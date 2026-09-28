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
import { GOSO_BOARDING_WINDOW_MS, WEEKLY_ASSIGNMENT_LOOKAHEAD_MS, boardingStartFor } from '../config/dispatch.js';
import { DEFAULT_GOA_FARE, DEFAULT_LEGAZPI_FARE } from '../config/fare.js';
import { NCEBT, TERMINAL_GEOFENCE } from '../config/terminal.js';
import { VAN_PASSENGER_CAPACITY, passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { admitAcceptedGosoSchedulesForDay, evaluateGosoLoading, isConfirmedForScheduledLoading, isPresentForLoading, normalizeSavedQueue, queueOrder, withRouteQueue } from './queueSchedulingService.js';
import { selectTripForQueueRow } from './queueTripSelection.js';
import { syncTayaDailyQueue } from './tayaQueueService.js';

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
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.PENDING_VERIFICATION,
  ReservationStatus.CONFIRMED,
  ReservationStatus.RESCHEDULED,
  ReservationStatus.REALLOCATED,
];

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

function statusAfterReallocation(status: ReservationStatus) {
  return status === ReservationStatus.PENDING_PAYMENT || status === ReservationStatus.PENDING_VERIFICATION
    ? status
    : ReservationStatus.REALLOCATED;
}

function departureLabel(value: Date) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(value);
}

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
  await normalizeSavedQueue(transaction, route);
}

export async function normalizeRouteQueuePositions(route: RouteCode) {
  await withRouteQueue(route, (transaction) => normalizeQueuePositions(transaction, route));
}

/**
 * Taya has no loading deadline. Its late check happens only when the queue row
 * immediately ahead departs: if that immediate follower is outside the
 * terminal circle, mark it late and move it behind the other active Taya rows.
 * Persist the same rotation in today's daily plan so the next synchronization
 * cannot restore the dispatcher-planned pre-departure order.
 */
async function rotateAbsentTayaFollowerAfterDeparture(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  departedQueueEntryId: string | null,
  departedPosition: number | null,
  departedAt: Date,
) {
  if (!departedQueueEntryId || departedPosition === null) return null;
  const serviceDate = new Date(`${manilaServiceDay(departedAt).date}T00:00:00.000Z`);

  const activeRows = await transaction.queueEntry.findMany({
    where: {
      route: RouteCode.LEGAZPI,
      status: { in: activeQueueStatuses },
      vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
      tayaDailySchedule: { is: { serviceDate } },
    },
    orderBy: queueOrder,
    include: { vehicle: true },
  });
  const follower = activeRows.find((row) => row.position > departedPosition);
  if (!follower || follower.lateAt || isConfirmedForScheduledLoading(follower.vehicle)) return null;

  const rowsWithoutFollower = activeRows.filter((row) => row.id !== follower.id);
  const nextPresent = rowsWithoutFollower.find((row) => (
    row.position > follower.position && isConfirmedForScheduledLoading(row.vehicle)
  ));
  if (nextPresent) {
    rowsWithoutFollower.splice(rowsWithoutFollower.findIndex((row) => row.id === nextPresent.id), 1);
    const departedGap = rowsWithoutFollower.filter((row) => row.position < departedPosition).length;
    rowsWithoutFollower.splice(departedGap, 0, nextPresent);
  }
  const reordered = [...rowsWithoutFollower, follower];
  for (const [index, row] of reordered.entries()) {
    await transaction.queueEntry.update({
      where: { id: row.id },
      data: {
        position: index + 1,
        ...(row.id === follower.id ? { lateAt: departedAt } : {}),
      },
    });
  }

  const followerPlan = await transaction.tayaDailySchedule.findUnique({
    where: { queueEntryId: follower.id },
  });
  if (followerPlan) {
    const plans = await transaction.tayaDailySchedule.findMany({
      where: { serviceDate: followerPlan.serviceDate },
      orderBy: { position: 'asc' },
    });
    const plansByQueueEntry = new Map(plans.flatMap((plan) => (
      plan.queueEntryId ? [[plan.queueEntryId, plan] as const] : []
    )));
    const reorderedActivePlans = reordered.flatMap((row) => {
      const plan = plansByQueueEntry.get(row.id);
      return plan ? [plan] : [];
    });
    const activePlanIds = new Set(reorderedActivePlans.map((plan) => plan.id));
    const reorderedPlans = [...reorderedActivePlans, ...plans.filter((plan) => !activePlanIds.has(plan.id))];
    // Offset first because (serviceDate, position) is unique.
    await transaction.tayaDailySchedule.updateMany({
      where: { serviceDate: followerPlan.serviceDate },
      data: { position: { increment: 1_000 } },
    });
    for (const [index, plan] of reorderedPlans.entries()) {
      await transaction.tayaDailySchedule.update({ where: { id: plan.id }, data: { position: index + 1 } });
    }
  }

  const driverId = follower.vehicle.assignedDriverId;
  await transaction.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.MOVED_TO_LAST,
      targetId: follower.id,
      route: RouteCode.LEGAZPI,
      reason: 'Driver was outside the 100-meter terminal geofence when the vehicle immediately ahead was dispatched.',
      metadata: {
        trigger: 'taya_preceding_vehicle_dispatched',
        departedQueueEntryId,
        oldPosition: follower.position,
        newPosition: reordered.length,
        lateAt: departedAt.toISOString(),
      },
    },
  });
  if (driverId) {
    await transaction.notification.create({
      data: {
        userId: driverId,
        type: NotificationType.QUEUE,
        message: 'The vehicle immediately ahead of you was dispatched while you were outside the 100-meter terminal geofence. You are marked Late and moved behind the other eligible Taya drivers.',
      },
    });
  }

  return { queueEntryId: follower.id, oldPosition: follower.position, newPosition: reordered.length };
}

async function completeAuthorizedDeparture(
  actorUserId: string,
  route: RouteCode,
  tripId: string,
  method: 'gps' | 'dispatcher',
  reason: string | null,
  metadata: Prisma.InputJsonObject = {},
) {
  const result = await withRouteQueue(route, async (transaction) => {
    const trip = await transaction.trip.findFirst({
      where: { id: tripId, route },
      include: {
        vehicle: true,
        assignments: {
          where: { status: AssignmentStatus.ACCEPTED },
          orderBy: { respondedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!trip) throw new AppError(404, 'ACTIVE_TRIP_NOT_FOUND', 'The departure awaiting confirmation was not found.');
    if (trip.status === TripStatus.DEPARTED || trip.departedAt) {
      throw new AppError(409, 'TRIP_ALREADY_DEPARTED', 'This trip has already been confirmed as departed.');
    }
    if (!trip.vehicle.departureAuthorizedAt || trip.vehicle.departureAuthorizedTripId !== trip.id) {
      throw new AppError(409, 'DEPARTURE_NOT_AUTHORIZED', 'Protocol authorization is required before departure can be confirmed.');
    }

    const assignment = trip.assignments[0];
    if (!assignment) throw new AppError(409, 'ACCEPTED_ASSIGNMENT_REQUIRED', 'An accepted driver assignment is required before departure.');
    const fallbackQueue = assignment.queueEntryId ? null : await transaction.queueEntry.findFirst({
      where: { vehicleId: trip.vehicleId, status: { in: activeQueueStatuses } },
      orderBy: { arrivalTimestamp: 'desc' },
    });
    const queueEntryId = assignment.queueEntryId ?? fallbackQueue?.id ?? null;
    const departedQueueEntry = queueEntryId
      ? await transaction.queueEntry.findUnique({ where: { id: queueEntryId }, select: { position: true } })
      : null;
    const departedAt = new Date();

    await transaction.trip.update({
      where: { id: trip.id },
      data: { status: TripStatus.DEPARTED, departedAt },
    });
    if (queueEntryId) {
      await transaction.queueEntry.update({ where: { id: queueEntryId }, data: { status: QueueStatus.DEPARTED } });
    }
    await transaction.vehicle.update({
      where: { id: trip.vehicleId },
      data: {
        status: VehicleStatus.ON_TRIP,
        insideTerminalZone: false,
        terminalEntrySampleCount: 0,
        terminalExitSampleCount: 0,
        departureSequenceStartKm: null,
        departureAuthorizedAt: null,
        departureAuthorizedTripId: null,
        departureReviewRequired: false,
        departureReviewReason: null,
        locationTrackingActive: trip.vehicle.lastKnownInsideZone,
      },
    });
    if (route === RouteCode.LEGAZPI) {
      await rotateAbsentTayaFollowerAfterDeparture(transaction, actorUserId, queueEntryId, departedQueueEntry?.position ?? null, departedAt);
    }
    await normalizeQueuePositions(transaction, route);
    await transaction.dispatchLog.create({
      data: {
        actorUserId,
        action: DispatchAction.TRIP_DEPARTED,
        targetId: trip.id,
        route,
        reason,
        metadata: { ...metadata, method, queueEntryId },
      },
    });
    await transaction.notification.create({
      data: {
        userId: assignment.driverId,
        type: NotificationType.TRIP,
        message: `${trip.vehicle.vanId} departure confirmed${method === 'dispatcher' ? ' by the dispatcher' : ' by terminal-exit GPS'}.`,
      },
    });
    return { tripId: trip.id, vehicleId: trip.vehicleId, queueEntryId, departedAt: departedAt.toISOString(), method };
  });

  if (route === RouteCode.LEGAZPI) await recalculateTayaReadiness();
  return result;
}

export async function confirmDepartureByDispatcher(
  actorUserId: string,
  route: RouteCode,
  tripId: string,
  reason: string,
) {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      route,
      departureAuthorizedTripId: tripId,
      departureAuthorizedAt: { not: null },
    },
    select: { departureReviewRequired: true },
  });
  if (!vehicle) {
    throw new AppError(409, 'DEPARTURE_NOT_AUTHORIZED', 'Protocol authorization is required before departure can be confirmed.');
  }
  if (!vehicle.departureReviewRequired) {
    throw new AppError(409, 'MANUAL_GPS_REVIEW_REQUIRED', 'Manual confirmation is available only after uncertain GPS requires dispatcher review.');
  }
  return completeAuthorizedDeparture(actorUserId, route, tripId, 'dispatcher', reason, { manualGpsFallback: true });
}

type QueueDepartureRequest = {
  method: 'dispatcher';
  queueEntryId: string;
  reason: string;
} | {
  method: 'gps';
  vehicleId: string;
  observedAt: Date;
  metadata: Prisma.InputJsonObject;
};

function activeDepartureQueueWhere(route: RouteCode, observedAt: Date): Prisma.QueueEntryWhereInput {
  const serviceDay = manilaServiceDay(observedAt);
  return {
    route,
    status: { in: activeQueueStatuses },
    vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
    ...(route === RouteCode.GOA
      ? { scheduledLoadingTime: { gte: serviceDay.start, lt: serviceDay.end } }
      : { tayaDailySchedule: { is: { serviceDate: new Date(`${serviceDay.date}T00:00:00.000Z`) } } }),
  };
}

async function completeQueueDeparture(actorUserId: string, route: RouteCode, request: QueueDepartureRequest) {
  const result = await withRouteQueue(route, async (tx) => {
    let queueEntryId: string;
    if (request.method === 'gps') {
      // The queue lock makes the head check and departure update atomic. This
      // deliberately reads the current order after any existing late/rotation
      // policy has run; it does not infer priority from the original assignment.
      const headWhere = activeDepartureQueueWhere(route, request.observedAt);
      let currentHead = await tx.queueEntry.findFirst({
        where: headWhere,
        orderBy: queueOrder,
        select: { id: true, vehicleId: true },
      });
      // Rows created before scheduled loading times were introduced can still
      // represent the active Goa queue. Use them only when today's dated queue
      // has no head, so a legacy record can never overtake a current schedule.
      if (!currentHead && route === RouteCode.GOA) {
        currentHead = await tx.queueEntry.findFirst({
          where: { ...headWhere, scheduledLoadingTime: null },
          orderBy: queueOrder,
          select: { id: true, vehicleId: true },
        });
      }
      if (!currentHead || currentHead.vehicleId !== request.vehicleId) return null;
      queueEntryId = currentHead.id;
    } else {
      queueEntryId = request.queueEntryId;
    }

    const entry = await tx.queueEntry.findUnique({
      where: { id: queueEntryId },
      include: {
        vehicle: true,
        assignments: {
          where: { status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PENDING] } },
          orderBy: { assignedAt: 'desc' },
          select: { tripId: true },
        },
      },
    });
    if (!entry) throw new AppError(404, 'QUEUE_ENTRY_NOT_FOUND', 'This queue entry was not found.');
    if (entry.route !== route) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'This queue entry belongs to another route.');
    if (!activeQueueStatuses.includes(entry.status) || entry.vehicle.status === VehicleStatus.ON_TRIP) {
      throw new AppError(409, 'QUEUE_ENTRY_NOT_ACTIVE', 'This van is no longer available for dispatch. Refresh the queue.');
    }
    if (request.method === 'gps' && (!entry.vehicle.insideTerminalZone || entry.vehicleId !== request.vehicleId)) {
      return null;
    }
    const driverId = entry.vehicle.assignedDriverId;
    if (!driverId) throw new AppError(409, 'DRIVER_REQUIRED', 'Assign a driver before dispatching this van.');
    const departedAt = request.method === 'gps' ? request.observedAt : new Date();
    const candidates = await tx.trip.findMany({
      where: { vehicleId: entry.vehicleId, route, status: { in: activeTripStatuses }, departedAt: null },
      include: { assignments: { where: { status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PENDING] } } } },
      orderBy: { scheduledOrTriggeredTime: 'asc' },
    });
    let trip = selectTripForQueueRow(entry.scheduledLoadingTime, entry.assignments, candidates);
    if (!trip) {
      trip = await tx.trip.create({
        data: {
          vehicleId: entry.vehicleId, route, scheduledOrTriggeredTime: departedAt,
          boardingStartTime: entry.arrivalTimestamp, status: TripStatus.DEPARTED, departedAt,
          fareAmount: route === RouteCode.GOA ? DEFAULT_GOA_FARE : DEFAULT_LEGAZPI_FARE,
          createdByDispatcherId: actorUserId,
        },
        include: { assignments: true },
      });
    } else {
      // Record actual departure separately from the passenger's published times.
      await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.DEPARTED, departedAt, awaitingQueueReplacement: false } });
    }
    // Close unanswered requests so neither acceptance nor timeout reopens this
    // departed trip. Accepted driver responses remain unchanged for the audit.
    await tx.tripAssignment.updateMany({ where: { tripId: trip.id, status: AssignmentStatus.PENDING }, data: { status: AssignmentStatus.EXPIRED, respondedAt: departedAt } });
    await tx.queueEntry.update({ where: { id: entry.id }, data: { status: QueueStatus.DEPARTED } });
    await tx.vehicle.update({
      where: { id: entry.vehicleId },
      data: {
        status: VehicleStatus.ON_TRIP, insideTerminalZone: false,
        terminalEntrySampleCount: 0, terminalExitSampleCount: 0, departureSequenceStartKm: null,
        departureAuthorizedAt: null, departureAuthorizedTripId: null,
        departureReviewRequired: false, departureReviewReason: null,
        locationTrackingActive: entry.vehicle.lastKnownInsideZone,
      },
    });
    if (route === RouteCode.LEGAZPI) {
      await rotateAbsentTayaFollowerAfterDeparture(tx, actorUserId, entry.id, entry.position, departedAt);
    }
    await normalizeQueuePositions(tx, route);
    const reason = request.method === 'dispatcher' ? request.reason.trim() || null : null;
    const metadata: Prisma.InputJsonObject = request.method === 'gps'
      ? {
        ...request.metadata,
        method: 'gps',
        automaticQueueHeadExit: true,
        queueEntryId: entry.id,
        driverId,
        previousPosition: entry.position,
      }
      : {
        method: 'dispatcher',
        manualQueueDispatch: true,
        queueEntryId: entry.id,
        driverId,
        previousPosition: entry.position,
      };
    await tx.dispatchLog.create({
      data: { actorUserId, action: DispatchAction.TRIP_DEPARTED, targetId: trip.id, route, reason, metadata },
    });
    await tx.notification.create({
      data: {
        userId: driverId,
        type: NotificationType.TRIP,
        message: `${entry.vehicle.vanId} departure confirmed${request.method === 'gps' ? ' by terminal-exit GPS' : ' by the dispatcher'}.`,
      },
    });
    return { tripId: trip.id, vehicleId: entry.vehicleId, queueEntryId: entry.id, departedAt: departedAt.toISOString(), method: request.method };
  });
  if (result && route === RouteCode.LEGAZPI) await recalculateTayaReadiness();
  return result;
}

/** A queue Dispatch click confirms actual departure, without waiting for GPS. */
export async function dispatchQueueDeparture(actorUserId: string, route: RouteCode, queueEntryId: string, reason: string) {
  const result = await completeQueueDeparture(actorUserId, route, { method: 'dispatcher', queueEntryId, reason });
  if (!result) throw new AppError(409, 'QUEUE_ENTRY_NOT_ACTIVE', 'This van is no longer available for dispatch. Refresh the queue.');
  return result;
}

export async function recordDriverLocation(
  driverId: string,
  latitude: number,
  longitude: number,
  observedAt = new Date(),
  accuracyMeters = TERMINAL_GEOFENCE.maxAccuracyMeters,
  speedMps: number | null = null,
  headingDegrees: number | null = null,
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { assignedDriverId: driverId },
    include: {
      trips: { where: { status: { in: activeTripStatuses } }, orderBy: { scheduledOrTriggeredTime: 'asc' }, take: 1 },
    },
  });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');
  if (vehicle.route === RouteCode.LEGAZPI) await syncTayaDailyQueue(observedAt);
  if (!vehicle.goOnTripEnabled) {
    return { transition: 'disabled', insideActiveZone: vehicle.lastKnownInsideZone, distanceKm: null, trackingActive: false };
  }
  const distanceKm = distanceFromNcebtKm(latitude, longitude);
  const insideActiveZone = distanceKm <= NCEBT.activeZoneRadiusKm;
  const previousObservedAt = vehicle.latestLocationObservedAt;
  if (previousObservedAt && observedAt <= previousObservedAt) {
    return { transition: 'out_of_order', insideActiveZone: vehicle.lastKnownInsideZone, distanceKm, trackingActive: vehicle.locationTrackingActive };
  }
  const sampleIntervalMs = previousObservedAt ? observedAt.getTime() - previousObservedAt.getTime() : Number.POSITIVE_INFINITY;
  const intervalEligible = sampleIntervalMs >= TERMINAL_GEOFENCE.sampleMinIntervalMs;
  const sampleAgeMs = Math.abs(Date.now() - observedAt.getTime());
  const reliable = accuracyMeters <= TERMINAL_GEOFENCE.maxAccuracyMeters
    && sampleAgeMs <= TERMINAL_GEOFENCE.sampleMaxAgeMs;
  const previousDistanceKm = vehicle.latestDistanceKm === null ? null : Number(vehicle.latestDistanceKm);

  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      latestLatitude: latitude,
      latestLongitude: longitude,
      latestLocationAccuracyM: accuracyMeters,
      latestLocationObservedAt: observedAt,
      latestDistanceKm: distanceKm,
    },
  });

  if (!reliable) {
    const reason = `GPS accuracy or freshness is insufficient for automatic departure confirmation (reported accuracy: ${Math.round(accuracyMeters)} m).`;
    const needsReview = Boolean(vehicle.departureAuthorizedAt) && distanceKm >= TERMINAL_GEOFENCE.departureRadiusKm;
    await prisma.$transaction(async (transaction) => {
      await transaction.vehicle.update({
        where: { id: vehicle.id },
        data: {
          terminalEntrySampleCount: 0,
          terminalExitSampleCount: 0,
          departureSequenceStartKm: null,
          ...(needsReview ? {
            status: VehicleStatus.DEPARTURE_REVIEW,
            departureReviewRequired: true,
            departureReviewReason: reason,
          } : {}),
        },
      });
      if (needsReview && !vehicle.departureReviewRequired) {
        await transaction.dispatchLog.create({
          data: {
            actorUserId: driverId,
            action: DispatchAction.DEPARTURE_REVIEW_REQUIRED,
            targetId: vehicle.departureAuthorizedTripId ?? vehicle.id,
            route: vehicle.route,
            reason,
            metadata: { automated: true, accuracyMeters, distanceKm },
          },
        });
      }
    });
    return { transition: needsReview ? 'departure_review_required' : 'unreliable', insideActiveZone: vehicle.lastKnownInsideZone, distanceKm, trackingActive: true };
  }

  let activeTransition: 'active_zone_entered' | 'active_zone_exited' | null = null;
  if (insideActiveZone !== vehicle.lastKnownInsideZone) {
    const entering = insideActiveZone;
    activeTransition = entering ? 'active_zone_entered' : 'active_zone_exited';
    await prisma.$transaction([
      prisma.vehicle.update({
        where: { id: vehicle.id },
        data: {
          lastKnownInsideZone: insideActiveZone,
          locationTrackingActive: entering || vehicle.status !== VehicleStatus.ON_TRIP,
          ...(entering && (vehicle.status === VehicleStatus.OUTSIDE_ZONE || vehicle.status === VehicleStatus.OFFLINE)
            ? { status: VehicleStatus.INCOMING }
            : {}),
          ...(!entering && vehicle.status === VehicleStatus.ON_TRIP
            ? { locationTrackingActive: false }
            : {}),
        },
      }),
      prisma.geofenceEvent.create({
        data: {
          vehicleId: vehicle.id,
          eventType: entering ? GeofenceEventType.ENTERED : GeofenceEventType.EXITED,
          timestamp: observedAt,
          latitude,
          longitude,
          distanceKm,
          accuracyMeters,
        },
      }),
      prisma.dispatchLog.create({
        data: {
          actorUserId: driverId,
          action: entering ? DispatchAction.GEOFENCE_ENTERED : DispatchAction.GEOFENCE_EXITED,
          targetId: vehicle.id,
          route: vehicle.route,
          metadata: { vanId: vehicle.vanId, distanceKm, accuracyMeters, automated: true },
        },
      }),
      prisma.notification.create({
        data: {
          userId: driverId,
          type: NotificationType.QUEUE,
          message: entering
            ? `${vehicle.vanId} entered the 5 km Active Zone. Terminal arrival still requires GPS confirmation.`
            : `${vehicle.vanId} exited the 5 km Active Zone.`,
        },
      }),
    ]);
  }

  if (vehicle.status === VehicleStatus.ON_TRIP) {
    return { transition: activeTransition ?? 'none', insideActiveZone, distanceKm, trackingActive: insideActiveZone };
  }

  if (!vehicle.insideTerminalZone) {
    if (distanceKm <= TERMINAL_GEOFENCE.arrivalRadiusKm) {
      const nextCount = intervalEligible ? vehicle.terminalEntrySampleCount + 1 : vehicle.terminalEntrySampleCount;
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { terminalEntrySampleCount: nextCount, terminalExitSampleCount: 0 } });
      if (nextCount >= TERMINAL_GEOFENCE.requiredSamples) {
        await withRouteQueue(vehicle.route, async (transaction) => {
          const serviceDay = manilaServiceDay(observedAt);
          const tayaServiceDate = new Date(`${serviceDay.date}T00:00:00.000Z`);
          const existingQueue = await transaction.queueEntry.findFirst({
            where: {
              vehicleId: vehicle.id,
              status: { in: activeQueueStatuses },
              ...(vehicle.route === RouteCode.LEGAZPI
                ? { tayaDailySchedule: { is: { serviceDate: tayaServiceDate } } }
                : {}),
            },
            orderBy: { arrivalTimestamp: 'desc' },
          });
          let queueEntryId = existingQueue?.id ?? null;
          if (!existingQueue && vehicle.route !== RouteCode.LEGAZPI) {
            const last = await transaction.queueEntry.aggregate({ where: { route: vehicle.route, status: { in: activeQueueStatuses } }, _max: { position: true } });
            const queueEntry = await transaction.queueEntry.create({
              data: { vehicleId: vehicle.id, route: vehicle.route, position: (last._max.position ?? 0) + 1, arrivalTimestamp: observedAt, status: QueueStatus.WAITING },
            });
            queueEntryId = queueEntry.id;
          }
          await normalizeQueuePositions(transaction, vehicle.route);
          await transaction.vehicle.update({
            where: { id: vehicle.id },
            data: {
              status: VehicleStatus.AT_TERMINAL,
              lastKnownInsideZone: true,
              insideTerminalZone: true,
              locationTrackingActive: true,
              latestArrivalAt: existingQueue?.arrivalTimestamp ?? observedAt,
              terminalEntrySampleCount: 0,
              terminalExitSampleCount: 0,
              departureSequenceStartKm: null,
              departureReviewRequired: false,
              departureReviewReason: null,
            },
          });

          const activeTrip = await transaction.trip.findFirst({
            where: {
              vehicleId: vehicle.id,
              status: { in: activeTripStatuses },
              ...(vehicle.route === RouteCode.LEGAZPI
                ? { scheduledOrTriggeredTime: { gte: serviceDay.start, lt: serviceDay.end } }
                : {}),
            },
          });
          if (vehicle.route === RouteCode.LEGAZPI && !activeTrip && queueEntryId) {
            const trip = await transaction.trip.create({
              data: {
                vehicleId: vehicle.id,
                route: RouteCode.LEGAZPI,
                scheduledOrTriggeredTime: observedAt,
                // Taya vans load as soon as they are admitted to the terminal,
                // so loading opens at the arrival sample that created the trip.
                boardingStartTime: observedAt,
                status: TripStatus.ASSIGNED,
                fareAmount: DEFAULT_LEGAZPI_FARE,
                createdByDispatcherId: vehicle.managedByDispatcherId,
              },
            });
            await transaction.tripAssignment.create({
              data: {
                tripId: trip.id,
                queueEntryId,
                driverId,
                status: AssignmentStatus.ACCEPTED,
                assignedAt: observedAt,
                respondedAt: observedAt,
                responseDeadline: observedAt,
              },
            });
            await transaction.queueEntry.update({ where: { id: queueEntryId }, data: { status: QueueStatus.ACCEPTED } });
            await transaction.notification.create({
              data: { userId: driverId, type: NotificationType.ASSIGNMENT, message: 'You are assigned to the Legazpi Taya queue. Cancel the assignment if you cannot make the trip.' },
            });
            await transaction.dispatchLog.create({
              data: {
                actorUserId: driverId,
                action: DispatchAction.ASSIGNMENT_CREATED,
                targetId: trip.id,
                route: RouteCode.LEGAZPI,
                metadata: { queueEntryId, automated: true, trigger: 'confirmed_terminal_arrival' },
              },
            });
          }
          await transaction.dispatchLog.create({
            data: {
              actorUserId: driverId,
              action: DispatchAction.TERMINAL_ARRIVAL_CONFIRMED,
              targetId: vehicle.id,
              route: vehicle.route,
              metadata: { queueEntryId, samples: nextCount, distanceKm, accuracyMeters },
            },
          });
          await transaction.notification.create({
            data: {
              userId: driverId,
              type: NotificationType.QUEUE,
              message: vehicle.route === RouteCode.LEGAZPI
                ? `${vehicle.vanId} terminal arrival confirmed. Your dispatcher-planned Taya position is unchanged.`
                : `${vehicle.vanId} terminal arrival confirmed and queue timestamp recorded.`,
            },
          });
        });
        return { transition: 'terminal_arrival_confirmed', insideActiveZone: true, insideTerminalZone: true, distanceKm, trackingActive: true };
      }
      return { transition: `terminal_arrival_sample_${nextCount}`, insideActiveZone, insideTerminalZone: false, distanceKm, trackingActive: true };
    }
    if (vehicle.terminalEntrySampleCount) {
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { terminalEntrySampleCount: 0 } });
    }
    return { transition: activeTransition ?? 'none', insideActiveZone, insideTerminalZone: false, distanceKm, trackingActive: true };
  }

  if (distanceKm <= TERMINAL_GEOFENCE.arrivalRadiusKm) {
    if (vehicle.terminalExitSampleCount) {
      await prisma.vehicle.update({ where: { id: vehicle.id }, data: { terminalExitSampleCount: 0, departureSequenceStartKm: null } });
    }
    return { transition: activeTransition ?? 'none', insideActiveZone, insideTerminalZone: true, distanceKm, trackingActive: true };
  }

  const outwardMoving = vehicle.terminalExitSampleCount === 0
    || previousDistanceKm === null
    || distanceKm >= previousDistanceKm + TERMINAL_GEOFENCE.minOutwardProgressKm
    || (speedMps !== null && speedMps >= 1);
  const nextExitCount = intervalEligible && outwardMoving ? vehicle.terminalExitSampleCount + 1 : vehicle.terminalExitSampleCount;
  const sequenceStartKm = vehicle.departureSequenceStartKm === null ? distanceKm : Number(vehicle.departureSequenceStartKm);
  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      terminalExitSampleCount: nextExitCount,
      departureSequenceStartKm: sequenceStartKm,
    },
  });

  if (nextExitCount < TERMINAL_GEOFENCE.requiredSamples) {
    return { transition: `terminal_exit_sample_${nextExitCount}`, insideActiveZone, insideTerminalZone: true, distanceKm, trackingActive: true };
  }

  const departure = await completeQueueDeparture(driverId, vehicle.route, {
    method: 'gps',
    vehicleId: vehicle.id,
    observedAt,
    metadata: {
      samples: nextExitCount,
      distanceKm,
      accuracyMeters,
      speedMps,
      headingDegrees,
      sequenceStartKm,
    },
  });
  if (departure) {
    return { transition: 'departure_confirmed', insideActiveZone, insideTerminalZone: false, distanceKm, trackingActive: insideActiveZone, departure };
  }

  const reviewReason = 'The van left the terminal circle without being the first queued van with an active trip. Dispatcher review is required.';
  await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        status: VehicleStatus.DEPARTURE_REVIEW,
        insideTerminalZone: false,
        terminalExitSampleCount: 0,
        departureSequenceStartKm: null,
        departureReviewRequired: true,
        departureReviewReason: reviewReason,
      },
    }),
    prisma.dispatchLog.create({
      data: {
        actorUserId: driverId,
        action: DispatchAction.DEPARTURE_REVIEW_REQUIRED,
        targetId: vehicle.id,
        route: vehicle.route,
        reason: reviewReason,
        metadata: { automated: true, unauthorizedExit: true, samples: nextExitCount, distanceKm, accuracyMeters },
      },
    }),
    prisma.notification.create({
      data: { userId: driverId, type: NotificationType.TRIP, message: `${vehicle.vanId} exit requires dispatcher review; the trip was not marked departed.` },
    }),
  ]);

  return { transition: 'departure_review_required', insideActiveZone, insideTerminalZone: false, distanceKm, trackingActive: true };
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
  const trip = await transaction.trip.findUnique({ where: { id: tripId }, select: { scheduledOrTriggeredTime: true } });
  await transaction.tripAssignment.upsert({
    where: { tripId_queueEntryId: { tripId, queueEntryId } },
    update: { driverId, status: AssignmentStatus.ACCEPTED, assignedAt: now, respondedAt: now, responseDeadline: now },
    create: { tripId, queueEntryId, driverId, status: AssignmentStatus.ACCEPTED, assignedAt: now, respondedAt: now, responseDeadline: now },
  });
  await transaction.queueEntry.update({ where: { id: queueEntryId }, data: { status: QueueStatus.ACCEPTED } });
  await transaction.trip.update({ where: { id: tripId }, data: { vehicleId, status: TripStatus.ASSIGNED } });
  await transaction.notification.create({
    data: {
      userId: driverId,
      type: NotificationType.ASSIGNMENT,
      message: trip
        ? `You are assigned to the ${routeLabels[route]} trip for ${departureLabel(trip.scheduledOrTriggeredTime)}. Cancel the assignment if you cannot make the trip.`
        : `You are assigned to a ${routeLabels[route]} trip. Cancel the assignment if you cannot make it.`,
    },
  });
  await transaction.dispatchLog.create({ data: { actorUserId, action: DispatchAction.ASSIGNMENT_CREATED, targetId: tripId, route, metadata } });
}

export async function assignScheduledVehicleDriver(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  tripId: string,
  vehicleId: string,
  driverId: string,
  route: RouteCode,
  now: Date,
  metadata: Prisma.InputJsonObject,
) {
  const trip = await transaction.trip.findUnique({ where: { id: tripId }, select: { scheduledOrTriggeredTime: true, boardingStartTime: true } });
  if (!trip) throw new AppError(404, 'SCHEDULE_NOT_FOUND', 'The scheduled trip could not be assigned.');
  const responseDeadline = boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime);

  const existingAssignment = await transaction.tripAssignment.findFirst({
    where: { tripId, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
    orderBy: { assignedAt: 'desc' },
  });
  if (existingAssignment) return existingAssignment;
  const assignment = await transaction.tripAssignment.create({
    data: {
      tripId,
      queueEntryId: null,
      driverId,
      status: AssignmentStatus.ACCEPTED,
      assignedAt: now,
      respondedAt: now,
      responseDeadline,
    },
  });
  await transaction.trip.update({ where: { id: tripId }, data: { vehicleId, status: TripStatus.ASSIGNED } });
  await transaction.notification.create({
    data: {
      userId: driverId,
      type: NotificationType.ASSIGNMENT,
      message: `You are assigned to the ${routeLabels[route]} trip for ${departureLabel(trip.scheduledOrTriggeredTime)}. Cancel the assignment if you cannot make the trip.`,
    },
  });
  await transaction.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.ASSIGNMENT_CREATED,
      targetId: tripId,
      route,
      metadata,
    },
  });
  return assignment;
}

async function activateLegacyPendingAssignments(actorUserId: string, route: RouteCode, now: Date) {
  const serviceDate = new Date(`${manilaServiceDay(now).date}T00:00:00.000Z`);
  return withRouteQueue(route, async (transaction) => {
    const pending = await transaction.tripAssignment.findMany({
      where: {
        status: AssignmentStatus.PENDING,
        trip: {
          route,
          status: { in: activeTripStatuses },
          departedAt: null,
          ...(route === RouteCode.LEGAZPI
            ? { tayaDailySchedule: { is: { serviceDate } } }
            : {}),
        },
      },
      include: { trip: true, queueEntry: true },
    });
    for (const assignment of pending) {
      await transaction.tripAssignment.update({
        where: { id: assignment.id },
        data: { status: AssignmentStatus.ACCEPTED, respondedAt: now },
      });
      if (assignment.queueEntryId && assignment.queueEntry?.status === QueueStatus.ASSIGNED) {
        await transaction.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.ACCEPTED } });
      }
      if (assignment.trip.status === TripStatus.ASSIGNING) {
        await transaction.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.ASSIGNED } });
      }
      await transaction.notification.create({
        data: { userId: assignment.driverId, type: NotificationType.ASSIGNMENT, message: `Your ${routeLabels[route]} assignment is active automatically. Cancel it if you cannot make the trip.` },
      });
      await transaction.dispatchLog.create({
        data: { actorUserId, action: DispatchAction.ASSIGNMENT_ACCEPTED, targetId: assignment.tripId, route, metadata: { assignmentId: assignment.id, automated: true, trigger: 'legacy_pending_auto_accept' } },
      });
    }
    return { expired: 0, advanced: 0, activated: pending.length };
  });
}

async function assignUnassignedManagedSchedules(actorUserId: string, now: Date) {
  const recurringAssignmentHorizon = new Date(now.getTime() + WEEKLY_ASSIGNMENT_LOOKAHEAD_MS);
  const trips = await prisma.trip.findMany({
    where: {
      route: RouteCode.GOA,
      status: TripStatus.SCHEDULED,
      createdByDispatcherId: { not: null },
      scheduledOrTriggeredTime: { gt: now },
      OR: [
        { weeklyScheduleId: null },
        { weeklyScheduleId: { not: null }, scheduledOrTriggeredTime: { lte: recurringAssignmentHorizon } },
      ],
      assignments: { none: {} },
      vehicle: { assignedDriverId: { not: null }, assignedDriver: { isActive: true } },
    },
    orderBy: { scheduledOrTriggeredTime: 'asc' },
    include: { vehicle: { select: { assignedDriverId: true } } },
  });

  let assigned = 0;
  for (const trip of trips) {
    if (!trip.vehicle.assignedDriverId) continue;
    await prisma.$transaction(async (transaction) => {
      const assignmentCount = await transaction.tripAssignment.count({ where: { tripId: trip.id } });
      if (assignmentCount > 0) return;
      await assignScheduledVehicleDriver(
        transaction,
        actorUserId,
        trip.id,
        trip.vehicleId,
        trip.vehicle.assignedDriverId!,
        trip.route,
        now,
        { automated: true, trigger: 'managed_schedule_reconciliation', vehicleId: trip.vehicleId },
      );
      assigned += 1;
    });
  }
  return assigned;
}

async function evaluateGoso(actorUserId: string, now: Date) {
  // Future-day acceptances intentionally have no queue row. Admit them when
  // their service day arrives, before applying the loading-time late policy.
  await admitAcceptedGosoSchedulesForDay(now);
  await evaluateGosoLoading(actorUserId, now);
  const directlyAssigned = await assignUnassignedManagedSchedules(actorUserId, now);
  const assignmentWindow = new Date(now.getTime() + GOSO_BOARDING_WINDOW_MS);
  const trips = await prisma.trip.findMany({
    where: { route: RouteCode.GOA, awaitingQueueReplacement: false, status: { in: [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING] }, scheduledOrTriggeredTime: { lte: assignmentWindow } },
    include: { vehicle: true, assignments: { where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } }, orderBy: { assignedAt: 'desc' }, take: 1 } },
    orderBy: { scheduledOrTriggeredTime: 'asc' },
  });
  let assigned = directlyAssigned;
  let ready = 0;
  for (const trip of trips) {
    let assignment = trip.assignments[0];
    let assignedVehicleId = trip.vehicleId;
    if (!assignment) {
      const queue = await prisma.queueEntry.findFirst({
        where: { route: RouteCode.GOA, status: QueueStatus.WAITING, vehicle: { assignedDriverId: { not: null }, status: { notIn: [VehicleStatus.UNAVAILABLE, VehicleStatus.DELAYED, VehicleStatus.ON_TRIP] } } },
        orderBy: queueOrder,
        include: { vehicle: { select: { assignedDriverId: true } } },
      });
      if (!queue?.vehicle.assignedDriverId) continue;
      await prisma.$transaction((transaction) => assignQueueEntry(transaction, actorUserId, trip.id, queue.id, queue.vehicleId, queue.vehicle.assignedDriverId!, RouteCode.GOA, now, { automated: true, trigger: 'goso_schedule_window' }));
      assigned += 1;
      assignedVehicleId = queue.vehicleId;
      assignment = await prisma.tripAssignment.findFirst({ where: { tripId: trip.id, queueEntryId: queue.id } }) ?? undefined;
    }
    if (assignment?.status === AssignmentStatus.ACCEPTED && trip.scheduledOrTriggeredTime <= now && isPresentForLoading(trip.vehicle) && trip.vehicle.status !== VehicleStatus.DELAYED) {
      const becameReady = await withRouteQueue(RouteCode.GOA, async (transaction) => {
        const current = await transaction.trip.findUniqueOrThrow({ where: { id: trip.id }, include: { vehicle: true, assignments: { where: { status: AssignmentStatus.ACCEPTED } } } });
        if (!activeTripStatuses.includes(current.status) || current.departedAt || current.vehicleId !== assignedVehicleId || !current.assignments.length || !isPresentForLoading(current.vehicle, now) || current.vehicle.status === VehicleStatus.DELAYED) return false;
        await transaction.trip.update({ where: { id: trip.id }, data: { status: TripStatus.READY } });
        if (assignment!.queueEntryId) {
          await transaction.queueEntry.update({ where: { id: assignment!.queueEntryId }, data: { status: QueueStatus.READY_FOR_DISPATCH } });
        }
        await transaction.vehicle.update({ where: { id: assignedVehicleId }, data: { status: current.vehicle.departureAuthorizedAt ? VehicleStatus.DEPARTURE_PENDING : VehicleStatus.READY_FOR_DISPATCH } });
        return true;
      });
      if (becameReady) ready += 1;
    }
  }
  return { assigned, ready };
}

export async function recalculateTayaReadiness(now = new Date()) {
  const serviceDay = manilaServiceDay(now);
  const serviceDate = new Date(`${serviceDay.date}T00:00:00.000Z`);
  return withRouteQueue(RouteCode.LEGAZPI, async (transaction) => {
  const queue = await transaction.queueEntry.findMany({
    where: {
      route: RouteCode.LEGAZPI,
      status: { in: [QueueStatus.WAITING, QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH] },
      tayaDailySchedule: { is: { serviceDate } },
    },
    orderBy: queueOrder,
    include: {
      vehicle: {
        include: {
          trips: {
            where: {
              status: { in: activeTripStatuses },
              scheduledOrTriggeredTime: {
                gte: serviceDay.start,
                lt: serviceDay.end,
              },
            },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
            take: 1,
            include: { passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 } },
          },
        },
      },
    },
  });
  let readyEntryId: string | null = null;
  for (const entry of queue) {
    const trip = entry.vehicle.trips[0];
    if (!trip) continue;
    const occupancy = trip.passengerCounts[0]?.count ?? 0;
    const ready = entry.position === 1 && occupancy >= passengerCapacityOf(entry.vehicle) && isPresentForLoading(entry.vehicle);
    if (ready) readyEntryId = entry.id;
    const nextQueueStatus = ready
      ? QueueStatus.READY_FOR_DISPATCH
      : entry.status === QueueStatus.ASSIGNED || entry.status === QueueStatus.ACCEPTED ? entry.status : QueueStatus.WAITING;
    const nextTripStatus = ready
      ? TripStatus.READY
      : trip.status === TripStatus.ASSIGNED || trip.status === TripStatus.ASSIGNING ? trip.status : TripStatus.BOARDING;
    await transaction.queueEntry.update({ where: { id: entry.id }, data: { status: nextQueueStatus } });
    await transaction.trip.update({ where: { id: trip.id }, data: { status: nextTripStatus } });
    const present = isPresentForLoading(entry.vehicle);
    await transaction.vehicle.update({
      where: { id: entry.vehicleId },
      data: {
        status: entry.vehicle.departureAuthorizedAt
          ? VehicleStatus.DEPARTURE_PENDING
          : entry.vehicle.departureReviewRequired
            ? VehicleStatus.DEPARTURE_REVIEW
            : ready
              ? VehicleStatus.READY_FOR_DISPATCH
              : present
                ? VehicleStatus.LOADING
                : entry.vehicle.status === VehicleStatus.LOADING || entry.vehicle.status === VehicleStatus.READY_FOR_DISPATCH
                  ? VehicleStatus.OUTSIDE_ZONE
                  : entry.vehicle.status,
      },
    });
  }
  return { evaluated: queue.length, readyEntryId };
  });
}

async function resolveDispatcherActor(route: RouteCode, actorUserId?: string) {
  if (actorUserId) {
    const dispatcher = await prisma.user.findFirst({ where: { id: actorUserId, role: UserRole.DISPATCHER, dispatcherRoute: route, isActive: true }, select: { id: true } });
    if (!dispatcher) throw new AppError(403, 'ROUTE_ACCESS_DENIED', `This dispatcher cannot run automation for the ${routeLabels[route]} route.`);
    return dispatcher.id;
  }
  const dispatcher = await prisma.user.findFirst({ where: { role: UserRole.DISPATCHER, dispatcherRoute: route, isActive: true }, select: { id: true } });
  if (!dispatcher) throw new AppError(503, 'DISPATCH_ACTOR_UNAVAILABLE', 'No active dispatcher account is available for automated dispatch logging.');
  return dispatcher.id;
}

async function runRouteDispatchEngine(route: RouteCode, actorUserId: string | undefined, now: Date) {
  const actor = await resolveDispatcherActor(route, actorUserId);
  if (route === RouteCode.LEGAZPI) await syncTayaDailyQueue(now);
  const expiredAssignments = await activateLegacyPendingAssignments(actor, route, now);
  const goso = route === RouteCode.GOA ? await evaluateGoso(actor, now) : { assigned: 0, ready: 0 };
  const taya = route === RouteCode.LEGAZPI ? await recalculateTayaReadiness(now) : { evaluated: 0, readyEntryId: null };
  return { evaluatedAt: now.toISOString(), expiredAssignments, goso, taya };
}

export async function runDispatchEngine(actorUserId?: string, now = new Date(), route?: RouteCode) {
  if (actorUserId) {
    const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { dispatcherRoute: true } });
    const ownedRoute = route ?? actor?.dispatcherRoute;
    if (!ownedRoute) throw new AppError(403, 'DISPATCHER_ROUTE_REQUIRED', 'This dispatcher account is not assigned to an operational route.');
    return runRouteDispatchEngine(ownedRoute, actorUserId, now);
  }

  const [goa, legazpi] = await Promise.all([
    runRouteDispatchEngine(RouteCode.GOA, undefined, now),
    runRouteDispatchEngine(RouteCode.LEGAZPI, undefined, now),
  ]);
  return {
    evaluatedAt: now.toISOString(),
    expiredAssignments: {
      expired: goa.expiredAssignments.expired + legazpi.expiredAssignments.expired,
      advanced: goa.expiredAssignments.advanced + legazpi.expiredAssignments.advanced,
    },
    goso: goa.goso,
    taya: legazpi.taya,
  };
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

export async function cancelDriverScheduledAssignment(driverId: string, assignmentId: string, optionalReason: string) {
  const now = new Date();
  const reason = optionalReason || 'Driver cancelled without providing a reason.';

  return prisma.$transaction(async (transaction) => {
    const assignment = await transaction.tripAssignment.findFirst({
      where: { id: assignmentId, driverId },
      include: {
        queueEntry: true,
        trip: {
          include: {
            vehicle: true,
            reservations: {
              where: { status: { in: movableReservationStatuses } },
              orderBy: { createdAt: 'asc' },
              include: { passenger: { select: { id: true } }, seats: { orderBy: { seatNumber: 'asc' } } },
            },
          },
        },
      },
    });
    if (!assignment) throw new AppError(404, 'ASSIGNMENT_NOT_FOUND', 'This assignment is not available to the driver.');
    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new AppError(409, 'ASSIGNMENT_NOT_CANCELLABLE', 'Only an accepted trip assignment can be cancelled.');
    }
    if (!activeTripStatuses.includes(assignment.trip.status)) {
      throw new AppError(409, 'TRIP_ALREADY_STARTED', 'This trip can no longer be cancelled from the driver app.');
    }

    const replacementQueue = await transaction.queueEntry.findFirst({
      where: {
        route: assignment.trip.route,
        status: { in: [QueueStatus.WAITING, QueueStatus.READY_FOR_DISPATCH] },
        ...(assignment.queueEntryId ? { id: { not: assignment.queueEntryId } } : {}),
        vehicleId: { not: assignment.trip.vehicleId },
        vehicle: {
          assignedDriverId: { not: null },
          status: { notIn: [VehicleStatus.UNAVAILABLE, VehicleStatus.DELAYED, VehicleStatus.ON_TRIP] },
        },
      },
      orderBy: [{ position: 'asc' }, { arrivalTimestamp: 'asc' }, { createdAt: 'asc' }],
      include: { vehicle: true },
    });
    if (!replacementQueue?.vehicle.assignedDriverId) {
      await transaction.tripAssignment.update({
        where: { id: assignment.id },
        data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
      });
      if (assignment.queueEntryId) {
        await transaction.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.REPLACED } });
      }
      await transaction.trip.update({
        where: { id: assignment.tripId },
        data: { status: TripStatus.ASSIGNING, awaitingQueueReplacement: true },
      });
      await transaction.vehicle.update({
        where: { id: assignment.trip.vehicleId },
        data: { status: VehicleStatus.UNAVAILABLE, locationTrackingActive: false },
      });
      await normalizeQueuePositions(transaction, assignment.trip.route);
      await transaction.notification.create({
        data: {
          userId: driverId,
          type: NotificationType.ASSIGNMENT,
          message: `Your ${routeLabels[assignment.trip.route]} assignment for ${departureLabel(assignment.trip.scheduledOrTriggeredTime)} was cancelled. The dispatcher must assign a replacement.`,
        },
      });
      await transaction.dispatchLog.create({
        data: {
          actorUserId: driverId,
          action: DispatchAction.ASSIGNMENT_CANCELLED,
          targetId: assignment.tripId,
          route: assignment.trip.route,
          reason,
          metadata: { assignmentId: assignment.id, replacementRequired: true, reservationsWaiting: assignment.trip.reservations.length },
        },
      });
      return {
        cancelledAssignmentId: assignment.id,
        sourceTripId: assignment.tripId,
        targetTripId: null,
        replacementVehicleId: null,
        replacementDriverId: null,
        reservationsMoved: 0,
        seatChanges: [],
        reason: optionalReason || null,
        replacementRequired: true,
      };
    }

    let targetTrip = await transaction.trip.findFirst({
      where: {
        id: { not: assignment.tripId },
        vehicleId: replacementQueue.vehicleId,
        route: assignment.trip.route,
        scheduledOrTriggeredTime: assignment.trip.scheduledOrTriggeredTime,
        status: { in: activeTripStatuses },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!targetTrip) {
      targetTrip = await transaction.trip.create({
        data: {
          vehicleId: replacementQueue.vehicleId,
          route: assignment.trip.route,
          scheduledOrTriggeredTime: assignment.trip.scheduledOrTriggeredTime,
          // Reallocation keeps the original departure's loading window.
          boardingStartTime: boardingStartFor(assignment.trip.scheduledOrTriggeredTime, assignment.trip.boardingStartTime),
          status: TripStatus.ASSIGNING,
          fareAmount: assignment.trip.fareAmount,
          createdByDispatcherId: assignment.trip.createdByDispatcherId ?? replacementQueue.vehicle.managedByDispatcherId,
        },
      });
    }

    const occupiedSeats = new Set(
      (await transaction.reservationSeat.findMany({ where: { tripId: targetTrip.id }, select: { seatNumber: true } }))
        .map((seat) => seat.seatNumber),
    );
    const seatChanges: Array<{ reference: string; from: number[]; to: number[] }> = [];

    const targetCapacity = passengerCapacityOf(replacementQueue.vehicle);
    for (const reservation of assignment.trip.reservations) {
      const originalSeats = reservation.seats.map((seat) => seat.seatNumber).sort((left, right) => left - right);
      const allocatedSeats = allocateSeats(targetCapacity, occupiedSeats, originalSeats).sort((left, right) => left - right);
      const seatChanged = originalSeats.some((seat, index) => seat !== allocatedSeats[index]);
      const nextStatus = statusAfterReallocation(reservation.status);

      await transaction.reservationSeat.deleteMany({ where: { reservationId: reservation.id } });
      await transaction.reservation.update({ where: { id: reservation.id }, data: { tripId: targetTrip.id, status: nextStatus } });
      await transaction.reservationSeat.createMany({
        data: allocatedSeats.map((seatNumber) => ({ reservationId: reservation.id, tripId: targetTrip!.id, seatNumber })),
      });
      await transaction.notification.create({
        data: {
          userId: reservation.passenger.id,
          type: NotificationType.REALLOCATION,
          message: seatChanged
            ? `${reservation.reference} moved to ${replacementQueue.vehicle.vanId} after a driver cancellation. Your seat changed from ${originalSeats.join(', ')} to ${allocatedSeats.join(', ')} because the original seat was already reserved.`
            : `${reservation.reference} moved to ${replacementQueue.vehicle.vanId} after a driver cancellation. Your seat remains ${allocatedSeats.join(', ')}.`,
        },
      });
      seatChanges.push({ reference: reservation.reference, from: originalSeats, to: allocatedSeats });
    }

    await transaction.tripAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    if (assignment.queueEntryId) {
      await transaction.queueEntry.update({ where: { id: assignment.queueEntryId }, data: { status: QueueStatus.REPLACED } });
    }
    await transaction.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.UNABLE_TO_DEPART } });
    await transaction.vehicle.update({
      where: { id: assignment.trip.vehicleId },
      data: { status: VehicleStatus.UNAVAILABLE, locationTrackingActive: false },
    });

    await assignQueueEntry(
      transaction,
      driverId,
      targetTrip.id,
      replacementQueue.id,
      replacementQueue.vehicleId,
      replacementQueue.vehicle.assignedDriverId,
      assignment.trip.route,
      now,
      { automated: true, trigger: 'driver_schedule_cancellation', cancelledAssignmentId: assignment.id, sourceTripId: assignment.tripId },
    );
    await normalizeQueuePositions(transaction, assignment.trip.route);

    await transaction.notification.create({
      data: {
        userId: driverId,
        type: NotificationType.ASSIGNMENT,
        message: `Your ${routeLabels[assignment.trip.route]} trip for ${departureLabel(assignment.trip.scheduledOrTriggeredTime)} was cancelled and transferred to ${replacementQueue.vehicle.vanId}.`,
      },
    });
    await transaction.dispatchLog.create({
      data: {
        actorUserId: driverId,
        action: DispatchAction.ASSIGNMENT_CANCELLED,
        targetId: assignment.tripId,
        route: assignment.trip.route,
        reason,
        metadata: {
          assignmentId: assignment.id,
          replacementQueueEntryId: replacementQueue.id,
          replacementVehicleId: replacementQueue.vehicleId,
          targetTripId: targetTrip.id,
          reservationsMoved: assignment.trip.reservations.length,
        },
      },
    });
    if (assignment.trip.reservations.length) {
      await transaction.dispatchLog.create({
        data: {
          actorUserId: driverId,
          action: DispatchAction.RESERVATION_REALLOCATED,
          targetId: assignment.tripId,
          route: assignment.trip.route,
          reason,
          metadata: { targetTripId: targetTrip.id, targetVehicleId: replacementQueue.vehicleId, reservationCount: assignment.trip.reservations.length },
        },
      });
    }

    return {
      cancelledAssignmentId: assignment.id,
      sourceTripId: assignment.tripId,
      targetTripId: targetTrip.id,
      replacementVehicleId: replacementQueue.vehicleId,
      replacementDriverId: replacementQueue.vehicle.assignedDriverId,
      reservationsMoved: assignment.trip.reservations.length,
      seatChanges,
      reason: optionalReason || null,
    };
  });
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
      orderBy: queueOrder,
      include: { vehicle: true },
    });
    if (sourceTrip?.reservations.length && !targetQueue?.vehicle.assignedDriverId) {
      throw new AppError(409, 'REALLOCATION_VEHICLE_UNAVAILABLE', 'No eligible replacement van is available for these reservations.');
    }

    let targetTrip: Awaited<ReturnType<typeof transaction.trip.findFirst>> = null;
    if (sourceTrip && targetQueue) {
      targetTrip = await transaction.trip.findFirst({
        where: { vehicleId: targetQueue.vehicleId, route: sourceTrip.route, scheduledOrTriggeredTime: sourceTrip.scheduledOrTriggeredTime, status: { in: activeTripStatuses } },
        orderBy: { scheduledOrTriggeredTime: 'asc' },
      });
      if (!targetTrip) {
        targetTrip = await transaction.trip.create({
          data: {
            vehicleId: targetQueue.vehicleId,
            route: sourceTrip.route,
            scheduledOrTriggeredTime: sourceTrip.scheduledOrTriggeredTime,
            // Reallocation keeps the original departure's loading window.
            boardingStartTime: boardingStartFor(sourceTrip.scheduledOrTriggeredTime, sourceTrip.boardingStartTime),
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
    const targetCapacity = targetQueue ? passengerCapacityOf(targetQueue.vehicle) : VAN_PASSENGER_CAPACITY;
    for (const reservation of sourceTrip?.reservations ?? []) {
      if (!targetTrip || !targetQueue) break;
      const seats = allocateSeats(targetCapacity, occupiedSeats, reservation.seats.map((seat) => seat.seatNumber));
      await transaction.reservationSeat.deleteMany({ where: { reservationId: reservation.id } });
      const nextStatus = statusAfterReallocation(reservation.status);
      await transaction.reservation.update({ where: { id: reservation.id }, data: { tripId: targetTrip.id, status: nextStatus } });
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
        route: sourceVehicle.route,
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
          route: sourceTrip.route,
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
