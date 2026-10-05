import {
  AssignmentStatus,
  DispatchAction,
  NotificationType,
  Prisma,
  QueueStatus,
  RouteCode,
  TripStatus,
  VehicleStatus,
} from '@prisma/client';
import { DEFAULT_LEGAZPI_FARE } from '../config/fare.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { normalizeSavedQueue, operationalQueueStatuses, queueOrder, withRouteQueue } from './queueSchedulingService.js';
import { tayaQueueAdmissionWhere } from './tayaQueueEligibility.js';

const closedQueueStatuses: QueueStatus[] = [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED];
const activeTripStatuses: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY, TripStatus.DELAYED];
const unavailableVehicleStatuses: VehicleStatus[] = [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE];
const closedTripStatuses: TripStatus[] = [TripStatus.DEPARTED, TripStatus.COMPLETED, TripStatus.UNABLE_TO_DEPART];

function serviceDateValue(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(422, 'INVALID_SERVICE_DATE', 'Choose a valid service date.');
  const value = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new AppError(422, 'INVALID_SERVICE_DATE', 'Choose a valid service date.');
  }
  return value;
}

function todayKey(now = new Date()) {
  return manilaServiceDay(now).date;
}

const weekdayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function isoWeekday(dateKey: string) {
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export interface TayaWeeklyScheduleInput {
  weekday: number;
  vehicleIds: string[];
}

async function materializeWeeklyPlanInTransaction(tx: Prisma.TransactionClient, now: Date) {
  const dateKey = todayKey(now);
  const serviceDate = serviceDateValue(dateKey);
  const existingCount = await tx.tayaDailySchedule.count({ where: { serviceDate } });
  if (existingCount) return;

  const templates = await tx.tayaWeeklySchedule.findMany({
    where: { weekday: isoWeekday(dateKey) },
    orderBy: { position: 'asc' },
  });
  if (!templates.length) return;

  await tx.tayaDailySchedule.createMany({
    data: templates.map((template) => ({
      dispatcherId: template.dispatcherId,
      vehicleId: template.vehicleId,
      serviceDate,
      position: template.position,
    })),
  });
}

async function activeTayaRows(tx: Prisma.TransactionClient, now: Date) {
  return tx.queueEntry.findMany({
    where: {
      route: RouteCode.LEGAZPI,
      status: { in: operationalQueueStatuses },
      ...tayaQueueAdmissionWhere(now),
    },
    orderBy: queueOrder,
  });
}

/** Admit a day's assigned driver on confirmed terminal arrival.
 * Existing rows retain dispatcher overrides and departure-triggered late moves.
 * Pending assignments have no active position until confirmed terminal arrival.
 */
export async function sequenceTayaArrivalInTransaction(
  tx: Prisma.TransactionClient,
  queueEntryId: string,
  arrivedAt: Date,
  now = arrivedAt,
) {
  const arriving = await tx.queueEntry.findFirst({
    where: {
      id: queueEntryId, route: RouteCode.LEGAZPI,
      status: { in: operationalQueueStatuses },
      vehicle: { insideTerminalZone: true, status: { notIn: unavailableVehicleStatuses } },
      tayaDailySchedule: { is: { serviceDate: serviceDateValue(todayKey(now)) } },
    },
  });
  if (!arriving || (arriving.tayaArrivalAt && arriving.position !== null)) return;
  const rows = await activeTayaRows(tx, now);

  await tx.queueEntry.update({
    where: { id: queueEntryId },
    data: { tayaArrivalAt: arrivedAt, arrivalTimestamp: arrivedAt },
  });
  // A late driver's return must not undo the existing move-to-last rule.
  const reordered = rows.filter((row) => row.id !== queueEntryId);
  const insertion = arriving.lateAt ? -1 : reordered.findIndex((row) => row.lateAt || !row.tayaArrivalAt
    || row.tayaArrivalAt.getTime() > arrivedAt.getTime()
    || (row.tayaArrivalAt.getTime() === arrivedAt.getTime() && row.vehicleId.localeCompare(arriving.vehicleId) > 0));
  reordered.splice(insertion < 0 ? reordered.length : insertion, 0, arriving);
  for (const [index, row] of reordered.entries()) {
    if (row.position !== index + 1) {
      await tx.queueEntry.update({ where: { id: row.id }, data: { position: index + 1 } });
    }
  }
}

/** Materialize today's planned Taya assignments without resetting queue order. */
export async function syncTayaDailyQueueInTransaction(tx: Prisma.TransactionClient, now = new Date()) {
  const serviceDay = manilaServiceDay(now);
  const serviceDate = serviceDateValue(serviceDay.date);
  await materializeWeeklyPlanInTransaction(tx, now);
  const plans = await tx.tayaDailySchedule.findMany({
    where: { serviceDate },
    // The plan determines membership, never terminal loading priority.
    orderBy: { vehicleId: 'asc' },
    include: {
      queueEntry: true,
      trip: true,
      vehicle: { include: { assignedDriver: { select: { id: true, isActive: true } } } },
    },
  });

  const plannedQueueIds = plans.flatMap((plan) => plan.queueEntryId ? [plan.queueEntryId] : []);
  const obsoleteRows = await tx.queueEntry.findMany({
    where: {
      route: RouteCode.LEGAZPI,
      status: { in: operationalQueueStatuses },
      // Reconcile only rows owned by today's dated Taya occurrence. Older
      // operational rows are historical records and must remain untouched.
      tayaDailySchedule: { is: { serviceDate } },
      ...(plannedQueueIds.length ? { id: { notIn: plannedQueueIds } } : {}),
    },
    select: { id: true },
  });
  if (obsoleteRows.length) {
    const obsoleteIds = obsoleteRows.map((row) => row.id);
    await tx.tripAssignment.updateMany({
      where: { queueEntryId: { in: obsoleteIds }, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    await tx.queueEntry.updateMany({ where: { id: { in: obsoleteIds } }, data: { status: QueueStatus.REPLACED } });
  }

  const arrivalsToSequence: { queueEntryId: string; arrivedAt: Date }[] = [];
  let materialized = 0;
  for (const plan of plans) {
    if (!plan.vehicle.assignedDriverId || !plan.vehicle.assignedDriver?.isActive) continue;
    let vehicleStatus = plan.vehicle.status;
    let queueEntryId = plan.queueEntryId;
    let tripId = plan.tripId;
    const hasClosedLinkedOccurrence = Boolean(
      (plan.queueEntry && closedQueueStatuses.includes(plan.queueEntry.status))
      || (plan.trip && (plan.trip.departedAt || closedTripStatuses.includes(plan.trip.status))),
    );
    let departedToday = false;
    if (vehicleStatus === VehicleStatus.ON_TRIP || hasClosedLinkedOccurrence) {
      departedToday = (await tx.trip.count({
        where: {
          vehicleId: plan.vehicleId,
          departedAt: { gte: serviceDay.start, lt: serviceDay.end },
        },
      })) > 0;
    }
    if (departedToday) continue;

    if (vehicleStatus === VehicleStatus.ON_TRIP) {
      // ON_TRIP belongs to the completed prior occurrence. A new Manila
      // service day is a separate Taya queue occurrence and must not remain
      // blocked when no departure was recorded for this day.
      vehicleStatus = plan.vehicle.insideTerminalZone ? VehicleStatus.AT_TERMINAL : VehicleStatus.OUTSIDE_ZONE;
      await tx.vehicle.update({
        where: { id: plan.vehicleId },
        data: {
          status: vehicleStatus,
          departureAuthorizedAt: null,
          departureAuthorizedTripId: null,
          departureReviewRequired: false,
          departureReviewReason: null,
          terminalExitSampleCount: 0,
        },
      });
    }
    if (unavailableVehicleStatuses.includes(vehicleStatus)) continue;
    if (hasClosedLinkedOccurrence) {
      // A daily plan can survive while its prior operational rows remain as
      // audit history. Detach those closed links before building today's row.
      await tx.tayaDailySchedule.update({
        where: { id: plan.id },
        data: { queueEntryId: null, tripId: null },
      });
      queueEntryId = null;
      tripId = null;
    }

    if (!queueEntryId) {
      const queue = await tx.queueEntry.create({
        data: {
          vehicleId: plan.vehicleId,
          route: RouteCode.LEGAZPI,
          position: null,
          arrivalTimestamp: now,
          status: QueueStatus.WAITING,
        },
      });
      queueEntryId = queue.id;
    }

    // Reconcile drivers already confirmed at the terminal before their daily
    // assignment was materialized, including queues created before this change.
    const knownArrival = plan.queueEntry?.tayaArrivalAt ?? plan.vehicle.latestArrivalAt;
    if (plan.vehicle.insideTerminalZone
      && (queueEntryId !== plan.queueEntryId || !plan.queueEntry?.tayaArrivalAt || plan.queueEntry.position === null)
      && knownArrival && knownArrival >= serviceDay.start && knownArrival < serviceDay.end) {
      const confirmation = await tx.dispatchLog.findFirst({
        where: {
          route: RouteCode.LEGAZPI,
          action: DispatchAction.TERMINAL_ARRIVAL_CONFIRMED,
          targetId: plan.vehicleId,
          timestamp: { gte: serviceDay.start, lt: serviceDay.end },
        },
        orderBy: { timestamp: 'desc' },
      });
      // Older GPS code copied the materialization time into latestArrivalAt;
      // the terminal confirmation log is the actual arrival evidence instead.
      const metadata = confirmation?.metadata as { observedAt?: string } | null;
      const confirmedAt = metadata?.observedAt ? new Date(metadata.observedAt) : confirmation?.timestamp ?? knownArrival;
      arrivalsToSequence.push({ queueEntryId, arrivedAt: plan.queueEntry?.tayaArrivalAt ?? confirmedAt });
    } else if (!plan.vehicle.insideTerminalZone || !knownArrival || knownArrival < serviceDay.start || knownArrival >= serviceDay.end) {
      await tx.queueEntry.update({ where: { id: queueEntryId }, data: { position: null, tayaArrivalAt: null } });
    }

    if (!tripId) {
      const existingTrip = await tx.trip.findFirst({
        where: {
          vehicleId: plan.vehicleId,
          route: RouteCode.LEGAZPI,
          status: { in: activeTripStatuses },
          departedAt: null,
          scheduledOrTriggeredTime: { gte: serviceDay.start, lt: serviceDay.end },
        },
        orderBy: { scheduledOrTriggeredTime: 'asc' },
      });
      if (existingTrip) {
        tripId = existingTrip.id;
      } else {
        const trip = await tx.trip.create({
          data: {
            vehicleId: plan.vehicleId,
            route: RouteCode.LEGAZPI,
            // Taya has no published departure time. This timestamp identifies
            // the operational occurrence internally and is never shown as a schedule.
            scheduledOrTriggeredTime: now,
            boardingStartTime: now,
            status: TripStatus.ASSIGNED,
            fareAmount: DEFAULT_LEGAZPI_FARE,
            createdByDispatcherId: plan.dispatcherId,
          },
        });
        tripId = trip.id;
      }
    }

    const liveAssignment = await tx.tripAssignment.findFirst({
      where: { tripId, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
      orderBy: { assignedAt: 'desc' },
    });
    if (!liveAssignment) {
      await tx.tripAssignment.create({
        data: {
          tripId,
          queueEntryId,
          driverId: plan.vehicle.assignedDriverId,
          status: AssignmentStatus.ACCEPTED,
          assignedAt: now,
          respondedAt: now,
          responseDeadline: now,
        },
      });
      await tx.trip.update({ where: { id: tripId }, data: { status: TripStatus.ASSIGNED } });
      await tx.queueEntry.update({ where: { id: queueEntryId }, data: { status: QueueStatus.ACCEPTED } });
      await tx.notification.create({
        data: {
          userId: plan.vehicle.assignedDriverId,
          type: NotificationType.ASSIGNMENT,
          message: "You are assigned to today's Legazpi Taya trips. Your queue position follows your confirmed terminal arrival. Cancel the assignment if you cannot make the trip.",
        },
      });
      await tx.dispatchLog.create({
        data: {
          actorUserId: plan.dispatcherId,
          action: DispatchAction.ASSIGNMENT_CREATED,
          targetId: tripId,
          route: RouteCode.LEGAZPI,
          metadata: { queueEntryId, automated: true, trigger: 'taya_daily_schedule', serviceDate: todayKey(now), plannedPosition: plan.position },
        },
      });
    } else if (liveAssignment.queueEntryId !== queueEntryId) {
      await tx.tripAssignment.update({ where: { id: liveAssignment.id }, data: { queueEntryId } });
    }

    await tx.tayaDailySchedule.update({ where: { id: plan.id }, data: { queueEntryId, tripId } });
    materialized += 1;
  }
  arrivalsToSequence.sort((left, right) => left.arrivedAt.getTime() - right.arrivedAt.getTime()
    || left.queueEntryId.localeCompare(right.queueEntryId));
  for (const arrival of arrivalsToSequence) {
    await sequenceTayaArrivalInTransaction(tx, arrival.queueEntryId, arrival.arrivedAt, now);
  }
  // Compact today's saved positions after cancellations or completed trips.
  // Never sort these rows by the daily/weekly assignment positions.
  await normalizeSavedQueue(tx, RouteCode.LEGAZPI, now);
  return { planned: plans.length, materialized };
}

export async function syncTayaDailyQueue(now = new Date()) {
  return withRouteQueue(RouteCode.LEGAZPI, (tx) => syncTayaDailyQueueInTransaction(tx, now));
}

async function replaceDailyPlanInTransaction(
  tx: Prisma.TransactionClient,
  dispatcherId: string,
  serviceDate: Date,
  vehicleIds: string[],
  now: Date,
) {
  const current = await tx.tayaDailySchedule.findMany({ where: { serviceDate }, include: { queueEntry: true, trip: true } });
  const retainedIds = new Set(vehicleIds);
  for (const entry of current.filter((candidate) => !retainedIds.has(candidate.vehicleId))) {
    if (entry.queueEntry && operationalQueueStatuses.some((status) => status === entry.queueEntry!.status)) {
      await tx.tripAssignment.updateMany({
        where: { queueEntryId: entry.queueEntry.id, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
        data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
      });
      await tx.queueEntry.update({ where: { id: entry.queueEntry.id }, data: { status: QueueStatus.REPLACED } });
    }
    if (entry.trip && activeTripStatuses.includes(entry.trip.status)) {
      await tx.trip.update({ where: { id: entry.trip.id }, data: { status: TripStatus.UNABLE_TO_DEPART } });
    }
    await tx.tayaDailySchedule.delete({ where: { id: entry.id } });
  }

  // Move retained rows outside the final position range before reordering so
  // the unique position constraint cannot collide while positions are swapped.
  await tx.tayaDailySchedule.updateMany({ where: { serviceDate }, data: { position: { increment: 1_000 } } });
  for (const [index, vehicleId] of vehicleIds.entries()) {
    const existing = current.find((entry) => entry.vehicleId === vehicleId);
    if (existing && retainedIds.has(existing.vehicleId)) {
      await tx.tayaDailySchedule.update({ where: { id: existing.id }, data: { dispatcherId, position: index + 1 } });
    } else {
      await tx.tayaDailySchedule.create({ data: { dispatcherId, vehicleId, serviceDate, position: index + 1 } });
    }
  }
}

export async function getTayaWeeklySchedule(dispatcherId: string, route: RouteCode) {
  if (route !== RouteCode.LEGAZPI) throw new AppError(403, 'TAYA_SCHEDULE_ONLY', 'Weekly queue schedules are available only to the Legazpi dispatcher.');
  await syncTayaDailyQueue();
  const [entries, vehicles] = await Promise.all([
    prisma.tayaWeeklySchedule.findMany({
      orderBy: [{ weekday: 'asc' }, { position: 'asc' }],
      include: { vehicle: { include: { assignedDriver: { select: { id: true, name: true } } } } },
    }),
    prisma.vehicle.findMany({
      where: { route: RouteCode.LEGAZPI, assignedDriverId: { not: null }, assignedDriver: { isActive: true } },
      orderBy: { vanId: 'asc' },
      include: { assignedDriver: { select: { id: true, name: true } } },
    }),
  ]);
  return {
    route: 'Legazpi' as const,
    routeCode: 'legazpi' as const,
    currentWeekday: isoWeekday(todayKey()),
    entries: entries.map((entry) => ({
      id: entry.id,
      weekday: entry.weekday,
      weekdayLabel: weekdayLabels[entry.weekday - 1] ?? 'Unknown',
      position: entry.position,
      vehicle: {
        id: entry.vehicle.id,
        vanId: entry.vehicle.vanId,
        capacity: entry.vehicle.capacity,
        driverId: entry.vehicle.assignedDriverId,
        driver: entry.vehicle.assignedDriver?.name ?? 'Unassigned',
      },
    })),
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      vanId: vehicle.vanId,
      capacity: vehicle.capacity,
      driverId: vehicle.assignedDriverId,
      driver: vehicle.assignedDriver?.name ?? 'Unassigned',
    })),
  };
}

export async function saveTayaWeeklySchedule(dispatcherId: string, route: RouteCode, input: TayaWeeklyScheduleInput, now = new Date()) {
  if (route !== RouteCode.LEGAZPI) throw new AppError(403, 'TAYA_SCHEDULE_ONLY', 'Weekly queue schedules are available only to the Legazpi dispatcher.');
  const vehicleIds = [...new Set(input.vehicleIds)];
  if (vehicleIds.length !== input.vehicleIds.length) throw new AppError(422, 'DUPLICATE_TAYA_DRIVER', 'Each driver can appear only once in a weekday Taya queue.');

  await withRouteQueue(RouteCode.LEGAZPI, async (tx) => {
    const vehicles = vehicleIds.length ? await tx.vehicle.findMany({
      where: { id: { in: vehicleIds }, route: RouteCode.LEGAZPI, assignedDriverId: { not: null }, assignedDriver: { isActive: true } },
      select: { id: true },
    }) : [];
    if (vehicles.length !== vehicleIds.length) throw new AppError(422, 'TAYA_DRIVER_UNAVAILABLE', 'Choose only active Legazpi drivers and vans.');

    const current = await tx.tayaWeeklySchedule.findMany({ where: { weekday: input.weekday } });
    const retainedIds = new Set(vehicleIds);
    await tx.tayaWeeklySchedule.deleteMany({
      where: vehicleIds.length
        ? { weekday: input.weekday, vehicleId: { notIn: vehicleIds } }
        : { weekday: input.weekday },
    });
    await tx.tayaWeeklySchedule.updateMany({
      where: { weekday: input.weekday },
      data: { position: { increment: 1_000 } },
    });
    for (const [index, vehicleId] of vehicleIds.entries()) {
      const existing = current.find((entry) => entry.vehicleId === vehicleId);
      if (existing && retainedIds.has(existing.vehicleId)) {
        await tx.tayaWeeklySchedule.update({ where: { id: existing.id }, data: { dispatcherId, position: index + 1 } });
      } else {
        await tx.tayaWeeklySchedule.create({ data: { dispatcherId, vehicleId, weekday: input.weekday, position: index + 1 } });
      }
    }

    const serviceDateKey = todayKey(now);
    if (input.weekday === isoWeekday(serviceDateKey)) {
      await replaceDailyPlanInTransaction(tx, dispatcherId, serviceDateValue(serviceDateKey), vehicleIds, now);
      await syncTayaDailyQueueInTransaction(tx, now);
    }
    await tx.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_UPDATED,
        targetId: `taya-weekday-${input.weekday}`,
        route: RouteCode.LEGAZPI,
        reason: 'Taya weekly queue sequence saved.',
        metadata: { weekday: input.weekday, weekdayLabel: weekdayLabels[input.weekday - 1], vehicleIds },
      },
    });
  });
  return getTayaWeeklySchedule(dispatcherId, route);
}
