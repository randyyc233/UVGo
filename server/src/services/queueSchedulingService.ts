import { AssignmentStatus, DispatchAction, NotificationType, Prisma, QueueStatus, ReservationStatus, RouteCode, TripStatus, VehicleStatus } from '@prisma/client';
import { boardingStartFor } from '../config/dispatch.js';
import { TERMINAL_GEOFENCE } from '../config/terminal.js';
import { passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';

export const operationalQueueStatuses = [QueueStatus.WAITING, QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH, QueueStatus.DELAYED];
export const queueOrder: Prisma.QueueEntryOrderByWithRelationInput[] = [{ position: 'asc' }, { arrivalTimestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];
const openTrips = [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY];
const liveAssignments = [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED];
const heldReservations = [ReservationStatus.CONFIRMED, ReservationStatus.RESCHEDULED, ReservationStatus.REALLOCATED, ReservationStatus.PENDING_PAYMENT, ReservationStatus.PENDING_VERIFICATION];

// The same route lock is used by attendance, queue edits and departure completion.
// Serializable retries also protect bookings changed while seats are being reassigned.
export async function withRouteQueue<T>(route: RouteCode, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM User WHERE dispatcherRoute = ${route} ORDER BY id FOR UPDATE`;
        return work(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
}

export async function normalizeSavedQueue(tx: Prisma.TransactionClient, route: RouteCode) {
  const rows = await tx.queueEntry.findMany({
    where: {
      route,
      status: { in: operationalQueueStatuses },
      vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
    },
    orderBy: queueOrder,
  });
  if (route === RouteCode.GOA) {
    const serviceDays = new Map<string, typeof rows>();
    for (const row of rows) {
      const serviceDay = row.scheduledLoadingTime ? manilaServiceDay(row.scheduledLoadingTime).date : 'unscheduled';
      const group = serviceDays.get(serviceDay) ?? [];
      group.push(row);
      serviceDays.set(serviceDay, group);
    }
    for (const serviceRows of serviceDays.values()) {
      serviceRows.sort((left, right) => {
        const leftLate = Boolean(left.lateAt);
        const rightLate = Boolean(right.lateAt);
        if (leftLate !== rightLate) return leftLate ? 1 : -1;
        if (leftLate && rightLate) {
          const lateDifference = left.lateAt!.getTime() - right.lateAt!.getTime();
          if (lateDifference) return lateDifference;
        }
        if (!leftLate) {
          const leftLoading = left.scheduledLoadingTime?.getTime();
          const rightLoading = right.scheduledLoadingTime?.getTime();
          if (leftLoading !== undefined && rightLoading !== undefined && leftLoading !== rightLoading) return leftLoading - rightLoading;
          if (leftLoading !== undefined && rightLoading === undefined) return -1;
          if (leftLoading === undefined && rightLoading !== undefined) return 1;
        }
        return left.position - right.position
          || left.arrivalTimestamp.getTime() - right.arrivalTimestamp.getTime()
          || left.createdAt.getTime() - right.createdAt.getTime()
          || left.id.localeCompare(right.id);
      });
      for (const [index, row] of serviceRows.entries()) {
        if (row.position !== index + 1) await tx.queueEntry.update({ where: { id: row.id }, data: { position: index + 1 } });
      }
    }
    return;
  }
  for (const [index, row] of rows.entries()) {
    if (row.position !== index + 1) await tx.queueEntry.update({ where: { id: row.id }, data: { position: index + 1 } });
  }
}

/**
 * Queue positions own the visible loading slots. When a dispatcher or the
 * late-driver policy changes the order, keep the same set of service-day
 * loading times but move the earliest time to position 1, the next time to
 * position 2, and so on. Passenger departure records remain unchanged.
 */
async function alignGosoLoadingTimesWithPositions(tx: Prisma.TransactionClient, serviceTime: Date) {
  const day = manilaServiceDay(serviceTime);
  const rows = await tx.queueEntry.findMany({
    where: {
      route: RouteCode.GOA,
      status: { in: operationalQueueStatuses },
      scheduledLoadingTime: { gte: day.start, lt: day.end },
      vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
    },
    orderBy: queueOrder,
  });
  const loadingTimes = rows
    .flatMap((row) => row.scheduledLoadingTime ? [row.scheduledLoadingTime] : [])
    .sort((left, right) => left.getTime() - right.getTime());
  for (const [index, row] of rows.entries()) {
    const scheduledLoadingTime = loadingTimes[index];
    if (scheduledLoadingTime && row.scheduledLoadingTime?.getTime() !== scheduledLoadingTime.getTime()) {
      await tx.queueEntry.update({ where: { id: row.id }, data: { scheduledLoadingTime } });
    }
  }
}

/**
 * Promote accepted Goa schedules into the visible queue when their Manila
 * service day begins. A driver may accept several days early, so acceptance
 * alone cannot create a future-day queue row; this reconciliation closes the
 * gap without requiring the driver to accept a second time.
 */
export async function admitAcceptedGosoSchedulesForDay(now = new Date()) {
  const day = manilaServiceDay(now);
  return withRouteQueue(RouteCode.GOA, async (tx) => {
    // A completed dispatch can be followed by another accepted schedule for
    // the same van. Retire any stale operational row while the van is on its
    // trip; the later schedule is admitted as a fresh queue occurrence only
    // after the van becomes available again.
    await tx.queueEntry.updateMany({
      where: {
        route: RouteCode.GOA,
        status: { in: operationalQueueStatuses },
        vehicle: { status: VehicleStatus.ON_TRIP },
      },
      data: { status: QueueStatus.REPLACED },
    });
    // A van may have completed an earlier trip today and still be marked
    // ON_TRIP when a later Goso occurrence becomes due. The later occurrence
    // is a new scheduled queue slot whether it came from a one-time schedule
    // or a recurring rule, so release only vans whose next loading time is
    // after their latest recorded departure.
    const scheduledOnTripVehicles = await tx.vehicle.findMany({
      where: { route: RouteCode.GOA, status: VehicleStatus.ON_TRIP },
      include: {
        trips: {
          where: {
            departedAt: null,
            status: { in: openTrips },
            scheduledOrTriggeredTime: { gte: day.start, lt: day.end },
            assignments: { some: { status: AssignmentStatus.ACCEPTED } },
          },
          orderBy: { scheduledOrTriggeredTime: 'asc' },
        },
      },
    });
    for (const vehicle of scheduledOnTripVehicles) {
      const latestDeparture = await tx.trip.aggregate({
        where: {
          vehicleId: vehicle.id,
          departedAt: { gte: day.start, lt: day.end },
        },
        _max: { departedAt: true },
      });
      const departedAt = latestDeparture._max.departedAt;
      if (!departedAt) continue;
      const hasLaterOccurrence = vehicle.trips.some((trip) => (
        boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).getTime() > departedAt.getTime()
      ));
      if (!hasLaterOccurrence) continue;
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          status: vehicle.insideTerminalZone ? VehicleStatus.AT_TERMINAL : VehicleStatus.OUTSIDE_ZONE,
          departureAuthorizedAt: null,
          departureAuthorizedTripId: null,
          departureReviewRequired: false,
          departureReviewReason: null,
          terminalExitSampleCount: 0,
        },
      });
    }
    // Future or past occurrences must never reserve today's physical queue row.
    // Their accepted assignment remains active, but the row is linked only when
    // that occurrence's Manila service day is current.
    await tx.tripAssignment.updateMany({
      where: {
        status: { in: liveAssignments },
        queueEntryId: { not: null },
        trip: {
          route: RouteCode.GOA,
          OR: [
            { scheduledOrTriggeredTime: { lt: day.start } },
            { scheduledOrTriggeredTime: { gte: day.end } },
          ],
        },
      },
      data: { queueEntryId: null },
    });
    // Current-day managed schedules are accepted automatically. This closes
    // the gap between weekly materialization and queue polling even if the
    // background dispatch tick has not run yet.
    const unassignedTrips = await tx.trip.findMany({
      where: {
        route: RouteCode.GOA,
        departedAt: null,
        status: { in: openTrips },
        scheduledOrTriggeredTime: { gte: day.start, lt: day.end },
        assignments: { none: {} },
        vehicle: {
          assignedDriverId: { not: null },
          assignedDriver: { isActive: true },
          status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] },
        },
      },
      include: { vehicle: { select: { assignedDriverId: true, managedByDispatcherId: true } } },
    });
    for (const trip of unassignedTrips) {
      if (!trip.vehicle.assignedDriverId) continue;
      const assignedAt = now;
      const responseDeadline = boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime);
      const assignment = await tx.tripAssignment.create({
        data: {
          tripId: trip.id,
          driverId: trip.vehicle.assignedDriverId,
          status: AssignmentStatus.ACCEPTED,
          assignedAt,
          respondedAt: assignedAt,
          responseDeadline,
        },
      });
      await tx.trip.update({ where: { id: trip.id }, data: { status: TripStatus.ASSIGNED } });
      await tx.notification.create({
        data: {
          userId: trip.vehicle.assignedDriverId,
          type: NotificationType.ASSIGNMENT,
          message: `You are assigned to today's Goa trip for ${departureLabel(trip.scheduledOrTriggeredTime)}. Cancel the assignment if you cannot make the trip.`,
        },
      });
      const actorUserId = trip.createdByDispatcherId ?? trip.vehicle.managedByDispatcherId;
      if (actorUserId) {
        await tx.dispatchLog.create({
          data: {
            actorUserId,
            action: DispatchAction.ASSIGNMENT_CREATED,
            targetId: trip.id,
            route: RouteCode.GOA,
            metadata: { assignmentId: assignment.id, automated: true, trigger: 'current_day_schedule_admission', autoAccepted: true },
          },
        });
      }
    }
    const assignments = await tx.tripAssignment.findMany({
      where: {
        status: AssignmentStatus.ACCEPTED,
        trip: {
          route: RouteCode.GOA,
          departedAt: null,
          status: { in: openTrips },
          scheduledOrTriggeredTime: { gte: day.start, lt: day.end },
          vehicle: {
            assignedDriverId: { not: null },
            assignedDriver: { isActive: true },
            status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] },
          },
        },
      },
      include: { trip: { include: { vehicle: true } }, queueEntry: true },
    });
    assignments.sort((left, right) =>
      boardingStartFor(left.trip.scheduledOrTriggeredTime, left.trip.boardingStartTime).getTime()
      - boardingStartFor(right.trip.scheduledOrTriggeredTime, right.trip.boardingStartTime).getTime()
      || left.id.localeCompare(right.id));

    let admitted = 0;
    const reconciledQueueIds = new Set<string>();
    for (const assignment of assignments) {
      // A vehicle/driver edit can leave an older accepted record behind. It
      // must never admit a different driver or van into today's queue.
      if (assignment.trip.vehicle.assignedDriverId !== assignment.driverId) continue;
      const scheduledLoadingTime = boardingStartFor(
        assignment.trip.scheduledOrTriggeredTime,
        assignment.trip.boardingStartTime,
      );
      const linkedQueue = assignment.queueEntry
        && assignment.queueEntry.vehicleId === assignment.trip.vehicleId
        && operationalQueueStatuses.some((status) => status === assignment.queueEntry!.status)
        ? assignment.queueEntry
        : null;
      // Schedule edits must immediately update the already-linked queue row.
      // Keep its operational state (including Late/Delayed), but restore the
      // authoritative loading time from its trip so normalization can place
      // the earliest loading schedule at position 1.
      if (linkedQueue) {
        // A van can carry more than one accepted occurrence on the same day.
        // Assignments are sorted by loading time, so reconcile a shared row
        // only once and let its earliest active occurrence own that row.
        if (reconciledQueueIds.has(linkedQueue.id)) continue;
        reconciledQueueIds.add(linkedQueue.id);
        if (linkedQueue.scheduledLoadingTime?.getTime() !== scheduledLoadingTime.getTime()) {
          await tx.queueEntry.update({
            where: { id: linkedQueue.id },
            // A late decision belongs to the previous loading deadline. An
            // edited deadline must be evaluated again at its new time.
            data: { scheduledLoadingTime, lateAt: null },
          });
        }
        continue;
      }
      let queue = null;
      if (!queue) {
        queue = await tx.queueEntry.findFirst({
          where: {
            vehicleId: assignment.trip.vehicleId,
            route: RouteCode.GOA,
            status: { in: operationalQueueStatuses },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
      if (queue) {
        const existingOccurrence = await tx.tripAssignment.findFirst({
          where: {
            queueEntryId: queue.id,
            tripId: { not: assignment.tripId },
            status: { in: liveAssignments },
            trip: { departedAt: null, status: { in: openTrips } },
          },
          select: { id: true },
        });
        // Each accepted current-day schedule is a distinct queue occurrence.
        // If this van already has a row owned by another active trip, create a
        // second row instead of hiding the newly created or rescheduled trip.
        if (existingOccurrence) queue = null;
      }
      if (!queue) {
        const last = await tx.queueEntry.aggregate({
          where: { route: RouteCode.GOA, status: { in: operationalQueueStatuses } },
          _max: { position: true },
        });
        queue = await tx.queueEntry.create({
          data: {
            vehicleId: assignment.trip.vehicleId,
            route: RouteCode.GOA,
            position: (last._max.position ?? 0) + 1,
            arrivalTimestamp: now,
            status: QueueStatus.ACCEPTED,
            scheduledLoadingTime,
            lateAt: null,
          },
        });
      } else if (
        queue.status !== QueueStatus.DELAYED
        && (queue.status !== QueueStatus.ACCEPTED
          || queue.scheduledLoadingTime?.getTime() !== scheduledLoadingTime.getTime()
          || queue.lateAt !== null)
      ) {
        queue = await tx.queueEntry.update({
          where: { id: queue.id },
          data: { status: QueueStatus.ACCEPTED, scheduledLoadingTime, lateAt: null },
        });
      }
      if (assignment.queueEntryId !== queue.id) {
        // An edited schedule keeps its cancelled assignment for audit. Release
        // that historical assignment's queue link before attaching the fresh
        // active assignment, otherwise the trip/queue uniqueness key blocks
        // the edited schedule from returning to the same van row.
        await tx.tripAssignment.updateMany({
          where: {
            id: { not: assignment.id },
            tripId: assignment.tripId,
            queueEntryId: queue.id,
            status: { notIn: liveAssignments },
          },
          data: { queueEntryId: null },
        });
        await tx.tripAssignment.update({
          where: { id: assignment.id },
          data: { queueEntryId: queue.id },
        });
        await tx.notification.create({
          data: {
            userId: assignment.driverId,
            type: NotificationType.QUEUE,
            message: `Your accepted Goa schedule for ${departureLabel(assignment.trip.scheduledOrTriggeredTime)} is now in today's queue.`,
          },
        });
        admitted += 1;
      }
      if (assignment.trip.status === TripStatus.SCHEDULED || assignment.trip.status === TripStatus.ASSIGNING) {
        await tx.trip.update({ where: { id: assignment.tripId }, data: { status: TripStatus.ASSIGNED } });
      }
    }
    await normalizeSavedQueue(tx, RouteCode.GOA);
    return { admitted };
  });
}

// A confirmed entry alone can be stale after an outside sample. Never treat a
// last known outside point as present just because the exit sequence is pending.
export function isPresentForLoading(vehicle: { insideTerminalZone: boolean; latestDistanceKm: Prisma.Decimal | number | null; latestLocationObservedAt?: Date | null; latestLocationAccuracyM?: Prisma.Decimal | number | null }, now = new Date()) {
  return vehicle.insideTerminalZone
    && (vehicle.latestDistanceKm === null || Number(vehicle.latestDistanceKm) <= TERMINAL_GEOFENCE.arrivalRadiusKm)
    && (!vehicle.latestLocationObservedAt || Math.abs(now.getTime() - vehicle.latestLocationObservedAt.getTime()) <= TERMINAL_GEOFENCE.sampleMaxAgeMs)
    && (vehicle.latestLocationAccuracyM == null || Number(vehicle.latestLocationAccuracyM) <= TERMINAL_GEOFENCE.maxAccuracyMeters);
}

// A confirmed terminal entry is sufficient for scheduled GOSO attendance;
// keep the distance check aligned with the shared 100 m terminal circle.
export function isConfirmedForScheduledLoading(vehicle: {
  insideTerminalZone: boolean;
  latestDistanceKm: Prisma.Decimal | number | null;
}) {
  return vehicle.insideTerminalZone
    && (vehicle.latestDistanceKm === null || Number(vehicle.latestDistanceKm) <= TERMINAL_GEOFENCE.arrivalRadiusKm);
}

function departureLabel(date: Date) {
  return date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short', hour12: true });
}

async function queueRows(tx: Prisma.TransactionClient, serviceTime: Date) {
  const day = manilaServiceDay(serviceTime);
  const scopedRows = await tx.queueEntry.findMany({
    where: {
      route: RouteCode.GOA,
      status: { in: operationalQueueStatuses },
      scheduledLoadingTime: { gte: day.start, lt: day.end },
      vehicle: { assignedDriver: { isActive: true }, status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
    },
    orderBy: queueOrder, include: { vehicle: true },
  });
  if (scopedRows.length) return scopedRows;
  // Legacy queue records created before daily loading slots may not carry a
  // scheduled time. Keep those records reorderable without mixing them into a
  // modern service-day queue when dated rows are available.
  return tx.queueEntry.findMany({
    where: {
      route: RouteCode.GOA,
      status: { in: operationalQueueStatuses },
      vehicle: { assignedDriver: { isActive: true }, status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
    },
    orderBy: queueOrder,
    include: { vehicle: true },
  });
}

async function slotsForRotation(tx: Prisma.TransactionClient, sourceTripId: string) {
  const source = await tx.trip.findUniqueOrThrow({ where: { id: sourceTripId } });
  const day = manilaServiceDay(source.scheduledOrTriggeredTime);
  const serviceDayTrips = await tx.trip.findMany({
    where: { route: RouteCode.GOA, status: { in: openTrips }, scheduledOrTriggeredTime: { gte: day.start, lt: day.end } },
    include: { assignments: { where: { status: { in: liveAssignments } }, orderBy: { assignedAt: 'desc' }, take: 1 }, reservations: { where: { status: { in: heldReservations } }, include: { seats: true } } },
  });
  serviceDayTrips.sort((left, right) => (
    boardingStartFor(left.scheduledOrTriggeredTime, left.boardingStartTime).getTime()
      - boardingStartFor(right.scheduledOrTriggeredTime, right.boardingStartTime).getTime()
    || left.scheduledOrTriggeredTime.getTime() - right.scheduledOrTriggeredTime.getTime()
    || left.id.localeCompare(right.id)
  ));
  const sourceIndex = serviceDayTrips.findIndex((trip) => trip.id === sourceTripId);
  if (sourceIndex < 0) return [];
  // Queue occurrences, rather than unique vehicles, own the schedule slots.
  // The same van can legitimately have another occurrence later in the day;
  // deduplicating by vehicle would stop the shift early and strand that later
  // slot (and its reservations) on the wrong queue occurrence.
  return serviceDayTrips.slice(sourceIndex).filter((trip) => (
    trip.id === sourceTripId || (!trip.loadingConfirmedAt && trip.assignments.length > 0)
  ));
}

// Rebind the next service-day slot for each affected van. Trip IDs, loading and
// departure times, booking references, fares and payment relations stay fixed.
export async function rotateGosoSlots(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  sourceTripId: string,
  now: Date,
  requirePresentHead: boolean,
  options: { lateQueueEntryId?: string } = {},
) {
  const allSlots = await slotsForRotation(tx, sourceTripId);
  const source = allSlots.find((trip) => trip.id === sourceTripId);
  if (!source) return false;
  const rows = (await queueRows(tx, source.scheduledOrTriggeredTime)).filter((row) => row.status !== QueueStatus.DELAYED && row.vehicle.status !== VehicleStatus.DELAYED && !row.vehicle.departureAuthorizedAt);
  const activeQueueEntryIds = new Set(rows.map((row) => row.id));
  const slots = allSlots.filter((trip) => trip.id === sourceTripId
    || trip.assignments.some((assignment) => assignment.queueEntryId && activeQueueEntryIds.has(assignment.queueEntryId)));
  const slotIds = slots.map((trip) => trip.id);
  const occupied = await tx.trip.findMany({
    where: { id: { notIn: slotIds }, status: { in: openTrips }, vehicleId: { in: rows.map((row) => row.vehicleId) },
      OR: [{ loadingConfirmedAt: { not: null } }, { boardingStartTime: { lte: now }, assignments: { some: { status: AssignmentStatus.ACCEPTED } } }] },
    select: { vehicleId: true },
  });
  const available = rows.filter((row) => !occupied.some((trip) => trip.vehicleId === row.vehicleId));
  const planned: Array<{ slot: typeof slots[number]; row: typeof rows[number] }> = [];
  const usedQueueEntries = new Set<string>();
  for (const slot of slots) {
    const seatsRequired = slot.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0);
    const row = available.find((candidate) => !usedQueueEntries.has(candidate.id)
      && (!requirePresentHead || passengerCapacityOf(candidate.vehicle) >= seatsRequired)
      && (slot.id !== sourceTripId || !requirePresentHead || (candidate.vehicle.status !== VehicleStatus.ON_TRIP && isConfirmedForScheduledLoading(candidate.vehicle))));
    // A manual edit must mean exactly the requested order, not silently skip
    // its new first van because that van cannot accommodate the bookings.
    if (!row || passengerCapacityOf(row.vehicle) < seatsRequired) return false;
    usedQueueEntries.add(row.id);
    planned.push({ slot, row });
  }
  if (planned[0]?.slot.id !== sourceTripId) return false;
  // A replacement takes the vacant first loading position. Vans which cannot
  // cover its seats stay behind it, without being reported as departed.
  if (requirePresentHead) {
    const headId = planned[0].row.id;
    const currentQueue = await tx.queueEntry.findMany({
      where: {
        route: RouteCode.GOA,
        status: { in: operationalQueueStatuses },
        vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
      },
      orderBy: queueOrder,
    });
    const reordered = [currentQueue.find((row) => row.id === headId)!, ...currentQueue.filter((row) => row.id !== headId)];
    for (const [index, row] of reordered.entries()) await tx.queueEntry.update({ where: { id: row.id }, data: { position: index + 1 } });
  }
  const changedTripIds = planned
    .filter(({ slot, row }) => {
      const assignment = slot.assignments[0];
      return slot.vehicleId !== row.vehicleId
        || !assignment
        || assignment.queueEntryId !== row.id
        || assignment.driverId !== row.vehicle.assignedDriverId;
    })
    .map(({ slot }) => slot.id);
  if (changedTripIds.length) {
    await tx.tripAssignment.updateMany({
      where: { tripId: { in: changedTripIds }, status: { in: liveAssignments } },
      // Release the queue link as the replacement assignment will own it.
      // This also prevents a unique-key collision if the same vans rotate
      // through these service-day slots again later.
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now, queueEntryId: null },
    });
  }
  for (const { slot, row } of planned) {
    const previous = slot.assignments[0];
    const alreadyBoundToOccurrence = slot.vehicleId === row.vehicleId
      && previous?.queueEntryId === row.id
      && previous.driverId === row.vehicle.assignedDriverId;
    if (alreadyBoundToOccurrence) continue;
    const loading = boardingStartFor(slot.scheduledOrTriggeredTime, slot.boardingStartTime) <= now
      && row.vehicle.status !== VehicleStatus.ON_TRIP && isConfirmedForScheduledLoading(row.vehicle);
    await tx.tripAssignment.create({ data: {
      tripId: slot.id, driverId: row.vehicle.assignedDriverId!, queueEntryId: row.id,
      status: AssignmentStatus.ACCEPTED, assignedAt: now, respondedAt: now,
      responseDeadline: boardingStartFor(slot.scheduledOrTriggeredTime, slot.boardingStartTime),
    } });
    await tx.trip.update({ where: { id: slot.id }, data: { vehicleId: row.vehicleId, status: loading ? TripStatus.BOARDING : TripStatus.ASSIGNED, loadingConfirmedAt: loading ? now : null, loadingConfirmedVehicleId: loading ? row.vehicleId : null, awaitingQueueReplacement: false } });
    if (loading) await tx.vehicle.update({ where: { id: row.vehicleId }, data: { status: VehicleStatus.LOADING } });
    await tx.queueEntry.update({
      where: { id: row.id },
      data: {
        status: QueueStatus.ACCEPTED,
        scheduledLoadingTime: boardingStartFor(slot.scheduledOrTriggeredTime, slot.boardingStartTime),
        // Automatic late rotation must not erase an earlier driver's final
        // late decision. Manual dispatcher rotations retain their existing
        // behavior and clear the marker for the explicitly arranged order.
        lateAt: options.lateQueueEntryId
          ? (row.id === options.lateQueueEntryId ? now : row.lateAt)
          : null,
      },
    });
    await tx.passengerCount.create({ data: { vehicleId: row.vehicleId, tripId: slot.id, count: 0, submittedByDriverId: row.vehicle.assignedDriverId! } });
    const occupiedSeats = new Set<number>();
    const changes = slot.reservations.map((reservation) => {
      const oldSeats = reservation.seats.map((seat) => seat.seatNumber);
      const seats = oldSeats.filter((seat) => seat <= passengerCapacityOf(row.vehicle) && !occupiedSeats.has(seat));
      seats.forEach((seat) => occupiedSeats.add(seat));
      return { reservation, oldSeats, seats };
    });
    for (const change of changes) {
      for (let seat = 1; change.seats.length < change.reservation.seatCount && seat <= passengerCapacityOf(row.vehicle); seat += 1) {
        if (!occupiedSeats.has(seat)) { change.seats.push(seat); occupiedSeats.add(seat); }
      }
    }
    // Release all affected seats before recreating them, avoiding unique-seat
    // collisions when a smaller van requires different seat numbers.
    await tx.reservationSeat.deleteMany({ where: { reservationId: { in: changes.map((change) => change.reservation.id) } } });
    for (const { reservation, seats } of changes) {
      await tx.reservationSeat.createMany({ data: seats.map((seatNumber) => ({ tripId: slot.id, reservationId: reservation.id, seatNumber })) });
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: reservation.status === ReservationStatus.PENDING_PAYMENT || reservation.status === ReservationStatus.PENDING_VERIFICATION ? reservation.status : ReservationStatus.REALLOCATED } });
      await tx.notification.create({ data: { userId: reservation.passengerId, type: NotificationType.REALLOCATION, message: `${reservation.reference}: queue adjustment changed your van to ${row.vehicle.vanId}. Your departure remains ${departureLabel(slot.scheduledOrTriggeredTime)}. Seats: ${seats.join(', ')}. Your payment is unchanged.` } });
    }
    await tx.notification.create({ data: { userId: row.vehicle.assignedDriverId!, type: NotificationType.ASSIGNMENT, message: `Queue adjustment: ${row.vehicle.vanId} is assigned to the Goa departure at ${departureLabel(slot.scheduledOrTriggeredTime)}. Cancel the assignment if you cannot make the trip.` } });
    if (previous && previous.driverId !== row.vehicle.assignedDriverId) await tx.notification.create({ data: { userId: previous.driverId, type: NotificationType.ASSIGNMENT, message: `The Goa departure at ${departureLabel(slot.scheduledOrTriggeredTime)} has transferred to ${row.vehicle.vanId} after a queue adjustment. Check your updated assignment.` } });
    await tx.dispatchLog.create({ data: { actorUserId, action: DispatchAction.RESERVATION_REALLOCATED, route: RouteCode.GOA, targetId: slot.id, reason: 'Queue adjusted; original departure and bookings preserved.', metadata: { trigger: 'goso_queue_rotation', fromVehicleId: slot.vehicleId, vehicleId: row.vehicleId, reservationCount: changes.length, departureTime: slot.scheduledOrTriggeredTime.toISOString() } } });
  }
  return true;
}

export async function evaluateGosoLoading(actorUserId: string, now: Date) {
  return withRouteQueue(RouteCode.GOA, async (tx) => {
    const day = manilaServiceDay(now);
    const trips = await tx.trip.findMany({
      where: {
        route: RouteCode.GOA,
        status: { in: openTrips },
        scheduledOrTriggeredTime: { gte: day.start, lt: day.end },
      },
      orderBy: { scheduledOrTriggeredTime: 'asc' },
    });
    let moved = 0;
    for (const candidate of trips) {
      if (boardingStartFor(candidate.scheduledOrTriggeredTime, candidate.boardingStartTime) > now) continue;
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: candidate.id }, include: { vehicle: true, assignments: { where: { status: AssignmentStatus.ACCEPTED }, take: 1 } } });
      if (trip.loadingConfirmedAt && trip.loadingConfirmedVehicleId === trip.vehicleId) continue;
      if (trip.vehicle.departureAuthorizedTripId === trip.id || trip.vehicle.status === VehicleStatus.DELAYED) continue;
      // An accepted later schedule must not put a van back in the queue while
      // its previous occurrence is still on the road.
      if (trip.vehicle.status === VehicleStatus.ON_TRIP) continue;
      const assignment = trip.assignments[0];
      if (assignment) {
        const loadingTime = boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime);
        const day = manilaServiceDay(trip.scheduledOrTriggeredTime);
        const rows = await tx.queueEntry.findMany({
          where: {
            route: RouteCode.GOA,
            status: { in: operationalQueueStatuses },
            scheduledLoadingTime: { gte: day.start, lt: day.end },
          },
          orderBy: queueOrder,
        });
        let row = assignment.queueEntryId
          ? rows.find((entry) => entry.id === assignment.queueEntryId)
          : rows.find((entry) => entry.vehicleId === trip.vehicleId);
        // A late decision is final for this queue occurrence. A later GPS sample
        // must not silently restore the driver's original position.
        if (row?.lateAt) continue;
        if (isConfirmedForScheduledLoading(trip.vehicle)) {
          await tx.trip.update({ where: { id: trip.id }, data: { loadingConfirmedAt: now, loadingConfirmedVehicleId: trip.vehicleId, status: TripStatus.BOARDING } });
          await tx.vehicle.update({ where: { id: trip.vehicleId }, data: { status: VehicleStatus.LOADING } });
          continue;
        }
        if (!row) row = await tx.queueEntry.create({ data: { vehicleId: trip.vehicleId, route: RouteCode.GOA, position: rows.length + 1, arrivalTimestamp: now, status: QueueStatus.ACCEPTED, scheduledLoadingTime: loadingTime } });
        await tx.queueEntry.update({
          where: { id: row.id },
          data: { position: rows.length + 1, status: QueueStatus.ACCEPTED, scheduledLoadingTime: loadingTime, lateAt: now },
        });
        await normalizeSavedQueue(tx, RouteCode.GOA);
        // Queue positions own the chronological loading slots. Once the due
        // head misses the geofence deadline, every following van moves up one
        // schedule and the late van inherits the final active schedule.
        const scheduleRotated = await rotateGosoSlots(
          tx,
          actorUserId,
          trip.id,
          now,
          false,
          { lateQueueEntryId: row.id },
        );
        if (scheduleRotated) await normalizeSavedQueue(tx, RouteCode.GOA);
        const lateRow = await tx.queueEntry.findUniqueOrThrow({ where: { id: row.id } });
        await tx.vehicle.update({ where: { id: trip.vehicleId }, data: { status: trip.vehicle.lastKnownInsideZone ? VehicleStatus.INCOMING : VehicleStatus.OUTSIDE_ZONE } });
        await tx.dispatchLog.create({ data: { actorUserId, action: DispatchAction.MOVED_TO_LAST, route: RouteCode.GOA, targetId: row.id, reason: 'Driver was outside the 100-meter terminal geofence when their scheduled loading time was reached.', metadata: { trigger: 'goso_policy_loading_no_show', tripId: trip.id, assignmentId: assignment.id, scheduledLoadingTime: loadingTime.toISOString(), adoptedLoadingTime: lateRow.scheduledLoadingTime?.toISOString() ?? null, scheduleRotated, lateAt: now.toISOString() } } });
        await tx.notification.create({ data: { userId: assignment.driverId, type: NotificationType.QUEUE, message: scheduleRotated && lateRow.scheduledLoadingTime
          ? `You were outside the 100-meter terminal geofence at your scheduled loading time (${departureLabel(loadingTime)}). You are marked Late, moved to the last active queue position, and reassigned to the ${departureLabel(lateRow.scheduledLoadingTime)} loading slot.`
          : `You were outside the 100-meter terminal geofence at your scheduled loading time (${departureLabel(loadingTime)}). You are marked Late and moved to the last active queue position.` } });
        moved += 1;
        continue;
      }
      // Preserve support for legacy records that were already waiting for a
      // replacement before the strict GOSO policy was introduced.
      if (trip.awaitingQueueReplacement) {
        await rotateGosoSlots(tx, actorUserId, trip.id, now, false);
      }
    }
    return { moved };
  });
}

export async function reorderDispatcherQueue(actorUserId: string, route: RouteCode, entryId: string, position: number | undefined, last: boolean, reason: string) {
  return withRouteQueue(route, async (tx) => {
    const now = new Date();
    const targetEntry = await tx.queueEntry.findFirst({
      where: {
        id: entryId,
        route,
        status: { in: operationalQueueStatuses },
        vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
      },
    });
    if (!targetEntry) throw new AppError(409, 'QUEUE_ENTRY_INACTIVE', 'Only active queue entries can be reordered.');
    const serviceTime = route === RouteCode.GOA && targetEntry.scheduledLoadingTime ? targetEntry.scheduledLoadingTime : now;
    const day = manilaServiceDay(serviceTime);
    const rows = await tx.queueEntry.findMany({
      where: {
        route,
        status: { in: operationalQueueStatuses },
        vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
        ...(route === RouteCode.GOA && targetEntry.scheduledLoadingTime
          ? { scheduledLoadingTime: { gte: day.start, lt: day.end } }
          : {}),
      },
      orderBy: queueOrder,
    });
    const entry = rows.find((row) => row.id === entryId);
    if (!entry) throw new AppError(409, 'QUEUE_ENTRY_INACTIVE', 'Only active queue entries can be reordered.');
    const reordered = rows.filter((row) => row.id !== entryId);
    const index = last ? reordered.length : Math.min((position ?? 1) - 1, reordered.length);
    reordered.splice(index, 0, entry);
    for (const [i, row] of reordered.entries()) await tx.queueEntry.update({ where: { id: row.id }, data: { position: i + 1 } });
    if (route === RouteCode.GOA) {
      const slot = await tx.trip.findFirst({ where: { route, status: { in: openTrips }, vehicleId: { in: rows.map((row) => row.vehicleId) } }, orderBy: { scheduledOrTriggeredTime: 'asc' } });
      if (slot && !await rotateGosoSlots(tx, actorUserId, slot.id, now, false)) throw new AppError(409, 'QUEUE_REALLOCATION_BLOCKED', 'This queue order cannot cover the scheduled reservations with the available vans.');
      await normalizeSavedQueue(tx, RouteCode.GOA);
      if (targetEntry.scheduledLoadingTime) await alignGosoLoadingTimesWithPositions(tx, serviceTime);
    } else {
      // The active Taya queue is materialized from the saved daily sequence.
      // Persist dispatcher reordering into that sequence, otherwise the next
      // poll/sync would immediately restore the previous order.
      const serviceDate = new Date(`${day.date}T00:00:00.000Z`);
      const plans = await tx.tayaDailySchedule.findMany({
        where: { serviceDate },
        orderBy: { position: 'asc' },
      });
      const plansByQueueEntry = new Map(plans.flatMap((plan) => plan.queueEntryId ? [[plan.queueEntryId, plan] as const] : []));
      const orderedActivePlans = reordered.flatMap((row) => {
        const plan = plansByQueueEntry.get(row.id);
        return plan ? [plan] : [];
      });
      const activePlanIds = new Set(orderedActivePlans.map((plan) => plan.id));
      const orderedPlans = [...orderedActivePlans, ...plans.filter((plan) => !activePlanIds.has(plan.id))];
      if (orderedPlans.length) {
        await tx.tayaDailySchedule.updateMany({ where: { serviceDate }, data: { position: { increment: 1_000 } } });
        for (const [i, plan] of orderedPlans.entries()) {
          await tx.tayaDailySchedule.update({ where: { id: plan.id }, data: { position: i + 1 } });
        }
      }
    }
    await tx.dispatchLog.create({ data: { actorUserId, route, targetId: entryId, action: last ? DispatchAction.MOVED_TO_LAST : DispatchAction.QUEUE_OVERRIDDEN, reason: reason || null, metadata: { oldPosition: entry.position, newPosition: index + 1 } } });
  });
}
