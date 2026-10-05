import { compare, hash } from 'bcryptjs';
import {
  AssignmentStatus,
  DispatchAction,
  NotificationType,
  Prisma,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  UserRole,
  VehicleStatus,
} from '@prisma/client';
import { boardingStartFor } from '../config/dispatch.js';
import { TERMINAL_GEOFENCE } from '../config/terminal.js';
import { passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { toAuthenticatedUser } from './authService.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { isPresentForLoading, queueOrder, withRouteQueue } from './queueSchedulingService.js';
import { dispatchQueueDeparture, normalizeRouteQueuePositions, recalculateTayaReadiness } from './automationService.js';
import { syncTayaDailyQueue } from './tayaQueueService.js';
import { tayaQueueAdmissionWhere } from './tayaQueueEligibility.js';

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

const currentQueueStatuses: QueueStatus[] = [
  QueueStatus.WAITING,
  QueueStatus.ASSIGNED,
  QueueStatus.ACCEPTED,
  QueueStatus.READY_FOR_DISPATCH,
  QueueStatus.DELAYED,
];

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };

interface DriverProfileInput {
  name: string;
  email: string;
  contact: string;
}

export async function updateDriverProfile(driverId: string, input: DriverProfileInput) {
  const driver = await prisma.user.findFirst({ where: { id: driverId, role: UserRole.DRIVER } });
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'This driver profile is no longer available.');
  try {
    const user = await prisma.user.update({
      where: { id: driver.id },
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
      throw new AppError(404, 'DRIVER_NOT_FOUND', 'This driver profile is no longer available.');
    }
    throw error;
  }
}

export async function changeDriverPassword(driverId: string, currentPassword: string, newPassword: string) {
  const driver = await prisma.user.findFirst({ where: { id: driverId, role: UserRole.DRIVER } });
  if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'This driver profile is no longer available.');
  if (!(await compare(currentPassword, driver.passwordHash))) {
    throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', 'The current password you entered is incorrect.');
  }
  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: driver.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
}

async function ownVehicle(driverId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { assignedDriverId: driverId } });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');
  return vehicle;
}

export async function getDriverOverview(driverId: string) {
  const now = new Date();
  const currentDay = manilaServiceDay(now);
  const assignedVehicle = await prisma.vehicle.findUnique({ where: { assignedDriverId: driverId }, select: { route: true } });
  if (!assignedVehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');
  // Match dispatcher queue management even when the driver opens the day first.
  if (assignedVehicle.route === RouteCode.LEGAZPI) await syncTayaDailyQueue(now);
  const vehicle = await prisma.vehicle.findUnique({
    where: { assignedDriverId: driverId },
    include: {
      assignedDriver: { select: { name: true, contact: true } },
      queueEntries: {
        where: {
          status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] },
          OR: [
            { route: RouteCode.GOA },
            { route: RouteCode.LEGAZPI, ...tayaQueueAdmissionWhere(now) },
          ],
        },
        orderBy: { createdAt: 'desc' },
      },
      trips: {
        where: {
          status: { in: activeTripStatuses },
          // Past-day records remain available for reports, but must not mask
          // today's assignment card or make an old response look current.
          scheduledOrTriggeredTime: { gte: currentDay.start },
        },
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
            where: { driverId, status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
            orderBy: { assignedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_ASSIGNED', 'No vehicle is assigned to this driver.');

  // Loading opens at the dispatcher-set time, falling back to the historical
  // departure-minus-window rule for trips created without an explicit one.
  const loadingOpen = (trip: { scheduledOrTriggeredTime: Date; boardingStartTime: Date | null }) =>
    boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).getTime() <= now.getTime();
  const currentlyBoardingTrip = vehicle.trips.find((trip) => {
    const tripAssignment = trip.assignments[0];
    return tripAssignment?.status === AssignmentStatus.ACCEPTED
      && (vehicle.route !== RouteCode.GOA || loadingOpen(trip));
  });
  const pendingTrip = vehicle.trips.find((trip) => trip.assignments[0]?.status === AssignmentStatus.PENDING);
  const acceptedFutureTrip = vehicle.trips.find((trip) => trip.assignments[0]?.status === AssignmentStatus.ACCEPTED);
  const assignedTrip = currentlyBoardingTrip ?? pendingTrip ?? acceptedFutureTrip ?? null;
  const assignment = assignedTrip?.assignments[0] ?? null;
  // Goa queue state belongs to a concrete daily assignment. Never surface an
  // unrelated historical row just because it is the van's newest record.
  const queue = assignment?.queueEntryId
    ? vehicle.queueEntries.find((entry) => entry.id === assignment.queueEntryId) ?? null
    : vehicle.route === RouteCode.LEGAZPI ? vehicle.queueEntries[0] ?? null : null;
  const submittedOccupancy = assignedTrip?.passengerCounts[0]?.count;
  const reservationOccupancy = assignedTrip?.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0) ?? 0;
  const capacity = passengerCapacityOf(vehicle);
  const scheduleAssignments = vehicle.trips.flatMap((trip) => {
    const tripAssignment = trip.assignments[0];
    if (!tripAssignment) return [];
    const tripReservations = trip.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0);
    const tripOccupancy = Math.min(capacity, trip.passengerCounts[0]?.count ?? tripReservations);
    return [{
      id: tripAssignment.id,
      status: tripAssignment.status.toLowerCase(),
      assignedAt: tripAssignment.assignedAt.toISOString(),
      responseDeadline: tripAssignment.responseDeadline.toISOString(),
      trip: {
        id: trip.id,
        boardingStartTime: boardingStartFor(trip.scheduledOrTriggeredTime, trip.boardingStartTime).toISOString(),
        departureTime: trip.scheduledOrTriggeredTime.toISOString(),
        loadingOpen: loadingOpen(trip),
        status: trip.status.toLowerCase(),
        occupancy: tripOccupancy,
        reservations: tripReservations,
      },
    }];
  });
  const occupancy = Math.min(capacity, submittedOccupancy ?? reservationOccupancy);
  const occupancyAllowed = assignment?.status === AssignmentStatus.ACCEPTED
    && isPresentForLoading(vehicle)
    && (vehicle.route !== RouteCode.GOA || Boolean(assignedTrip && loadingOpen(assignedTrip)));
  const occupancyReason = !assignment
    ? 'No active schedule is assigned to this driver.'
    : assignment.status !== AssignmentStatus.ACCEPTED
      ? 'The active assignment is not ready for passenger counting.'
      : !isPresentForLoading(vehicle)
        ? 'Passenger loading requires confirmed presence inside the terminal circle.'
      : !occupancyAllowed
        ? 'Passenger-count reporting opens when this departure’s loading time begins.'
        : 'Passenger count can be updated for this accepted schedule.';

  const queueEntries = await prisma.queueEntry.findMany({
    where: {
      route: vehicle.route,
      status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] },
      ...(vehicle.route === RouteCode.GOA
        ? { scheduledLoadingTime: { gte: currentDay.start, lt: currentDay.end } }
        : {
          ...tayaQueueAdmissionWhere(now),
        }),
    },
    orderBy: queueOrder,
    include: { vehicle: { select: { status: true } } },
  });
  const dispatcher = await prisma.user.findFirst({ where: { role: 'DISPATCHER', dispatcherRoute: vehicle.route, isActive: true }, select: { name: true, contact: true } });
  const notifications = await prisma.notification.findMany({ where: { userId: driverId }, orderBy: { createdAt: 'desc' }, take: 6 });
  const currentQueueIndex = queue ? queueEntries.findIndex((entry) => entry.id === queue.id) : -1;
  // Taya dashboard cards must use the same active occurrence and saved
  // position shown by dispatcher queue management, not a separately counted rank.
  const visibleQueue = vehicle.route === RouteCode.LEGAZPI
    ? queueEntries[currentQueueIndex] ?? null
    : queue;
  const latestTodayTrip = await prisma.trip.findFirst({
    where: {
      vehicleId: vehicle.id,
      scheduledOrTriggeredTime: { gte: currentDay.start, lt: currentDay.end },
      assignments: { some: { driverId } },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 },
      reservations: { where: { status: { in: activeReservationStatuses } }, select: { seatCount: true } },
      assignments: { where: { driverId }, orderBy: { assignedAt: 'desc' }, take: 1, include: { queueEntry: true } },
    },
  });
  const historicalTodayAssignment = latestTodayTrip?.assignments[0] ?? null;
  const todayAssignment = assignment ?? historicalTodayAssignment;
  const todayTrip = assignedTrip ?? latestTodayTrip;
  const todayQueue = queue ?? historicalTodayAssignment?.queueEntry ?? null;
  const todayQueueIndex = todayQueue && currentQueueStatuses.some((status) => status === todayQueue.status)
    ? queueEntries.findIndex((entry) => entry.id === todayQueue.id)
    : -1;
  const todayQueuePosition = todayQueueIndex >= 0
    ? vehicle.route === RouteCode.LEGAZPI ? queueEntries[todayQueueIndex]!.position : todayQueueIndex + 1
    : null;
  const todayOccupancy = Math.min(
    capacity,
    todayTrip?.passengerCounts[0]?.count
      ?? todayTrip?.reservations.reduce((sum, reservation) => sum + reservation.seatCount, 0)
      ?? 0,
  );
  const todayStatus = todayTrip?.status === TripStatus.COMPLETED
    ? 'completed'
    : todayTrip?.status === TripStatus.DEPARTED || todayTrip?.departedAt
      ? 'departed'
      : todayQueue?.lateAt
        ? 'late'
        : todayQueue?.status === QueueStatus.READY_FOR_DISPATCH || todayTrip?.status === TripStatus.READY
          ? 'ready_for_dispatch'
          : vehicle.status === VehicleStatus.LOADING || todayTrip?.status === TripStatus.BOARDING
            ? 'loading'
            : todayQueuePosition === 1
              ? 'queue_1'
              : todayQueuePosition !== null
                ? 'waiting'
                : todayAssignment?.status === AssignmentStatus.ACCEPTED
                  ? 'scheduled'
                  : todayAssignment?.status === AssignmentStatus.PENDING
                    ? 'scheduled'
                    : 'not_scheduled';

  let startReason = 'An active assignment is required before authorizing departure.';
  let canStart = assignment?.status === AssignmentStatus.ACCEPTED;
  if (canStart && !vehicle.goOnTripEnabled) { canStart = false; startReason = 'Enable Go on Trip first.'; }
  if (canStart && !isPresentForLoading(vehicle)) { canStart = false; startReason = 'Reliable terminal-zone GPS confirmation is required before departure.'; }
  if (canStart && vehicle.departureAuthorizedAt) { canStart = false; startReason = 'Departure is authorized and awaiting terminal-exit GPS confirmation.'; }
  if (canStart && vehicle.route === RouteCode.GOA && assignedTrip && assignedTrip.scheduledOrTriggeredTime > new Date()) {
    canStart = false; startReason = 'Goso departures unlock at the scheduled time.';
  }
  if (canStart && vehicle.route === RouteCode.LEGAZPI && visibleQueue?.position !== 1) {
    canStart = false; startReason = 'Taya departure is available only to the first van in today\'s queue.';
  }
  if (canStart && vehicle.route === RouteCode.LEGAZPI && occupancy < capacity) {
    canStart = false; startReason = `Taya departures require 100% occupancy (${capacity} of ${capacity}).`;
  }
  if (canStart) startReason = 'All protocol requirements are satisfied. Authorize departure, then GPS will confirm the terminal exit.';

  return {
    driver: { name: vehicle.assignedDriver?.name ?? 'Driver', contact: vehicle.assignedDriver?.contact ?? null },
    vehicle: {
      id: vehicle.id,
      vanId: vehicle.vanId,
      plateNo: vehicle.plateNo,
      route: routeLabels[vehicle.route],
      routeCode: vehicle.route.toLowerCase(),
      protocol: vehicle.protocol === 'GOSO' ? 'Goso' : 'Taya',
      capacity,
      status: vehicle.status.toLowerCase(),
      goOnTripEnabled: vehicle.goOnTripEnabled,
      insideActiveZone: vehicle.lastKnownInsideZone,
      insideTerminalZone: vehicle.insideTerminalZone,
      locationTrackingActive: vehicle.locationTrackingActive,
    },
    queue: visibleQueue ? {
      id: visibleQueue.id,
      position: vehicle.route === RouteCode.GOA && currentQueueIndex >= 0 ? currentQueueIndex + 1 : visibleQueue.position,
      status: visibleQueue.status.toLowerCase(),
      arrivalTimestamp: visibleQueue.arrivalTimestamp.toISOString(),
    } : null,
    trip: assignedTrip ? {
      id: assignedTrip.id,
      // Both times are surfaced so the driver knows when loading opens as well
      // as when the van is due to leave.
      boardingStartTime: boardingStartFor(assignedTrip.scheduledOrTriggeredTime, assignedTrip.boardingStartTime).toISOString(),
      departureTime: assignedTrip.scheduledOrTriggeredTime.toISOString(),
      loadingOpen: loadingOpen(assignedTrip),
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
    assignments: scheduleAssignments,
    dispatcher,
    queueSummary: {
      total: queueEntries.length,
      atTerminal: queueEntries.filter((entry) => entry.vehicle.status === VehicleStatus.AT_TERMINAL).length,
      incoming: queueEntries.filter((entry) => entry.vehicle.status === VehicleStatus.INCOMING).length,
      ready: queueEntries.filter((entry) => entry.status === QueueStatus.READY_FOR_DISPATCH).length,
    },
    startEligibility: { allowed: canStart, reason: startReason },
    departureConfirmation: {
      authorized: Boolean(vehicle.departureAuthorizedAt),
      authorizedAt: vehicle.departureAuthorizedAt?.toISOString() ?? null,
      reviewRequired: vehicle.departureReviewRequired,
      reviewReason: vehicle.departureReviewReason,
      terminalEntrySamples: vehicle.terminalEntrySampleCount,
      terminalExitSamples: vehicle.terminalExitSampleCount,
      requiredSamples: TERMINAL_GEOFENCE.requiredSamples,
      latestAccuracyMeters: vehicle.latestLocationAccuracyM === null ? null : Number(vehicle.latestLocationAccuracyM),
      latestDistanceKm: vehicle.latestDistanceKm === null ? null : Number(vehicle.latestDistanceKm),
      latestObservedAt: vehicle.latestLocationObservedAt?.toISOString() ?? null,
    },
    occupancyEligibility: { allowed: occupancyAllowed, reason: occupancyReason },
    todayQueueStatus: {
      policy: vehicle.protocol,
      queuePosition: todayQueuePosition,
      scheduledLoadingTime: vehicle.route === RouteCode.GOA && todayTrip
        ? boardingStartFor(todayTrip.scheduledOrTriggeredTime, todayTrip.boardingStartTime).toISOString()
        : null,
      scheduledDepartureTime: vehicle.route === RouteCode.GOA && todayTrip ? todayTrip.scheduledOrTriggeredTime.toISOString() : null,
      status: todayStatus,
      terminalStatus: vehicle.insideTerminalZone ? 'inside_100m_geofence' : 'outside_100m_geofence',
      passengerCount: todayOccupancy,
      capacity,
    },
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

export async function deleteDriverNotification(driverId: string, notificationId: string) {
  const result = await prisma.notification.deleteMany({ where: { id: notificationId, userId: driverId } });
  if (!result.count) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'This notification is no longer available.');
  return getDriverOverview(driverId);
}

export async function getDriverNotifications(driverId: string) {
  const notifications = await prisma.notification.findMany({
    where: { userId: driverId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return notifications.map((notification) => ({
    id: notification.id,
    type: notification.type.toLowerCase(),
    message: notification.message,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  }));
}

export async function markDriverNotificationRead(driverId: string, notificationId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId: driverId },
    data: { isRead: true },
  });
  if (!result.count) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'This notification is no longer available.');
}

export async function markAllDriverNotificationsRead(driverId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId: driverId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

export async function cancelAssignmentByDispatcher(dispatcherId: string, route: RouteCode, assignmentId: string) {
  const assignment = await prisma.tripAssignment.findFirst({
    where: { id: assignmentId, status: AssignmentStatus.ACCEPTED, trip: { route, status: { in: activeTripStatuses }, departedAt: null } },
    select: { id: true },
  });
  if (!assignment) throw new AppError(404, 'ACTIVE_ASSIGNMENT_NOT_FOUND', 'This active assignment is no longer available on your route.');

  await withRouteQueue(route, async (transaction) => {
    const current = await transaction.tripAssignment.findFirst({
      where: { id: assignmentId, status: AssignmentStatus.ACCEPTED, trip: { route, status: { in: activeTripStatuses }, departedAt: null } },
      include: { trip: true, queueEntry: { include: { vehicle: true } } },
    });
    if (!current) throw new AppError(409, 'ASSIGNMENT_ALREADY_RESPONDED', 'This assignment changed. Refresh Schedule Management.');
    const cancelledAt = new Date();
    await transaction.tripAssignment.update({
      where: { id: current.id },
      data: { status: AssignmentStatus.CANCELLED, respondedAt: cancelledAt },
    });
    if (current.queueEntry) {
      await transaction.queueEntry.update({ where: { id: current.queueEntry.id }, data: { status: QueueStatus.REPLACED } });
      const vehicle = current.queueEntry.vehicle;
      if (vehicle.status !== VehicleStatus.ON_TRIP && vehicle.status !== VehicleStatus.DELAYED) {
        await transaction.vehicle.update({
          where: { id: vehicle.id },
          data: { status: vehicle.insideTerminalZone ? VehicleStatus.AT_TERMINAL : vehicle.lastKnownInsideZone ? VehicleStatus.INCOMING : VehicleStatus.OUTSIDE_ZONE },
        });
      }
    }
    await transaction.trip.update({
      where: { id: current.tripId },
      data: { status: TripStatus.ASSIGNING, awaitingQueueReplacement: true },
    });
    await transaction.dispatchLog.create({
      data: {
        actorUserId: dispatcherId,
        action: DispatchAction.ASSIGNMENT_CANCELLED,
        targetId: current.tripId,
        route,
        reason: 'Dispatcher cancelled the driver assignment.',
        metadata: { assignmentId: current.id, queueEntryId: current.queueEntryId, cancelledByDispatcher: true },
      },
    });
    await transaction.notification.create({
      data: {
        userId: current.driverId,
        type: NotificationType.ASSIGNMENT,
        message: `The dispatcher cancelled your ${routeLabels[route]} trip assignment. You were removed from the active queue for this trip.`,
      },
    });
  });
  await normalizeRouteQueuePositions(route);
}

export async function submitOccupancy(driverId: string, count: number) {
  const assignedVehicle = await ownVehicle(driverId);
  await withRouteQueue(assignedVehicle.route, async (transaction) => {
  const vehicle = await transaction.vehicle.findUniqueOrThrow({ where: { id: assignedVehicle.id } });
  const capacity = passengerCapacityOf(vehicle);
  if (count > capacity) throw new AppError(422, 'OCCUPANCY_EXCEEDS_CAPACITY', `Passenger count cannot exceed this van's ${capacity} seats.`);
  const acceptedAssignments = await transaction.tripAssignment.findMany({
    where: {
      driverId,
      status: AssignmentStatus.ACCEPTED,
      trip: { vehicleId: vehicle.id, status: { in: activeTripStatuses } },
    },
    include: { trip: true },
  });
  acceptedAssignments.sort((left, right) => left.trip.scheduledOrTriggeredTime.getTime() - right.trip.scheduledOrTriggeredTime.getTime());
  if (!acceptedAssignments.length) {
    throw new AppError(409, 'OCCUPANCY_ASSIGNMENT_REQUIRED', 'Accept your assigned schedule before updating the passenger count.');
  }
  if (!isPresentForLoading(vehicle)) throw new AppError(409, 'TERMINAL_PRESENCE_REQUIRED', 'Confirm arrival inside the terminal circle before reporting passengers.');
  const now = Date.now();
  const assignment = acceptedAssignments.find((item) => vehicle.route !== RouteCode.GOA
    || boardingStartFor(item.trip.scheduledOrTriggeredTime, item.trip.boardingStartTime).getTime() <= now);
  if (!assignment) {
    throw new AppError(409, 'OCCUPANCY_WINDOW_NOT_OPEN', 'Passenger-count reporting opens at the scheduled loading time.');
  }
  const trip = assignment.trip;
  await transaction.passengerCount.create({ data: { vehicleId: vehicle.id, tripId: trip.id, count, submittedByDriverId: driverId } });
  await transaction.notification.create({ data: { userId: driverId, type: NotificationType.TRIP, message: `Passenger occupancy updated to ${count} of ${capacity}.` } });
  });
  if (assignedVehicle.route === RouteCode.LEGAZPI) {
    const readiness = await recalculateTayaReadiness();
    if (readiness.readyEntryId) {
      await dispatchQueueDeparture(driverId, RouteCode.LEGAZPI, readiness.readyEntryId, 'Taya passenger capacity reached.');
    }
  }
  return getDriverOverview(driverId);
}

export async function markArrivedAtTerminal(driverId: string) {
  const vehicle = await ownVehicle(driverId);
  if (!vehicle.insideTerminalZone) {
    throw new AppError(409, 'TERMINAL_GPS_CONFIRMATION_REQUIRED', `Terminal arrival is recorded automatically after ${TERMINAL_GEOFENCE.requiredSamples} reliable GPS samples inside the terminal zone.`);
  }
  return getDriverOverview(driverId);
}

export async function startDriverTrip(driverId: string) {
  const overview = await getDriverOverview(driverId);
  if (!overview.trip) throw new AppError(404, 'ACTIVE_TRIP_NOT_FOUND', 'No active trip is ready to start.');
  if (!overview.startEligibility.allowed) throw new AppError(409, 'TRIP_START_BLOCKED', overview.startEligibility.reason);
  const vehicle = await ownVehicle(driverId);
  const authorizedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.trip.update({ where: { id: overview.trip!.id }, data: { status: TripStatus.READY } });
    if (overview.queue) {
      await transaction.queueEntry.update({ where: { id: overview.queue.id }, data: { status: QueueStatus.READY_FOR_DISPATCH } });
    }
    await transaction.vehicle.update({
      where: { id: vehicle.id },
      data: {
        status: VehicleStatus.DEPARTURE_PENDING,
        locationTrackingActive: true,
        departureAuthorizedAt: authorizedAt,
        departureAuthorizedTripId: overview.trip!.id,
        departureReviewRequired: false,
        departureReviewReason: null,
        terminalExitSampleCount: 0,
        departureSequenceStartKm: null,
      },
    });
    await transaction.dispatchLog.create({
      data: {
        actorUserId: driverId,
        action: DispatchAction.DEPARTURE_AUTHORIZED,
        targetId: overview.trip!.id,
        route: vehicle.route,
        metadata: { queueEntryId: overview.queue?.id ?? null, authorizedAt: authorizedAt.toISOString() },
      },
    });
    await transaction.notification.create({
      data: { userId: driverId, type: NotificationType.TRIP, message: `${vehicle.vanId} departure authorized. Keep location tracking active while leaving the terminal.` },
    });
  });
  return getDriverOverview(driverId);
}
