import {
  AssignmentStatus,
  DispatchAction,
  DispatchProtocol,
  NotificationType,
  Prisma,
  QueueStatus,
  RouteCode,
  TripStatus,
  UserRole,
  VehicleStatus,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { boardingStartFor } from '../config/dispatch.js';
import { DEFAULT_GOA_FARE } from '../config/fare.js';
import {
  MAX_VAN_PASSENGER_CAPACITY,
  MIN_VAN_PASSENGER_CAPACITY,
  isValidPassengerCapacity,
} from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { assignScheduledVehicleDriver } from './automationService.js';
import { manilaServiceWeek } from './driverSchedulePolicy.js';
import { admitAcceptedGosoSchedulesForDay, normalizeSavedQueue, operationalQueueStatuses, withRouteQueue } from './queueSchedulingService.js';
import { listWeeklySchedules, materializeWeeklySchedules } from './weeklyScheduleService.js';

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

interface VehicleInput {
  vanId: string;
  plateNo: string;
  capacity: number;
}

interface CreateDriverInput {
  name: string;
  contact: string;
  email: string;
  password: string;
  vehicle: VehicleInput;
}

interface UpdateDriverInput {
  name: string;
  contact: string;
  email: string;
  isActive: boolean;
  vehicle: VehicleInput;
}

interface ScheduleInput {
  boardingStartTime: string;
  departureTime: string;
  vehicleId: string;
  fareAmount: number;
}

const managedDriverInclude = {
  assignedVehicle: true,
} as const;

function duplicateMessage(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : String(error.meta?.target ?? 'field');
    throw new AppError(409, 'MANAGED_RECORD_CONFLICT', `A driver or vehicle already uses this ${target}.`);
  }
  throw error;
}

function assertPassengerCapacity(capacity: number) {
  if (!isValidPassengerCapacity(capacity)) {
    throw new AppError(
      422,
      'INVALID_VEHICLE_CAPACITY',
      `Passenger capacity must be a whole number between ${MIN_VAN_PASSENGER_CAPACITY} and ${MAX_VAN_PASSENGER_CAPACITY}.`,
    );
  }
}

function deletedVehicleIdentifier(label: string, vehicleId: string) {
  const suffix = vehicleId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'history';
  const prefix = 'deleted-';
  const availableLabelLength = 32 - prefix.length - suffix.length - 1;
  return `${prefix}${label.slice(0, Math.max(0, availableLabelLength))}-${suffix}`;
}

function serializeDriver(driver: Awaited<ReturnType<typeof prisma.user.findFirst<{ include: typeof managedDriverInclude }>>>) {
  if (!driver) return null;
  return {
    id: driver.id,
    name: driver.name,
    contact: driver.contact,
    email: driver.email,
    isActive: driver.isActive,
    createdAt: driver.createdAt.toISOString(),
    vehicle: driver.assignedVehicle ? {
      id: driver.assignedVehicle.id,
      vanId: driver.assignedVehicle.vanId,
      plateNo: driver.assignedVehicle.plateNo,
      capacity: driver.assignedVehicle.capacity,
      status: driver.assignedVehicle.status.toLowerCase(),
      route: routeLabels[driver.assignedVehicle.route],
      routeCode: driver.assignedVehicle.route.toLowerCase(),
      protocol: driver.assignedVehicle.protocol === DispatchProtocol.GOSO ? 'Goso' : 'Taya',
    } : null,
  };
}

async function ownedDriver(dispatcherId: string, driverId: string) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: UserRole.DRIVER, managedByDispatcherId: dispatcherId },
    include: managedDriverInclude,
  });
  if (!driver) throw new AppError(404, 'MANAGED_DRIVER_NOT_FOUND', 'This driver is not managed by the signed-in dispatcher.');
  return driver;
}

export async function getManagedDrivers(dispatcherId: string, route: RouteCode) {
  const drivers = await prisma.user.findMany({
    where: { role: UserRole.DRIVER, managedByDispatcherId: dispatcherId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: managedDriverInclude,
  });
  return {
    route: routeLabels[route],
    routeCode: route.toLowerCase(),
    drivers: drivers.map(serializeDriver),
  };
}

export async function createManagedDriver(dispatcherId: string, route: RouteCode, input: CreateDriverInput) {
  assertPassengerCapacity(input.vehicle.capacity);
  const passwordHash = await hash(input.password, 12);
  try {
    await prisma.$transaction(async (transaction) => {
      const driver = await transaction.user.create({
        data: {
          role: UserRole.DRIVER,
          name: input.name,
          contact: input.contact,
          email: input.email,
          passwordHash,
          managedByDispatcherId: dispatcherId,
        },
      });
      const vehicle = await transaction.vehicle.create({
        data: {
          vanId: input.vehicle.vanId,
          plateNo: input.vehicle.plateNo,
          capacity: input.vehicle.capacity,
          route,
          protocol: route === RouteCode.GOA ? DispatchProtocol.GOSO : DispatchProtocol.TAYA,
          status: VehicleStatus.OUTSIDE_ZONE,
          assignedDriverId: driver.id,
          managedByDispatcherId: dispatcherId,
        },
      });
      await transaction.dispatchLog.create({
        data: {
          actorUserId: dispatcherId,
          action: DispatchAction.DRIVER_CREATED,
          targetId: driver.id,
          route,
          metadata: { vehicleId: vehicle.id, vanId: vehicle.vanId },
        },
      });
    });
  } catch (error) {
    duplicateMessage(error);
  }
  return getManagedDrivers(dispatcherId, route);
}

export async function updateManagedDriver(dispatcherId: string, route: RouteCode, driverId: string, input: UpdateDriverInput) {
  assertPassengerCapacity(input.vehicle.capacity);
  const driver = await ownedDriver(dispatcherId, driverId);
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: driver.id },
        data: {
          name: input.name,
          contact: input.contact,
          email: input.email,
          isActive: input.isActive,
          tokenVersion: input.isActive || !driver.isActive ? undefined : { increment: 1 },
        },
      });
      let vehicleId = driver.assignedVehicle?.id;
      if (driver.assignedVehicle) {
        await transaction.vehicle.update({
          where: { id: driver.assignedVehicle.id },
          data: {
            vanId: input.vehicle.vanId,
            plateNo: input.vehicle.plateNo,
            capacity: input.vehicle.capacity,
            route,
            protocol: route === RouteCode.GOA ? DispatchProtocol.GOSO : DispatchProtocol.TAYA,
            managedByDispatcherId: dispatcherId,
          },
        });
      } else {
        const vehicle = await transaction.vehicle.create({
          data: {
            vanId: input.vehicle.vanId,
            plateNo: input.vehicle.plateNo,
            capacity: input.vehicle.capacity,
            route,
            protocol: route === RouteCode.GOA ? DispatchProtocol.GOSO : DispatchProtocol.TAYA,
            status: VehicleStatus.OUTSIDE_ZONE,
            assignedDriverId: driver.id,
            managedByDispatcherId: dispatcherId,
          },
        });
        vehicleId = vehicle.id;
      }
      await transaction.dispatchLog.create({
        data: {
          actorUserId: dispatcherId,
          action: !input.isActive && driver.isActive ? DispatchAction.DRIVER_DEACTIVATED : DispatchAction.DRIVER_UPDATED,
          targetId: driver.id,
          route,
          metadata: { vehicleId, active: input.isActive },
        },
      });
    });
  } catch (error) {
    duplicateMessage(error);
  }
  return getManagedDrivers(dispatcherId, route);
}

export async function deleteManagedDriver(dispatcherId: string, route: RouteCode, driverId: string) {
  const deletedAt = new Date();
  await withRouteQueue(route, async (transaction) => {
    const driver = await transaction.user.findFirst({
      where: { id: driverId, role: UserRole.DRIVER, managedByDispatcherId: dispatcherId },
      include: managedDriverInclude,
    });
    if (!driver || (driver.assignedVehicle && driver.assignedVehicle.route !== route)) {
      throw new AppError(404, 'MANAGED_DRIVER_NOT_FOUND', 'This driver is not managed by the signed-in dispatcher.');
    }

    const assignments = await transaction.tripAssignment.findMany({
      where: { driverId: driver.id, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
      select: { id: true, tripId: true, queueEntryId: true },
    });
    const tripIds = [...new Set(assignments.map((assignment) => assignment.tripId))];
    const queueEntryIds = [...new Set(assignments.flatMap((assignment) => assignment.queueEntryId ? [assignment.queueEntryId] : []))];
    const vehicleQueueEntryIds = driver.assignedVehicle ? (await transaction.queueEntry.findMany({
      where: { vehicleId: driver.assignedVehicle.id },
      select: { id: true },
    })).map((entry) => entry.id) : [];
    const removableFutureTrips = driver.assignedVehicle ? await transaction.trip.findMany({
      where: {
        vehicleId: driver.assignedVehicle.id,
        scheduledOrTriggeredTime: { gt: deletedAt },
        departedAt: null,
        reservations: { none: {} },
      },
      select: { id: true },
    }) : [];
    const removableFutureTripIds = removableFutureTrips.map((trip) => trip.id);

    if (assignments.length) {
      await transaction.tripAssignment.updateMany({
        where: { id: { in: assignments.map((assignment) => assignment.id) } },
        data: { status: AssignmentStatus.CANCELLED, respondedAt: deletedAt },
      });
    }
    if (queueEntryIds.length) {
      await transaction.queueEntry.updateMany({
        where: { id: { in: queueEntryIds }, status: { in: operationalQueueStatuses } },
        data: { status: QueueStatus.REPLACED },
      });
    }
    if (tripIds.length) {
      await transaction.trip.updateMany({
        where: { id: { in: tripIds.filter((tripId) => !removableFutureTripIds.includes(tripId)) }, status: { in: [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY] } },
        data: { status: TripStatus.ASSIGNING, awaitingQueueReplacement: route === RouteCode.GOA },
      });
    }

    if (driver.assignedVehicle) {
      const removedVehicle = driver.assignedVehicle;
      const removedTayaScheduleCount = await transaction.tayaDailySchedule.count({
        where: { vehicleId: removedVehicle.id },
      });
      const removedTayaWeeklyScheduleCount = await transaction.tayaWeeklySchedule.count({
        where: { vehicleId: removedVehicle.id },
      });
      // A Taya daily row owns the planned occurrence for this van. Remove the
      // plan before deleting the van so it cannot be materialized back into the
      // queue and so the vehicle relation does not block deletion.
      await transaction.tayaDailySchedule.deleteMany({
        where: { vehicleId: removedVehicle.id },
      });
      await transaction.tayaWeeklySchedule.deleteMany({
        where: { vehicleId: removedVehicle.id },
      });
      if (removableFutureTripIds.length) {
        await transaction.trip.deleteMany({ where: { id: { in: removableFutureTripIds } } });
      }
      await transaction.weeklySchedule.deleteMany({
        where: { vehicleId: removedVehicle.id },
      });
      await transaction.geofenceEvent.deleteMany({
        where: { vehicleId: removedVehicle.id },
      });

      // Trip and passenger history must not be destroyed just because the
      // operational van is deleted. Move retained history to an anonymized,
      // unmanaged placeholder, then permanently delete the real van row. Its
      // original van ID and plate number are therefore immediately reusable.
      const retainedTripCount = await transaction.trip.count({ where: { vehicleId: removedVehicle.id } });
      let historyVehicleId: string | null = null;
      if (retainedTripCount > 0) {
        const historyVehicle = await transaction.vehicle.create({
          data: {
            vanId: deletedVehicleIdentifier(removedVehicle.vanId, removedVehicle.id),
            plateNo: deletedVehicleIdentifier(removedVehicle.plateNo, removedVehicle.id),
            route: removedVehicle.route,
            protocol: removedVehicle.protocol,
            capacity: removedVehicle.capacity,
            status: VehicleStatus.UNAVAILABLE,
          },
        });
        historyVehicleId = historyVehicle.id;
        await transaction.trip.updateMany({
          where: { vehicleId: removedVehicle.id },
          data: { vehicleId: historyVehicle.id },
        });
        await transaction.passengerCount.updateMany({
          where: { vehicleId: removedVehicle.id },
          data: { vehicleId: historyVehicle.id },
        });
      }
      if (vehicleQueueEntryIds.length) {
        await transaction.tripAssignment.updateMany({
          where: { queueEntryId: { in: vehicleQueueEntryIds } },
          data: { queueEntryId: null },
        });
      }
      await transaction.vehicle.delete({ where: { id: removedVehicle.id } });

      await transaction.dispatchLog.create({
        data: {
          actorUserId: dispatcherId,
          action: DispatchAction.DRIVER_DEACTIVATED,
          targetId: driver.id,
          route,
          reason: 'Dispatcher deleted the managed driver account.',
          metadata: {
            operation: 'delete_driver',
            vehicleId: removedVehicle.id,
            vehicleDeleted: true,
            historyVehicleId,
            cancelledAssignmentCount: assignments.length,
            removedQueueEntryCount: vehicleQueueEntryIds.length,
            removedFutureScheduleCount: removableFutureTripIds.length,
            removedWeeklyScheduleRules: true,
            removedTayaDailySchedules: removedTayaScheduleCount,
            removedTayaWeeklySchedules: removedTayaWeeklyScheduleCount,
            liveLocationDataRemoved: true,
            geofenceHistoryRemoved: true,
            auditHistoryRetained: true,
          },
        },
      });
    } else {
      await transaction.dispatchLog.create({
        data: {
          actorUserId: dispatcherId,
          action: DispatchAction.DRIVER_DEACTIVATED,
          targetId: driver.id,
          route,
          reason: 'Dispatcher deleted the managed driver account.',
          metadata: {
            operation: 'delete_driver',
            vehicleId: null,
            vehicleDeleted: false,
            cancelledAssignmentCount: assignments.length,
            removedQueueEntryCount: 0,
            removedFutureScheduleCount: 0,
            removedWeeklyScheduleRules: true,
            liveLocationDataRemoved: true,
            geofenceHistoryRemoved: true,
            auditHistoryRetained: true,
          },
        },
      });
    }

    await transaction.user.update({
      where: { id: driver.id },
      data: {
        name: 'Deleted driver',
        contact: null,
        email: `deleted.${driver.id}@removed.uvgo`,
        isActive: false,
        managedByDispatcherId: null,
        tokenVersion: { increment: 1 },
      },
    });
    await normalizeSavedQueue(transaction, route);
  });
  return getManagedDrivers(dispatcherId, route);
}

export async function resetManagedDriverPassword(dispatcherId: string, route: RouteCode, driverId: string, password: string) {
  const driver = await ownedDriver(dispatcherId, driverId);
  const passwordHash = await hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: driver.id }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
    prisma.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.DRIVER_UPDATED,
        targetId: driver.id,
        route,
        reason: 'Dispatcher reset the driver password.',
      },
    }),
  ]);
  return { reset: true };
}

function assertGoaSchedule(route: RouteCode) {
  if (route !== RouteCode.GOA) {
    throw new AppError(403, 'GOSO_SCHEDULE_ONLY', 'Fixed departure schedules are available only to the Goa dispatcher.');
  }
}

const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;

function departureDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(422, 'INVALID_DEPARTURE_TIME', 'Enter a valid departure date and time.');
  if (date.getTime() <= Date.now() + MIN_SCHEDULE_LEAD_MS) throw new AppError(422, 'DEPARTURE_TIME_TOO_SOON', 'Departure must be at least five minutes in the future.');
  return date;
}

/**
 * A schedule carries two mandatory times: when passenger loading opens and when
 * the van departs. Loading must start strictly before departure, and both must
 * still be far enough ahead to be actionable.
 */
function scheduleTimes(boardingStartTime: string | undefined, departureTime: string) {
  if (!boardingStartTime?.trim()) {
    throw new AppError(422, 'BOARDING_START_REQUIRED', 'Enter the passenger loading start time.');
  }
  const departure = departureDate(departureTime);
  const boardingStart = new Date(boardingStartTime);
  if (!Number.isFinite(boardingStart.getTime())) {
    throw new AppError(422, 'INVALID_BOARDING_START', 'Enter a valid passenger loading start time.');
  }
  if (boardingStart.getTime() >= departure.getTime()) {
    throw new AppError(422, 'BOARDING_START_AFTER_DEPARTURE', 'Passenger loading must start before the departure time.');
  }
  if (boardingStart.getTime() <= Date.now() + MIN_SCHEDULE_LEAD_MS) {
    throw new AppError(422, 'BOARDING_START_TOO_SOON', 'Passenger loading must start at least five minutes in the future.');
  }
  return { boardingStart, departure };
}

async function ownedGoaVehicle(dispatcherId: string, vehicleId: string) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, route: RouteCode.GOA, managedByDispatcherId: dispatcherId, assignedDriver: { isActive: true } },
  });
  if (!vehicle) throw new AppError(422, 'SCHEDULE_VEHICLE_UNAVAILABLE', 'Choose an active Goa van managed by this dispatcher.');
  return vehicle;
}

async function schedulePayload(dispatcherId: string) {
  const now = new Date();
  const responseWeek = manilaServiceWeek(now);
  const [trips, vehicles, weeklySchedules] = await Promise.all([
    prisma.trip.findMany({
      where: {
        route: RouteCode.GOA,
        createdByDispatcherId: dispatcherId,
        vehicle: {
          managedByDispatcherId: dispatcherId,
          assignedDriver: { isActive: true },
        },
        // Schedule Management is an operational, forward-looking view. Past
        // departures stay in the database for reports and audit history, but
        // disappear from this list as soon as their departure time passes.
        scheduledOrTriggeredTime: { gt: now },
      },
      orderBy: { scheduledOrTriggeredTime: 'asc' },
      include: {
        vehicle: { include: { assignedDriver: { select: { name: true } } } },
        reservations: { select: { seatCount: true } },
        assignments: {
          where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          include: { driver: { select: { name: true } } },
        },
        _count: { select: { assignments: { where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } } } } },
      },
    }),
    prisma.vehicle.findMany({
      where: { route: RouteCode.GOA, managedByDispatcherId: dispatcherId, assignedDriver: { isActive: true } },
      orderBy: { vanId: 'asc' },
      include: { assignedDriver: { select: { name: true } } },
    }),
    listWeeklySchedules(dispatcherId),
  ]);
  return {
    route: 'Goa',
    routeCode: 'goa' as const,
    defaultFare: DEFAULT_GOA_FARE,
    weeklySchedules,
    assignmentResponseWeek: {
      start: responseWeek.start.toISOString(),
      endExclusive: responseWeek.end.toISOString(),
      startDate: responseWeek.startDate,
      endDate: responseWeek.endDate,
    },
    schedules: trips.map((trip) => ({
      id: trip.id,
      weeklyScheduleId: trip.weeklyScheduleId,
      boardingStartTime: (trip.boardingStartTime ?? boardingStartFor(trip.scheduledOrTriggeredTime)).toISOString(),
      departureTime: trip.scheduledOrTriggeredTime.toISOString(),
      fareAmount: Number(trip.fareAmount),
      status: trip.status.toLowerCase(),
      reservationCount: trip.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0),
      assignmentCount: trip._count.assignments,
      assignment: trip.scheduledOrTriggeredTime >= responseWeek.start && trip.scheduledOrTriggeredTime < responseWeek.end && trip.assignments[0] ? {
        id: trip.assignments[0].id,
        driver: trip.assignments[0].driver.name,
        status: trip.assignments[0].status.toLowerCase(),
      } : null,
      vehicle: {
        id: trip.vehicle.id,
        vanId: trip.vehicle.vanId,
        capacity: trip.vehicle.capacity,
        driverId: trip.vehicle.assignedDriverId,
        driver: trip.vehicle.assignedDriver?.name ?? 'Unassigned',
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

export async function getManagedSchedules(dispatcherId: string, route: RouteCode) {
  assertGoaSchedule(route);
  await materializeWeeklySchedules(new Date(), dispatcherId);
  return schedulePayload(dispatcherId);
}

export async function createManagedSchedule(dispatcherId: string, route: RouteCode, input: ScheduleInput) {
  assertGoaSchedule(route);
  const { boardingStart, departure: scheduledOrTriggeredTime } = scheduleTimes(input.boardingStartTime, input.departureTime);
  const vehicle = await ownedGoaVehicle(dispatcherId, input.vehicleId);
  if (!vehicle.assignedDriverId) throw new AppError(422, 'SCHEDULE_DRIVER_UNAVAILABLE', 'The selected van does not have an active assigned driver.');
  const now = new Date();
  await withRouteQueue(RouteCode.GOA, async (transaction) => {
    const currentVehicle = await transaction.vehicle.findFirst({
      where: { id: vehicle.id, route: RouteCode.GOA, managedByDispatcherId: dispatcherId, assignedDriverId: vehicle.assignedDriverId, assignedDriver: { isActive: true } },
    });
    if (!currentVehicle?.assignedDriverId) throw new AppError(422, 'SCHEDULE_DRIVER_UNAVAILABLE', 'The selected van does not have an active assigned driver.');
    const duplicate = await transaction.trip.findFirst({ where: { route: RouteCode.GOA, scheduledOrTriggeredTime }, select: { id: true } });
    if (duplicate) throw new AppError(409, 'SCHEDULE_CONFLICT', 'A Goa departure already exists at this date and time.');
    const trip = await transaction.trip.create({
      data: {
        vehicleId: input.vehicleId,
        route: RouteCode.GOA,
        scheduledOrTriggeredTime,
        boardingStartTime: boardingStart,
        status: TripStatus.SCHEDULED,
        fareAmount: input.fareAmount,
        createdByDispatcherId: dispatcherId,
      },
    });
    await assignScheduledVehicleDriver(
      transaction,
      dispatcherId,
      trip.id,
      vehicle.id,
      currentVehicle.assignedDriverId,
      RouteCode.GOA,
      now,
      { trigger: 'dispatcher_schedule_created', vehicleId: vehicle.id, driverId: currentVehicle.assignedDriverId },
    );
    await transaction.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_CREATED,
        targetId: trip.id,
        route: RouteCode.GOA,
        metadata: { boardingStartTime: boardingStart.toISOString(), departureTime: scheduledOrTriggeredTime.toISOString(), vehicleId: input.vehicleId, driverId: vehicle.assignedDriverId },
      },
    });
  });
  await admitAcceptedGosoSchedulesForDay(now);
  return schedulePayload(dispatcherId);
}

export async function updateManagedSchedule(dispatcherId: string, route: RouteCode, tripId: string, input: ScheduleInput) {
  assertGoaSchedule(route);
  const { boardingStart, departure: scheduledOrTriggeredTime } = scheduleTimes(input.boardingStartTime, input.departureTime);
  const selectedVehicle = await ownedGoaVehicle(dispatcherId, input.vehicleId);
  if (!selectedVehicle.assignedDriverId) throw new AppError(422, 'SCHEDULE_DRIVER_UNAVAILABLE', 'The selected van does not have an active assigned driver.');
  const now = new Date();

  await withRouteQueue(RouteCode.GOA, async (transaction) => {
    const trip = await transaction.trip.findFirst({
      where: { id: tripId, route: RouteCode.GOA, createdByDispatcherId: dispatcherId },
      include: {
        _count: { select: { reservations: true } },
        assignments: {
          where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
          select: { id: true, driverId: true, queueEntryId: true, status: true },
        },
      },
    });
    if (!trip) throw new AppError(404, 'MANAGED_SCHEDULE_NOT_FOUND', 'This departure is not managed by the signed-in dispatcher.');
    if (trip.status === TripStatus.DEPARTED || trip.status === TripStatus.COMPLETED || trip.status === TripStatus.UNABLE_TO_DEPART) {
      throw new AppError(409, 'SCHEDULE_LOCKED', 'Completed or departed trips cannot be edited.');
    }

    const currentVehicle = await transaction.vehicle.findFirst({
      where: { id: input.vehicleId, route: RouteCode.GOA, managedByDispatcherId: dispatcherId, assignedDriver: { isActive: true } },
      select: { id: true, assignedDriverId: true },
    });
    if (!currentVehicle?.assignedDriverId) throw new AppError(422, 'SCHEDULE_DRIVER_UNAVAILABLE', 'The selected van does not have an active assigned driver.');

    const operationalChange = trip.vehicleId !== input.vehicleId || trip.scheduledOrTriggeredTime.getTime() !== scheduledOrTriggeredTime.getTime();
    if (operationalChange && trip._count.reservations > 0) {
      throw new AppError(409, 'BOOKED_SCHEDULE_LOCKED', 'A departure with passenger reservations cannot change its time or van.');
    }
    const duplicate = await transaction.trip.findFirst({
      where: { id: { not: trip.id }, route: RouteCode.GOA, scheduledOrTriggeredTime },
      select: { id: true },
    });
    if (duplicate) throw new AppError(409, 'SCHEDULE_CONFLICT', 'A Goa departure already exists at this date and time.');

    const previousDriverIds = [...new Set(trip.assignments.map((assignment) => assignment.driverId))];
    const linkedQueueEntryIds = [...new Set(trip.assignments.flatMap((assignment) => assignment.queueEntryId ? [assignment.queueEntryId] : []))];
    await transaction.tripAssignment.updateMany({
      where: { tripId: trip.id, status: AssignmentStatus.PENDING },
      data: { status: AssignmentStatus.EXPIRED, respondedAt: now },
    });
    await transaction.tripAssignment.updateMany({
      where: { tripId: trip.id, status: AssignmentStatus.ACCEPTED },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: now },
    });
    if (linkedQueueEntryIds.length) {
      await transaction.queueEntry.updateMany({
        where: { id: { in: linkedQueueEntryIds }, status: { in: [QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH] } },
        data: {
          status: trip.vehicleId === input.vehicleId ? QueueStatus.ASSIGNED : QueueStatus.WAITING,
          scheduledLoadingTime: trip.vehicleId === input.vehicleId ? boardingStart : null,
          lateAt: null,
        },
      });
      await normalizeSavedQueue(transaction, RouteCode.GOA);
    }

    await transaction.trip.update({
      where: { id: trip.id },
      data: { vehicleId: input.vehicleId, scheduledOrTriggeredTime, boardingStartTime: boardingStart, fareAmount: input.fareAmount, status: TripStatus.SCHEDULED },
    });
    await assignScheduledVehicleDriver(
      transaction,
      dispatcherId,
      trip.id,
      currentVehicle.id,
      currentVehicle.assignedDriverId,
      RouteCode.GOA,
      now,
      { trigger: 'dispatcher_schedule_updated', vehicleId: currentVehicle.id, driverId: currentVehicle.assignedDriverId },
    );
    const removedDriverIds = previousDriverIds.filter((driverId) => driverId !== currentVehicle.assignedDriverId);
    if (removedDriverIds.length) {
      await transaction.notification.createMany({
        data: removedDriverIds.map((driverId) => ({
          userId: driverId,
          type: NotificationType.ASSIGNMENT,
          message: 'A dispatcher changed your Goa schedule. The previous assignment is no longer active.',
        })),
      });
    }
    await transaction.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_UPDATED,
        targetId: trip.id,
        route: RouteCode.GOA,
        metadata: { boardingStartTime: boardingStart.toISOString(), departureTime: scheduledOrTriggeredTime.toISOString(), vehicleId: input.vehicleId, assignmentReissued: true },
      },
    });
  });
  await admitAcceptedGosoSchedulesForDay(now);
  return schedulePayload(dispatcherId);
}

export async function deleteManagedSchedule(dispatcherId: string, route: RouteCode, tripId: string) {
  assertGoaSchedule(route);
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, route: RouteCode.GOA, createdByDispatcherId: dispatcherId },
    include: {
      _count: { select: { reservations: true } },
      assignments: { select: { driverId: true } },
      vehicle: { select: { vanId: true } },
    },
  });
  if (!trip) throw new AppError(404, 'MANAGED_SCHEDULE_NOT_FOUND', 'This departure is not managed by the signed-in dispatcher.');
  if (trip.scheduledOrTriggeredTime <= new Date()) {
    throw new AppError(409, 'SCHEDULE_DELETE_BLOCKED', 'Only a future departure can be removed.');
  }
  // Assignments are created automatically alongside the schedule and cascade
  // away with it, so only real passenger reservations block removal.
  if (trip._count.reservations > 0) {
    throw new AppError(409, 'SCHEDULE_DELETE_BLOCKED', 'A departure that already has passenger reservations cannot be removed.');
  }
  const assignedDriverIds = [...new Set(trip.assignments.map((assignment) => assignment.driverId))];
  await prisma.$transaction(async (transaction) => {
    await transaction.trip.delete({ where: { id: trip.id } });
    await transaction.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.SCHEDULE_DELETED,
        targetId: trip.id,
        route: RouteCode.GOA,
        metadata: {
          departureTime: trip.scheduledOrTriggeredTime.toISOString(),
          vehicleId: trip.vehicleId,
          vanId: trip.vehicle.vanId,
        },
      },
    });
    if (assignedDriverIds.length) {
      await transaction.notification.createMany({
        data: assignedDriverIds.map((driverId) => ({
          userId: driverId,
          type: NotificationType.ASSIGNMENT,
          message: `The ${trip.vehicle.vanId} departure on ${trip.scheduledOrTriggeredTime.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short', hour12: true })} was removed by the dispatcher. You are no longer assigned to it.`,
        })),
      });
    }
  });
  return schedulePayload(dispatcherId);
}
