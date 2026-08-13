import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AssignmentStatus,
  DispatchAction,
  NotificationType,
  PaymentMethod,
  PaymentStatus,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  VehicleStatus,
} from '@prisma/client';
import { NCEBT } from '../config/terminal.js';
import { prisma } from '../lib/prisma.js';
import { receiptDirectory } from '../middleware/receiptUpload.js';
import { AppError } from '../utils/AppError.js';
import { reallocateUnavailableVehicle } from './automationService.js';

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };
const activeTripStatuses: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY, TripStatus.DELAYED];
const terminalVehicleStatuses: VehicleStatus[] = [VehicleStatus.AT_TERMINAL, VehicleStatus.WAITING, VehicleStatus.LOADING, VehicleStatus.READY_FOR_DISPATCH];

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function displayCoordinates(index: number, inside: boolean) {
  const insideOffsets = [[0.0037, 0.0104], [-0.006, 0.015], [0.012, -0.014], [-0.01, -0.009]];
  const outsideOffsets = [[0.06, 0.052], [-0.065, -0.04]];
  const offset = (inside ? insideOffsets : outsideOffsets)[index % (inside ? insideOffsets.length : outsideOffsets.length)] ?? [0, 0];
  return { latitude: NCEBT.latitude + (offset[0] ?? 0), longitude: NCEBT.longitude + (offset[1] ?? 0) };
}

async function queueRows(route?: RouteCode) {
  const entries = await prisma.queueEntry.findMany({
    where: { route, status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } },
    orderBy: [{ route: 'asc' }, { position: 'asc' }],
    include: {
      vehicle: {
        include: {
          assignedDriver: { select: { name: true } },
          trips: {
            where: { status: { in: activeTripStatuses } },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
            take: 1,
            include: {
              passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 },
              reservations: { where: { status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED, ReservationStatus.REALLOCATED] } }, select: { seatCount: true } },
              assignments: { orderBy: { assignedAt: 'desc' }, take: 1, include: { driver: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  return entries.map((entry) => {
    const trip = entry.vehicle.trips[0] ?? null;
    const reservationCount = trip?.reservations.reduce((total, reservation) => total + reservation.seatCount, 0) ?? 0;
    const occupancy = Math.min(entry.vehicle.capacity, trip?.passengerCounts[0]?.count ?? reservationCount);
    const assignment = trip?.assignments[0] ?? null;
    return {
      id: entry.id,
      route: routeLabels[entry.route],
      routeCode: entry.route.toLowerCase(),
      position: entry.position,
      vanId: entry.vehicle.vanId,
      driver: entry.vehicle.assignedDriver?.name ?? 'Unassigned',
      arrivalTimestamp: entry.arrivalTimestamp.toISOString(),
      occupancy,
      capacity: entry.vehicle.capacity,
      status: entry.status.toLowerCase(),
      vehicleStatus: entry.vehicle.status.toLowerCase(),
      tripId: trip?.id ?? null,
      departureTime: trip?.scheduledOrTriggeredTime.toISOString() ?? null,
      assignment: assignment ? { id: assignment.id, driver: assignment.driver.name, status: assignment.status.toLowerCase(), responseDeadline: assignment.responseDeadline.toISOString() } : null,
    };
  });
}

export async function getDispatcherDashboard() {
  const [vehicles, queues, pendingGcash, tripsDispatched, trips, geofenceEvents, logs, assignments] = await Promise.all([
    prisma.vehicle.findMany(),
    queueRows(),
    prisma.payment.count({ where: { method: PaymentMethod.GCASH_RECEIPT, status: PaymentStatus.PENDING_VERIFICATION } }),
    prisma.trip.count({ where: { departedAt: { gte: startOfToday() } } }),
    prisma.trip.findMany({ where: { status: { in: activeTripStatuses } }, orderBy: { scheduledOrTriggeredTime: 'asc' }, take: 6, include: { vehicle: { select: { vanId: true, capacity: true } }, passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 } } }),
    prisma.geofenceEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 5, include: { vehicle: { select: { vanId: true, route: true } } } }),
    prisma.dispatchLog.findMany({ orderBy: { timestamp: 'desc' }, take: 5, include: { actor: { select: { name: true } } } }),
    prisma.tripAssignment.findMany({
      where: { status: AssignmentStatus.PENDING },
      orderBy: { assignedAt: 'desc' },
      take: 5,
      include: {
        trip: true,
        driver: { select: { name: true } },
        queueEntry: { include: { vehicle: { select: { vanId: true } } } },
      },
    }),
  ]);
  const passengerWaiting = queues.reduce((total, entry) => total + entry.occupancy, 0);
  const alerts = [
    ...vehicles.filter((vehicle) => vehicle.status === VehicleStatus.DELAYED).map((vehicle) => ({ id: `vehicle-${vehicle.id}`, tone: 'danger', title: 'Van delayed', message: `${vehicle.vanId} requires dispatcher attention.`, timestamp: vehicle.updatedAt.toISOString() })),
    ...(pendingGcash ? [{ id: 'pending-gcash', tone: 'warning', title: 'Payment verification', message: `${pendingGcash} GCash receipt${pendingGcash === 1 ? '' : 's'} awaiting review.`, timestamp: new Date().toISOString() }] : []),
    ...assignments.map((assignment) => ({ id: assignment.id, tone: 'info', title: 'Driver response pending', message: `${assignment.driver.name} · ${assignment.queueEntry.vehicle.vanId} · ${routeLabels[assignment.trip.route]}`, timestamp: assignment.assignedAt.toISOString() })),
  ].slice(0, 6);
  return {
    metrics: {
      vansAtTerminal: vehicles.filter((vehicle) => terminalVehicleStatuses.includes(vehicle.status)).length,
      incomingVans: vehicles.filter((vehicle) => vehicle.status === VehicleStatus.INCOMING).length,
      activeRoutes: new Set(vehicles.map((vehicle) => vehicle.route)).size,
      passengersWaiting: passengerWaiting,
      pendingGcash,
      tripsDispatchedToday: tripsDispatched,
    },
    alerts,
    departures: trips.map((trip) => ({ id: trip.id, route: routeLabels[trip.route], vanId: trip.vehicle.vanId, departureTime: trip.scheduledOrTriggeredTime.toISOString(), occupancy: trip.passengerCounts[0]?.count ?? 0, capacity: trip.vehicle.capacity, status: trip.status.toLowerCase() })),
    activity: [
      ...geofenceEvents.map((event) => ({ id: event.id, type: 'geofence', title: `${event.vehicle.vanId} ${event.eventType === 'ENTERED' ? 'entered' : 'exited'} Active Zone`, detail: routeLabels[event.vehicle.route], timestamp: event.timestamp.toISOString() })),
      ...logs.map((log) => ({ id: log.id, type: 'dispatch', title: log.action.toLowerCase().replaceAll('_', ' '), detail: `${log.actor.name} · ${log.reason ?? log.targetId}`, timestamp: log.timestamp.toISOString() })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 7),
  };
}

export async function getFleetSnapshot() {
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { vanId: 'asc' },
    include: {
      assignedDriver: { select: { name: true } },
      geofenceEvents: { orderBy: { timestamp: 'desc' }, take: 1 },
      queueEntries: { where: { status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const events = await prisma.geofenceEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 12, include: { vehicle: { select: { vanId: true, route: true } } } });
  return {
    terminal: NCEBT,
    vehicles: vehicles.map((vehicle, index) => {
      const event = vehicle.geofenceEvents[0];
      const fallback = displayCoordinates(index, vehicle.lastKnownInsideZone);
      return {
        id: vehicle.id,
        vanId: vehicle.vanId,
        driver: vehicle.assignedDriver?.name ?? 'Unassigned',
        route: routeLabels[vehicle.route],
        routeCode: vehicle.route.toLowerCase(),
        status: vehicle.status.toLowerCase(),
        insideActiveZone: vehicle.lastKnownInsideZone,
        queuePosition: vehicle.queueEntries[0]?.position ?? null,
        latitude: event?.latitude ? Number(event.latitude) : fallback.latitude,
        longitude: event?.longitude ? Number(event.longitude) : fallback.longitude,
        updatedAt: event?.timestamp.toISOString() ?? vehicle.updatedAt.toISOString(),
      };
    }),
    events: events.map((event) => ({ id: event.id, vanId: event.vehicle.vanId, route: routeLabels[event.vehicle.route], eventType: event.eventType.toLowerCase(), timestamp: event.timestamp.toISOString(), distanceKm: event.distanceKm ? Number(event.distanceKm) : null })),
    updatedAt: new Date().toISOString(),
  };
}

export async function getDispatcherQueue(route?: string) {
  const routeCode = route?.toUpperCase() as RouteCode | undefined;
  if (routeCode && !Object.values(RouteCode).includes(routeCode)) throw new AppError(422, 'INVALID_ROUTE', 'Queue route must be Goa or Legazpi.');
  return { entries: await queueRows(routeCode), updatedAt: new Date().toISOString() };
}

interface QueueActionInput { action: 'dispatch' | 'override' | 'move_to_last' | 'mark_delayed' | 'replace' | 'notify_driver'; reason: string; newPosition?: number }

export async function applyQueueAction(actorUserId: string, queueEntryId: string, input: QueueActionInput) {
  const entry = await prisma.queueEntry.findUnique({ where: { id: queueEntryId }, include: { vehicle: true } });
  if (!entry) throw new AppError(404, 'QUEUE_ENTRY_NOT_FOUND', 'This queue entry was not found.');

  if (input.action === 'dispatch') {
    if (!entry.vehicle.assignedDriverId) throw new AppError(409, 'DRIVER_REQUIRED', 'Assign a driver before dispatching this van.');
    let trip = await prisma.trip.findFirst({ where: { vehicleId: entry.vehicleId, status: { in: activeTripStatuses } }, orderBy: { scheduledOrTriggeredTime: 'asc' } });
    if (!trip) {
      trip = await prisma.trip.create({ data: { vehicleId: entry.vehicleId, route: entry.route, scheduledOrTriggeredTime: new Date(Date.now() + (entry.route === RouteCode.GOA ? 30 * 60_000 : 0)), status: TripStatus.ASSIGNING, fareAmount: entry.route === RouteCode.GOA ? 190 : 250 } });
    }
    await prisma.$transaction([
      prisma.tripAssignment.upsert({
        where: { tripId_queueEntryId: { tripId: trip.id, queueEntryId: entry.id } },
        update: { driverId: entry.vehicle.assignedDriverId, status: AssignmentStatus.PENDING, assignedAt: new Date(), respondedAt: null, responseDeadline: new Date(Date.now() + 5 * 60_000) },
        create: { tripId: trip.id, queueEntryId: entry.id, driverId: entry.vehicle.assignedDriverId, responseDeadline: new Date(Date.now() + 5 * 60_000) },
      }),
      prisma.queueEntry.update({ where: { id: entry.id }, data: { status: QueueStatus.ASSIGNED } }),
      prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.ASSIGNING } }),
      prisma.notification.create({ data: { userId: entry.vehicle.assignedDriverId, type: NotificationType.ASSIGNMENT, message: `A ${routeLabels[entry.route]} trip assignment is awaiting your response.` } }),
      prisma.dispatchLog.create({ data: { actorUserId, action: DispatchAction.ASSIGNMENT_CREATED, targetId: trip.id, metadata: { queueEntryId: entry.id } } }),
    ]);
    return getDispatcherQueue(entry.route.toLowerCase());
  }

  if (input.action === 'notify_driver') {
    if (!entry.vehicle.assignedDriverId) throw new AppError(409, 'DRIVER_REQUIRED', 'This vehicle has no assigned driver.');
    await prisma.$transaction([
      prisma.notification.create({ data: { userId: entry.vehicle.assignedDriverId, type: NotificationType.QUEUE, message: input.reason || `Dispatcher update for ${entry.vehicle.vanId}.` } }),
      prisma.dispatchLog.create({ data: { actorUserId, action: DispatchAction.DRIVER_NOTIFIED, targetId: entry.id, reason: input.reason || null } }),
    ]);
    return getDispatcherQueue(entry.route.toLowerCase());
  }

  if (input.action === 'mark_delayed') {
    await prisma.$transaction([
      prisma.queueEntry.update({ where: { id: entry.id }, data: { status: QueueStatus.DELAYED } }),
      prisma.vehicle.update({ where: { id: entry.vehicleId }, data: { status: VehicleStatus.DELAYED } }),
      prisma.dispatchLog.create({ data: { actorUserId, action: DispatchAction.QUEUE_OVERRIDDEN, targetId: entry.id, reason: input.reason, metadata: { operation: 'mark_delayed' } } }),
    ]);
    return getDispatcherQueue(entry.route.toLowerCase());
  }

  if (input.action === 'replace') {
    const reallocation = await reallocateUnavailableVehicle(actorUserId, entry.vehicleId, input.reason);
    return { ...await getDispatcherQueue(entry.route.toLowerCase()), reallocation };
  }

  const ordered = await prisma.queueEntry.findMany({ where: { route: entry.route, status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } }, orderBy: [{ position: 'asc' }, { arrivalTimestamp: 'asc' }] });
  const withoutTarget = ordered.filter((item) => item.id !== entry.id);
  const targetIndex = input.action === 'move_to_last' ? withoutTarget.length : Math.min((input.newPosition ?? 1) - 1, withoutTarget.length);
  withoutTarget.splice(targetIndex, 0, entry);
  await prisma.$transaction([
    ...withoutTarget.map((item, index) => prisma.queueEntry.update({ where: { id: item.id }, data: { position: index + 1 } })),
    prisma.dispatchLog.create({ data: { actorUserId, action: input.action === 'move_to_last' ? DispatchAction.MOVED_TO_LAST : DispatchAction.QUEUE_OVERRIDDEN, targetId: entry.id, reason: input.reason || null, metadata: { oldPosition: entry.position, newPosition: targetIndex + 1 } } }),
  ]);
  return getDispatcherQueue(entry.route.toLowerCase());
}

const paymentInclude = {
  reservation: { include: { passenger: { select: { name: true, contact: true } }, trip: { select: { route: true, scheduledOrTriggeredTime: true } }, seats: { orderBy: { seatNumber: 'asc' as const } } } },
  verifiedBy: { select: { name: true } },
} as const;

function serializePayment(payment: Awaited<ReturnType<typeof prisma.payment.findMany<{ include: typeof paymentInclude }>>>[number]) {
  const receiptAvailable = Boolean(payment.receiptImageKey && existsSync(resolve(receiptDirectory, payment.receiptImageKey)));
  return {
    id: payment.id,
    method: payment.method === PaymentMethod.PAYPAL ? 'paypal' : 'gcash',
    status: payment.status.toLowerCase(),
    amount: Number(payment.amount),
    paypalOrderId: payment.paypalOrderId,
    gcashReference: payment.gcashReference,
    receiptAvailable,
    receiptUrl: receiptAvailable ? `/api/dispatcher/payments/${payment.id}/receipt` : null,
    uploadedAt: payment.createdAt.toISOString(),
    verifiedAt: payment.verifiedAt?.toISOString() ?? null,
    verifiedBy: payment.verifiedBy?.name ?? null,
    rejectionReason: payment.rejectionReason,
    reservation: {
      reference: payment.reservation.reference,
      passengerName: payment.reservation.passenger.name,
      contact: payment.reservation.passenger.contact,
      route: routeLabels[payment.reservation.trip.route],
      departureTime: payment.reservation.trip.scheduledOrTriggeredTime.toISOString(),
      seats: payment.reservation.seats.map((seat) => seat.seatNumber),
      status: payment.reservation.status.toLowerCase(),
    },
  };
}

export async function getDispatcherPayments() {
  const payments = await prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, include: paymentInclude });
  return { gcash: payments.filter((payment) => payment.method === PaymentMethod.GCASH_RECEIPT).map(serializePayment), paypal: payments.filter((payment) => payment.method === PaymentMethod.PAYPAL).map(serializePayment) };
}

export async function decideGcashPayment(actorUserId: string, paymentId: string, decision: 'approve' | 'reject', reason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { reservation: true } });
  if (!payment || payment.method !== PaymentMethod.GCASH_RECEIPT) throw new AppError(404, 'GCASH_PAYMENT_NOT_FOUND', 'This GCash payment was not found.');
  if (payment.status !== PaymentStatus.PENDING_VERIFICATION) throw new AppError(409, 'PAYMENT_ALREADY_REVIEWED', 'This payment has already been reviewed.');
  const approved = decision === 'approve';
  await prisma.$transaction([
    prisma.payment.update({ where: { id: payment.id }, data: { status: approved ? PaymentStatus.VERIFIED : PaymentStatus.REJECTED, verifiedByUserId: actorUserId, verifiedAt: new Date(), rejectionReason: approved ? null : reason } }),
    prisma.reservation.update({ where: { id: payment.reservationId }, data: { status: approved ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING_PAYMENT } }),
    prisma.notification.create({ data: { userId: payment.reservation.passengerId, type: NotificationType.PAYMENT, message: approved ? `GCash payment for ${payment.reservation.reference} approved. Your booking is confirmed.` : `GCash receipt for ${payment.reservation.reference} was rejected: ${reason}` } }),
    prisma.dispatchLog.create({ data: { actorUserId, action: approved ? DispatchAction.PAYMENT_APPROVED : DispatchAction.PAYMENT_REJECTED, targetId: payment.id, reason: approved ? null : reason, metadata: { reservationReference: payment.reservation.reference } } }),
  ]);
  return getDispatcherPayments();
}

export async function getPaymentReceiptPath(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment?.receiptImageKey || payment.method !== PaymentMethod.GCASH_RECEIPT) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'This payment has no receipt image.');
  const receiptPath = resolve(receiptDirectory, payment.receiptImageKey);
  if (!receiptPath.startsWith(receiptDirectory) || !existsSync(receiptPath)) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'The receipt image is unavailable.');
  return receiptPath;
}

export async function getDispatchLogs() {
  const logs = await prisma.dispatchLog.findMany({ orderBy: { timestamp: 'desc' }, take: 100, include: { actor: { select: { name: true, role: true } } } });
  return { logs: logs.map((log) => ({ id: log.id, action: log.action.toLowerCase(), actor: log.actor.name, actorRole: log.actor.role.toLowerCase(), targetId: log.targetId, reason: log.reason, metadata: log.metadata, timestamp: log.timestamp.toISOString() })) };
}
