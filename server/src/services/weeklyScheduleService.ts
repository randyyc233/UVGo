import {
  AssignmentStatus,
  DispatchAction,
  NotificationType,
  Prisma,
  QueueStatus,
  RouteCode,
  TripStatus,
} from '@prisma/client';
import {
  WEEKLY_ASSIGNMENT_LOOKAHEAD_MS,
  WEEKLY_SCHEDULE_HORIZON_WEEKS,
} from '../config/dispatch.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { assignScheduledVehicleDriver } from './automationService.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { admitAcceptedGosoSchedulesForDay, normalizeSavedQueue, withRouteQueue } from './queueSchedulingService.js';

export interface WeeklyScheduleInput {
  weekday: number;
  boardingTime: string;
  departureTime: string;
  vehicleId: string;
  fareAmount: number;
  isActive: boolean;
}

const DAY_MS = 24 * 60 * 60_000;
const weekdayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const replaceableOccurrenceStatuses: TripStatus[] = [
  TripStatus.SCHEDULED,
  TripStatus.ASSIGNING,
  TripStatus.ASSIGNED,
  TripStatus.BOARDING,
  TripStatus.READY,
  TripStatus.DELAYED,
];

function minuteOfDay(value: string) {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeOfDay(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function timeLabel(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function weekdayOf(dayStart: Date) {
  const jsDay = new Date(dayStart.getTime() + 8 * 60 * 60_000).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function occurrenceDates(weekday: number, now: Date) {
  const firstDay = manilaServiceDay(now).start;
  const lastDay = new Date(firstDay.getTime() + WEEKLY_SCHEDULE_HORIZON_WEEKS * 7 * DAY_MS);
  const dates: Date[] = [];
  for (let day = firstDay; day <= lastDay; day = new Date(day.getTime() + DAY_MS)) {
    if (weekdayOf(day) === weekday) dates.push(day);
  }
  return dates;
}

async function ownedVehicle(
  tx: Prisma.TransactionClient,
  dispatcherId: string,
  vehicleId: string,
) {
  const vehicle = await tx.vehicle.findFirst({
    where: {
      id: vehicleId,
      route: RouteCode.GOA,
      managedByDispatcherId: dispatcherId,
      assignedDriverId: { not: null },
      assignedDriver: { isActive: true },
    },
    include: { assignedDriver: { select: { id: true, name: true } } },
  });
  if (!vehicle?.assignedDriverId || !vehicle.assignedDriver) {
    throw new AppError(422, 'SCHEDULE_DRIVER_UNAVAILABLE', 'Choose an active Goa van with an assigned driver.');
  }
  return vehicle;
}

async function assertTemplateDoesNotConflict(
  tx: Prisma.TransactionClient,
  dispatcherId: string,
  input: WeeklyScheduleInput,
  excludeTemplateId?: string,
) {
  if (!input.isActive) return;
  const templates = await tx.weeklySchedule.findMany({
    where: {
      dispatcherId,
      weekday: input.weekday,
      isActive: true,
      ...(excludeTemplateId ? { id: { not: excludeTemplateId } } : {}),
    },
    select: { departureMinute: true },
  });
  const departureMinute = minuteOfDay(input.departureTime);
  if (templates.some((template) => template.departureMinute === departureMinute)) {
    throw new AppError(
      409,
      'WEEKLY_DEPARTURE_TIME_CONFLICT',
      `Another active Goa weekly departure already uses ${timeLabel(departureMinute)} on ${weekdayLabels[input.weekday - 1]}.`,
    );
  }
}

async function materializeTemplate(
  tx: Prisma.TransactionClient,
  templateId: string,
  now: Date,
) {
  const template = await tx.weeklySchedule.findUnique({
    where: { id: templateId },
    include: {
      vehicle: {
        include: { assignedDriver: { select: { id: true, isActive: true } } },
      },
    },
  });
  if (!template?.isActive) return 0;
  if (
    template.vehicle.route !== RouteCode.GOA
    || template.vehicle.managedByDispatcherId !== template.dispatcherId
    || !template.vehicle.assignedDriverId
    || !template.vehicle.assignedDriver?.isActive
  ) {
    throw new AppError(409, 'WEEKLY_SCHEDULE_VEHICLE_UNAVAILABLE', 'The weekly schedule needs an active managed Goa driver and van.');
  }

  let generated = 0;
  const currentServiceDayStart = manilaServiceDay(now).start;
  for (const occurrenceDate of occurrenceDates(template.weekday, now)) {
    const boardingStartTime = new Date(occurrenceDate.getTime() + template.boardingMinute * 60_000);
    const scheduledOrTriggeredTime = new Date(occurrenceDate.getTime() + template.departureMinute * 60_000);
    // Materialize the current service-day occurrence even when its loading
    // time has already passed. The GOSO queue policy needs that row in order
    // to evaluate the driver's geofence attendance and move an absent/late
    // driver to the end of the active queue. Historical one-off trips are
    // still excluded by admitAcceptedGosoSchedulesForDay; this only applies
    // to an active recurring schedule's current occurrence.

    const existing = await tx.trip.findUnique({
      where: {
        weeklyScheduleId_weeklyOccurrenceDate: {
          weeklyScheduleId: template.id,
          weeklyOccurrenceDate: occurrenceDate,
        },
      },
      include: {
        _count: { select: { reservations: true } },
        assignments: {
          where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
          select: { queueEntryId: true },
        },
      },
    });
    if (existing) {
      const matchesTemplate = existing.vehicleId === template.vehicleId
        && existing.boardingStartTime?.getTime() === boardingStartTime.getTime()
        && existing.scheduledOrTriggeredTime.getTime() === scheduledOrTriggeredTime.getTime()
        && Number(existing.fareAmount) === Number(template.fareAmount);
      // GOSO late rotation intentionally changes the vehicle assigned to the
      // current occurrence and moves its queue slot. Do not regenerate that
      // occurrence on the next ten-second scheduler tick, or the fresh trip
      // would clear lateAt and put the missed driver back at the front.
      const isCurrentPolicyManagedOccurrence = occurrenceDate.getTime() === currentServiceDayStart.getTime()
        && existing.boardingStartTime?.getTime() === boardingStartTime.getTime()
        && existing.scheduledOrTriggeredTime.getTime() === scheduledOrTriggeredTime.getTime()
        && Number(existing.fareAmount) === Number(template.fareAmount)
        && existing.assignments.some((assignment) => assignment.queueEntryId !== null);
      if (matchesTemplate || isCurrentPolicyManagedOccurrence) continue;

      const canRegenerate = existing._count.reservations === 0
        && !existing.departedAt
        && replaceableOccurrenceStatuses.includes(existing.status);

      // Keep an already-departed trip as immutable history, but release the
      // recurring occurrence key when today's rule was moved to a later time.
      // This lets the edited rule create the van's genuinely new trip for the
      // same service day instead of being blocked by the morning departure.
      if (!canRegenerate && existing.departedAt) {
        await tx.trip.update({
          where: { id: existing.id },
          data: { weeklyScheduleId: null, weeklyOccurrenceDate: null },
        });
      } else if (!canRegenerate) {
        continue;
      }

      if (canRegenerate) {
        const linkedQueueEntryIds = [...new Set(
          existing.assignments.flatMap((assignment) => assignment.queueEntryId ? [assignment.queueEntryId] : []),
        )];
        if (linkedQueueEntryIds.length) {
          await tx.queueEntry.updateMany({
            where: { id: { in: linkedQueueEntryIds }, status: { in: [QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH, QueueStatus.DELAYED] } },
            data: { status: QueueStatus.REPLACED },
          });
        }
        await tx.trip.delete({ where: { id: existing.id } });
      }
    }

    const sameTime = await tx.trip.findFirst({
      where: { route: RouteCode.GOA, scheduledOrTriggeredTime },
      select: { id: true },
    });
    if (sameTime) {
      throw new AppError(409, 'SCHEDULE_CONFLICT', `A Goa departure already exists at ${timeLabel(template.departureMinute)} on this occurrence date.`);
    }
    const trip = await tx.trip.create({
      data: {
        vehicleId: template.vehicleId,
        route: RouteCode.GOA,
        scheduledOrTriggeredTime,
        boardingStartTime,
        status: TripStatus.SCHEDULED,
        fareAmount: template.fareAmount,
        createdByDispatcherId: template.dispatcherId,
        weeklyScheduleId: template.id,
        weeklyOccurrenceDate: occurrenceDate,
      },
    });
    if (scheduledOrTriggeredTime.getTime() <= now.getTime() + WEEKLY_ASSIGNMENT_LOOKAHEAD_MS) {
      await assignScheduledVehicleDriver(
        tx,
        template.dispatcherId,
        trip.id,
        template.vehicleId,
        template.vehicle.assignedDriverId,
        RouteCode.GOA,
        now,
        {
          automated: true,
          trigger: 'weekly_schedule_materialized',
          weeklyScheduleId: template.id,
          occurrenceDate: occurrenceDate.toISOString(),
        },
      );
    }
    generated += 1;
  }
  return generated;
}

export async function materializeWeeklySchedules(now = new Date(), dispatcherId?: string) {
  const templates = await prisma.weeklySchedule.findMany({
    where: { isActive: true, ...(dispatcherId ? { dispatcherId } : {}) },
    orderBy: [{ dispatcherId: 'asc' }, { weekday: 'asc' }, { departureMinute: 'asc' }],
    select: { id: true },
  });
  let generated = 0;
  let conflicts = 0;
  for (const template of templates) {
    try {
      generated += await withRouteQueue(RouteCode.GOA, (tx) => materializeTemplate(tx, template.id, now));
    } catch (error) {
      if (
        error instanceof AppError &&
        ['SCHEDULE_CONFLICT', 'WEEKLY_SCHEDULE_VEHICLE_UNAVAILABLE'].includes(error.code)
      ) {
        conflicts += 1;
        continue;
      }
      throw error;
    }
  }
  return { generated, conflicts };
}

export async function listWeeklySchedules(dispatcherId: string) {
  const now = new Date();
  const templates = await prisma.weeklySchedule.findMany({
    where: {
      dispatcherId,
      vehicle: {
        managedByDispatcherId: dispatcherId,
        assignedDriver: { isActive: true },
      },
    },
    orderBy: [{ weekday: 'asc' }, { departureMinute: 'asc' }],
    include: {
      vehicle: { include: { assignedDriver: { select: { name: true } } } },
      trips: {
        where: { scheduledOrTriggeredTime: { gt: now } },
        orderBy: { scheduledOrTriggeredTime: 'asc' },
        select: { scheduledOrTriggeredTime: true },
      },
    },
  });
  return templates.map((template) => ({
    id: template.id,
    weekday: template.weekday,
    weekdayLabel: weekdayLabels[template.weekday - 1],
    boardingTime: timeOfDay(template.boardingMinute),
    departureTime: timeOfDay(template.departureMinute),
    fareAmount: Number(template.fareAmount),
    isActive: template.isActive,
    generatedCount: template.trips.length,
    nextDeparture: template.trips[0]?.scheduledOrTriggeredTime.toISOString() ?? null,
    vehicle: {
      id: template.vehicle.id,
      vanId: template.vehicle.vanId,
      capacity: template.vehicle.capacity,
      driverId: template.vehicle.assignedDriverId,
      driver: template.vehicle.assignedDriver?.name ?? 'Unassigned',
    },
  }));
}

export async function createWeeklySchedule(
  dispatcherId: string,
  route: RouteCode,
  input: WeeklyScheduleInput,
  now = new Date(),
) {
  if (route !== RouteCode.GOA) throw new AppError(403, 'GOSO_SCHEDULE_ONLY', 'Weekly schedules are available only to the Goa dispatcher.');
  const templateId = await withRouteQueue(RouteCode.GOA, async (tx) => {
    await ownedVehicle(tx, dispatcherId, input.vehicleId);
    await assertTemplateDoesNotConflict(tx, dispatcherId, input);
    const template = await tx.weeklySchedule.create({
      data: {
        dispatcherId,
        vehicleId: input.vehicleId,
        weekday: input.weekday,
        boardingMinute: minuteOfDay(input.boardingTime),
        departureMinute: minuteOfDay(input.departureTime),
        fareAmount: input.fareAmount,
        isActive: input.isActive,
      },
    });
    if (template.isActive) await materializeTemplate(tx, template.id, now);
    await tx.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_CREATED,
        targetId: template.id,
        route: RouteCode.GOA,
        reason: 'Recurring weekly schedule created.',
        metadata: { recurring: true, weekday: input.weekday, boardingTime: input.boardingTime, departureTime: input.departureTime, vehicleId: input.vehicleId },
      },
    });
    return template.id;
  });
  await admitAcceptedGosoSchedulesForDay(now);
  return templateId;
}

export async function updateWeeklySchedule(
  dispatcherId: string,
  route: RouteCode,
  templateId: string,
  input: WeeklyScheduleInput,
  now = new Date(),
) {
  if (route !== RouteCode.GOA) throw new AppError(403, 'GOSO_SCHEDULE_ONLY', 'Weekly schedules are available only to the Goa dispatcher.');
  const updatedTemplateId = await withRouteQueue(RouteCode.GOA, async (tx) => {
    const current = await tx.weeklySchedule.findFirst({
      where: { id: templateId, dispatcherId },
      include: {
        trips: {
          where: { scheduledOrTriggeredTime: { gt: now } },
          include: {
            _count: { select: { reservations: true } },
            assignments: {
              where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
              select: { queueEntryId: true },
            },
          },
        },
      },
    });
    if (!current) throw new AppError(404, 'WEEKLY_SCHEDULE_NOT_FOUND', 'This weekly schedule was not found.');
    await ownedVehicle(tx, dispatcherId, input.vehicleId);
    await assertTemplateDoesNotConflict(tx, dispatcherId, input, current.id);

    const removableTrips = current.trips.filter((trip) => trip._count.reservations === 0);
    const removableIds = removableTrips.map((trip) => trip.id);
    const linkedQueueEntryIds = [...new Set(removableTrips.flatMap((trip) => trip.assignments.flatMap((assignment) => assignment.queueEntryId ? [assignment.queueEntryId] : [])))];
    if (linkedQueueEntryIds.length) {
      await tx.queueEntry.updateMany({
        where: { id: { in: linkedQueueEntryIds }, status: { in: [QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH] } },
        data: {
          status: current.vehicleId === input.vehicleId ? QueueStatus.ASSIGNED : QueueStatus.WAITING,
          scheduledLoadingTime: null,
          lateAt: null,
        },
      });
      await normalizeSavedQueue(tx, RouteCode.GOA);
    }
    if (removableIds.length) await tx.trip.deleteMany({ where: { id: { in: removableIds } } });
    await tx.weeklySchedule.update({
      where: { id: current.id },
      data: {
        vehicleId: input.vehicleId,
        weekday: input.weekday,
        boardingMinute: minuteOfDay(input.boardingTime),
        departureMinute: minuteOfDay(input.departureTime),
        fareAmount: input.fareAmount,
        isActive: input.isActive,
      },
    });
    if (input.isActive) await materializeTemplate(tx, current.id, now);
    await tx.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_UPDATED,
        targetId: current.id,
        route: RouteCode.GOA,
        reason: input.isActive ? 'Recurring weekly schedule updated.' : 'Recurring weekly schedule paused.',
        metadata: { recurring: true, weekday: input.weekday, boardingTime: input.boardingTime, departureTime: input.departureTime, vehicleId: input.vehicleId, active: input.isActive },
      },
    });
    return current.id;
  });
  await admitAcceptedGosoSchedulesForDay(now);
  return updatedTemplateId;
}

export async function deleteWeeklySchedule(
  dispatcherId: string,
  route: RouteCode,
  templateId: string,
  now = new Date(),
) {
  if (route !== RouteCode.GOA) throw new AppError(403, 'GOSO_SCHEDULE_ONLY', 'Weekly schedules are available only to the Goa dispatcher.');
  return withRouteQueue(RouteCode.GOA, async (tx) => {
    const template = await tx.weeklySchedule.findFirst({
      where: { id: templateId, dispatcherId },
      include: {
        vehicle: { select: { vanId: true } },
        trips: {
          where: { scheduledOrTriggeredTime: { gt: now } },
          include: {
            _count: { select: { reservations: true } },
            assignments: {
              where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
              select: { driverId: true, queueEntryId: true },
            },
          },
        },
      },
    });
    if (!template) throw new AppError(404, 'WEEKLY_SCHEDULE_NOT_FOUND', 'This weekly schedule was not found.');
    const removable = template.trips.filter((trip) => trip._count.reservations === 0);
    const preserved = template.trips.filter((trip) => trip._count.reservations > 0);
    const activeAssignments = template.trips.flatMap((trip) => trip.assignments);
    const linkedQueueEntryIds = [...new Set(activeAssignments.flatMap((assignment) => assignment.queueEntryId ? [assignment.queueEntryId] : []))];

    // Removing a recurring rule releases its driver for that Manila service
    // day. Unbooked occurrences disappear entirely. Booked occurrences must
    // remain for their passenger records, but their old driver assignment is
    // cancelled and the departure is explicitly returned to the assignment
    // pool instead of silently reserving that driver for the day.
    if (preserved.length) {
      const preservedIds = preserved.map((trip) => trip.id);
      await tx.tripAssignment.updateMany({
        where: {
          tripId: { in: preservedIds },
          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
        },
        data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
      });
      await tx.trip.updateMany({
        where: { id: { in: preservedIds } },
        data: { status: TripStatus.ASSIGNING, awaitingQueueReplacement: true },
      });
    }
    if (linkedQueueEntryIds.length) {
      await tx.queueEntry.updateMany({
        where: {
          id: { in: linkedQueueEntryIds },
          status: { in: [QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH] },
        },
        data: { status: QueueStatus.WAITING, scheduledLoadingTime: null, lateAt: null },
      });
      await normalizeSavedQueue(tx, RouteCode.GOA);
    }
    if (removable.length) await tx.trip.deleteMany({ where: { id: { in: removable.map((trip) => trip.id) } } });
    await tx.weeklySchedule.delete({ where: { id: template.id } });
    const drivers = [...new Set(activeAssignments.map((assignment) => assignment.driverId))];
    if (drivers.length) {
      await tx.notification.createMany({
        data: drivers.map((driverId) => ({
          userId: driverId,
          type: NotificationType.ASSIGNMENT,
          message: `The recurring ${template.vehicle.vanId} weekly schedule was removed. Its future assignments were cancelled, so you are available for another schedule on those days.`,
        })),
      });
    }
    await tx.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_DELETED,
        targetId: template.id,
        route: RouteCode.GOA,
        reason: 'Recurring weekly schedule removed.',
        metadata: {
          recurring: true,
          weekday: template.weekday,
          vehicleId: template.vehicleId,
          preservedBookedDepartures: preserved.length,
          releasedDriverIds: drivers,
        },
      },
    });
    return template.id;
  });
}
