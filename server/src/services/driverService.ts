import {
  AssignmentStatus,
  DispatchAction,
  NotificationType,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  VehicleStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { normalizeRouteQueuePositions, recalculateTayaReadiness } from './automationService.js';

const activeTripStatuses: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.ASSIGNING,
  TripStatus.ASSIGNED,
  TripStatus.BOARDING,
  TripStatus.READY,
  TripStatus.DELAYED,
];

const activeReservationStatuses: ReservationStatus[] = [
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

async function ownVehicle(driverId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { assignedDriverId: driverId } });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');
  return vehicle;
}

export async function getDriverOverview(driverId: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { assignedDriverId: driverId },
    include: {
      assignedDriver: { select: { name: true, contact: true } },
      queueEntries: {
        where: { status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      trips: {
        where: { status: { in: activeTripStatuses } },
        orderBy: { scheduledOrTriggeredTime: 'asc' },
        include: {
          passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 },
          reservations: {
            where: { status: { in: activeReservationStatuses } },
            include: {
              passenger: { select: { name: true, contact: true } },
              seats: { orderBy: { seatNumber: 'asc' } },
            },
          },
          assignments: {
            where: { driverId },
            orderBy: { assignedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');

  const assignedTrip = vehicle.trips.find((trip) => trip.assignments.length > 0) ?? vehicle.trips[0] ?? null;
  const assignment = assignedTrip?.assignments[0] ?? null;
  const queue = vehicle.queueEntries[0] ?? null;
  const submittedOccupancy = assignedTrip?.passengerCounts[0]?.count;
  const reservationOccupancy = assignedTrip?.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0) ?? 0;
  const occupancy = Math.min(vehicle.capacity, submittedOccupancy ?? reservationOccupancy);

  const queueEntries = await prisma.queueEntry.findMany({
    where: { route: vehicle.route, status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } },
    include: { vehicle: { select: { status: true } } },
  });
  const dispatcher = await prisma.user.findFirst({ where: { role: 'DISPATCHER', isActive: true }, select: { name: true, contact: true } });
  const notifications = await prisma.notification.findMany({ where: { userId: driverId }, orderBy: { createdAt: 'desc' }, take: 6 });

  let startReason = 'Accept the active assignment before starting the trip.';
  let canStart = assignment?.status === AssignmentStatus.ACCEPTED;
  if (canStart && !vehicle.goOnTripEnabled) { canStart = false; startReason = 'Enable Go on Trip first.'; }
  if (canStart && vehicle.route === RouteCode.GOA && assignedTrip && assignedTrip.scheduledOrTriggeredTime > new Date()) {
    canStart = false; startReason = 'Goso departures unlock at the scheduled time.';
  }
  if (canStart && vehicle.route === RouteCode.LEGAZPI && occupancy < vehicle.capacity) {
    canStart = false; startReason = 'Taya departures require 100% occupancy.';
  }
  if (canStart) startReason = 'All departure requirements are satisfied.';

  return {
    driver: { name: vehicle.assignedDriver?.name ?? 'Driver', contact: vehicle.assignedDriver?.contact ?? null },
    vehicle: {
      id: vehicle.id,
      vanId: vehicle.vanId,
      plateNo: vehicle.plateNo,
      route: routeLabels[vehicle.route],
      routeCode: vehicle.route.toLowerCase(),
      protocol: vehicle.protocol === 'GOSO' ? 'Goso' : 'Taya',
      capacity: vehicle.capacity,
      status: vehicle.status.toLowerCase(),
      goOnTripEnabled: vehicle.goOnTripEnabled,
      insideActiveZone: vehicle.lastKnownInsideZone,
    },
    queue: queue ? {
      id: queue.id,
      position: queue.position,
      status: queue.status.toLowerCase(),
      arrivalTimestamp: queue.arrivalTimestamp.toISOString(),
    } : null,
    trip: assignedTrip ? {
      id: assignedTrip.id,
      departureTime: assignedTrip.scheduledOrTriggeredTime.toISOString(),
      status: assignedTrip.status.toLowerCase(),
      estimatedTravelMinutes: vehicle.route === RouteCode.GOA ? 120 : 150,
      occupancy,
      reservations: reservationOccupancy,
      manifest: assignedTrip.reservations.map((reservation) => ({
        reference: reservation.reference,
        passengerName: reservation.passenger.name,
        contact: reservation.passenger.contact,
        seats: reservation.seats.map((seat) => seat.seatNumber),
        status: reservation.status.toLowerCase(),
      })),
    } : null,
    assignment: assignment ? {
      id: assignment.id,
      status: assignment.status.toLowerCase(),
      assignedAt: assignment.assignedAt.toISOString(),
      responseDeadline: assignment.responseDeadline.toISOString(),
    } : null,
    dispatcher,
    queueSummary: {
      total: queueEntries.length,
      atTerminal: queueEntries.filter((entry) => entry.vehicle.status === VehicleStatus.AT_TERMINAL).length,
      incoming: queueEntries.filter((entry) => entry.vehicle.status === VehicleStatus.INCOMING).length,
      ready: queueEntries.filter((entry) => entry.status === QueueStatus.READY_FOR_DISPATCH).length,
    },
    startEligibility: { allowed: canStart, reason: startReason },
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type.toLowerCase(),
      message: notification.message,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
    })),
  };
}

export async function setGoOnTrip(driverId: string, enabled: boolean) {
  const vehicle = await ownVehicle(driverId);
  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: { goOnTripEnabled: enabled, locationTrackingActive: enabled && vehicle.lastKnownInsideZone },
  });
  await prisma.notification.create({
    data: { userId: driverId, type: NotificationType.TRIP, message: `Go on Trip ${enabled ? 'enabled' : 'disabled'} for ${vehicle.vanId}.` },
  });
  return getDriverOverview(driverId);
}

export async function respondToAssignment(driverId: string, assignmentId: string, accept: boolean) {
  const assignment = await prisma.tripAssignment.findFirst({
    where: { id: assignmentId, driverId },
    include: { trip: true, queueEntry: true },
  });
  if (!assignment) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'This assignment is not available to the driver.');
  if (assignment.status !== AssignmentStatus.PENDING) throw new AppError(409, 'ASSIGNMENT_ALREADY_RESPONDED', 'This assignment already has a response.');

  if (accept) {
    await prisma.$transaction([
      prisma.tripAssignment.update({ where: { id: assignment.id }, data: { status: AssignmentStatus.ACCEPTED, respondedAt: new Date() } }),
      prisma.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.ACCEPTED } }),
      prisma.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.ASSIGNED } }),
      prisma.vehicle.update({ where: { id: assignment.trip.vehicleId }, data: { status: VehicleStatus.WAITING } }),
      prisma.dispatchLog.create({ data: { actorUserId: driverId, action: DispatchAction.ASSIGNMENT_ACCEPTED, targetId: assignment.tripId, metadata: { assignmentId } } }),
      prisma.notification.create({ data: { userId: driverId, type: NotificationType.ASSIGNMENT, message: `Trip assignment for ${routeLabels[assignment.trip.route]} accepted.` } }),
    ]);
    return getDriverOverview(driverId);
  }

  const nextQueue = await prisma.queueEntry.findFirst({
    where: {
      route: assignment.queueEntry.route,
      status: QueueStatus.WAITING,
      id: { not: assignment.queueEntryId },
      vehicle: { assignedDriverId: { not: null } },
    },
    orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
    include: { vehicle: { select: { assignedDriverId: true } } },
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.tripAssignment.update({ where: { id: assignment.id }, data: { status: AssignmentStatus.REJECTED, respondedAt: new Date() } });
    await transaction.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.REJECTED } });
    if (nextQueue?.vehicle.assignedDriverId) {
      await transaction.queueEntry.update({ where: { id: nextQueue.id }, data: { status: QueueStatus.ASSIGNED } });
      await transaction.trip.update({ where: { id: assignment.tripId }, data: { vehicleId: nextQueue.vehicleId, status: TripStatus.ASSIGNING } });
      await transaction.tripAssignment.upsert({
        where: { tripId_queueEntryId: { tripId: assignment.tripId, queueEntryId: nextQueue.id } },
        update: { driverId: nextQueue.vehicle.assignedDriverId, status: AssignmentStatus.PENDING, assignedAt: new Date(), respondedAt: null, responseDeadline: new Date(Date.now() + 5 * 60_000) },
        create: { tripId: assignment.tripId, queueEntryId: nextQueue.id, driverId: nextQueue.vehicle.assignedDriverId, status: AssignmentStatus.PENDING, responseDeadline: new Date(Date.now() + 5 * 60_000) },
      });
      await transaction.notification.create({ data: { userId: nextQueue.vehicle.assignedDriverId, type: NotificationType.ASSIGNMENT, message: `A ${routeLabels[assignment.trip.route]} trip assignment is awaiting your response.` } });
    } else {
      await transaction.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.ASSIGNING } });
    }
    await transaction.dispatchLog.create({ data: { actorUserId: driverId, action: DispatchAction.ASSIGNMENT_REJECTED, targetId: assignment.tripId, metadata: { assignmentId, advancedToQueueEntryId: nextQueue?.id ?? null } } });
    await transaction.notification.create({ data: { userId: driverId, type: NotificationType.ASSIGNMENT, message: `Trip assignment for ${routeLabels[assignment.trip.route]} rejected.` } });
  });
  await normalizeRouteQueuePositions(assignment.queueEntry.route);
  return { advanced: Boolean(nextQueue), overview: await getDriverOverview(driverId) };
}

export async function submitOccupancy(driverId: string, count: number) {
  const vehicle = await ownVehicle(driverId);
  if (count > vehicle.capacity) throw new AppError(422, 'OCCUPANCY_EXCEEDS_CAPACITY', `Passenger count cannot exceed ${vehicle.capacity}.`);
  const trip = await prisma.trip.findFirst({ where: { vehicleId: vehicle.id, status: { in: activeTripStatuses } }, orderBy: { scheduledOrTriggeredTime: 'asc' } });
  if (!trip) throw new AppError(404, 'ACTIVE_TRIP_NOT_FOUND', 'No active trip is available for occupancy reporting.');
  await prisma.$transaction([
    prisma.passengerCount.create({ data: { vehicleId: vehicle.id, tripId: trip.id, count, submittedByDriverId: driverId } }),
    prisma.notification.create({ data: { userId: driverId, type: NotificationType.TRIP, message: `Passenger occupancy updated to ${count} of ${vehicle.capacity}.` } }),
  ]);
  if (vehicle.route === RouteCode.LEGAZPI) await recalculateTayaReadiness();
  return getDriverOverview(driverId);
}

export async function markArrivedAtTerminal(driverId: string) {
  const vehicle = await ownVehicle(driverId);
  if (!vehicle.goOnTripEnabled) throw new AppError(409, 'GO_ON_TRIP_REQUIRED', 'Enable Go on Trip before marking terminal arrival.');
  if (!vehicle.lastKnownInsideZone) throw new AppError(409, 'OUTSIDE_ACTIVE_ZONE', 'Terminal arrival is available only inside the 5 km Active Zone.');
  await prisma.$transaction([
    prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: VehicleStatus.AT_TERMINAL } }),
    prisma.queueEntry.updateMany({ where: { vehicleId: vehicle.id, status: QueueStatus.WAITING }, data: { status: QueueStatus.WAITING } }),
    prisma.notification.create({ data: { userId: driverId, type: NotificationType.TRIP, message: `${vehicle.vanId} marked as arrived at NCEBT.` } }),
  ]);
  return getDriverOverview(driverId);
}

export async function startDriverTrip(driverId: string) {
  const overview = await getDriverOverview(driverId);
  if (!overview.trip || !overview.queue) throw new AppError(404, 'ACTIVE_TRIP_NOT_FOUND', 'No active trip is ready to start.');
  if (!overview.startEligibility.allowed) throw new AppError(409, 'TRIP_START_BLOCKED', overview.startEligibility.reason);
  const vehicle = await ownVehicle(driverId);
  await prisma.$transaction([
    prisma.trip.update({ where: { id: overview.trip.id }, data: { status: TripStatus.DEPARTED, departedAt: new Date() } }),
    prisma.queueEntry.update({ where: { id: overview.queue.id }, data: { status: QueueStatus.DEPARTED } }),
    prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: VehicleStatus.ON_TRIP, locationTrackingActive: false, lastKnownInsideZone: false } }),
    prisma.dispatchLog.create({ data: { actorUserId: driverId, action: DispatchAction.TRIP_STARTED, targetId: overview.trip.id } }),
    prisma.notification.create({ data: { userId: driverId, type: NotificationType.TRIP, message: `${vehicle.vanId} trip started.` } }),
  ]);
  return getDriverOverview(driverId);
}
