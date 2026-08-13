import {
  AssignmentStatus,
  DispatchAction,
  GeofenceEventType,
  NotificationType,
  Prisma,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  UserRole,
  VehicleStatus,
} from '@prisma/client';
import { NCEBT } from '../config/terminal.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';

const activeQueueStatuses: QueueStatus[] = [
  QueueStatus.WAITING,
  QueueStatus.ASSIGNED,
  QueueStatus.ACCEPTED,
  QueueStatus.READY_FOR_DISPATCH,
  QueueStatus.DELAYED,
];

const activeTripStatuses: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.ASSIGNING,
  TripStatus.ASSIGNED,
  TripStatus.BOARDING,
  TripStatus.READY,
  TripStatus.DELAYED,
];

const movableReservationStatuses: ReservationStatus[] = [
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

export function distanceFromNcebtKm(latitude: number, longitude: number) {
  const earthRadiusKm = 6_371;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(latitude - NCEBT.latitude);
  const longitudeDelta = radians(longitude - NCEBT.longitude);
  const startLatitude = radians(NCEBT.latitude);
  const endLatitude = radians(latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

async function normalizeQueuePositions(transaction: Prisma.TransactionClient, route: RouteCode) {
  const entries = await transaction.queueEntry.findMany({
    where: { route, status: { in: activeQueueStatuses } },
    orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
  });
  await Promise.all(entries.map((entry, index) => transaction.queueEntry.update({
    where: { id: entry.id },
    data: { position: index + 1 },
  })));
}

export async function normalizeRouteQueuePositions(route: RouteCode) {
  await prisma.$transaction((transaction) => normalizeQueuePositions(transaction, route));
}

export async function recordDriverLocation(
  driverId: string,
  latitude: number,
  longitude: number,
  observedAt = new Date(),
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { assignedDriverId: driverId },
    include: {
      queueEntries: { where: { status: { in: activeQueueStatuses } }, orderBy: { arrivalTimestamp: 'desc' }, take: 1 },
      trips: { where: { status: { in: activeTripStatuses } }, orderBy: { scheduledOrTriggeredTime: 'asc' }, take: 1 },
    },
  });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');

  const distanceKm = distanceFromNcebtKm(latitude, longitude);
  const insideActiveZone = distanceKm <= NCEBT.activeZoneRadiusKm;
  if (insideActiveZone === vehicle.lastKnownInsideZone) {
    return { transition: 'none', insideActiveZone, distanceKm, trackingActive: vehicle.locationTrackingActive };
  }

  const entering = insideActiveZone;
  await prisma.$transaction(async (transaction) => {
    if (entering) {
      const existingQueue = vehicle.queueEntries[0];
      if (existingQueue) {
        await transaction.queueEntry.update({
          where: { id: existingQueue.id },
          data: { arrivalTimestamp: observedAt },
        });
      } else {
        await transaction.queueEntry.create({
          data: {
            vehicleId: vehicle.id,
            route: vehicle.route,
            position: 1,
            arrivalTimestamp: observedAt,
            status: QueueStatus.WAITING,
          },
        });
      }
      await normalizeQueuePositions(transaction, vehicle.route);
      await transaction.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: VehicleStatus.INCOMING,
          lastKnownInsideZone: true,
          locationTrackingActive: true,
          latestArrivalAt: observedAt,
        },
      });
    } else {
      const departed = vehicle.status === VehicleStatus.ON_TRIP
        || vehicle.queueEntries.some((entry) => entry.status === QueueStatus.DEPARTED)
        || vehicle.trips.some((trip) => trip.status === TripStatus.DEPARTED);
      await transaction.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: departed ? VehicleStatus.ON_TRIP : VehicleStatus.OUTSIDE_ZONE,
          lastKnownInsideZone: false,
          locationTrackingActive: departed ? false : vehicle.locationTrackingActive,
        },
      });
    }

    await transaction.geofenceEvent.create({
      data: {
        vehicleId: vehicle.id,
        eventType: entering ? GeofenceEventType.ENTERED : GeofenceEventType.EXITED,
        timestamp: observedAt,
        latitude,
        longitude,
        distanceKm,
      },
    });
    await transaction.dispatchLog.create({
      data: {
        actorUserId: driverId,
        action: entering ? DispatchAction.GEOFENCE_ENTERED : DispatchAction.GEOFENCE_EXITED,
        targetId: vehicle.id,
        metadata: { vanId: vehicle.vanId, route: vehicle.route, distanceKm, automated: true },
      },
    });
    await transaction.notification.create({
      data: {
        userId: driverId,
        type: NotificationType.QUEUE,
        message: entering
          ? `${vehicle.vanId} entered the NCEBT Active Zone and joined the ${routeLabels[vehicle.route]} queue.`
          : `${vehicle.vanId} exited the NCEBT Active Zone.`,
      },
    });
  });

  return {
    transition: entering ? 'entered' : 'exited',
    insideActiveZone,
    distanceKm,
    trackingActive: entering || (vehicle.locationTrackingActive && vehicle.status !== VehicleStatus.ON_TRIP),
  };
}

async function assignQueueEntry(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  tripId: string,
  queueEntryId: string,
  vehicleId: string,
  driverId: string,
  route: RouteCode,
  now: Date,
  metadata: Prisma.InputJsonObject,
) {
  await transaction.tripAssignment.upsert({
    where: { tripId_queueEntryId: { tripId, queueEntryId } },
    update: { driverId, status: AssignmentStatus.PENDING, assignedAt: now, respondedAt: null, responseDeadline: new Date(now.getTime() + 5 * 60_000) },
    create: { tripId, queueEntryId, driverId, status: AssignmentStatus.PENDING, assignedAt: now, responseDeadline: new Date(now.getTime() + 5 * 60_000) },
  });
  await transaction.queueEntry.update({ where: { id: queueEntryId }, data: { status: QueueStatus.ASSIGNED } });
  await transaction.trip.update({ where: { id: tripId }, data: { vehicleId, status: TripStatus.ASSIGNING } });
  await transaction.notification.create({ data: { userId: driverId, type: NotificationType.ASSIGNMENT, message: `A ${routeLabels[route]} trip assignment is awaiting your response.` } });
  await transaction.dispatchLog.create({ data: { actorUserId, action: DispatchAction.ASSIGNMENT_CREATED, targetId: tripId, metadata } });
}

async function expireAssignments(actorUserId: string, now: Date) {
  const expired = await prisma.tripAssignment.findMany({
    where: { status: AssignmentStatus.PENDING, responseDeadline: { lte: now } },
    include: { trip: true, queueEntry: true },
  });
  let advanced = 0;
  for (const assignment of expired) {
    const nextQueue = await prisma.queueEntry.findFirst({
      where: {
        route: assignment.queueEntry.route,
        status: QueueStatus.WAITING,
        id: { not: assignment.queueEntryId },
        vehicle: { assignedDriverId: { not: null }, status: { notIn: [VehicleStatus.UNAVAILABLE, VehicleStatus.DELAYED, VehicleStatus.ON_TRIP] } },
      },
      orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
      include: { vehicle: { select: { assignedDriverId: true } } },
    });
    await prisma.$transaction(async (transaction) => {
      const current = await transaction.tripAssignment.findUnique({ where: { id: assignment.id } });
      if (!current || current.status !== AssignmentStatus.PENDING) return;
      await transaction.tripAssignment.update({ where: { id: assignment.id }, data: { status: AssignmentStatus.EXPIRED, respondedAt: now } });
      await transaction.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.REJECTED } });
      await transaction.notification.create({ data: { userId: assignment.driverId, type: NotificationType.ASSIGNMENT, message: `The ${routeLabels[assignment.trip.route]} assignment response window expired.` } });
      await transaction.dispatchLog.create({ data: { actorUserId, action: DispatchAction.ASSIGNMENT_REJECTED, targetId: assignment.tripId, reason: 'Driver response window expired.', metadata: { assignmentId: assignment.id, automated: true, advancedToQueueEntryId: nextQueue?.id ?? null } } });
      if (nextQueue?.vehicle.assignedDriverId) {
        await transaction.trip.update({ where: { id: assignment.tripId }, data: { vehicleId: nextQueue.vehicleId } });
        await assignQueueEntry(transaction, actorUserId, assignment.tripId, nextQueue.id, nextQueue.vehicleId, nextQueue.vehicle.assignedDriverId, assignment.trip.route, now, { automated: true, trigger: 'assignment_expired', previousAssignmentId: assignment.id });
        advanced += 1;
      } else {
        await transaction.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.ASSIGNING } });
      }
    });
    await normalizeRouteQueuePositions(assignment.queueEntry.route);
  }
  return { expired: expired.length, advanced };
}

async function evaluateGoso(actorUserId: string, now: Date) {
  const assignmentWindow = new Date(now.getTime() + 10 * 60_000);
  const trips = await prisma.trip.findMany({
    where: { route: RouteCode.GOA, status: { in: [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED] }, scheduledOrTriggeredTime: { lte: assignmentWindow } },
    include: { assignments: { where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } }, orderBy: { assignedAt: 'desc' }, take: 1 } },
    orderBy: { scheduledOrTriggeredTime: 'asc' },
  });
  let assigned = 0;
  let ready = 0;
  for (const trip of trips) {
    let assignment = trip.assignments[0];
    let assignedVehicleId = trip.vehicleId;
    if (!assignment) {
      const queue = await prisma.queueEntry.findFirst({
        where: { route: RouteCode.GOA, status: QueueStatus.WAITING, vehicle: { assignedDriverId: { not: null }, status: { notIn: [VehicleStatus.UNAVAILABLE, VehicleStatus.DELAYED, VehicleStatus.ON_TRIP] } } },
        orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
        include: { vehicle: { select: { assignedDriverId: true } } },
      });
      if (!queue?.vehicle.assignedDriverId) continue;
      await prisma.$transaction((transaction) => assignQueueEntry(transaction, actorUserId, trip.id, queue.id, queue.vehicleId, queue.vehicle.assignedDriverId!, RouteCode.GOA, now, { automated: true, trigger: 'goso_schedule_window' }));
      assigned += 1;
      assignedVehicleId = queue.vehicleId;
      assignment = await prisma.tripAssignment.findFirst({ where: { tripId: trip.id, queueEntryId: queue.id } }) ?? undefined;
    }
    if (assignment?.status === AssignmentStatus.ACCEPTED && trip.scheduledOrTriggeredTime <= now) {
      await prisma.$transaction([
        prisma.trip.update({ where: { id: trip.id }, data: { status: TripStatus.READY } }),
        prisma.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.READY_FOR_DISPATCH } }),
        prisma.vehicle.update({ where: { id: assignedVehicleId }, data: { status: VehicleStatus.READY_FOR_DISPATCH } }),
      ]);
      ready += 1;
    }
  }
  return { assigned, ready };
}

export async function recalculateTayaReadiness() {
  const queue = await prisma.queueEntry.findMany({
    where: { route: RouteCode.LEGAZPI, status: { in: [QueueStatus.WAITING, QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH] } },
    orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
    include: {
      vehicle: {
        include: {
          trips: {
            where: { status: { in: activeTripStatuses } },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
            take: 1,
            include: { passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 } },
          },
        },
      },
    },
  });
  let readyEntryId: string | null = null;
  for (const [index, entry] of queue.entries()) {
    const trip = entry.vehicle.trips[0];
    if (!trip) continue;
    const occupancy = trip.passengerCounts[0]?.count ?? 0;
    const ready = index === 0 && occupancy === entry.vehicle.capacity;
    if (ready) readyEntryId = entry.id;
    const nextQueueStatus = ready
      ? QueueStatus.READY_FOR_DISPATCH
      : entry.status === QueueStatus.ASSIGNED || entry.status === QueueStatus.ACCEPTED ? entry.status : QueueStatus.WAITING;
    const nextTripStatus = ready
      ? TripStatus.READY
      : trip.status === TripStatus.ASSIGNED || trip.status === TripStatus.ASSIGNING ? trip.status : TripStatus.BOARDING;
    await prisma.$transaction([
      prisma.queueEntry.update({ where: { id: entry.id }, data: { status: nextQueueStatus } }),
      prisma.trip.update({ where: { id: trip.id }, data: { status: nextTripStatus } }),
      prisma.vehicle.update({ where: { id: entry.vehicleId }, data: { status: ready ? VehicleStatus.READY_FOR_DISPATCH : VehicleStatus.LOADING } }),
    ]);
  }
  return { evaluated: queue.length, readyEntryId };
}

async function resolveDispatcherActor(actorUserId?: string) {
  if (actorUserId) return actorUserId;
  const dispatcher = await prisma.user.findFirst({ where: { role: UserRole.DISPATCHER, isActive: true }, select: { id: true } });
  if (!dispatcher) throw new AppError(503, 'DISPATCH_ACTOR_UNAVAILABLE', 'No active dispatcher account is available for automated dispatch logging.');
  return dispatcher.id;
}

export async function runDispatchEngine(actorUserId?: string, now = new Date()) {
  const actor = await resolveDispatcherActor(actorUserId);
  const expiredAssignments = await expireAssignments(actor, now);
  const goso = await evaluateGoso(actor, now);
  const taya = await recalculateTayaReadiness();
  return { evaluatedAt: now.toISOString(), expiredAssignments, goso, taya };
}

function allocateSeats(capacity: number, occupiedSeats: Set<number>, requestedSeats: number[]) {
  const result: number[] = [];
  for (const seat of requestedSeats) {
    if (seat >= 1 && seat <= capacity && !occupiedSeats.has(seat)) {
      occupiedSeats.add(seat);
      result.push(seat);
    }
  }
  for (let seat = 1; result.length < requestedSeats.length && seat <= capacity; seat += 1) {
    if (!occupiedSeats.has(seat)) {
      occupiedSeats.add(seat);
      result.push(seat);
    }
  }
  if (result.length !== requestedSeats.length) throw new AppError(409, 'REALLOCATION_CAPACITY_UNAVAILABLE', 'The next eligible van does not have enough seats for the affected reservations.');
  return result;
}

export async function reallocateUnavailableVehicle(actorUserId: string, sourceVehicleId: string, reason: string) {
  return prisma.$transaction(async (transaction) => {
    const sourceVehicle = await transaction.vehicle.findUnique({
      where: { id: sourceVehicleId },
      include: {
        queueEntries: { where: { status: { in: activeQueueStatuses } }, orderBy: { arrivalTimestamp: 'asc' }, take: 1 },
        trips: {
          where: { status: { in: activeTripStatuses } },
          orderBy: { scheduledOrTriggeredTime: 'asc' },
          take: 1,
          include: {
            assignments: { where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } } },
            reservations: {
              where: { status: { in: movableReservationStatuses } },
              include: { passenger: { select: { id: true } }, seats: { orderBy: { seatNumber: 'asc' } } },
            },
          },
        },
      },
    });
    if (!sourceVehicle) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'The unavailable vehicle was not found.');
    const sourceTrip = sourceVehicle.trips[0];
    const targetQueue = await transaction.queueEntry.findFirst({
      where: {
        route: sourceVehicle.route,
        status: { in: [QueueStatus.WAITING, QueueStatus.READY_FOR_DISPATCH] },
        vehicleId: { not: sourceVehicle.id },
        vehicle: { assignedDriverId: { not: null }, status: { notIn: [VehicleStatus.UNAVAILABLE, VehicleStatus.DELAYED, VehicleStatus.ON_TRIP] } },
      },
      orderBy: [{ arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
      include: { vehicle: true },
    });
    if (sourceTrip?.reservations.length && !targetQueue?.vehicle.assignedDriverId) {
      throw new AppError(409, 'REALLOCATION_VEHICLE_UNAVAILABLE', 'No eligible replacement van is available for these reservations.');
    }

    let targetTrip: Awaited<ReturnType<typeof transaction.trip.findFirst>> = null;
    if (sourceTrip && targetQueue) {
      targetTrip = await transaction.trip.findFirst({
        where: { vehicleId: targetQueue.vehicleId, route: sourceTrip.route, status: { in: activeTripStatuses } },
        orderBy: { scheduledOrTriggeredTime: 'asc' },
      });
      if (!targetTrip) {
        targetTrip = await transaction.trip.create({
          data: {
            vehicleId: targetQueue.vehicleId,
            route: sourceTrip.route,
            scheduledOrTriggeredTime: sourceTrip.scheduledOrTriggeredTime,
            status: TripStatus.ASSIGNING,
            fareAmount: sourceTrip.fareAmount,
          },
        });
      }
    }

    const occupiedSeats = new Set<number>();
    if (targetTrip) {
      const seats = await transaction.reservationSeat.findMany({ where: { tripId: targetTrip.id }, select: { seatNumber: true } });
      seats.forEach((seat) => occupiedSeats.add(seat.seatNumber));
    }
    const sourceRoute = sourceTrip?.route;
    for (const reservation of sourceTrip?.reservations ?? []) {
      if (!targetTrip || !targetQueue) break;
      const seats = allocateSeats(targetQueue.vehicle.capacity, occupiedSeats, reservation.seats.map((seat) => seat.seatNumber));
      await transaction.reservationSeat.deleteMany({ where: { reservationId: reservation.id } });
      await transaction.reservation.update({ where: { id: reservation.id }, data: { tripId: targetTrip.id, status: ReservationStatus.REALLOCATED } });
      await transaction.reservationSeat.createMany({ data: seats.map((seatNumber) => ({ reservationId: reservation.id, tripId: targetTrip!.id, seatNumber })) });
      await transaction.notification.create({
        data: {
          userId: reservation.passenger.id,
          type: NotificationType.REALLOCATION,
          message: `${reservation.reference} was moved to ${targetQueue.vehicle.vanId} for the same ${routeLabels[sourceRoute!]} departure. Seats: ${seats.join(', ')}.`,
        },
      });
    }

    if (sourceTrip) {
      await transaction.trip.update({ where: { id: sourceTrip.id }, data: { status: TripStatus.UNABLE_TO_DEPART } });
      await transaction.tripAssignment.updateMany({ where: { tripId: sourceTrip.id, status: AssignmentStatus.PENDING }, data: { status: AssignmentStatus.EXPIRED, respondedAt: new Date() } });
    }
    if (sourceVehicle.queueEntries[0]) await transaction.queueEntry.update({ where: { id: sourceVehicle.queueEntries[0].id }, data: { status: QueueStatus.REPLACED } });
    await transaction.vehicle.update({ where: { id: sourceVehicle.id }, data: { status: VehicleStatus.UNAVAILABLE, locationTrackingActive: false } });

    if (sourceTrip && targetTrip && targetQueue?.vehicle.assignedDriverId) {
      await assignQueueEntry(transaction, actorUserId, targetTrip.id, targetQueue.id, targetQueue.vehicleId, targetQueue.vehicle.assignedDriverId, sourceTrip.route, new Date(), { automated: true, trigger: 'reservation_reallocation', sourceTripId: sourceTrip.id });
    }
    await normalizeQueuePositions(transaction, sourceVehicle.route);
    await transaction.dispatchLog.create({
      data: {
        actorUserId,
        action: DispatchAction.VEHICLE_REPLACED,
        targetId: sourceVehicle.id,
        reason,
        metadata: { replacementVehicleId: targetQueue?.vehicleId ?? null, sourceTripId: sourceTrip?.id ?? null },
      },
    });
    if (sourceTrip?.reservations.length) {
      await transaction.dispatchLog.create({
        data: {
          actorUserId,
          action: DispatchAction.RESERVATION_REALLOCATED,
          targetId: sourceTrip.id,
          reason,
          metadata: { targetTripId: targetTrip?.id ?? null, targetVehicleId: targetQueue?.vehicleId ?? null, reservationCount: sourceTrip.reservations.length },
        },
      });
    }
    return {
      sourceVehicleId: sourceVehicle.id,
      replacementVehicleId: targetQueue?.vehicleId ?? null,
      sourceTripId: sourceTrip?.id ?? null,
      targetTripId: targetTrip?.id ?? null,
      reservationsMoved: sourceTrip?.reservations.length ?? 0,
    };
  });
}
