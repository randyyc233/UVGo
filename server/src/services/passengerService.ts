import {
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReservationStatus,
  RouteCode,
  TripStatus,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { capturePayPalOrder, createPayPalOrder } from './paypalService.js';

const SERVICE_FEE = 20;
const activeReservationStatuses: ReservationStatus[] = [
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.PENDING_VERIFICATION,
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

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
  const trips = await prisma.trip.findMany({
    where: {
      route: RouteCode.GOA,
      status: { in: [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING] },
      scheduledOrTriggeredTime: dateRange(date),
    },
    orderBy: { scheduledOrTriggeredTime: 'asc' },
    include: {
      vehicle: { select: { vanId: true, capacity: true } },
      reservedSeats: {
        where: { reservation: { status: { in: activeReservationStatuses } } },
        select: { seatNumber: true },
      },
    },
  });

  return trips.map((trip) => ({
    id: trip.id,
    route: 'Goa' as const,
    origin: 'Naga City East Bound Terminal',
    destination: 'Goa Terminal',
    departureTime: trip.scheduledOrTriggeredTime.toISOString(),
    fare: Number(trip.fareAmount),
    serviceFee: SERVICE_FEE,
    vanId: trip.vehicle.vanId,
    capacity: trip.vehicle.capacity,
    availableSeats: trip.vehicle.capacity - trip.reservedSeats.length,
    canFitParty: trip.vehicle.capacity - trip.reservedSeats.length >= passengers,
  }));
}

export async function getTripSeats(tripId: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, route: RouteCode.GOA },
    include: {
      vehicle: { select: { vanId: true, capacity: true } },
      reservedSeats: {
        where: { reservation: { status: { in: activeReservationStatuses } } },
        select: { seatNumber: true },
      },
    },
  });
  if (!trip) throw new AppError(404, 'TRIP_NOT_FOUND', 'This Goa trip is no longer available.');

  const unavailable = new Set(trip.reservedSeats.map((seat) => seat.seatNumber));
  return {
    trip: {
      id: trip.id,
      route: 'Goa' as const,
      origin: 'Naga City East Bound Terminal',
      destination: 'Goa Terminal',
      departureTime: trip.scheduledOrTriggeredTime.toISOString(),
      fare: Number(trip.fareAmount),
      serviceFee: SERVICE_FEE,
      vanId: trip.vehicle.vanId,
      capacity: trip.vehicle.capacity,
    },
    seats: Array.from({ length: trip.vehicle.capacity }, (_, index) => ({
      number: index + 1,
      available: !unavailable.has(index + 1),
    })),
  };
}

interface ReservationInput {
  passengerId: string;
  tripId: string;
  seats: number[];
  contact: string;
}

function normalizeSeatConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats were just reserved. Please choose another.');
  }
  throw error;
}

async function createReservationRecord(
  transaction: Prisma.TransactionClient,
  input: ReservationInput,
  method: PaymentMethod,
  paymentStatus: PaymentStatus,
  reservationStatus: ReservationStatus,
  paymentMetadata: { gcashReference?: string; receiptImageKey?: string; receiptMimeType?: string } = {},
) {
  const trip = await transaction.trip.findUnique({ where: { id: input.tripId }, include: { vehicle: true } });
  if (!trip || trip.route !== RouteCode.GOA) throw new AppError(422, 'GOA_ONLY', 'Only Goa trips can be reserved.');
  if (trip.scheduledOrTriggeredTime <= new Date()) throw new AppError(409, 'TRIP_CLOSED', 'This trip is no longer open for reservations.');
  if (input.seats.some((seat) => seat > trip.vehicle.capacity)) throw new AppError(422, 'INVALID_SEAT', 'One or more seats do not exist on this van.');

  const occupied = await transaction.reservationSeat.findMany({
    where: { tripId: input.tripId, seatNumber: { in: input.seats }, reservation: { status: { in: activeReservationStatuses } } },
    select: { seatNumber: true },
  });
  if (occupied.length) throw new AppError(409, 'SEAT_UNAVAILABLE', `Seat ${occupied.map((seat) => seat.seatNumber).join(', ')} was just reserved. Please choose another.`);

  const fareAmount = Number(trip.fareAmount) * input.seats.length;
  const totalAmount = fareAmount + SERVICE_FEE;
  const reference = bookingReference();
  await transaction.user.update({ where: { id: input.passengerId }, data: { contact: input.contact } });
  const reservation = await transaction.reservation.create({
    data: {
      reference,
      passengerId: input.passengerId,
      tripId: trip.id,
      seatCount: input.seats.length,
      fareAmount,
      status: reservationStatus,
      seats: { create: input.seats.map((seatNumber) => ({ tripId: trip.id, seatNumber })) },
      payments: {
        create: {
          method,
          amount: totalAmount,
          status: paymentStatus,
          gcashReference: paymentMetadata.gcashReference || null,
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
  let result;
  try {
    result = await prisma.$transaction((transaction) => createReservationRecord(
      transaction,
      input,
      PaymentMethod.GCASH_RECEIPT,
      PaymentStatus.PENDING_VERIFICATION,
      ReservationStatus.PENDING_VERIFICATION,
      input,
    ));
  } catch (error) {
    normalizeSeatConflict(error);
  }
  await prisma.notification.create({ data: { userId: input.passengerId, type: NotificationType.PAYMENT, message: `GCash receipt received for ${result.reservation.reference}. Verification is pending.` } });
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
    normalizeSeatConflict(error);
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

export async function capturePaypalReservation(passengerId: string, reference: string) {
  const reservation = await prisma.reservation.findFirst({
    where: { reference, passengerId },
    include: { payments: { where: { method: PaymentMethod.PAYPAL }, take: 1 } },
  });
  const payment = reservation?.payments[0];
  if (!reservation || !payment?.paypalOrderId) throw new AppError(404, 'BOOKING_NOT_FOUND', 'PayPal booking was not found.');
  if (payment.status === PaymentStatus.CAPTURED) return getPassengerBooking(passengerId, reference);

  const captured = await capturePayPalOrder(payment.paypalOrderId);
  if (!captured.completed) throw new AppError(409, 'PAYPAL_NOT_COMPLETED', 'PayPal has not completed this payment.');
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CAPTURED, paidAt: new Date() } }),
    prisma.reservation.update({ where: { id: reservation.id }, data: { status: ReservationStatus.CONFIRMED } }),
    prisma.notification.create({ data: { userId: passengerId, type: NotificationType.BOOKING, message: `Your Goa booking ${reference} is confirmed.` } }),
  ]);
  return getPassengerBooking(passengerId, reference);
}

const bookingInclude = {
  trip: { include: { vehicle: { select: { vanId: true } } } },
  seats: { orderBy: { seatNumber: 'asc' as const } },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.ReservationInclude;

function serializeBooking(booking: Prisma.ReservationGetPayload<{ include: typeof bookingInclude }>) {
  const payment = booking.payments[0] ?? null;
  const hoursUntilDeparture = (booking.trip.scheduledOrTriggeredTime.getTime() - Date.now()) / 3_600_000;
  return {
    id: booking.id,
    tripId: booking.tripId,
    reference: booking.reference,
    route: 'Goa' as const,
    origin: 'Naga City East Bound Terminal',
    destination: 'Goa Terminal',
    departureTime: booking.trip.scheduledOrTriggeredTime.toISOString(),
    vanId: booking.trip.vehicle.vanId,
    seats: booking.seats.map((seat) => seat.seatNumber),
    seatCount: booking.seatCount,
    fareAmount: Number(booking.fareAmount),
    serviceFee: SERVICE_FEE,
    totalAmount: payment ? Number(payment.amount) : Number(booking.fareAmount) + SERVICE_FEE,
    status: booking.status.toLowerCase(),
    payment: payment ? {
      method: payment.method === PaymentMethod.PAYPAL ? 'paypal' : 'gcash',
      status: payment.status.toLowerCase(),
      gcashReference: payment.gcashReference,
    } : null,
    canReschedule: hoursUntilDeparture >= 24 && booking.status !== ReservationStatus.FORFEITED,
    rescheduleMessage: hoursUntilDeparture >= 24 ? 'Eligible to reschedule.' : 'Rescheduling closes 24 hours before departure.',
    createdAt: booking.createdAt.toISOString(),
  };
}

export async function getPassengerBookings(passengerId: string) {
  const bookings = await prisma.reservation.findMany({ where: { passengerId }, orderBy: { createdAt: 'desc' }, include: bookingInclude });
  return bookings.map(serializeBooking);
}

export async function getPassengerBooking(passengerId: string, reference: string) {
  const booking = await prisma.reservation.findFirst({ where: { passengerId, reference }, include: bookingInclude });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'This booking could not be found.');
  return serializeBooking(booking);
}

export async function reschedulePassengerBooking(passengerId: string, reference: string, tripId: string, seats: number[]) {
  await prisma.$transaction(async (transaction) => {
    const booking = await transaction.reservation.findFirst({ where: { passengerId, reference }, include: { trip: true } });
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'This booking could not be found.');
    if (booking.trip.scheduledOrTriggeredTime.getTime() - Date.now() < 86_400_000) {
      throw new AppError(409, 'RESCHEDULE_WINDOW_CLOSED', 'Rescheduling closes 24 hours before departure.');
    }
    if (seats.length !== booking.seatCount) throw new AppError(422, 'SEAT_COUNT_MISMATCH', `Choose exactly ${booking.seatCount} seat(s).`);
    const target = await transaction.trip.findUnique({ where: { id: tripId }, include: { vehicle: true } });
    if (!target || target.route !== RouteCode.GOA || target.scheduledOrTriggeredTime <= new Date()) {
      throw new AppError(422, 'INVALID_RESCHEDULE_TRIP', 'Choose a future Goa trip.');
    }
    if (seats.some((seat) => seat > target.vehicle.capacity)) throw new AppError(422, 'INVALID_SEAT', 'One or more seats do not exist on this van.');
    const occupied = await transaction.reservationSeat.findMany({ where: { tripId, seatNumber: { in: seats } } });
    if (occupied.length) throw new AppError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are no longer available.');
    await transaction.reservationSeat.deleteMany({ where: { reservationId: booking.id } });
    await transaction.reservation.update({
      where: { id: booking.id },
      data: {
        tripId,
        status: ReservationStatus.RESCHEDULED,
        seats: { create: seats.map((seatNumber) => ({ tripId, seatNumber })) },
      },
    });
    await transaction.notification.create({ data: { userId: passengerId, type: NotificationType.BOOKING, message: `Booking ${reference} was rescheduled.` } });
  });
  return getPassengerBooking(passengerId, reference);
}

export async function getPassengerNotifications(passengerId: string) {
  const notifications = await prisma.notification.findMany({ where: { userId: passengerId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return notifications.map((notification) => ({ ...notification, type: notification.type.toLowerCase(), createdAt: notification.createdAt.toISOString() }));
}
