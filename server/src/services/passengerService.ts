import {
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReservationStatus,
  RouteCode,
  TripStatus,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { boardingStartFor, MAX_PASSENGER_RESCHEDULES, reservationCutoffFor } from '../config/dispatch.js';
import { passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { toAuthenticatedUser } from './authService.js';
import { capturePayPalOrder, createPayPalOrder, getPayPalOrderState } from './paypalService.js';
import { calculateReservationFare, type PassengerDiscountInput } from './reservationFare.js';

const activeReservationStatuses: ReservationStatus[] = [
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.PENDING_VERIFICATION,
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

const bookableTripStatuses: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.ASSIGNING,
  TripStatus.ASSIGNED,
  TripStatus.BOARDING,
];

const reschedulableReservationStatuses: ReservationStatus[] = [
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

const dispatcherPaymentSelect = {
  name: true,
  contact: true,
  role: true,
  dispatcherRoute: true,
  isActive: true,
} satisfies Prisma.UserSelect;

type DispatcherPaymentCandidate = Prisma.UserGetPayload<{ select: typeof dispatcherPaymentSelect }>;

function gcashRecipient(
  route: RouteCode,
  ...candidates: Array<DispatcherPaymentCandidate | null | undefined>
) {
  const dispatcher = candidates.find((candidate) => (
    candidate?.role === UserRole.DISPATCHER
    && candidate.dispatcherRoute === route
    && candidate.isActive
    && Boolean(candidate.contact?.trim())
  ));

  return dispatcher?.contact ? {
    dispatcherName: dispatcher.name,
    mobileNumber: dispatcher.contact,
  } : null;
}

async function activeRouteDispatcher(route: RouteCode) {
  return prisma.user.findFirst({
    where: {
      role: UserRole.DISPATCHER,
      dispatcherRoute: route,
      isActive: true,
      contact: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: dispatcherPaymentSelect,
  });
}

function assertBookableTrip(trip: { route: RouteCode; status: TripStatus; scheduledOrTriggeredTime: Date; boardingStartTime: Date | null }) {
  if (trip.route !== RouteCode.GOA) throw new AppError(422, 'GOA_ONLY', 'Only Goa trips can be reserved.');
  if (!bookableTripStatuses.includes(trip.status) || trip.scheduledOrTriggeredTime <= new Date()) {
    throw new AppError(409, 'TRIP_CLOSED', 'This trip is no longer open for reservations. Choose another departure.');
  }
  if (reservationCutoffFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime) <= new Date()) {
    throw new AppError(409, 'TRIP_CLOSED', 'Reservations close 5 hours before loading time. Choose another departure.');
  }
}

function bookingReference() {
  const date = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  return `UVGO${date}${randomBytes(3).toString('hex').toUpperCase()}`;
}

function dateRange(date?: string) {
  if (!date) return { gte: new Date() };
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

export async function searchGoaTrips(date: string | undefined, passengers: number) {
  const [trips, routeDispatcher] = await Promise.all([
    prisma.trip.findMany({
      where: {
        route: RouteCode.GOA,
        status: { in: bookableTripStatuses },
        scheduledOrTriggeredTime: dateRange(date),
      },
      orderBy: { scheduledOrTriggeredTime: 'asc' },
      include: {
        createdByDispatcher: { select: dispatcherPaymentSelect },
        vehicle: {
          select: {
            vanId: true,
            capacity: true,
            managedByDispatcher: { select: dispatcherPaymentSelect },
          },
        },
        reservedSeats: {
          where: { reservation: { status: { in: activeReservationStatuses } } },
          select: { seatNumber: true },
        },
      },
    }),
    activeRouteDispatcher(RouteCode.GOA),
  ]);

  const now = new Date();
  return trips.filter((trip) => (
    trip.scheduledOrTriggeredTime > now
    && reservationCutoffFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime) > now
  )).map((trip) => {
    const capacity = passengerCapacityOf(trip.vehicle);
    const reservedSeatCount = trip.reservedSeats.filter((seat) => seat.seatNumber >= 1 && seat.seatNumber <= capacity).length;
    return {
      id: trip.id,
      route: 'Goa' as const,
      origin: 'Naga City East Bound Terminal',
      destination: 'Goa Terminal',
      boardingStartTime: boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).toISOString(),
      reservationCutoffTime: reservationCutoffFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).toISOString(),
      departureTime: trip.scheduledOrTriggeredTime.toISOString(),
      fare: Number(trip.fareAmount),
      vanId: trip.vehicle.vanId,
      capacity,
      availableSeats: capacity - reservedSeatCount,
      canFitParty: capacity - reservedSeatCount >= passengers,
      gcashRecipient: gcashRecipient(
        trip.route,
        trip.createdByDispatcher,
        trip.vehicle.managedByDispatcher,
        routeDispatcher,
      ),
    };
  });
}

export async function getTripSeats(tripId: string) {
  const [trip, routeDispatcher] = await Promise.all([
    prisma.trip.findFirst({
      where: { id: tripId, route: RouteCode.GOA },
      include: {
        createdByDispatcher: { select: dispatcherPaymentSelect },
        vehicle: {
          select: {
            vanId: true,
            capacity: true,
            managedByDispatcher: { select: dispatcherPaymentSelect },
          },
        },
        reservedSeats: {
          where: { reservation: { status: { in: activeReservationStatuses } } },
          select: { seatNumber: true },
        },
      },
    }),
    activeRouteDispatcher(RouteCode.GOA),
  ]);
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'This Goa trip is no longer available.');
  assertBookableTrip(trip);

  const capacity = passengerCapacityOf(trip.vehicle);
  const unavailable = new Set(trip.reservedSeats.map((seat) => seat.seatNumber));
  return {
    trip: {
      id: trip.id,
      route: 'Goa' as const,
      origin: 'Naga City East Bound Terminal',
      destination: 'Goa Terminal',
      boardingStartTime: boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).toISOString(),
      reservationCutoffTime: reservationCutoffFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).toISOString(),
      departureTime: trip.scheduledOrTriggeredTime.toISOString(),
      fare: Number(trip.fareAmount),
      vanId: trip.vehicle.vanId,
      capacity,
      gcashRecipient: gcashRecipient(
        trip.route,
        trip.createdByDispatcher,
        trip.vehicle.managedByDispatcher,
        routeDispatcher,
      ),
    },
    seats: Array.from({ length: capacity }, (_, index) => ({
      number: index + 1,
      available: !unavailable.has(index + 1),
    })),
  };
}

interface ReservationInput extends PassengerDiscountInput {
  passengerId: string;
  tripId: string;
  seats: number[];
  contact: string;
}

export async function quoteReservationFare(input: Omit<ReservationInput, 'passengerId' | 'contact'>) {
  const trip = await prisma.trip.findUnique({ where: { id: input.tripId }, include: { vehicle: true } });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'This Goa trip is no longer available.');
  assertBookableTrip(trip);
  if (input.seats.some((seat) => seat < 1 || seat > passengerCapacityOf(trip.vehicle))) throw new AppError(422, 'INVALID_SEAT', 'Choose valid passenger seats.');
  return calculateReservationFare(trip.fareAmount, input.seats.length, { ...input, discountIdAcknowledged: true });
}

function normalizeReservationConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    if (String(error.meta?.target ?? '').includes('externalReferenceKey')) {
      throw new AppError(409, 'PAYMENT_REFERENCE_ALREADY_REPORTED', 'This payment reference has already been submitted. Check My Bookings instead of submitting it again.');
    }
    throw new AppError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats were just reserved. Please choose another.');
  }
  throw error;
}

function externalPaymentReferenceKey(method: PaymentMethod, value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized ? `${method}:${normalized}` : undefined;
}

async function createReservationRecord(
  transaction: Prisma.TransactionClient,
  input: ReservationInput,
  method: PaymentMethod,
  paymentStatus: PaymentStatus,
  reservationStatus: ReservationStatus,
  paymentMetadata: {
    gcashReference?: string;
    externalReferenceKey?: string;
    receiptImageKey?: string;
    receiptMimeType?: string;
  } = {},
) {
  const trip = await transaction.trip.findUnique({ where: { id: input.tripId }, include: { vehicle: true } });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'This Goa trip is no longer available.');
  assertBookableTrip(trip);
  const capacity = passengerCapacityOf(trip.vehicle);
  if (input.seats.some((seat) => seat < 1 || seat > capacity)) throw new AppError(422, 'INVALID_SEAT', `Choose a seat from 1 to ${capacity}.`);

  const occupied = await transaction.reservationSeat.findMany({
    where: { tripId: input.tripId, seatNumber: { in: input.seats }, reservation: { status: { in: activeReservationStatuses } } },
    select: { seatNumber: true },
  });
  if (occupied.length) throw new AppError(409, 'SEAT_UNAVAILABLE', `Seat ${occupied.map((seat) => seat.seatNumber).join(', ')} was just reserved. Please choose another.`);

  const fare = calculateReservationFare(trip.fareAmount, input.seats.length, input);
  const fareAmount = fare.subtotal;
  // The fare is the full per-seat price; there is no separate service fee.
  const totalAmount = fare.totalAmount;
  const reference = bookingReference();
  await transaction.user.update({ where: { id: input.passengerId }, data: { contact: input.contact } });
  const reservation = await transaction.reservation.create({
    data: {
      reference,
      passengerId: input.passengerId,
      tripId: trip.id,
      seatCount: input.seats.length,
      fareAmount,
      studentPassengers: fare.studentPassengers,
      seniorPassengers: fare.seniorPassengers,
      discountAmount: fare.discountAmount,
      status: reservationStatus,
      seats: { create: input.seats.map((seatNumber) => ({ tripId: trip.id, seatNumber })) },
      payments: {
        create: {
          method,
          amount: totalAmount,
          status: paymentStatus,
          gcashReference: paymentMetadata.gcashReference || null,
          externalReferenceKey: paymentMetadata.externalReferenceKey,
          receiptImageKey: paymentMetadata.receiptImageKey,
          receiptMimeType: paymentMetadata.receiptMimeType,
        },
      },
    },
    include: { payments: true },
  });
  return { reservation, totalAmount };
}

export async function createGcashReservation(input: ReservationInput & { gcashReference?: string; receiptImageKey: string; receiptMimeType: string }) {
  const gcashReference = input.gcashReference?.trim();
  const externalReferenceKey = externalPaymentReferenceKey(PaymentMethod.GCASH_RECEIPT, gcashReference);
  let result;
  try {
    result = await prisma.$transaction(async (transaction) => {
      if (externalReferenceKey && await transaction.payment.findUnique({ where: { externalReferenceKey }, select: { id: true } })) {
        throw new AppError(409, 'PAYMENT_REFERENCE_ALREADY_REPORTED', 'This GCash reference has already been submitted. Check My Bookings instead of submitting it again.');
      }
      const created = await createReservationRecord(
        transaction,
        input,
        PaymentMethod.GCASH_RECEIPT,
        PaymentStatus.PENDING_VERIFICATION,
        ReservationStatus.PENDING_VERIFICATION,
        { ...input, gcashReference, externalReferenceKey },
      );
      await transaction.notification.create({ data: { userId: input.passengerId, type: NotificationType.PAYMENT, message: `GCash receipt received for ${created.reservation.reference}. Verification is pending.` } });
      return created;
    });
  } catch (error) {
    normalizeReservationConflict(error);
  }
  return getPassengerBooking(input.passengerId, result.reservation.reference);
}

/**
 * Creates the reservation that backs a dashboard-configured ("hosted") PayPal
 * button payment.
 *
 * The hosted button charges the passenger on PayPal's own checkout page, which
 * never hands an order id back to UVGo, so this path cannot be captured
 * server-side the way `createPaypalReservation` is. The reservation is
 * therefore parked at PENDING_VERIFICATION, exactly like a GCash receipt, and a
 * dispatcher confirms it once the payment shows up in the PayPal account.
 *
 * A required uploaded receipt supports dispatcher review; the payment still
 * needs verification in the merchant account. `paypalOrderId` is not set because
 * there is no order id to record; `paypalTransactionReference` stores whatever
 * reference the passenger supplies from their PayPal receipt.
 */
export async function createPaypalHostedReservation(input: ReservationInput & { paypalTransactionReference?: string; receiptImageKey: string; receiptMimeType: string }) {
  if (!input.receiptImageKey || !input.receiptMimeType) throw new AppError(422, 'RECEIPT_REQUIRED', 'Upload your PayPal receipt before continuing.');
  const paypalTransactionReference = input.paypalTransactionReference?.trim();
  const externalReferenceKey = externalPaymentReferenceKey(PaymentMethod.PAYPAL, paypalTransactionReference);
  let result;
  try {
    result = await prisma.$transaction(async (transaction) => {
      if (externalReferenceKey && await transaction.payment.findUnique({ where: { externalReferenceKey }, select: { id: true } })) {
        throw new AppError(409, 'PAYPAL_REFERENCE_ALREADY_REPORTED', 'This PayPal transaction reference has already been submitted. Check My Bookings instead of submitting it again.');
      }
      const created = await createReservationRecord(
        transaction,
        input,
        PaymentMethod.PAYPAL,
        PaymentStatus.PENDING_VERIFICATION,
        ReservationStatus.PENDING_VERIFICATION,
        { gcashReference: paypalTransactionReference, externalReferenceKey, receiptImageKey: input.receiptImageKey, receiptMimeType: input.receiptMimeType },
      );
      await transaction.notification.create({ data: { userId: input.passengerId, type: NotificationType.PAYMENT, message: `PayPal payment reported for ${created.reservation.reference}. Verification is pending.` } });
      return created;
    });
  } catch (error) {
    normalizeReservationConflict(error);
  }
  return getPassengerBooking(input.passengerId, result.reservation.reference);
}

export async function createPaypalReservation(input: ReservationInput) {
  let result;
  try {
    result = await prisma.$transaction((transaction) => createReservationRecord(
      transaction,
      input,
      PaymentMethod.PAYPAL,
      PaymentStatus.PENDING,
      ReservationStatus.PENDING_PAYMENT,
    ));
  } catch (error) {
    normalizeReservationConflict(error);
  }
  try {
    const order = await createPayPalOrder(result.reservation.reference, result.totalAmount);
    const payment = result.reservation.payments[0];
    if (!payment) throw new AppError(500, 'PAYMENT_NOT_CREATED', 'The PayPal payment record was not created.');
    await prisma.payment.update({ where: { id: payment.id }, data: { paypalOrderId: order.orderId } });
    return { reference: result.reservation.reference, ...order };
  } catch (error) {
    await prisma.reservation.delete({ where: { id: result.reservation.id } });
    throw error;
  }
}

async function confirmCapturedPaypal(
  transaction: Prisma.TransactionClient, paymentId: string, reservationId: string,
  passengerId: string, reference: string, captureId: string | null,
) {
  const updated = await transaction.payment.updateMany({
    where: { id: paymentId, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.CAPTURED, paidAt: new Date(), ...(captureId ? { externalReferenceKey: externalPaymentReferenceKey(PaymentMethod.PAYPAL, captureId) } : {}) },
  });
  if (!updated.count) return;
  await transaction.reservation.update({ where: { id: reservationId }, data: { status: ReservationStatus.CONFIRMED } });
  await transaction.notification.create({ data: { userId: passengerId, type: NotificationType.BOOKING, message: `Your Goa booking ${reference} is confirmed. Bring a valid ID and your reservation reference to the terminal.` } });
}

export async function capturePaypalReservation(passengerId: string, reference: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { reference, passengerId }, include: { payments: { where: { method: PaymentMethod.PAYPAL }, take: 1 } },
  });
  const payment = reservation?.payments[0];
  if (!reservation || !payment?.paypalOrderId) throw new AppError(404, 'BOOKING_NOT_FOUND', 'PayPal booking was not found.');
  if (payment.status === PaymentStatus.CAPTURED) return getPassengerBooking(passengerId, reference);

  await prisma.$transaction(async (transaction) => {
    // Capture and cancellation share the payment row lock, including the provider call.
    await transaction.$queryRaw`SELECT id FROM Payment WHERE id = ${payment.id} FOR UPDATE`;
    const current = await transaction.payment.findUnique({ where: { id: payment.id }, include: { reservation: true } });
    if (!current) throw new AppError(404, 'BOOKING_NOT_FOUND', 'PayPal booking was not found.');
    if (current.status === PaymentStatus.CAPTURED) return;
    if (current.status !== PaymentStatus.PENDING || current.reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new AppError(409, 'PAYPAL_BOOKING_NOT_PENDING', 'This reservation is not awaiting a PayPal payment.');
    }
    const captured = await capturePayPalOrder(current.paypalOrderId!, { reference, amount: Number(current.amount) });
    if (!captured.completed) throw new AppError(409, 'PAYPAL_NOT_COMPLETED', 'PayPal has not completed this payment. Check again after approval; do not pay again if a payment is pending.');
    await confirmCapturedPaypal(transaction, current.id, reservation.id, passengerId, reference, captured.captureId);
  }, { maxWait: 10_000, timeout: 90_000 });
  return getPassengerBooking(passengerId, reference);
}

/** Release only a verified unpaid checkout. Recover completed payments instead of deleting them. */
export async function releasePaypalReservation(passengerId: string, reference: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { reference, passengerId }, include: { payments: { where: { method: PaymentMethod.PAYPAL }, take: 1 } },
  });
  const payment = reservation?.payments[0];
  if (!reservation || !payment?.paypalOrderId) return { released: false };
  const released = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM Payment WHERE id = ${payment.id} FOR UPDATE`;
    const current = await transaction.payment.findUnique({ where: { id: payment.id }, include: { reservation: true } });
    if (!current || current.status !== PaymentStatus.PENDING || current.reservation.status !== ReservationStatus.PENDING_PAYMENT) return false;
    const state = await getPayPalOrderState(current.paypalOrderId!, { reference, amount: Number(current.amount) });
    if (state.status === 'completed') {
      await confirmCapturedPaypal(transaction, current.id, reservation.id, passengerId, reference, state.captureId);
      return false;
    }
    if (state.status !== 'unpaid') return false;
    await transaction.reservation.delete({ where: { id: reservation.id } });
    return true;
  }, { maxWait: 10_000, timeout: 60_000 });
  return { released, ...(!released ? { booking: await getPassengerBooking(passengerId, reference) } : {}) };
}

const bookingInclude = {
  trip: {
    include: {
      createdByDispatcher: { select: dispatcherPaymentSelect },
      vehicle: {
        select: {
          vanId: true,
          managedByDispatcher: { select: dispatcherPaymentSelect },
        },
      },
    },
  },
  seats: { orderBy: { seatNumber: 'asc' as const } },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.ReservationInclude;

function serializeBooking(
  booking: Prisma.ReservationGetPayload<{ include: typeof bookingInclude }>,
  routeDispatcher?: DispatcherPaymentCandidate | null,
) {
  const payment = booking.payments[0] ?? null;
  const rescheduleCutoffTime = reservationCutoffFor(booking.trip.scheduledOrTriggeredTime, booking.trip.boardingStartTime);
  const rescheduleWindowOpen = Date.now() < rescheduleCutoffTime.getTime();
  const reschedulesRemaining = Math.max(0, MAX_PASSENGER_RESCHEDULES - booking.rescheduleCount);
  const reschedulableStatus = reschedulableReservationStatuses.includes(booking.status);
  return {
    id: booking.id,
    tripId: booking.tripId,
    reference: booking.reference,
    route: 'Goa' as const,
    origin: 'Naga City East Bound Terminal',
    destination: 'Goa Terminal',
    boardingStartTime: boardingStartFor(booking.trip.scheduledOrTriggeredTime, booking.trip.boardingStartTime).toISOString(),
    departureTime: booking.trip.scheduledOrTriggeredTime.toISOString(),
    vanId: booking.trip.vehicle.vanId,
    seats: booking.seats.map((seat) => seat.seatNumber),
    seatCount: booking.seatCount,
    fareAmount: Number(booking.fareAmount),
    studentPassengers: booking.studentPassengers,
    seniorPassengers: booking.seniorPassengers,
    discountAmount: Number(booking.discountAmount),
    totalAmount: payment ? Number(payment.amount) : Number(booking.fareAmount),
    status: booking.status.toLowerCase(),
    payment: payment ? {
      method: payment.method === PaymentMethod.PAYPAL
        ? 'paypal'
        : payment.method === PaymentMethod.GCASH_RECEIPT
          ? 'gcash'
          : 'legacy',
      status: payment.status.toLowerCase(),
      transactionReference: (payment.method === PaymentMethod.PAYPAL && payment.status === PaymentStatus.CAPTURED ? payment.externalReferenceKey?.replace(/^PAYPAL:/, '') : null)
        ?? payment.paypalOrderId
        ?? payment.gcashReference
        ?? (payment.method === PaymentMethod.LEGACY ? payment.externalReferenceKey?.replace(/^LEGACY:/, '') : null),
      gcashReference: payment.gcashReference,
      rejectionReason: payment.rejectionReason,
    } : null,
    gcashRecipient: gcashRecipient(
      booking.trip.route,
      booking.trip.createdByDispatcher,
      booking.trip.vehicle.managedByDispatcher,
      routeDispatcher,
    ),
    rescheduleCutoffTime: rescheduleCutoffTime.toISOString(),
    rescheduleCount: booking.rescheduleCount,
    rescheduleLimit: MAX_PASSENGER_RESCHEDULES,
    reschedulesRemaining,
    canReschedule: rescheduleWindowOpen && reschedulableStatus && reschedulesRemaining > 0,
    rescheduleMessage: !reschedulableStatus
      ? 'Payment must be confirmed before this booking can be rescheduled.'
      : reschedulesRemaining === 0
        ? 'The limit of 3 reschedules for this reservation has been reached.'
        : rescheduleWindowOpen
          ? 'Reschedule before the cutoff, up to 3 times per reservation.'
          : 'Rescheduling closes 5 hours before loading time.',
    createdAt: booking.createdAt.toISOString(),
  };
}

export async function getPassengerBookings(passengerId: string) {
  const [bookings, routeDispatcher] = await Promise.all([
    prisma.reservation.findMany({ where: { passengerId }, orderBy: { createdAt: 'desc' }, include: bookingInclude }),
    activeRouteDispatcher(RouteCode.GOA),
  ]);
  return bookings.map((booking) => serializeBooking(booking, routeDispatcher));
}

export async function getPassengerBooking(passengerId: string, reference: string) {
  const [booking, routeDispatcher] = await Promise.all([
    prisma.reservation.findFirst({ where: { passengerId, reference }, include: bookingInclude }),
    activeRouteDispatcher(RouteCode.GOA),
  ]);
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'This booking could not be found.');
  return serializeBooking(booking, routeDispatcher);
}

export async function reschedulePassengerBooking(passengerId: string, reference: string, tripId: string, seats: number[]) {
  try {
    await prisma.$transaction(async (transaction) => {
      // Serialize requests for this passenger's booking before reading its count,
      // current trip, or seats, so concurrent tabs cannot exceed the limit.
      await transaction.$queryRaw`SELECT id FROM Reservation WHERE reference = ${reference} AND passengerId = ${passengerId} FOR UPDATE`;
      const booking = await transaction.reservation.findFirst({ where: { passengerId, reference }, include: { trip: true, seats: true } });
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'This booking could not be found.');
      if (!reschedulableReservationStatuses.includes(booking.status)) {
        throw new AppError(409, 'BOOKING_NOT_RESCHEDULABLE', 'Only a confirmed booking can be rescheduled.');
      }
      if (booking.rescheduleCount >= MAX_PASSENGER_RESCHEDULES) {
        throw new AppError(409, 'RESCHEDULE_LIMIT_REACHED', 'The limit of 3 reschedules for this reservation has been reached.');
      }
      if (reservationCutoffFor(booking.trip.scheduledOrTriggeredTime, booking.trip.boardingStartTime).getTime() <= Date.now()) {
        throw new AppError(409, 'RESCHEDULE_WINDOW_CLOSED', 'Rescheduling closes 5 hours before loading time.');
      }
      if (seats.length !== booking.seatCount) throw new AppError(422, 'SEAT_COUNT_MISMATCH', `Choose exactly ${booking.seatCount} seat(s).`);
      if (tripId === booking.tripId && booking.seats.every((seat) => seats.includes(seat.seatNumber))) {
        throw new AppError(409, 'RESCHEDULE_UNCHANGED', 'Choose a different trip or seats to reschedule this booking.');
      }
      const target = await transaction.trip.findUnique({ where: { id: tripId }, include: { vehicle: true } });
      if (!target || target.route !== RouteCode.GOA || !bookableTripStatuses.includes(target.status) || target.scheduledOrTriggeredTime <= new Date()) {
        throw new AppError(422, 'INVALID_RESCHEDULE_TRIP', 'Choose an open future Goa trip.');
      }
      assertBookableTrip(target);
      const capacity = passengerCapacityOf(target.vehicle);
      if (seats.some((seat) => seat < 1 || seat > capacity)) throw new AppError(422, 'INVALID_SEAT', `Choose a seat from 1 to ${capacity}.`);
      const occupied = await transaction.reservationSeat.findMany({
        where: {
          reservationId: { not: booking.id },
          tripId,
          seatNumber: { in: seats },
          reservation: { status: { in: activeReservationStatuses } },
        },
      });
      if (occupied.length) throw new AppError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are no longer available.');
      await transaction.reservationSeat.deleteMany({ where: { reservationId: booking.id } });
      await transaction.reservation.update({
        where: { id: booking.id },
        data: {
          tripId,
          status: ReservationStatus.RESCHEDULED,
          rescheduleCount: { increment: 1 },
          seats: { create: seats.map((seatNumber) => ({ tripId, seatNumber })) },
        },
      });
      await transaction.notification.create({ data: { userId: passengerId, type: NotificationType.BOOKING, message: `Booking ${reference} was rescheduled.` } });
    });
  } catch (error) {
    normalizeReservationConflict(error);
  }
  return getPassengerBooking(passengerId, reference);
}

export async function getPassengerNotifications(passengerId: string) {
  const notifications = await prisma.notification.findMany({ where: { userId: passengerId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return notifications.map((notification) => ({ ...notification, type: notification.type.toLowerCase(), createdAt: notification.createdAt.toISOString() }));
}

export async function markPassengerNotificationRead(passengerId: string, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId: passengerId },
    data: { isRead: true },
  });
  if (!result.count) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'This notification is no longer available.');
}

export async function markAllPassengerNotificationsRead(passengerId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId: passengerId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

export async function deletePassengerNotification(passengerId: string, notificationId: string) {
  const result = await prisma.notification.deleteMany({ where: { id: notificationId, userId: passengerId } });
  if (!result.count) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'This notification is no longer available.');
}

interface PassengerProfileInput {
  name: string;
  email: string;
  contact: string;
}

export async function updatePassengerProfile(passengerId: string, input: PassengerProfileInput) {
  try {
    const user = await prisma.user.update({
      where: { id: passengerId },
      data: {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        contact: input.contact.trim(),
      },
    });
    return toAuthenticatedUser(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(409, 'EMAIL_ALREADY_IN_USE', 'Another UVGo account already uses this email address.');
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new AppError(404, 'PASSENGER_NOT_FOUND', 'This passenger profile is no longer available.');
    }
    throw error;
  }
}

export async function changePassengerPassword(passengerId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: passengerId } });
  if (!user) throw new AppError(404, 'PASSENGER_NOT_FOUND', 'This passenger profile is no longer available.');
  if (!(await compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', 'The current password you entered is incorrect.');
  }

  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: passengerId },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
}
