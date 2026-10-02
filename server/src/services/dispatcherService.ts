import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { compare, hash } from 'bcryptjs';
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
  UserRole,
  VehicleStatus,
  Prisma,
} from '@prisma/client';
import { NCEBT, TERMINAL_GEOFENCE } from '../config/terminal.js';
import { passengerCapacityOf } from '../config/vehicle.js';
import { prisma } from '../lib/prisma.js';
import { receiptDirectory } from '../middleware/receiptUpload.js';
import { AppError } from '../utils/AppError.js';
import { toAuthenticatedUser } from './authService.js';
import { manilaServiceDay } from './driverSchedulePolicy.js';
import { admitAcceptedGosoSchedulesForDay, operationalQueueStatuses, reorderDispatcherQueue, withRouteQueue } from './queueSchedulingService.js';
import { selectTripForQueueRow } from './queueTripSelection.js';
import { confirmDepartureByDispatcher, dispatchQueueDeparture, recalculateTayaReadiness, reallocateUnavailableVehicle } from './automationService.js';
import { syncTayaDailyQueue } from './tayaQueueService.js';
import { materializeWeeklySchedules } from './weeklyScheduleService.js';

const routeLabels: Record<RouteCode, string> = { GOA: 'Goa', LEGAZPI: 'Legazpi' };
const activeTripStatuses: TripStatus[] = [TripStatus.SCHEDULED, TripStatus.ASSIGNING, TripStatus.ASSIGNED, TripStatus.BOARDING, TripStatus.READY, TripStatus.DELAYED];
const terminalVehicleStatuses: VehicleStatus[] = [
  VehicleStatus.AT_TERMINAL,
  VehicleStatus.WAITING,
  VehicleStatus.LOADING,
  VehicleStatus.READY_FOR_DISPATCH,
  VehicleStatus.DEPARTURE_PENDING,
];

interface DispatcherProfileInput {
  name: string;
  email: string;
  contact: string;
}

export async function updateDispatcherProfile(dispatcherId: string, input: DispatcherProfileInput) {
  const dispatcher = await prisma.user.findFirst({ where: { id: dispatcherId, role: UserRole.DISPATCHER } });
  if (!dispatcher) throw new AppError(404, 'DISPATCHER_NOT_FOUND', 'This dispatcher profile is no longer available.');
  try {
    const user = await prisma.user.update({
      where: { id: dispatcher.id },
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
      throw new AppError(404, 'DISPATCHER_NOT_FOUND', 'This dispatcher profile is no longer available.');
    }
    throw error;
  }
}

export async function changeDispatcherPassword(dispatcherId: string, currentPassword: string, newPassword: string) {
  const dispatcher = await prisma.user.findFirst({ where: { id: dispatcherId, role: UserRole.DISPATCHER } });
  if (!dispatcher) throw new AppError(404, 'DISPATCHER_NOT_FOUND', 'This dispatcher profile is no longer available.');
  if (!(await compare(currentPassword, dispatcher.passwordHash))) {
    throw new AppError(400, 'CURRENT_PASSWORD_INCORRECT', 'The current password you entered is incorrect.');
  }
  const passwordHash = await hash(newPassword, 12);
  await prisma.user.update({
    where: { id: dispatcher.id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
  });
}

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
  const today = manilaServiceDay(new Date());
  const tayaServiceDate = new Date(`${today.date}T00:00:00.000Z`);
  const entries = await prisma.queueEntry.findMany({
    where: {
      route,
      status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] },
      vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
      ...(route === RouteCode.GOA
        ? { scheduledLoadingTime: { gte: today.start, lt: today.end } }
        : route === RouteCode.LEGAZPI
          ? { tayaDailySchedule: { is: { serviceDate: tayaServiceDate } } }
          : {}),
    },
    orderBy: [{ route: 'asc' }, { position: 'asc' }],
    include: {
      assignments: {
        where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
        orderBy: { assignedAt: 'desc' },
        select: {
          id: true,
          tripId: true,
          status: true,
          responseDeadline: true,
          driver: { select: { name: true } },
        },
      },
      vehicle: {
        include: {
          assignedDriver: { select: { name: true } },
          trips: {
            where: { status: { in: activeTripStatuses } },
            orderBy: { scheduledOrTriggeredTime: 'asc' },
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
  return entries.map((entry, index) => {
    // A van may have several schedules on the same day. Match this queue
    // occurrence to its loading slot first; if a dispatcher adjusted that
    // slot, retain the queue-linked assignment instead of showing another
    // (or an old) trip's departure.
    const trip = selectTripForQueueRow(entry.scheduledLoadingTime, entry.assignments, entry.vehicle.trips);
    const capacity = passengerCapacityOf(entry.vehicle);
    const reservationCount = trip?.reservations.reduce((total, reservation) => total + reservation.seatCount, 0) ?? 0;
    const occupancy = Math.min(capacity, trip?.passengerCounts[0]?.count ?? reservationCount);
    const queueAssignment = trip ? entry.assignments.find((candidate) => candidate.tripId === trip.id) ?? null : null;
    const assignment = queueAssignment ?? trip?.assignments[0] ?? null;
    return {
      id: entry.id,
      route: routeLabels[entry.route],
      routeCode: entry.route.toLowerCase(),
      // Historical active rows remain available for audit, but they must not
      // create gaps in the current Manila service day's visible queue.
      position: route === RouteCode.GOA ? index + 1 : entry.position,
      vanId: entry.vehicle.vanId,
      driver: entry.vehicle.assignedDriver?.name ?? 'Unassigned',
      arrivalTimestamp: entry.arrivalTimestamp.toISOString(),
      scheduledLoadingTime: entry.scheduledLoadingTime?.toISOString() ?? null,
      lateAt: entry.lateAt?.toISOString() ?? null,
      isLate: entry.lateAt !== null,
      occupancy,
      capacity,
      status: entry.status.toLowerCase(),
      vehicleStatus: entry.vehicle.status.toLowerCase(),
      tripId: trip?.id ?? null,
      departureTime: trip?.scheduledOrTriggeredTime.toISOString() ?? null,
      assignment: assignment ? { id: assignment.id, driver: assignment.driver.name, status: assignment.status.toLowerCase(), responseDeadline: assignment.responseDeadline.toISOString() } : null,
    };
  });
}

export async function getDispatcherDashboard(route: RouteCode, dispatcherId: string) {
  const today = manilaServiceDay(new Date());
  if (route === RouteCode.GOA) {
    await materializeWeeklySchedules(new Date());
    await admitAcceptedGosoSchedulesForDay();
  }
  if (route === RouteCode.LEGAZPI) await syncTayaDailyQueue();
  const [vehicles, queues, pendingPayments, tripsDispatched, geofenceEvents, logs, replacementTrips] = await Promise.all([
    prisma.vehicle.findMany({
      where: { route },
      include: {
        assignedDriver: { select: { name: true } },
        trips: {
          where: { status: { in: activeTripStatuses } },
          orderBy: { scheduledOrTriggeredTime: 'asc' },
          include: { assignments: { where: { status: AssignmentStatus.ACCEPTED }, orderBy: { respondedAt: 'desc' }, take: 1 } },
        },
      },
    }),
    queueRows(route),
    prisma.payment.count({ where: { method: { in: [PaymentMethod.GCASH_RECEIPT, PaymentMethod.PAYPAL] }, status: PaymentStatus.PENDING_VERIFICATION, reservation: { trip: { route } } } }),
    prisma.trip.count({ where: { route, departedAt: { gte: startOfToday() } } }),
    prisma.geofenceEvent.findMany({ where: { vehicle: { route } }, orderBy: { timestamp: 'desc' }, take: 5, include: { vehicle: { select: { vanId: true, route: true } } } }),
    prisma.dispatchLog.findMany({ where: { route }, orderBy: { timestamp: 'desc' }, take: 5, include: { actor: { select: { name: true } } } }),
    // Replacement trips survive queue removal to protect bookings. Only today's
    // occurrences belong in live alerts; keep other dates intact for review.
    prisma.trip.findMany({ where: { route, awaitingQueueReplacement: true, status: { in: activeTripStatuses }, scheduledOrTriggeredTime: { gte: today.start, lt: today.end } }, orderBy: { scheduledOrTriggeredTime: 'asc' } }),
  ]);
  const passengerWaiting = queues.reduce((total, entry) => total + entry.occupancy, 0);
  const departureReviews = vehicles
    .filter((vehicle) => vehicle.departureAuthorizedAt || vehicle.departureReviewRequired)
    .map((vehicle) => {
      const trip = vehicle.trips.find((candidate) => candidate.id === vehicle.departureAuthorizedTripId) ?? vehicle.trips[0] ?? null;
      const authorized = Boolean(vehicle.departureAuthorizedAt && trip);
      return {
        id: vehicle.id,
        vehicleId: vehicle.id,
        tripId: trip?.id ?? null,
        vanId: vehicle.vanId,
        driver: vehicle.assignedDriver?.name ?? 'Unassigned',
        kind: vehicle.departureReviewRequired ? 'review' : 'pending',
        reason: vehicle.departureReviewReason ?? (authorized ? 'Protocol authorized; awaiting reliable terminal-exit GPS samples.' : 'An unauthorized terminal exit requires review.'),
        canConfirm: authorized && vehicle.departureReviewRequired,
        authorizedAt: vehicle.departureAuthorizedAt?.toISOString() ?? null,
        updatedAt: vehicle.latestLocationObservedAt?.toISOString() ?? vehicle.updatedAt.toISOString(),
        latestAccuracyMeters: vehicle.latestLocationAccuracyM === null ? null : Number(vehicle.latestLocationAccuracyM),
        latestDistanceKm: vehicle.latestDistanceKm === null ? null : Number(vehicle.latestDistanceKm),
        exitSamples: vehicle.terminalExitSampleCount,
      };
    });
  const allAlerts = [
    ...replacementTrips.map((trip) => ({ id: `replacement-${trip.id}`, tone: 'danger', title: 'Today’s departure needs a replacement van', message: `The departure scheduled for ${trip.scheduledOrTriggeredTime.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short', hour12: true })} is awaiting a replacement van. ${queues.length === 0 ? 'There are no vans in today’s queue.' : 'A replacement has not yet been assigned.'} The trip and any reservations are retained. Arrange a replacement van.`, timestamp: trip.updatedAt.toISOString() })),
    ...vehicles.filter((vehicle) => vehicle.status === VehicleStatus.DELAYED).map((vehicle) => ({ id: `vehicle-${vehicle.id}`, tone: 'danger', title: 'Van delayed', message: `${vehicle.vanId} requires dispatcher attention.`, timestamp: vehicle.updatedAt.toISOString() })),
    ...(pendingPayments ? [{ id: 'pending-payments', tone: 'warning', title: 'Payment verification', message: `${pendingPayments} payment${pendingPayments === 1 ? '' : 's'} awaiting review.`, timestamp: new Date().toISOString() }] : []),
  ];
  const allAlertKeys = allAlerts.map((alert) => alert.id);
  const [alertReceipts] = await Promise.all([
    prisma.dispatcherAlertRead.findMany({
      where: { userId: dispatcherId, alertKey: { in: allAlertKeys } },
      select: { alertKey: true, dismissedAt: true },
    }),
    prisma.dispatcherAlertRead.deleteMany({
      where: {
        userId: dispatcherId,
        // This table also stores durable payment-list and departure-history
        // dismissals. Prune only expired dashboard alerts, even when no alerts
        // are active, so polling cannot make deleted list entries reappear.
        OR: [
          { alertKey: { startsWith: 'replacement-' } },
          { alertKey: { startsWith: 'vehicle-' } },
          { alertKey: 'pending-payments' },
        ],
        alertKey: { notIn: allAlertKeys },
      },
    }),
  ]);
  const dismissedAlertKeys = new Set(alertReceipts.filter((receipt) => receipt.dismissedAt).map((receipt) => receipt.alertKey));
  const alerts = allAlerts.filter((alert) => !dismissedAlertKeys.has(alert.id)).slice(0, 6);
  const alertKeys = new Set(alerts.map((alert) => alert.id));
  const readAlertKeys = new Set(alertReceipts.filter((receipt) => !receipt.dismissedAt && alertKeys.has(receipt.alertKey)).map((receipt) => receipt.alertKey));
  return {
    route: routeLabels[route],
    routeCode: route.toLowerCase(),
    metrics: {
      vansAtTerminal: vehicles.filter((vehicle) => terminalVehicleStatuses.includes(vehicle.status)).length,
      incomingVans: vehicles.filter((vehicle) => vehicle.status === VehicleStatus.INCOMING).length,
      activeRoutes: vehicles.length ? 1 : 0,
      passengersWaiting: passengerWaiting,
      pendingPayments,
      tripsDispatchedToday: tripsDispatched,
    },
    alerts: alerts.map((alert) => ({ ...alert, isRead: readAlertKeys.has(alert.id) })),
    departureReviews,
    // Use the same current-day rows and order as queue management. A retained
    // trip outside the visible queue must not appear as the next departure.
    departures: queues.flatMap((entry) => entry.tripId && entry.departureTime ? [{
      id: entry.id, route: entry.route, vanId: entry.vanId,
      departureTime: entry.departureTime, occupancy: entry.occupancy,
      capacity: entry.capacity, status: entry.status,
    }] : []).slice(0, 6),
    activity: [
      ...geofenceEvents.map((event) => ({ id: event.id, type: 'geofence', title: `${event.vehicle.vanId} ${event.eventType === 'ENTERED' ? 'entered' : 'exited'} Active Zone`, detail: routeLabels[event.vehicle.route], timestamp: event.timestamp.toISOString() })),
      ...logs.map((log) => ({ id: log.id, type: 'dispatch', title: log.action.toLowerCase().replaceAll('_', ' '), detail: `${log.actor.name} · ${log.reason ?? log.targetId}`, timestamp: log.timestamp.toISOString() })),
    ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 7),
  };
}

export async function markDispatcherAlertRead(dispatcherId: string, route: RouteCode, alertKey: string) {
  const dashboard = await getDispatcherDashboard(route, dispatcherId);
  if (!dashboard.alerts.some((alert) => alert.id === alertKey)) {
    throw new AppError(404, 'ALERT_NOT_FOUND', 'This dispatcher alert is no longer active.');
  }
  await prisma.dispatcherAlertRead.upsert({
    where: { userId_alertKey: { userId: dispatcherId, alertKey } },
    update: { readAt: new Date() },
    create: { userId: dispatcherId, alertKey },
  });
  return getDispatcherDashboard(route, dispatcherId);
}

export async function dismissDispatcherAlert(dispatcherId: string, route: RouteCode, alertKey: string) {
  const dashboard = await getDispatcherDashboard(route, dispatcherId);
  if (!dashboard.alerts.some((alert) => alert.id === alertKey)) {
    throw new AppError(404, 'ALERT_NOT_FOUND', 'This alert is no longer available.');
  }
  const dismissedAt = new Date();
  await prisma.dispatcherAlertRead.upsert({
    where: { userId_alertKey: { userId: dispatcherId, alertKey } },
    update: { dismissedAt, readAt: dismissedAt },
    create: { userId: dispatcherId, alertKey, dismissedAt, readAt: dismissedAt },
  });
  return getDispatcherDashboard(route, dispatcherId);
}

export async function dismissAllDispatcherAlerts(dispatcherId: string, route: RouteCode) {
  let dashboard = await getDispatcherDashboard(route, dispatcherId);
  const dismissedAlertKeys = new Set<string>();

  // The dashboard intentionally returns at most six alerts. Dismiss in batches
  // until every alert that is currently active for this dispatcher and route
  // has a receipt, including alerts that were initially below the visible six.
  while (dashboard.alerts.length) {
    const alertKeys = dashboard.alerts
      .map((alert) => alert.id)
      .filter((alertKey) => !dismissedAlertKeys.has(alertKey));
    if (!alertKeys.length) break;

    const dismissedAt = new Date();
    await prisma.$transaction(alertKeys.map((alertKey) => prisma.dispatcherAlertRead.upsert({
      where: { userId_alertKey: { userId: dispatcherId, alertKey } },
      update: { dismissedAt, readAt: dismissedAt },
      create: { userId: dispatcherId, alertKey, dismissedAt, readAt: dismissedAt },
    })));
    alertKeys.forEach((alertKey) => dismissedAlertKeys.add(alertKey));
    dashboard = await getDispatcherDashboard(route, dispatcherId);
  }

  return dashboard;
}

export async function confirmDispatcherDeparture(
  actorUserId: string,
  route: RouteCode,
  tripId: string,
  reason: string,
) {
  return confirmDepartureByDispatcher(actorUserId, route, tripId, reason);
}

interface DriverAnnouncementInput {
  driverId: string;
  message: string;
}

export async function sendDriverAnnouncement(
  actorUserId: string,
  dispatcherRoute: RouteCode,
  input: DriverAnnouncementInput,
) {
  const drivers = await prisma.user.findMany({
    where: {
      role: UserRole.DRIVER,
      managedByDispatcherId: actorUserId,
      isActive: true,
      ...(input.driverId === 'all' ? {} : { id: input.driverId }),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  if (!drivers.length) {
    if (input.driverId === 'all') {
      throw new AppError(409, 'NO_ACTIVE_DRIVERS', 'There are no active managed drivers available for this announcement.');
    }
    throw new AppError(404, 'ANNOUNCEMENT_RECIPIENT_NOT_FOUND', 'This active driver is not managed by the signed-in dispatcher.');
  }

  const sentAt = new Date();
  await prisma.$transaction([
    ...drivers.map((driver) => prisma.notification.create({
      data: {
        userId: driver.id,
        type: NotificationType.SYSTEM,
        message: input.message,
        createdAt: sentAt,
      },
    })),
    prisma.dispatchLog.create({
      data: {
        actorUserId,
        action: DispatchAction.DRIVER_NOTIFIED,
        targetId: input.driverId,
        route: dispatcherRoute,
        reason: input.message,
        timestamp: sentAt,
        metadata: {
          announcement: true,
          recipientCount: drivers.length,
          recipientIds: drivers.map((driver) => driver.id),
        },
      },
    }),
  ]);

  return {
    recipientCount: drivers.length,
    recipients: drivers,
    message: input.message,
    sentAt: sentAt.toISOString(),
  };
}

export async function getFleetSnapshot(route: RouteCode) {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      route,
      status: { not: VehicleStatus.UNAVAILABLE },
      assignedDriver: { isActive: true },
    },
    orderBy: { vanId: 'asc' },
    include: {
      assignedDriver: { select: { name: true } },
      geofenceEvents: { orderBy: { timestamp: 'desc' }, take: 1 },
      queueEntries: { where: { status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const events = await prisma.geofenceEvent.findMany({
    where: {
      vehicle: {
        route,
        status: { not: VehicleStatus.UNAVAILABLE },
        assignedDriver: { isActive: true },
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 12,
    include: { vehicle: { select: { vanId: true, route: true } } },
  });
  return {
    route: routeLabels[route],
    routeCode: route.toLowerCase(),
    terminal: {
      ...NCEBT,
      terminalArrivalRadiusKm: TERMINAL_GEOFENCE.arrivalRadiusKm,
    },
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
        insideTerminalZone: vehicle.insideTerminalZone,
        departureReviewRequired: vehicle.departureReviewRequired,
        latitude: vehicle.latestLatitude !== null ? Number(vehicle.latestLatitude) : event?.latitude ? Number(event.latitude) : fallback.latitude,
        longitude: vehicle.latestLongitude !== null ? Number(vehicle.latestLongitude) : event?.longitude ? Number(event.longitude) : fallback.longitude,
        accuracyMeters: vehicle.latestLocationAccuracyM === null ? null : Number(vehicle.latestLocationAccuracyM),
        updatedAt: vehicle.latestLocationObservedAt?.toISOString() ?? event?.timestamp.toISOString() ?? vehicle.updatedAt.toISOString(),
      };
    }),
    events: events.map((event) => ({ id: event.id, vanId: event.vehicle.vanId, route: routeLabels[event.vehicle.route], eventType: event.eventType.toLowerCase(), timestamp: event.timestamp.toISOString(), distanceKm: event.distanceKm ? Number(event.distanceKm) : null })),
    updatedAt: new Date().toISOString(),
  };
}

async function getPendingArrivalDiagnostics(route: RouteCode) {
  const vehicles = await prisma.vehicle.findMany({
    where: { route, assignedDriver: { isActive: true } },
    select: {
      vanId: true,
      status: true,
      goOnTripEnabled: true,
      insideTerminalZone: true,
      latestDistanceKm: true,
      latestLocationAccuracyM: true,
      latestLocationObservedAt: true,
      terminalEntrySampleCount: true,
      assignedDriver: { select: { name: true } },
      queueEntries: {
        where: { status: { in: operationalQueueStatuses } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const now = Date.now();
  const maxAgeMs = TERMINAL_GEOFENCE.sampleMaxAgeMs;
  const maxAccuracyMeters = TERMINAL_GEOFENCE.maxAccuracyMeters;
  const requiredSamples = TERMINAL_GEOFENCE.requiredSamples;
  const arrivalRadiusMeters = Math.round(TERMINAL_GEOFENCE.arrivalRadiusKm * 1_000);

  return vehicles
    .filter((vehicle) => {
      if (vehicle.queueEntries.length || vehicle.status === VehicleStatus.ON_TRIP || vehicle.status === VehicleStatus.UNAVAILABLE) return false;
      // Confirmation resets the sampling counter to zero. A vehicle already
      // marked inside the terminal is therefore confirmed, not still waiting
      // for a GPS sample, even when it has no current schedule/queue row.
      if (vehicle.insideTerminalZone) return false;
      return vehicle.latestDistanceKm !== null && Number(vehicle.latestDistanceKm) <= TERMINAL_GEOFENCE.arrivalRadiusKm;
    })
    .map((vehicle) => {
      const distanceMeters = vehicle.latestDistanceKm === null ? null : Math.round(Number(vehicle.latestDistanceKm) * 1_000);
      const accuracyMeters = vehicle.latestLocationAccuracyM === null ? null : Math.round(Number(vehicle.latestLocationAccuracyM));
      const sampleAgeMs = vehicle.latestLocationObservedAt ? Math.max(0, now - vehicle.latestLocationObservedAt.getTime()) : null;
      let message = `${vehicle.vanId} is waiting for a location sample.`;
      if (!vehicle.goOnTripEnabled) {
        message = `${vehicle.vanId} is inside the ${arrivalRadiusMeters} m circle, but Go on Trip is off.`;
      } else if (vehicle.terminalEntrySampleCount < requiredSamples) {
        const sampleProblems = [
          sampleAgeMs !== null && sampleAgeMs > maxAgeMs ? 'the GPS sample is stale' : null,
          accuracyMeters !== null && accuracyMeters > maxAccuracyMeters ? `GPS accuracy is ${accuracyMeters} m (maximum ${maxAccuracyMeters} m)` : null,
        ].filter((problem): problem is string => Boolean(problem));
        message = sampleProblems.length
          ? `${vehicle.vanId} is about ${distanceMeters ?? '—'} m from the terminal, but ${sampleProblems.join(' and ')}.`
          : `${vehicle.vanId} is inside the ${arrivalRadiusMeters} m circle; arrival confirmation is ${vehicle.terminalEntrySampleCount}/${requiredSamples} reliable samples.`;
      } else {
        message = `${vehicle.vanId} is inside the ${arrivalRadiusMeters} m circle; queue admission is being processed.`;
      }
      return {
        vanId: vehicle.vanId,
        driver: vehicle.assignedDriver?.name ?? 'Unassigned',
        message,
        distanceMeters,
        accuracyMeters,
        terminalEntrySamples: vehicle.terminalEntrySampleCount,
        requiredSamples,
        observedAt: vehicle.latestLocationObservedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY))
    .slice(0, 3);
}

export async function getDispatcherQueue(route: RouteCode) {
  if (route === RouteCode.GOA) {
    await materializeWeeklySchedules(new Date());
    await admitAcceptedGosoSchedulesForDay();
  }
  if (route === RouteCode.LEGAZPI) await syncTayaDailyQueue();
  const [entries, pendingArrivals] = await Promise.all([
    queueRows(route),
    getPendingArrivalDiagnostics(route),
  ]);
  return { route: routeLabels[route], routeCode: route.toLowerCase(), entries, pendingArrivals, updatedAt: new Date().toISOString() };
}

interface QueueActionInput { action: 'dispatch' | 'update_passengers' | 'override' | 'move_to_last' | 'mark_delayed' | 'replace' | 'notify_driver'; reason: string; newPosition?: number; passengerCount?: number }

async function updateDispatcherPassengers(actorUserId: string, route: RouteCode, queueEntryId: string, count: number | undefined, reason: string) {
  if (count === undefined || !Number.isInteger(count) || count < 0) throw new AppError(422, 'INVALID_PASSENGER_COUNT', 'Enter a whole passenger count of zero or more.');
  await withRouteQueue(route, async (tx) => {
    const entry = await tx.queueEntry.findUnique({
      where: { id: queueEntryId },
      include: {
        assignments: {
          where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] } },
          orderBy: { assignedAt: 'desc' },
          select: { tripId: true },
        },
        vehicle: {
          include: {
            trips: {
              where: { status: { in: activeTripStatuses }, departedAt: null },
              orderBy: { scheduledOrTriggeredTime: 'asc' },
              include: { passengerCounts: { orderBy: { timestamp: 'desc' }, take: 1 } },
            },
          },
        },
      },
    });
    if (!entry || entry.route !== route) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'This queue entry is not available on your route.');
    if (!operationalQueueStatuses.some((status) => status === entry.status) || entry.vehicle.status === VehicleStatus.ON_TRIP || entry.vehicle.status === VehicleStatus.UNAVAILABLE) {
      throw new AppError(409, 'QUEUE_ENTRY_NOT_ACTIVE', 'Passenger counts can only be updated for a van in the active queue.');
    }
    const day = manilaServiceDay(new Date());
    const tayaServiceDate = new Date(`${day.date}T00:00:00.000Z`);
    if (route === RouteCode.LEGAZPI) {
      const currentPlan = await tx.tayaDailySchedule.findUnique({ where: { queueEntryId: entry.id } });
      if (currentPlan?.serviceDate.getTime() !== tayaServiceDate.getTime()) {
        throw new AppError(409, 'QUEUE_ENTRY_NOT_ACTIVE', 'Passenger counts can only be updated for a van in today\'s active queue.');
      }
    }
    const firstEntry = await tx.queueEntry.findFirst({
      where: {
        route,
        status: { in: operationalQueueStatuses },
        vehicle: { status: { notIn: [VehicleStatus.ON_TRIP, VehicleStatus.UNAVAILABLE] } },
        ...(route === RouteCode.GOA
          ? { scheduledLoadingTime: { gte: day.start, lt: day.end } }
          : { tayaDailySchedule: { is: { serviceDate: tayaServiceDate } } }),
      },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (firstEntry?.id !== entry.id) {
      throw new AppError(409, 'QUEUE_HEAD_REQUIRED', 'Passenger count can be adjusted only for the van currently in queue position 1.');
    }
    const driverId = entry.vehicle.assignedDriverId;
    if (!driverId) throw new AppError(409, 'DRIVER_REQUIRED', 'Assign a driver before recording passengers.');
    const capacity = passengerCapacityOf(entry.vehicle);
    if (count > capacity) throw new AppError(422, 'OCCUPANCY_EXCEEDS_CAPACITY', `Passenger count cannot exceed this van's ${capacity} seats.`);
    const trip = selectTripForQueueRow(entry.scheduledLoadingTime, entry.assignments, entry.vehicle.trips);
    if (!trip) throw new AppError(409, 'ACTIVE_TRIP_REQUIRED', 'Assign a trip to this van before recording passengers.');
    // This legacy column references User, so store the actual dispatcher actor.
    // Counts represent everyone aboard, including any reserved passengers.
    await tx.passengerCount.create({ data: { vehicleId: entry.vehicleId, tripId: trip.id, count, submittedByDriverId: actorUserId } });
    await tx.dispatchLog.create({ data: { actorUserId, action: DispatchAction.QUEUE_OVERRIDDEN, targetId: entry.id, route, reason: reason.trim() || null,
      metadata: { operation: 'update_passengers', tripId: trip.id, driverId, previousCount: trip.passengerCounts[0]?.count ?? null, count, capacity } } });
    await tx.notification.create({ data: { userId: driverId, type: NotificationType.TRIP, message: `The dispatcher updated ${entry.vehicle.vanId} to ${count} passengers aboard out of ${capacity} seats.` } });
  });
  if (route === RouteCode.LEGAZPI) {
    const readiness = await recalculateTayaReadiness();
    if (readiness.readyEntryId) {
      await dispatchQueueDeparture(actorUserId, RouteCode.LEGAZPI, readiness.readyEntryId, 'Taya passenger capacity reached.');
    }
  }
}

export async function applyQueueAction(actorUserId: string, dispatcherRoute: RouteCode, queueEntryId: string, input: QueueActionInput) {
  const entry = await prisma.queueEntry.findUnique({
    where: { id: queueEntryId },
    include: { vehicle: true, tayaDailySchedule: true },
  });
  if (!entry) throw new AppError(404, 'QUEUE_ENTRY_NOT_FOUND', 'This queue entry was not found.');
  if (entry.route !== dispatcherRoute) throw new AppError(403, 'ROUTE_ACCESS_DENIED', `This dispatcher can manage only the ${routeLabels[dispatcherRoute]} route.`);
  if (dispatcherRoute === RouteCode.LEGAZPI) {
    const today = new Date(`${manilaServiceDay(new Date()).date}T00:00:00.000Z`);
    if (entry.tayaDailySchedule?.serviceDate.getTime() !== today.getTime()) {
      throw new AppError(409, 'QUEUE_ENTRY_NOT_ACTIVE', 'Only entries in today\'s Taya queue can be changed.');
    }
  }

  if (input.action === 'dispatch') {
    await dispatchQueueDeparture(actorUserId, dispatcherRoute, entry.id, input.reason);
    return getDispatcherQueue(dispatcherRoute);
  }

  if (input.action === 'update_passengers') {
    await updateDispatcherPassengers(actorUserId, dispatcherRoute, entry.id, input.passengerCount, input.reason);
    return getDispatcherQueue(dispatcherRoute);
  }

  if (input.action === 'notify_driver') {
    if (!entry.vehicle.assignedDriverId) throw new AppError(409, 'DRIVER_REQUIRED', 'This vehicle has no assigned driver.');
    await prisma.$transaction([
      prisma.notification.create({ data: { userId: entry.vehicle.assignedDriverId, type: NotificationType.QUEUE, message: input.reason || `Dispatcher update for ${entry.vehicle.vanId}.` } }),
      prisma.dispatchLog.create({ data: { actorUserId, action: DispatchAction.DRIVER_NOTIFIED, targetId: entry.id, route: entry.route, reason: input.reason || null } }),
    ]);
    return getDispatcherQueue(dispatcherRoute);
  }

  if (input.action === 'mark_delayed') {
    await prisma.$transaction([
      prisma.queueEntry.update({ where: { id: entry.id }, data: { status: QueueStatus.DELAYED } }),
      prisma.vehicle.update({ where: { id: entry.vehicleId }, data: { status: VehicleStatus.DELAYED } }),
      prisma.dispatchLog.create({ data: { actorUserId, action: DispatchAction.QUEUE_OVERRIDDEN, targetId: entry.id, route: entry.route, reason: input.reason, metadata: { operation: 'mark_delayed' } } }),
    ]);
    return getDispatcherQueue(dispatcherRoute);
  }

  if (input.action === 'replace') {
    const reallocation = await reallocateUnavailableVehicle(actorUserId, entry.vehicleId, input.reason);
    return { ...await getDispatcherQueue(dispatcherRoute), reallocation };
  }

  await reorderDispatcherQueue(actorUserId, dispatcherRoute, entry.id, input.newPosition, input.action === 'move_to_last', input.reason);
  return getDispatcherQueue(dispatcherRoute);
}

const paymentInclude = {
  reservation: { include: { passenger: { select: { name: true, contact: true } }, trip: { select: { route: true, scheduledOrTriggeredTime: true } }, seats: { orderBy: { seatNumber: 'asc' as const } } } },
  verifiedBy: { select: { name: true } },
} as const;

const paymentDismissalPrefix = 'payment-list:';
const checkoutDismissalPrefix = 'payment-checkout-list:';
const reviewedPaymentStatuses: PaymentStatus[] = [PaymentStatus.VERIFIED, PaymentStatus.CAPTURED, PaymentStatus.REJECTED];
const removableCheckoutStatuses: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.FAILED];

function isRemovablePaypalCheckout(payment: { method: PaymentMethod; paypalOrderId: string | null; status: PaymentStatus }) {
  return payment.method === PaymentMethod.PAYPAL && Boolean(payment.paypalOrderId) && removableCheckoutStatuses.includes(payment.status);
}

function serializePayment(payment: Awaited<ReturnType<typeof prisma.payment.findMany<{ include: typeof paymentInclude }>>>[number]) {
  const receiptAvailable = Boolean(payment.receiptImageKey && existsSync(resolve(receiptDirectory, payment.receiptImageKey)));
  return {
    id: payment.id,
    method: payment.method === PaymentMethod.PAYPAL ? 'paypal' : 'gcash',
    status: payment.status.toLowerCase(),
    amount: Number(payment.amount),
    paypalOrderId: payment.paypalOrderId,
    gcashReference: payment.gcashReference,
    transactionReference: (payment.method === PaymentMethod.PAYPAL && payment.status === PaymentStatus.CAPTURED ? payment.externalReferenceKey?.replace(/^PAYPAL:/, '') : null)
      ?? payment.paypalOrderId ?? payment.gcashReference,
    canDelete: reviewedPaymentStatuses.includes(payment.status) || isRemovablePaypalCheckout(payment),
    receiptAvailable,
    receiptUrl: receiptAvailable ? `/api/dispatcher/payments/${payment.id}/receipt` : null,
    uploadedAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
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
      studentPassengers: payment.reservation.studentPassengers,
      seniorPassengers: payment.reservation.seniorPassengers,
      discountAmount: Number(payment.reservation.discountAmount),
      status: payment.reservation.status.toLowerCase(),
    },
  };
}

export async function getDispatcherPayments(route: RouteCode, dispatcherId?: string) {
  const dismissed = dispatcherId ? await prisma.dispatcherAlertRead.findMany({
    where: { userId: dispatcherId, OR: [{ alertKey: { startsWith: paymentDismissalPrefix } }, { alertKey: { startsWith: checkoutDismissalPrefix } }], dismissedAt: { not: null } },
    select: { alertKey: true },
  }) : [];
  const dismissedIds = dismissed.filter((receipt) => receipt.alertKey.startsWith(paymentDismissalPrefix)).map((receipt) => receipt.alertKey.slice(paymentDismissalPrefix.length));
  const dismissedCheckoutIds = dismissed.filter((receipt) => receipt.alertKey.startsWith(checkoutDismissalPrefix)).map((receipt) => receipt.alertKey.slice(checkoutDismissalPrefix.length));
  const payments = await prisma.payment.findMany({
    where: {
      reservation: { trip: { route } },
      NOT: [
        { id: { in: dismissedIds }, status: { in: reviewedPaymentStatuses } },
        { id: { in: dismissedCheckoutIds }, method: PaymentMethod.PAYPAL, paypalOrderId: { not: null }, status: { in: removableCheckoutStatuses } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: paymentInclude,
  });
  return { gcash: payments.filter((payment) => payment.method === PaymentMethod.GCASH_RECEIPT).map(serializePayment), paypal: payments.filter((payment) => payment.method === PaymentMethod.PAYPAL).map(serializePayment) };
}

export async function dismissDispatcherPayment(dispatcherId: string, route: RouteCode, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { reservation: { select: { trip: { select: { route: true } } } } },
  });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'This reservation payment was not found.');
  if (payment.reservation.trip.route !== route) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'You can delete reservation entries only for your assigned route.');
  const checkout = isRemovablePaypalCheckout(payment);
  if (!reviewedPaymentStatuses.includes(payment.status) && !checkout) throw new AppError(409, 'PAYMENT_NOT_REVIEWED', 'Only reviewed payments or pending/failed PayPal checkout entries can be removed.');

  // Reuse existing per-dispatcher dismissal receipts with a separate key namespace.
  // Never delete financial records or reservations: confirmed seats and duplicate
  // transaction checks must continue to work after an entry is cleared.
  // Checkout dismissal applies only while pending/failed. A later completed
  // capture must reappear so the dispatcher can see the newly paid booking.
  const alertKey = `${checkout ? checkoutDismissalPrefix : paymentDismissalPrefix}${payment.id}`;
  const dismissedAt = new Date();
  await prisma.dispatcherAlertRead.upsert({
    where: { userId_alertKey: { userId: dispatcherId, alertKey } },
    update: { dismissedAt, readAt: dismissedAt },
    create: { userId: dispatcherId, alertKey, dismissedAt, readAt: dismissedAt },
  });
  return getDispatcherPayments(route, dispatcherId);
}

export async function decideGcashPayment(actorUserId: string, dispatcherRoute: RouteCode, paymentId: string, decision: 'approve' | 'reject', reason: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { reservation: { include: { trip: { select: { route: true } } } } } });
  // Keep the existing endpoint for GCash and manually reported PayPal payments.
  // Orders-v2 payments must remain server-captured, never manually approved.
  const manualPayment = payment && (payment.method === PaymentMethod.GCASH_RECEIPT || (payment.method === PaymentMethod.PAYPAL && !payment.paypalOrderId));
  if (!payment || !manualPayment) throw new AppError(404, 'MANUAL_PAYMENT_NOT_FOUND', 'This payment is not available for manual verification.');
  if (payment.reservation.trip.route !== dispatcherRoute) throw new AppError(403, 'ROUTE_ACCESS_DENIED', `This dispatcher can review payments only for the ${routeLabels[dispatcherRoute]} route.`);
  if (payment.status !== PaymentStatus.PENDING_VERIFICATION) throw new AppError(409, 'PAYMENT_ALREADY_REVIEWED', 'This payment has already been reviewed.');
  if (decision === 'reject' && !reason.trim()) throw new AppError(422, 'REJECTION_REASON_REQUIRED', 'Enter a rejection reason.');
  const approved = decision === 'approve';
  const methodLabel = payment.method === PaymentMethod.PAYPAL ? 'PayPal' : 'GCash';
  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING_VERIFICATION },
      data: { status: approved ? PaymentStatus.VERIFIED : PaymentStatus.REJECTED, verifiedByUserId: actorUserId, verifiedAt: new Date(), rejectionReason: approved ? null : reason },
    });
    if (updated.count !== 1) throw new AppError(409, 'PAYMENT_ALREADY_REVIEWED', 'This payment has already been reviewed.');
    // Rejected manual reports must release the seat hold. FORFEITED is outside
    // activeReservationStatuses; PENDING_PAYMENT would keep blocking the seats.
    await transaction.reservation.update({ where: { id: payment.reservationId }, data: { status: approved ? ReservationStatus.CONFIRMED : ReservationStatus.FORFEITED } });
    if (!approved) {
      await transaction.reservationSeat.deleteMany({ where: { reservationId: payment.reservationId } });
    }
    await transaction.notification.create({ data: { userId: payment.reservation.passengerId, type: NotificationType.PAYMENT, message: approved ? `${methodLabel} payment for ${payment.reservation.reference} approved. Your booking is confirmed. Bring a valid ID and your reservation reference to the terminal.` : `${methodLabel} payment for ${payment.reservation.reference} was rejected: ${reason}` } });
    await transaction.dispatchLog.create({ data: { actorUserId, action: approved ? DispatchAction.PAYMENT_APPROVED : DispatchAction.PAYMENT_REJECTED, targetId: payment.id, route: dispatcherRoute, reason: approved ? null : reason, metadata: { reservationReference: payment.reservation.reference } } });
  });
  return getDispatcherPayments(dispatcherRoute, actorUserId);
}

export async function getPaymentReceiptPath(paymentId: string, dispatcherRoute: RouteCode) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { reservation: { include: { trip: { select: { route: true } } } } } });
  if (!payment?.receiptImageKey || (payment.method !== PaymentMethod.GCASH_RECEIPT && payment.method !== PaymentMethod.PAYPAL)) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'This payment has no receipt image.');
  if (payment.reservation.trip.route !== dispatcherRoute) throw new AppError(403, 'ROUTE_ACCESS_DENIED', `This dispatcher can view receipts only for the ${routeLabels[dispatcherRoute]} route.`);
  const receiptPath = resolve(receiptDirectory, payment.receiptImageKey);
  if (!receiptPath.startsWith(receiptDirectory) || !existsSync(receiptPath)) throw new AppError(404, 'RECEIPT_NOT_FOUND', 'The receipt image is unavailable.');
  return receiptPath;
}

export async function getDispatchLogs(route: RouteCode) {
  const logs = await prisma.dispatchLog.findMany({ where: { route }, orderBy: { timestamp: 'desc' }, take: 100, include: { actor: { select: { name: true, role: true } } } });
  return { logs: logs.map((log) => ({ id: log.id, action: log.action.toLowerCase(), actor: log.actor.name, actorRole: log.actor.role.toLowerCase(), targetId: log.targetId, reason: log.reason, metadata: log.metadata, timestamp: log.timestamp.toISOString() })) };
}

export async function deleteDispatchLog(route: RouteCode, logId: string) {
  const deleted = await prisma.dispatchLog.deleteMany({ where: { id: logId, route } });
  if (deleted.count !== 1) {
    const log = await prisma.dispatchLog.findUnique({ where: { id: logId }, select: { id: true } });
    if (log) throw new AppError(403, 'ROUTE_ACCESS_DENIED', `This dispatcher can delete logs only for the ${routeLabels[route]} route.`);
    throw new AppError(404, 'DISPATCH_LOG_NOT_FOUND', 'This dispatch log no longer exists.');
  }
  return getDispatchLogs(route);
}

export async function deleteAllDispatchLogs(route: RouteCode) {
  const deleted = await prisma.dispatchLog.deleteMany({ where: { route } });
  return { logs: [], deleted: deleted.count };
}
