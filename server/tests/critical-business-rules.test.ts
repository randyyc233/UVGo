import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import { compare } from 'bcryptjs';
import {
  AssignmentStatus,
  DispatchAction,
  GeofenceEventType,
  PaymentMethod,
  PaymentStatus,
  QueueStatus,
  ReservationStatus,
  RouteCode,
  TripStatus,
  UserRole,
  VehicleStatus,
} from '@prisma/client';
import { app } from '../src/app.js';
import { DEFAULT_GOA_FARE } from '../src/config/fare.js';
import { NCEBT, TERMINAL_GEOFENCE } from '../src/config/terminal.js';
import { VAN_PASSENGER_CAPACITY } from '../src/config/vehicle.js';
import { prisma } from '../src/lib/prisma.js';
import {
  cancelDriverScheduledAssignment,
  assignScheduledVehicleDriver,
  confirmDepartureByDispatcher,
  distanceFromNcebtKm,
  recordDriverLocation,
  reallocateUnavailableVehicle,
  recalculateTayaReadiness,
  runDispatchEngine,
} from '../src/services/automationService.js';
import { applyQueueAction, changeDispatcherPassword, decideGcashPayment, deleteAllDispatchLogs, deleteDispatchLog, dismissAllDispatcherAlerts, dismissDispatcherAlert, getDispatcherDashboard, getDispatcherPayments, getDispatcherQueue, getFleetSnapshot, markDispatcherAlertRead, sendDriverAnnouncement, updateDispatcherProfile } from '../src/services/dispatcherService.js';
import {
  createManagedDriver,
  createManagedSchedule,
  deleteManagedDriver,
  deleteManagedSchedule,
  getManagedDrivers,
  getManagedSchedules,
  updateManagedSchedule,
} from '../src/services/dispatcherManagementService.js';
import { cancelAssignmentByDispatcher, changeDriverPassword, deleteDriverNotification, getDriverNotifications, getDriverOverview, markAllDriverNotificationsRead, markDriverNotificationRead, setGoOnTrip, startDriverTrip, submitOccupancy, updateDriverProfile } from '../src/services/driverService.js';
import {
  capturePaypalReservation,
  changePassengerPassword,
  createGcashReservation,
  createPaypalHostedReservation,
  createPaypalReservation,
  deletePassengerNotification,
  getPassengerBooking,
  getTripSeats,
  markAllPassengerNotificationsRead,
  markPassengerNotificationRead,
  processPaymongoWebhookEvent,
  releasePaypalReservation,
  reschedulePassengerBooking,
  searchGoaTrips,
  updatePassengerProfile,
} from '../src/services/passengerService.js';
import { getPublicDepartures, getPublicRoutes } from '../src/services/publicService.js';
import { AppError } from '../src/utils/AppError.js';
import { queueActionSchema } from '../src/validators/dispatcherValidators.js';
import { disconnectSeedClient, resetDemoData } from '../prisma/seed.js';
import { admitAcceptedGosoSchedulesForDay, evaluateGosoLoading, normalizeSavedQueue, operationalQueueStatuses, withRouteQueue } from '../src/services/queueSchedulingService.js';
import { manilaServiceDay, manilaServiceWeek } from '../src/services/driverSchedulePolicy.js';
import { createWeeklySchedule, deleteWeeklySchedule, listWeeklySchedules, materializeWeeklySchedules, updateWeeklySchedule } from '../src/services/weeklyScheduleService.js';
import { requestPasswordReset, resetPasswordWithCode } from '../src/services/authService.js';
import { createBackupDispatcher, getRouteDispatchers } from '../src/services/dispatcherAccountService.js';
import { getDemoState } from '../src/services/demoService.js';
import { createPayPalOrder } from '../src/services/paypalService.js';
import { verifyPaymongoWebhookSignature, type PaymongoWebhookEvent } from '../src/services/paymongoService.js';
import { getTayaWeeklySchedule, saveTayaWeeklySchedule, syncTayaDailyQueue } from '../src/services/tayaQueueService.js';

if (!process.env.UVGO_ISOLATED_TEST_DATABASE || new URL(process.env.DATABASE_URL!).pathname !== `/${process.env.UVGO_ISOLATED_TEST_DATABASE}`) {
  throw new Error('Use npm test: this suite resets fixtures and must run in its isolated test database.');
}

function latitudeAtDistanceKm(distanceKm: number) {
  return NCEBT.latitude + distanceKm / 111.32;
}

/** Passenger loading start, defaulting to 10 minutes before departure. */
function loadingAt(departureTime: string, leadMinutes = 10) {
  return new Date(new Date(departureTime).getTime() - leadMinutes * 60_000).toISOString();
}

async function recordReliableSequence(driverId: string, distancesKm: number[], startedAt = Date.now()) {
  let result: Awaited<ReturnType<typeof recordDriverLocation>> | null = null;
  let transitionResult: Awaited<ReturnType<typeof recordDriverLocation>> | null = null;
  for (const [index, distanceKm] of distancesKm.entries()) {
    result = await recordDriverLocation(
      driverId,
      latitudeAtDistanceKm(distanceKm),
      NCEBT.longitude,
      new Date(startedAt + index * TERMINAL_GEOFENCE.sampleMinIntervalMs),
      10,
      2,
    );
    if (result.transition !== 'none') transitionResult = result;
  }
  // With a one-reading geofence threshold, the meaningful transition can
  // happen before the final sample in a diagnostic sequence.
  return transitionResult ?? result;
}

async function resetIsolatedFixtures() {
  // Demo reset is normally unavailable with DEMO_MODE=false. This temporary
  // override applies only to the exact throwaway database guarded above.
  const originalDemoMode = process.env.DEMO_MODE;
  process.env.DEMO_MODE = 'true';
  try {
    await resetDemoData();
  } finally {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  }
}

beforeEach(resetIsolatedFixtures);

after(async () => {
  await resetIsolatedFixtures();
  await prisma.$disconnect();
  await disconnectSeedClient();
});

test('assignment response weeks roll from Monday through Sunday in Manila', () => {
  const week = manilaServiceWeek(new Date('2026-09-25T05:40:00.000Z'));
  assert.equal(week.start.toISOString(), '2026-09-20T16:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-09-27T16:00:00.000Z');
  assert.equal(week.startDate, '2026-09-21');
  assert.equal(week.endDate, '2026-09-27');
});

test('with demo mode off, simulation is blocked but the live dispatcher fleet remains available', { skip: process.env.DEMO_MODE !== 'false' }, async () => {
  await assert.rejects(getDemoState(RouteCode.GOA), (error: unknown) => error instanceof AppError && error.code === 'DEMO_MODE_DISABLED');
  const fleet = await getFleetSnapshot(RouteCode.GOA);
  assert.ok(fleet.vehicles.length > 0);
  assert.ok(fleet.terminal.activeZoneRadiusKm > 0);
  await setGoOnTrip('seed_user_driver_mario', true);
  const result = await recordDriverLocation('seed_user_driver_mario', latitudeAtDistanceKm(3), NCEBT.longitude, new Date(), 10);
  assert.notEqual(result.transition, 'disabled');
  await runDispatchEngine();
});

test('with demo mode off, integrated PayPal requires API credentials', { skip: process.env.DEMO_MODE !== 'false' || Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) }, async () => {
  await assert.rejects(createPayPalOrder('TEST-NONDEMO', 190), (error: unknown) => error instanceof AppError && error.code === 'PAYPAL_NOT_CONFIGURED');
});

test('public departure board exposes only queued vans without dispatcher statuses', async () => {
  const now = new Date();
  await prisma.queueEntry.update({
    where: { id: 'seed_queue_goa_1' },
    data: { scheduledLoadingTime: now },
  });
  await prisma.queueEntry.update({
    where: { id: 'seed_queue_goa_2' },
    data: { scheduledLoadingTime: new Date(now.getTime() + 30 * 60_000) },
  });
  const initial = await getPublicDepartures();
  assert.ok(initial.departures.some((departure) => departure.id === 'seed_queue_goa_1'));
  assert.ok(initial.departures.every((departure) => !Object.hasOwn(departure, 'status')));
  const tayaDepartures = initial.departures.filter((departure) => departure.protocol === 'Taya');
  assert.ok(tayaDepartures.length > 0);
  assert.ok(tayaDepartures.every((departure) => departure.departureTime === null));
  const publicRoutes = await getPublicRoutes();
  assert.equal(publicRoutes.routes.find((route) => route.protocol === 'Taya')?.nextDeparture, null);

  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { status: QueueStatus.DEPARTED } });
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_021' }, data: { status: VehicleStatus.ON_TRIP } });

  const updated = await getPublicDepartures();
  assert.equal(updated.departures.some((departure) => departure.id === 'seed_queue_goa_1'), false);
  assert.equal(updated.departures.some((departure) => departure.id === 'seed_queue_goa_2'), false);
  assert.ok(updated.departures.every((departure) => !Object.hasOwn(departure, 'status')));
});

test('Goa dispatch logs can be deleted only by their owning route', async () => {
  const logId = 'seed_dispatch_log_assignment';
  await assert.rejects(
    deleteDispatchLog(RouteCode.LEGAZPI, logId),
    (error: unknown) => error instanceof AppError && error.code === 'ROUTE_ACCESS_DENIED',
  );
  assert.ok(await prisma.dispatchLog.findUnique({ where: { id: logId } }));

  const response = await deleteDispatchLog(RouteCode.GOA, logId);
  assert.equal(response.logs.some((log) => log.id === logId), false);
  assert.equal(await prisma.dispatchLog.findUnique({ where: { id: logId } }), null);
  await assert.rejects(
    deleteDispatchLog(RouteCode.GOA, logId),
    (error: unknown) => error instanceof AppError && error.code === 'DISPATCH_LOG_NOT_FOUND',
  );
});

test('all dispatch logs can be deleted only for the signed-in dispatcher route', async () => {
  await prisma.dispatchLog.create({
    data: {
      id: 'test_legazpi_log_bulk_delete_scope',
      actorUserId: 'seed_user_dispatcher_legazpi',
      action: DispatchAction.QUEUE_OVERRIDDEN,
      targetId: 'seed_queue_legazpi_1',
      route: RouteCode.LEGAZPI,
      reason: 'Route-isolation fixture for bulk log deletion.',
    },
  });
  const goaCount = await prisma.dispatchLog.count({ where: { route: RouteCode.GOA } });
  const legazpiIds = (await prisma.dispatchLog.findMany({
    where: { route: RouteCode.LEGAZPI },
    select: { id: true },
    orderBy: { id: 'asc' },
  })).map((log) => log.id);
  assert.ok(goaCount > 0, 'The Goa route should have dispatch logs to delete.');
  assert.ok(legazpiIds.length > 0, 'The Legazpi route should have dispatch logs that must remain untouched.');

  const response = await deleteAllDispatchLogs(RouteCode.GOA);
  assert.equal(response.deleted, goaCount);
  assert.deepEqual(response.logs, []);
  assert.equal(await prisma.dispatchLog.count({ where: { route: RouteCode.GOA } }), 0);
  assert.deepEqual(
    (await prisma.dispatchLog.findMany({ where: { route: RouteCode.LEGAZPI }, select: { id: true }, orderBy: { id: 'asc' } })).map((log) => log.id),
    legazpiIds,
  );
});

test('weekly Goa schedules repeat idempotently, stay editable, and allow multiple driver schedules per day', async () => {
  const now = new Date('2026-09-23T00:00:00.000Z');
  const input = {
    weekday: 7,
    boardingTime: '08:00',
    departureTime: '08:30',
    vehicleId: 'seed_vehicle_021',
    fareAmount: DEFAULT_GOA_FARE,
    isActive: true,
  };
  const templateId = await createWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, input, now);
  const generated = await prisma.trip.findMany({ where: { weeklyScheduleId: templateId }, orderBy: { weeklyOccurrenceDate: 'asc' } });
  assert.ok(generated.length >= 8);
  assert.ok(generated.every((trip) => {
    const manilaDay = new Date(trip.scheduledOrTriggeredTime.getTime() + 8 * 60 * 60_000);
    return manilaDay.getUTCDay() === 0 && manilaDay.getUTCHours() === 8 && manilaDay.getUTCMinutes() === 30;
  }));

  await materializeWeeklySchedules(now, 'seed_user_dispatcher');
  assert.equal(await prisma.trip.count({ where: { weeklyScheduleId: templateId } }), generated.length);
  const secondTemplateId = await createWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, {
    ...input,
    boardingTime: '08:30',
    departureTime: '09:00',
  }, now);
  assert.ok(await prisma.weeklySchedule.findUnique({ where: { id: secondTemplateId } }));
  assert.ok(await prisma.trip.count({ where: { weeklyScheduleId: secondTemplateId } }) >= 8);

  const updated = { ...input, weekday: 1, boardingTime: '09:00', departureTime: '09:30' };
  await updateWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, updated, now);
  const moved = await prisma.trip.findMany({ where: { weeklyScheduleId: templateId } });
  assert.ok(moved.length >= 8);
  assert.ok(moved.every((trip) => {
    const manilaDay = new Date(trip.scheduledOrTriggeredTime.getTime() + 8 * 60 * 60_000);
    return manilaDay.getUTCDay() === 1 && manilaDay.getUTCHours() === 9 && manilaDay.getUTCMinutes() === 30;
  }));

  const bookedOccurrence = moved[0]!;
  await prisma.reservation.create({ data: {
    reference: 'UVGO-WEEKLY-TEST', passengerId: 'seed_user_passenger_ana', tripId: bookedOccurrence.id,
    seatCount: 1, fareAmount: DEFAULT_GOA_FARE, status: ReservationStatus.CONFIRMED,
  } });
  const changedTime = { ...updated, boardingTime: '10:00', departureTime: '10:30' };
  await updateWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, changedTime, now);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: bookedOccurrence.id } })).scheduledOrTriggeredTime.getTime(), bookedOccurrence.scheduledOrTriggeredTime.getTime());
  const changedOccurrences = await prisma.trip.findMany({ where: { weeklyScheduleId: templateId, id: { not: bookedOccurrence.id } } });
  assert.ok(changedOccurrences.every((trip) => new Date(trip.scheduledOrTriggeredTime.getTime() + 8 * 60 * 60_000).getUTCHours() === 10));

  await updateWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, { ...changedTime, isActive: false }, now);
  assert.equal(await prisma.trip.count({ where: { weeklyScheduleId: templateId } }), 1);
  assert.equal((await listWeeklySchedules('seed_user_dispatcher')).find((template) => template.id === templateId)?.isActive, false);

  await updateWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, changedTime, now);
  assert.ok(await prisma.trip.count({ where: { weeklyScheduleId: templateId } }) >= 8);

  await deleteWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, now);
  assert.equal(await prisma.weeklySchedule.findUnique({ where: { id: templateId } }), null);
  const preservedBookedOccurrence = await prisma.trip.findUniqueOrThrow({
    where: { id: bookedOccurrence.id },
    include: { assignments: true },
  });
  assert.equal(preservedBookedOccurrence.status, TripStatus.ASSIGNING);
  assert.equal(preservedBookedOccurrence.awaitingQueueReplacement, true);
  assert.equal(
    preservedBookedOccurrence.assignments.some((assignment) => ['PENDING', 'ACCEPTED'].includes(assignment.status)),
    false,
  );
  assert.equal(
    preservedBookedOccurrence.assignments.some((assignment) => assignment.status === 'CANCELLED'),
    true,
  );

  // The retained passenger departure does not prevent the driver from
  // receiving another recurring departure on the same weekday.
  const replacementTemplateId = await createWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, {
    ...changedTime,
    boardingTime: '11:00',
    departureTime: '11:30',
  }, now);
  assert.ok(await prisma.weeklySchedule.findUnique({ where: { id: replacementTemplateId } }));
});

test('past Goa departures leave schedule management without deleting trip history', async () => {
  const futureDeparture = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const createdPayload = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(futureDeparture),
    departureTime: futureDeparture,
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
  });
  const created = createdPayload.schedules.find((schedule) => schedule.departureTime === futureDeparture);
  assert.ok(created);

  const pastDeparture = new Date(Date.now() - 60_000);
  await prisma.trip.update({
    where: { id: created!.id },
    data: {
      boardingStartTime: new Date(pastDeparture.getTime() - 10 * 60_000),
      scheduledOrTriggeredTime: pastDeparture,
    },
  });

  const refreshed = await getManagedSchedules('seed_user_dispatcher', RouteCode.GOA);
  assert.equal(refreshed.schedules.some((schedule) => schedule.id === created!.id), false);
  assert.ok(await prisma.trip.findUnique({ where: { id: created!.id } }));
});

test('driver overview exposes every active and upcoming assignment in departure order', async () => {
  const departureTimes = [20, 21].map((daysAhead) => new Date(Date.now() + daysAhead * 24 * 60 * 60_000).toISOString());
  const createdIds: string[] = [];
  for (const departureTime of departureTimes) {
    const result = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
      boardingStartTime: loadingAt(departureTime, 20),
      departureTime,
      vehicleId: 'seed_vehicle_033',
      fareAmount: DEFAULT_GOA_FARE,
    });
    const created = result.schedules.find((schedule) => schedule.departureTime === departureTime);
    assert.ok(created);
    createdIds.push(created.id);
  }

  const overview = await getDriverOverview('seed_user_driver_rodel');
  const displayed = overview.assignments.filter((assignment) => createdIds.includes(assignment.trip.id));
  assert.deepEqual(displayed.map((assignment) => assignment.trip.id), createdIds);
  assert.deepEqual(displayed.map((assignment) => assignment.trip.departureTime), departureTimes);
  assert.ok(displayed.every((assignment) => assignment.status === 'accepted'));
  assert.ok(displayed.every((assignment) => assignment.trip.boardingStartTime < assignment.trip.departureTime));
});

for (const route of [RouteCode.GOA, RouteCode.LEGAZPI]) {
  test(`manual dispatch: ${route} immediately records departure, preserves bookings and advances the queue once`, async () => {
    const goa = route === RouteCode.GOA;
    const actor = goa ? 'seed_user_dispatcher' : 'seed_user_dispatcher_legazpi';
    const queueId = goa ? 'seed_queue_goa_1' : 'seed_queue_legazpi_1';
    const tripId = goa ? 'seed_trip_goa_morning' : 'seed_trip_legazpi_loading';
    const vehicleId = goa ? 'seed_vehicle_033' : 'seed_vehicle_019';
    if (goa) await prisma.tripAssignment.update({ where: { id: 'seed_assignment_goa' }, data: { status: 'ACCEPTED' } });
    const before = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: { reservations: { include: { seats: true, payments: true } } } });
    const outcomes = await Promise.allSettled([
      applyQueueAction(actor, route, queueId, { action: 'dispatch', reason: 'Dispatcher observed departure.' }),
      applyQueueAction(actor, route, queueId, { action: 'dispatch', reason: 'Duplicate click.' }),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
    const afterTrip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: { reservations: { include: { seats: true, payments: true } } } });
    assert.equal(afterTrip.status, TripStatus.DEPARTED);
    assert.ok(afterTrip.departedAt);
    assert.deepEqual(afterTrip.scheduledOrTriggeredTime, before.scheduledOrTriggeredTime);
    assert.deepEqual(afterTrip.boardingStartTime, before.boardingStartTime);
    assert.deepEqual(afterTrip.reservations, before.reservations);
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    assert.equal(vehicle.status, VehicleStatus.ON_TRIP);
    assert.equal(vehicle.insideTerminalZone, false);
    assert.equal(vehicle.departureAuthorizedAt, null);
    assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueId } })).status, QueueStatus.DEPARTED);
    const publicBoard = await getPublicDepartures();
    assert.equal(publicBoard.departures.some((departure) => departure.id === queueId), false);
    const next = await prisma.queueEntry.findUniqueOrThrow({ where: { id: goa ? 'seed_queue_goa_2' : 'seed_queue_legazpi_2' } });
    assert.equal(next.position, 1);
    const logs = await prisma.dispatchLog.findMany({ where: { targetId: tripId, action: 'TRIP_DEPARTED' } });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorUserId, actor);
    assert.equal((logs[0].metadata as { manualQueueDispatch: boolean }).manualQueueDispatch, true);
    if (goa) {
      assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_goa' } })).status, 'ACCEPTED');
      await recordReliableSequence('seed_user_driver_rodel', [0.12, 0.14, 0.16]);
      assert.equal(await prisma.dispatchLog.count({ where: { targetId: tripId, action: 'TRIP_DEPARTED' } }), 1);
    }
  });

  test(`dispatcher passengers: ${route} saves actual onboard totals with the dispatcher as author`, async () => {
    const goa = route === RouteCode.GOA;
    const actor = goa ? 'seed_user_dispatcher' : 'seed_user_dispatcher_legazpi';
    const queueId = goa ? 'seed_queue_goa_1' : 'seed_queue_legazpi_1';
    const tripId = goa ? 'seed_trip_goa_morning' : 'seed_trip_legazpi_loading';
    await prisma.passengerCount.deleteMany({ where: { tripId } });
    await prisma.queueEntry.update({ where: { id: queueId }, data: { status: QueueStatus.ACCEPTED, ...(goa ? { scheduledLoadingTime: new Date() } : {}) } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: goa ? 'seed_vehicle_033' : 'seed_vehicle_019' } });
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { insideTerminalZone: true, latestDistanceKm: 0.02, latestLocationObservedAt: null } });
    const bookings = await prisma.reservation.findMany({ where: { tripId }, include: { seats: true, payments: true } });
    await assert.rejects(applyQueueAction(actor, route, queueId, { action: 'update_passengers', passengerCount: vehicle.capacity + 1, reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'OCCUPANCY_EXCEEDS_CAPACITY');
    const result = await applyQueueAction(actor, route, queueId, { action: 'update_passengers', passengerCount: vehicle.capacity, reason: 'Counted at boarding.' });
    const count = await prisma.passengerCount.findFirstOrThrow({ where: { tripId } });
    assert.equal(count.submittedByDriverId, actor);
    assert.equal(count.count, vehicle.capacity);
    assert.deepEqual(await prisma.reservation.findMany({ where: { tripId }, include: { seats: true, payments: true } }), bookings);
    assert.equal(await prisma.passengerCount.count({ where: { tripId } }), 1);
    if (goa) {
      assert.equal(result.entries.find((entry) => entry.id === queueId)?.occupancy, vehicle.capacity);
      await applyQueueAction(actor, route, queueId, { action: 'dispatch', reason: '' });
    } else {
      assert.equal(result.entries.some((entry) => entry.id === queueId), false);
      assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status, TripStatus.DEPARTED);
      assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueId } })).status, QueueStatus.DEPARTED);
      assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_legazpi_2' } })).position, 1);
    }
    await assert.rejects(applyQueueAction(actor, route, queueId, { action: 'update_passengers', passengerCount: 0, reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'QUEUE_ENTRY_NOT_ACTIVE');
  });
}

test('manual dispatch: the active assignment remains historical and cannot revive a departed trip', async () => {
  await prisma.trip.update({ where: { id: 'seed_trip_goa_morning' }, data: { scheduledOrTriggeredTime: new Date() } });
  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_1', { action: 'dispatch', reason: '' });
  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_goa' } })).status, AssignmentStatus.ACCEPTED);
  await runDispatchEngine('seed_user_dispatcher');
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).status, TripStatus.DEPARTED);
});

test('manual dispatch: a van without a trip gets one departed record and repeat requests cannot create another', async () => {
  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'dispatch', reason: '' });
  const trips = await prisma.trip.findMany({ where: { vehicleId: 'seed_vehicle_021' } });
  assert.equal(trips.length, 1);
  assert.equal(trips[0].status, TripStatus.DEPARTED);
  await assert.rejects(applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'dispatch', reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'QUEUE_ENTRY_NOT_ACTIVE');
  assert.equal(await prisma.trip.count({ where: { vehicleId: 'seed_vehicle_021' } }), 1);
});

test('dispatcher queue changes reject cross-route writes, invalid passenger counts, and non-head passenger updates', async () => {
  for (const action of ['dispatch', 'update_passengers'] as const) {
    await assert.rejects(applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_legazpi_1', { action, passengerCount: 1, reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'ROUTE_ACCESS_DENIED');
  }
  for (const count of [undefined, -1, 1.5, Number.NaN]) {
    assert.equal(queueActionSchema.safeParse({ action: 'update_passengers', passengerCount: count }).success, false);
    await assert.rejects(applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_1', { action: 'update_passengers', passengerCount: count, reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'INVALID_PASSENGER_COUNT');
  }
  await assert.rejects(applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'update_passengers', passengerCount: 1, reason: '' }), (error: unknown) => error instanceof AppError && error.code === 'QUEUE_HEAD_REQUIRED');
});

test('1. the NCEBT geofence exposes its active and terminal-arrival radii', async () => {
  assert.ok(distanceFromNcebtKm(NCEBT.latitude, NCEBT.longitude) < 0.01);
  assert.ok(distanceFromNcebtKm(NCEBT.latitude + 0.03, NCEBT.longitude) < 5);
  assert.ok(distanceFromNcebtKm(NCEBT.latitude + 0.06, NCEBT.longitude) > 5);
  const fleet = await getFleetSnapshot(RouteCode.GOA);
  assert.equal(fleet.terminal.activeZoneRadiusKm, NCEBT.activeZoneRadiusKm);
  assert.equal(fleet.terminal.terminalArrivalRadiusKm, TERMINAL_GEOFENCE.arrivalRadiusKm);
});

test('2. Goso assigns the earliest eligible Goa queue entry', async () => {
  const now = new Date();
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_day_two' },
    data: { scheduledOrTriggeredTime: new Date(now.getTime() + 5 * 60_000), status: TripStatus.SCHEDULED, createdByDispatcherId: null },
  });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 20 * 60_000) } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 10 * 60_000) } });

  await runDispatchEngine('seed_user_dispatcher', now);
  const assignment = await prisma.tripAssignment.findFirst({ where: { tripId: 'seed_trip_goa_day_two' } });
  assert.equal(assignment?.queueEntryId, 'seed_queue_goa_1');
});

test('3. Taya readiness respects the dispatcher-planned order instead of arrival order', async () => {
  const now = new Date();
  // Demo counts use fixed clock times and may otherwise be later than `now`
  // when the suite runs in the morning.
  await prisma.passengerCount.deleteMany({ where: { tripId: 'seed_trip_legazpi_loading' } });
  await prisma.vehicle.updateMany({ where: { id: { in: ['seed_vehicle_019', 'seed_vehicle_005'] } }, data: { status: VehicleStatus.LOADING } });
  // Position 2 arrived first, but Taya must preserve the saved daily order.
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_1' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 10 * 60_000) } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_2' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 20 * 60_000) } });
  await prisma.trip.update({ where: { id: 'seed_trip_legazpi_loading' }, data: { status: TripStatus.BOARDING } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_019', tripId: 'seed_trip_legazpi_loading', count: VAN_PASSENGER_CAPACITY, submittedByDriverId: 'seed_user_driver_pedro' } });
  const secondTrip = await prisma.trip.create({ data: { vehicleId: 'seed_vehicle_005', route: 'LEGAZPI', scheduledOrTriggeredTime: now, status: TripStatus.BOARDING, fareAmount: 250 } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_005', tripId: secondTrip.id, count: VAN_PASSENGER_CAPACITY, submittedByDriverId: 'seed_user_driver_noel' } });

  const result = await recalculateTayaReadiness();
  assert.equal(result.readyEntryId, 'seed_queue_legazpi_1');
  assert.equal((await prisma.queueEntry.findUnique({ where: { id: 'seed_queue_legazpi_2' } }))?.status, QueueStatus.WAITING);
});

test('4. Taya does not become ready below 100% occupancy', async () => {
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_019' }, data: { status: VehicleStatus.LOADING } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_1' }, data: { status: QueueStatus.WAITING } });
  await prisma.trip.update({ where: { id: 'seed_trip_legazpi_loading' }, data: { status: TripStatus.BOARDING } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_019', tripId: 'seed_trip_legazpi_loading', count: VAN_PASSENGER_CAPACITY - 1, submittedByDriverId: 'seed_user_driver_pedro' } });

  const result = await recalculateTayaReadiness();
  assert.equal(result.readyEntryId, null);
  assert.equal((await prisma.queueEntry.findUnique({ where: { id: 'seed_queue_legazpi_1' } }))?.status, QueueStatus.WAITING);
});

test('4a. dispatcher Taya weekly schedules define the daily sequence without publishing times', async () => {
  const serviceDate = manilaServiceDay(new Date()).date;
  const jsWeekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  const weekday = jsWeekday === 0 ? 7 : jsWeekday;
  const saved = await saveTayaWeeklySchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, {
    weekday,
    vehicleIds: ['seed_vehicle_005', 'seed_vehicle_019'],
  });
  assert.deepEqual(saved.entries.filter((entry) => entry.weekday === weekday).map((entry) => entry.vehicle.id), ['seed_vehicle_005', 'seed_vehicle_019']);

  const queue = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.deepEqual(queue.entries.map((entry) => entry.vanId), ['VAN-005', 'VAN-019']);
  assert.deepEqual(queue.entries.map((entry) => entry.position), [1, 2]);

  const overview = await getDriverOverview('seed_user_driver_noel');
  assert.equal(overview.todayQueueStatus.policy, 'TAYA');
  assert.equal(overview.todayQueueStatus.queuePosition, 1);
  assert.equal(overview.todayQueueStatus.scheduledLoadingTime, null);
  assert.equal(overview.todayQueueStatus.scheduledDepartureTime, null);
});

test('4b. a manual Taya reorder persists in the saved daily sequence', async () => {
  await applyQueueAction('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, 'seed_queue_legazpi_2', {
    action: 'override',
    newPosition: 1,
    reason: 'Test dispatcher-defined Taya order.',
  });
  const serviceDate = manilaServiceDay(new Date()).date;
  await getTayaWeeklySchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI);
  const dailySchedule = await prisma.tayaDailySchedule.findMany({
    where: { serviceDate: new Date(`${serviceDate}T00:00:00.000Z`) },
    orderBy: { position: 'asc' },
  });
  assert.deepEqual(dailySchedule.map((entry) => entry.vehicleId), ['seed_vehicle_005', 'seed_vehicle_019']);
  const queue = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.deepEqual(queue.entries.map((entry) => entry.vanId), ['VAN-005', 'VAN-019']);
});

test('4c. a prior-day Taya trip cannot block today\'s saved queue sequence', async () => {
  const now = new Date();
  const serviceDay = manilaServiceDay(now);
  const jsWeekday = new Date(`${serviceDay.date}T00:00:00.000Z`).getUTCDay();
  const weekday = jsWeekday === 0 ? 7 : jsWeekday;
  const oldDeparture = new Date(serviceDay.start.getTime() - 60 * 60_000);

  await prisma.queueEntry.updateMany({
    where: { vehicleId: 'seed_vehicle_005' },
    data: { status: QueueStatus.DEPARTED },
  });
  await prisma.trip.updateMany({
    where: { vehicleId: 'seed_vehicle_005' },
    data: { status: TripStatus.DEPARTED, departedAt: oldDeparture },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: { status: VehicleStatus.ON_TRIP, insideTerminalZone: false },
  });

  await saveTayaWeeklySchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, {
    weekday,
    vehicleIds: ['seed_vehicle_005'],
  }, now);
  await syncTayaDailyQueue(now);

  const daily = await prisma.tayaDailySchedule.findFirstOrThrow({
    where: {
      serviceDate: new Date(`${serviceDay.date}T00:00:00.000Z`),
      vehicleId: 'seed_vehicle_005',
    },
    include: { queueEntry: true, trip: { include: { assignments: true } }, vehicle: true },
  });
  assert.equal(daily.vehicle.status, VehicleStatus.OUTSIDE_ZONE);
  assert.equal(daily.queueEntry?.status, QueueStatus.ACCEPTED);
  assert.equal(daily.trip?.status, TripStatus.ASSIGNED);
  assert.equal(daily.trip?.assignments[0]?.status, AssignmentStatus.ACCEPTED);
  assert.equal((await getDispatcherQueue(RouteCode.LEGAZPI)).entries.some((entry) => entry.vanId === 'VAN-005'), true);
});

test('4ca. Taya displays only today\'s queue while preserving yesterday\'s queue records unchanged', async () => {
  const now = new Date();
  const serviceDay = manilaServiceDay(now);
  const serviceDate = new Date(`${serviceDay.date}T00:00:00.000Z`);
  const yesterdayDate = new Date(serviceDate.getTime() - 24 * 60 * 60_000);
  const yesterdayTime = new Date(serviceDay.start.getTime() - 60 * 60_000);
  const historicalQueueIds = ['seed_queue_legazpi_1', 'seed_queue_legazpi_2'];

  // Simulate crossing midnight with yesterday's operational rows still active.
  // The dated daily plans own those rows, so the records do not need to be
  // closed, deleted, or rewritten merely to remove them from today's view.
  await prisma.tayaDailySchedule.updateMany({
    where: { serviceDate },
    data: { serviceDate: yesterdayDate },
  });
  await prisma.trip.update({
    where: { id: 'seed_trip_legazpi_loading' },
    data: { scheduledOrTriggeredTime: yesterdayTime, boardingStartTime: yesterdayTime },
  });
  const before = await prisma.queueEntry.findMany({
    where: { id: { in: historicalQueueIds } },
    orderBy: { id: 'asc' },
    select: { id: true, position: true, status: true, arrivalTimestamp: true, lateAt: true, createdAt: true, updatedAt: true },
  });
  const oldAssignmentBefore = await prisma.tripAssignment.findUniqueOrThrow({
    where: { id: 'seed_assignment_legazpi' },
    select: { status: true, queueEntryId: true, respondedAt: true },
  });

  const queue = await getDispatcherQueue(RouteCode.LEGAZPI);

  assert.equal(queue.entries.some((entry) => historicalQueueIds.includes(entry.id)), false);
  assert.deepEqual(queue.entries.map((entry) => entry.vanId), ['VAN-019', 'VAN-005']);
  assert.deepEqual(queue.entries.map((entry) => entry.position), [1, 2]);
  const currentPlans = await prisma.tayaDailySchedule.findMany({
    where: { serviceDate },
    orderBy: { position: 'asc' },
    include: { queueEntry: true },
  });
  assert.equal(currentPlans.length, 2);
  assert.equal(currentPlans.every((plan) => plan.queueEntry && !historicalQueueIds.includes(plan.queueEntry.id)), true);

  const after = await prisma.queueEntry.findMany({
    where: { id: { in: historicalQueueIds } },
    orderBy: { id: 'asc' },
    select: { id: true, position: true, status: true, arrivalTimestamp: true, lateAt: true, createdAt: true, updatedAt: true },
  });
  assert.deepEqual(after, before);
  assert.deepEqual(await prisma.tripAssignment.findUniqueOrThrow({
    where: { id: 'seed_assignment_legazpi' },
    select: { status: true, queueEntryId: true, respondedAt: true },
  }), oldAssignmentBefore);
  assert.equal(await prisma.tayaDailySchedule.count({ where: { serviceDate: yesterdayDate } }), 2);
});

test('4d. Taya marks only the absent immediate follower late when the preceding van is dispatched', async () => {
  const now = new Date();
  const serviceDate = manilaServiceDay(now).date;
  const jsWeekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  const weekday = jsWeekday === 0 ? 7 : jsWeekday;
  const thirdDriver = await prisma.user.create({
    data: {
      email: 'taya-third@example.test',
      name: 'Taya Driver C',
      passwordHash: 'test-only',
      role: UserRole.DRIVER,
      managedByDispatcherId: 'seed_user_dispatcher_legazpi',
    },
  });
  const thirdVehicle = await prisma.vehicle.create({
    data: {
      vanId: 'TAYA-C',
      plateNo: 'TAYA-C',
      route: RouteCode.LEGAZPI,
      protocol: 'TAYA',
      assignedDriverId: thirdDriver.id,
      managedByDispatcherId: 'seed_user_dispatcher_legazpi',
      capacity: VAN_PASSENGER_CAPACITY,
      status: VehicleStatus.AT_TERMINAL,
      insideTerminalZone: true,
      latestDistanceKm: 0.02,
    },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_019' },
    data: { status: VehicleStatus.LOADING, insideTerminalZone: true, latestDistanceKm: 0.02 },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: { status: VehicleStatus.OUTSIDE_ZONE, insideTerminalZone: false, latestDistanceKm: 0.2 },
  });

  await saveTayaWeeklySchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, {
    weekday,
    vehicleIds: ['seed_vehicle_019', 'seed_vehicle_005', thirdVehicle.id],
  }, now);
  const before = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.deepEqual(before.entries.map((entry) => entry.vanId), ['VAN-019', 'VAN-005', 'TAYA-C']);
  assert.equal(before.entries[1]?.isLate, false);

  // Taya has no clock-based late trigger: an engine tick alone changes nothing.
  await runDispatchEngine('seed_user_dispatcher_legazpi', now, RouteCode.LEGAZPI);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: before.entries[1]!.id } })).lateAt, null);

  await applyQueueAction('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, before.entries[0]!.id, {
    action: 'dispatch',
    reason: 'Driver A departed.',
  });

  const after = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.deepEqual(after.entries.map((entry) => entry.vanId), ['TAYA-C', 'VAN-005']);
  assert.deepEqual(after.entries.map((entry) => entry.position), [1, 2]);
  assert.equal(after.entries[0]?.isLate, false);
  assert.equal(after.entries[1]?.isLate, true);
  assert.ok(after.entries[1]?.lateAt);

  const rotationLog = await prisma.dispatchLog.findFirstOrThrow({
    where: { targetId: before.entries[1]!.id, action: DispatchAction.MOVED_TO_LAST },
    orderBy: { timestamp: 'desc' },
  });
  assert.equal((rotationLog.metadata as { trigger?: string } | null)?.trigger, 'taya_preceding_vehicle_dispatched');
  const notification = await prisma.notification.findFirst({
    where: { userId: 'seed_user_driver_noel', type: 'QUEUE', message: { contains: 'marked Late' } },
  });
  assert.ok(notification);

  // The rotation is written back to the daily Taya plan and survives a sync.
  await syncTayaDailyQueue(now);
  const persisted = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.deepEqual(persisted.entries.map((entry) => entry.vanId), ['TAYA-C', 'VAN-005']);
  assert.equal(persisted.entries[1]?.isLate, true);
});

test('4e. Taya keeps the immediate follower in place when that driver is inside the terminal geofence', async () => {
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_019' },
    data: { status: VehicleStatus.LOADING, insideTerminalZone: true, latestDistanceKm: 0.02 },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: { status: VehicleStatus.AT_TERMINAL, insideTerminalZone: true, latestDistanceKm: 0.02 },
  });
  const before = await getDispatcherQueue(RouteCode.LEGAZPI);

  await applyQueueAction('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, before.entries[0]!.id, {
    action: 'dispatch',
    reason: 'Driver A departed.',
  });

  const follower = (await getDispatcherQueue(RouteCode.LEGAZPI)).entries[0];
  assert.equal(follower?.vanId, 'VAN-005');
  assert.equal(follower?.position, 1);
  assert.equal(follower?.isLate, false);
  assert.equal(follower?.lateAt, null);
  assert.equal(await prisma.dispatchLog.count({
    where: { targetId: follower!.id, action: DispatchAction.MOVED_TO_LAST },
  }), 0);
});

test('5. scheduled assignments are active without driver approval', async () => {
  const assignment = await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_goa' } });
  assert.equal(assignment.status, AssignmentStatus.ACCEPTED);
  assert.ok(assignment.respondedAt);
  const overview = await getDriverOverview('seed_user_driver_rodel');
  assert.equal(overview.assignments.find((item) => item.id === assignment.id)?.status, 'accepted');
  assert.equal(overview.assignments.some((item) => item.status === 'pending'), false);
});

test('6. dispatcher queue override creates an audit log', async () => {
  const input = queueActionSchema.parse({ action: 'override', newPosition: 1 });
  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', input);
  const log = await prisma.dispatchLog.findFirst({ where: { targetId: 'seed_queue_goa_2', action: 'QUEUE_OVERRIDDEN' }, orderBy: { timestamp: 'desc' } });
  assert.equal(log?.reason, null);
  assert.equal((log?.metadata as { newPosition?: number } | null)?.newPosition, 1);
});

test('7. Legazpi reservations are rejected', async () => {
  await assert.rejects(
    createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_legazpi_loading', seats: [1], contact: '09170000001', gcashReference: 'GCASH-GOA-ONLY', receiptImageKey: 'test.png', receiptMimeType: 'image/png' }),
    (error: unknown) => error instanceof AppError && error.code === 'GOA_ONLY',
  );
});

test('8. a Goa reservation can be created', async () => {
  const booking = await createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [1], contact: '09170000001', receiptImageKey: 'test.png', receiptMimeType: 'image/png' });
  assert.equal(booking.route, 'Goa');
  assert.deepEqual(booking.seats, [1]);
  assert.equal(booking.payment?.transactionReference, null);
});

test('8a. passenger notification actions are scoped to the signed-in passenger', async () => {
  const notification = await prisma.notification.findUniqueOrThrow({ where: { id: 'seed_notification_passenger' } });

  await assert.rejects(
    markPassengerNotificationRead('seed_user_passenger_maria', notification.id),
    (error: unknown) => error instanceof AppError && error.code === 'NOTIFICATION_NOT_FOUND',
  );
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).isRead, false);

  await markPassengerNotificationRead('seed_user_passenger_ana', notification.id);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).isRead, true);

  await prisma.notification.createMany({ data: [
    { id: 'test_passenger_notice_1', userId: 'seed_user_passenger_ana', type: 'SYSTEM', message: 'First unread notice.' },
    { id: 'test_passenger_notice_2', userId: 'seed_user_passenger_ana', type: 'SYSTEM', message: 'Second unread notice.' },
    { id: 'test_other_passenger_notice', userId: 'seed_user_passenger_maria', type: 'SYSTEM', message: 'Another passenger notice.' },
  ] });
  assert.equal(await markAllPassengerNotificationsRead('seed_user_passenger_ana'), 2);
  assert.equal(await prisma.notification.count({ where: { userId: 'seed_user_passenger_ana', isRead: false } }), 0);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: 'test_other_passenger_notice' } })).isRead, false);

  await assert.rejects(
    deletePassengerNotification('seed_user_passenger_maria', notification.id),
    (error: unknown) => error instanceof AppError && error.code === 'NOTIFICATION_NOT_FOUND',
  );
  await deletePassengerNotification('seed_user_passenger_ana', notification.id);
  assert.equal(await prisma.notification.findUnique({ where: { id: notification.id } }), null);
});

test('8aa. dispatcher alert read state is persistent and scoped to the dispatcher route', async () => {
  const before = await getDispatcherDashboard(RouteCode.GOA, 'seed_user_dispatcher');
  const alert = before.alerts.find((item) => !item.isRead);
  assert.ok(alert, 'The Goa demo dashboard should have an active unread alert.');

  await assert.rejects(
    markDispatcherAlertRead('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, alert.id),
    (error: unknown) => error instanceof AppError && error.code === 'ALERT_NOT_FOUND',
  );

  const after = await markDispatcherAlertRead('seed_user_dispatcher', RouteCode.GOA, alert.id);
  assert.equal(after.alerts.find((item) => item.id === alert.id)?.isRead, true);
  assert.equal(await prisma.dispatcherAlertRead.count({ where: { userId: 'seed_user_dispatcher', alertKey: alert.id } }), 1);
});

test('8ab. drivers can delete only their own notifications and dispatchers can dismiss only their route alerts', async () => {
  const driverNotification = await prisma.notification.create({
    data: { id: 'test_driver_notification_delete', userId: 'seed_user_driver_rodel', type: 'SYSTEM', message: 'Driver-only notification.' },
  });
  await assert.rejects(
    markDriverNotificationRead('seed_user_driver_mario', driverNotification.id),
    (error: unknown) => error instanceof AppError && error.code === 'NOTIFICATION_NOT_FOUND',
  );
  await markDriverNotificationRead('seed_user_driver_rodel', driverNotification.id);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: driverNotification.id } })).isRead, true);

  await prisma.notification.create({
    data: { id: 'test_driver_notification_unread', userId: 'seed_user_driver_rodel', type: 'SYSTEM', message: 'Another driver notification.' },
  });
  assert.equal((await getDriverNotifications('seed_user_driver_rodel')).some((item) => item.id === 'test_driver_notification_unread'), true);
  assert.equal(await markAllDriverNotificationsRead('seed_user_driver_rodel'), 1);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: 'test_driver_notification_unread' } })).isRead, true);

  await assert.rejects(
    deleteDriverNotification('seed_user_driver_mario', driverNotification.id),
    (error: unknown) => error instanceof AppError && error.code === 'NOTIFICATION_NOT_FOUND',
  );
  await deleteDriverNotification('seed_user_driver_rodel', driverNotification.id);
  assert.equal(await prisma.notification.findUnique({ where: { id: driverNotification.id } }), null);

  await prisma.vehicle.update({ where: { id: 'seed_vehicle_021' }, data: { status: VehicleStatus.DELAYED } });
  const dashboard = await getDispatcherDashboard(RouteCode.GOA, 'seed_user_dispatcher');
  const alert = dashboard.alerts.find((item) => item.id === 'vehicle-seed_vehicle_021');
  assert.ok(alert, 'The Goa dashboard should have a route-specific alert to dismiss.');
  await assert.rejects(
    dismissDispatcherAlert('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, alert.id),
    (error: unknown) => error instanceof AppError && error.code === 'ALERT_NOT_FOUND',
  );
  const after = await dismissDispatcherAlert('seed_user_dispatcher', RouteCode.GOA, alert.id);
  assert.equal(after.alerts.some((item) => item.id === alert.id), false);
  const receipt = await prisma.dispatcherAlertRead.findUnique({ where: { userId_alertKey: { userId: 'seed_user_dispatcher', alertKey: alert.id } } });
  assert.ok(receipt?.dismissedAt);
});

test('8ac. a dispatcher can delete all active notifications without affecting another dispatcher', async () => {
  const goaBefore = await getDispatcherDashboard(RouteCode.GOA, 'seed_user_dispatcher');
  const legazpiBefore = await getDispatcherDashboard(RouteCode.LEGAZPI, 'seed_user_dispatcher_legazpi');
  assert.ok(goaBefore.alerts.length > 0, 'The Goa dispatcher should have active alerts to delete.');
  assert.ok(legazpiBefore.alerts.length > 0, 'The Legazpi dispatcher should have an alert that must remain untouched.');

  const goaAfter = await dismissAllDispatcherAlerts('seed_user_dispatcher', RouteCode.GOA);
  assert.equal(goaAfter.alerts.length, 0);
  for (const alert of goaBefore.alerts) {
    const receipt = await prisma.dispatcherAlertRead.findUnique({
      where: { userId_alertKey: { userId: 'seed_user_dispatcher', alertKey: alert.id } },
    });
    assert.ok(receipt?.dismissedAt, `${alert.id} should be dismissed for the Goa dispatcher.`);
  }

  const legazpiAfter = await getDispatcherDashboard(RouteCode.LEGAZPI, 'seed_user_dispatcher_legazpi');
  assert.deepEqual(legazpiAfter.alerts.map((alert) => alert.id), legazpiBefore.alerts.map((alert) => alert.id));
  assert.equal(await prisma.dispatcherAlertRead.count({ where: { userId: 'seed_user_dispatcher_legazpi', dismissedAt: { not: null } } }), 0);
});

test('8b. passengers can update their profile and securely change their password', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_passenger_ana' } });
  const profile = await updatePassengerProfile('seed_user_passenger_ana', {
    name: 'Ana Marie Reyes',
    email: 'ana.updated@uvgo.demo',
    contact: '09179990000',
  });
  assert.equal(profile.name, 'Ana Marie Reyes');
  assert.equal(profile.email, 'ana.updated@uvgo.demo');
  assert.equal(profile.contact, '09179990000');

  await assert.rejects(
    updatePassengerProfile('seed_user_passenger_ana', { name: 'Ana Reyes', email: 'maria.santos@uvgo.demo', contact: '09179990000' }),
    (error: unknown) => error instanceof AppError && error.code === 'EMAIL_ALREADY_IN_USE',
  );
  await assert.rejects(
    changePassengerPassword('seed_user_passenger_ana', 'incorrect-password', 'NewPassenger456'),
    (error: unknown) => error instanceof AppError && error.code === 'CURRENT_PASSWORD_INCORRECT',
  );

  await changePassengerPassword('seed_user_passenger_ana', 'UVGoDemo123!', 'NewPassenger456');
  const afterPasswordChange = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_passenger_ana' } });
  assert.equal(await compare('NewPassenger456', afterPasswordChange.passwordHash), true);
  assert.equal(afterPasswordChange.tokenVersion, before.tokenVersion + 1);
});

test('8c. dispatchers can update personal details without changing their role or route', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_dispatcher' } });
  const profile = await updateDispatcherProfile('seed_user_dispatcher', {
    name: 'Juan Miguel Dela Cruz',
    email: 'juan.updated@uvgo.demo',
    contact: '09178880000',
  });
  assert.equal(profile.name, 'Juan Miguel Dela Cruz');
  assert.equal(profile.email, 'juan.updated@uvgo.demo');
  assert.equal(profile.contact, '09178880000');
  assert.equal(profile.role, 'dispatcher');
  assert.equal(profile.dispatcherRoute, 'goa');

  await assert.rejects(
    updateDispatcherProfile('seed_user_dispatcher', { name: 'Juan Dela Cruz', email: 'passenger@uvgo.demo', contact: '09178880000' }),
    (error: unknown) => error instanceof AppError && error.code === 'EMAIL_ALREADY_IN_USE',
  );
  await assert.rejects(
    updateDispatcherProfile('seed_user_passenger_ana', { name: 'Ana Reyes', email: 'ana@uvgo.demo', contact: '09179990000' }),
    (error: unknown) => error instanceof AppError && error.code === 'DISPATCHER_NOT_FOUND',
  );
  await assert.rejects(
    changeDispatcherPassword('seed_user_dispatcher', 'incorrect-password', 'NewDispatcher456'),
    (error: unknown) => error instanceof AppError && error.code === 'CURRENT_PASSWORD_INCORRECT',
  );

  await changeDispatcherPassword('seed_user_dispatcher', 'UVGoDemo123!', 'NewDispatcher456');
  const after = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_dispatcher' } });
  assert.equal(await compare('NewDispatcher456', after.passwordHash), true);
  assert.equal(after.tokenVersion, before.tokenVersion + 1);
  assert.equal(after.role, before.role);
  assert.equal(after.dispatcherRoute, before.dispatcherRoute);
});

test('8d. drivers can update personal details without changing their role or vehicle assignment', async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_driver_rodel' } });
  const vehicleBefore = await prisma.vehicle.findUniqueOrThrow({ where: { assignedDriverId: before.id } });
  const profile = await updateDriverProfile(before.id, {
    name: 'Rodel Miguel Reyes',
    email: 'rodel.updated@uvgo.demo',
    contact: '09177770000',
  });
  assert.equal(profile.name, 'Rodel Miguel Reyes');
  assert.equal(profile.email, 'rodel.updated@uvgo.demo');
  assert.equal(profile.contact, '09177770000');
  assert.equal(profile.role, 'driver');

  await assert.rejects(
    updateDriverProfile(before.id, { name: 'Rodel Reyes', email: 'passenger@uvgo.demo', contact: '09177770000' }),
    (error: unknown) => error instanceof AppError && error.code === 'EMAIL_ALREADY_IN_USE',
  );
  await assert.rejects(
    updateDriverProfile('seed_user_passenger_ana', { name: 'Ana Reyes', email: 'ana@uvgo.demo', contact: '09179990000' }),
    (error: unknown) => error instanceof AppError && error.code === 'DRIVER_NOT_FOUND',
  );
  await assert.rejects(
    changeDriverPassword(before.id, 'incorrect-password', 'NewDriver456'),
    (error: unknown) => error instanceof AppError && error.code === 'CURRENT_PASSWORD_INCORRECT',
  );

  await changeDriverPassword(before.id, 'UVGoDemo123!', 'NewDriver456');
  const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
  const vehicleAfter = await prisma.vehicle.findUniqueOrThrow({ where: { assignedDriverId: before.id } });
  assert.equal(await compare('NewDriver456', after.passwordHash), true);
  assert.equal(after.tokenVersion, before.tokenVersion + 1);
  assert.equal(after.role, before.role);
  assert.equal(vehicleAfter.id, vehicleBefore.id);
  assert.equal(vehicleAfter.route, vehicleBefore.route);
});

test('5a. passenger count uses the automatically active schedule and its boarding window', async () => {
  await prisma.passengerCount.deleteMany({ where: { tripId: 'seed_trip_goa_morning' } });
  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_goa' } })).status, AssignmentStatus.ACCEPTED);
  await assert.rejects(
    submitOccupancy('seed_user_driver_rodel', 3),
    (error: unknown) => error instanceof AppError && error.code === 'OCCUPANCY_WINDOW_NOT_OPEN',
  );

  // The loading window is stored separately now, so moving the departure means
  // moving the loading start too — otherwise loading legitimately stays closed.
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_morning' },
    data: {
      boardingStartTime: new Date(Date.now() - 60_000),
      scheduledOrTriggeredTime: new Date(Date.now() + 5 * 60_000),
    },
  });
  const overview = await submitOccupancy('seed_user_driver_rodel', 3);
  const passengerCount = await prisma.passengerCount.findFirst({
    where: { tripId: 'seed_trip_goa_morning', submittedByDriverId: 'seed_user_driver_rodel' },
    orderBy: { timestamp: 'desc' },
  });
  assert.equal(overview.occupancyEligibility.allowed, true);
  assert.equal(passengerCount?.count, 3);
});

test('8a. Goa seat maps expose only 11 passenger seats', async () => {
  const seatMap = await getTripSeats('seed_trip_goa_day_three');
  assert.equal(seatMap.trip.capacity, VAN_PASSENGER_CAPACITY);
  assert.deepEqual(seatMap.trip.gcashRecipient, {
    dispatcherName: 'Juan Dela Cruz',
    mobileNumber: '09175558884',
  });
  assert.deepEqual(seatMap.seats.map((seat) => seat.number), Array.from({ length: VAN_PASSENGER_CAPACITY }, (_, index) => index + 1));
  await assert.rejects(
    createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [12], contact: '09170000001', gcashReference: 'GCASH-INVALID-SEAT', receiptImageKey: 'test.png', receiptMimeType: 'image/png' }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_SEAT',
  );
});

test('the selected trip and reservation expose the current Goa dispatcher GCash number', async () => {
  await prisma.user.update({
    where: { id: 'seed_user_dispatcher' },
    data: { name: 'Updated Goa Dispatcher', contact: '09991234567' },
  });

  const searchResult = (await searchGoaTrips(undefined, 1)).find((trip) => trip.id === 'seed_trip_goa_day_three');
  assert.deepEqual(searchResult?.gcashRecipient, {
    dispatcherName: 'Updated Goa Dispatcher',
    mobileNumber: '09991234567',
  });

  const seatMap = await getTripSeats('seed_trip_goa_day_three');
  assert.deepEqual(seatMap.trip.gcashRecipient, searchResult?.gcashRecipient);

  const existingBooking = await getPassengerBooking('seed_user_passenger_maria', 'UVGO-DEMO-002');
  assert.deepEqual(existingBooking.gcashRecipient, searchResult?.gcashRecipient);
});

test('9. PayPal demo capture confirms the reservation', { skip: process.env.DEMO_MODE === 'false' }, async () => {
  const order = await createPaypalReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [2], contact: '09170000001' });
  assert.equal(order.demo, true);
  const booking = await capturePaypalReservation('seed_user_passenger_ana', order.reference);
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.payment?.status, 'captured');
});

test('10. GCash receipt upload produces PendingVerification', async () => {
  const booking = await createGcashReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: 'seed_trip_goa_day_three',
    seats: [3],
    contact: '09170000001',
    gcashReference: 'GCash-Test-001',
    receiptImageKey: 'test.png',
    receiptMimeType: 'image/png',
  });
  assert.equal(booking.status, 'pending_verification');
  assert.equal(booking.payment?.status, 'pending_verification');
  assert.equal(booking.payment?.transactionReference, 'GCash-Test-001');
  const [payment, notification] = await Promise.all([
    prisma.payment.findFirstOrThrow({ where: { reservation: { reference: booking.reference } } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_passenger_ana', message: { contains: booking.reference } } }),
  ]);
  assert.equal(payment.externalReferenceKey, 'GCASH_RECEIPT:GCASH-TEST-001');
  assert.ok(notification, 'reservation and receipt notification should commit together');
  const dispatcherPayment = (await getDispatcherPayments(RouteCode.GOA)).gcash.find((item) => item.reservation.reference === booking.reference);
  assert.equal(dispatcherPayment?.transactionReference, booking.payment?.transactionReference);

  await assert.rejects(
    () => createGcashReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seats: [4],
      contact: '09170000001',
      gcashReference: '  gcash-test-001  ',
      receiptImageKey: 'duplicate-test.png',
      receiptMimeType: 'image/png',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'PAYMENT_REFERENCE_ALREADY_REPORTED',
  );
});

test('11. dispatcher GCash approval confirms the booking', async () => {
  await decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, 'seed_payment_gcash', 'approve', '');
  const payment = await prisma.payment.findUnique({ where: { id: 'seed_payment_gcash' }, include: { reservation: true } });
  assert.equal(payment?.status, PaymentStatus.VERIFIED);
  assert.equal(payment?.reservation.status, ReservationStatus.CONFIRMED);
});

test('12. rescheduling is blocked inside 24 hours', async () => {
  await prisma.trip.update({ where: { id: 'seed_trip_goa_morning' }, data: { scheduledOrTriggeredTime: new Date(Date.now() + 12 * 60 * 60_000) } });
  await assert.rejects(
    reschedulePassengerBooking('seed_user_passenger_ana', 'UVGO-DEMO-001', 'seed_trip_goa_day_two', [5]),
    (error: unknown) => error instanceof AppError && error.code === 'RESCHEDULE_WINDOW_CLOSED',
  );
});

test('13. reservations are reallocated to the next eligible van', async () => {
  const result = await reallocateUnavailableVehicle('seed_user_dispatcher', 'seed_vehicle_033', 'Critical test vehicle replacement');
  const reservation = await prisma.reservation.findUnique({ where: { reference: 'UVGO-DEMO-001' } });
  const pendingReservation = await prisma.reservation.findUnique({ where: { reference: 'UVGO-DEMO-002' } });
  const targetTrip = reservation ? await prisma.trip.findUnique({ where: { id: reservation.tripId } }) : null;
  assert.equal(result.reservationsMoved, 2);
  assert.equal(reservation?.status, ReservationStatus.REALLOCATED);
  assert.equal(pendingReservation?.tripId, reservation?.tripId);
  assert.equal(pendingReservation?.status, ReservationStatus.PENDING_VERIFICATION);
  assert.equal(targetTrip?.vehicleId, 'seed_vehicle_021');
});

test('14. authenticated passengers cannot access dispatcher endpoints', async () => {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'passenger@uvgo.demo', password: 'UVGoDemo123!' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const forbidden = await fetch(`${baseUrl}/dispatcher/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(forbidden.status, 403);
    const payload = await forbidden.json() as { error: { code: string } };
    assert.equal(payload.error.code, 'FORBIDDEN');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('registration offers email verification while sign-in requires only active valid credentials', async () => {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const signupInput = {
      name: 'New Passenger',
      email: 'new.passenger@uvgo.demo',
      contact: '09171234567',
      password: 'Passenger123!',
      confirmPassword: 'Passenger123!',
    };

    const signup = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupInput),
    });
    assert.equal(signup.status, 201);
    const payload = await signup.json() as { email: string; requiresEmailVerification: boolean; developmentCode: string };
    assert.equal(payload.email, signupInput.email);
    assert.equal(payload.requiresEmailVerification, true);
    assert.match(payload.developmentCode, /^\d{6}$/);
    assert.equal(signup.headers.get('set-cookie'), null);

    const storedUser = await prisma.user.findUniqueOrThrow({ where: { email: signupInput.email } });
    assert.equal(storedUser.role, UserRole.PASSENGER);
    assert.equal(storedUser.dispatcherRoute, null);
    assert.equal(storedUser.managedByDispatcherId, null);
    assert.equal(storedUser.isActive, true);
    assert.equal(storedUser.emailVerifiedAt, null);
    assert.notEqual(storedUser.passwordHash, signupInput.password);
    assert.equal(await compare(signupInput.password, storedUser.passwordHash), true);

    const unverifiedLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupInput.email, password: signupInput.password }),
    });
    assert.equal(unverifiedLogin.status, 200);
    const unverifiedPayload = await unverifiedLogin.json() as { user: { id: string; emailVerified: boolean; redirectTo: string } };
    assert.equal(unverifiedPayload.user.id, storedUser.id);
    assert.equal(unverifiedPayload.user.emailVerified, false);
    assert.equal(unverifiedPayload.user.redirectTo, '/passenger/home');
    const unverifiedCookie = unverifiedLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(unverifiedCookie);
    const unverifiedSession = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: unverifiedCookie } });
    assert.equal(unverifiedSession.status, 200);

    const invalidVerification = await fetch(`${baseUrl}/auth/verification/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupInput.email, code: payload.developmentCode === '000000' ? '000001' : '000000' }),
    });
    assert.equal(invalidVerification.status, 422);

    const verification = await fetch(`${baseUrl}/auth/verification/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupInput.email, code: payload.developmentCode }),
    });
    assert.equal(verification.status, 200);
    const verifiedPayload = await verification.json() as { user: { id: string; role: string; email: string; emailVerified: boolean; redirectTo: string } };
    assert.equal(verifiedPayload.user.id, storedUser.id);
    assert.equal(verifiedPayload.user.role, 'passenger');
    assert.equal(verifiedPayload.user.emailVerified, true);
    assert.equal(verifiedPayload.user.redirectTo, '/passenger/home');
    const cookie = verification.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: storedUser.id } })).emailVerifiedAt);

    const me = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);

    const reusedVerification = await fetch(`${baseUrl}/auth/verification/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: signupInput.email, code: payload.developmentCode }),
    });
    assert.equal(reusedVerification.status, 422);
    assert.equal(reusedVerification.headers.get('set-cookie'), null);

    const duplicate = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signupInput),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(((await duplicate.json()) as { error: { code: string } }).error.code, 'EMAIL_ALREADY_IN_USE');

    const injectedEmail = 'role.injected@uvgo.test';
    const roleInjection = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signupInput, email: injectedEmail, role: 'DISPATCHER' }),
    });
    assert.equal(roleInjection.status, 422);
    assert.equal(((await roleInjection.json()) as { error: { code: string } }).error.code, 'VALIDATION_ERROR');
    assert.equal(await prisma.user.findUnique({ where: { email: injectedEmail } }), null);

    const weakPassword = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...signupInput, email: 'weak.password@uvgo.test', password: 'password', confirmPassword: 'password' }),
    });
    assert.equal(weakPassword.status, 422);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('forgot-password codes reset credentials without revealing unknown accounts and invalidate old sessions', async () => {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const email = 'passenger@uvgo.demo';

    const oldLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'UVGoDemo123!' }),
    });
    assert.equal(oldLogin.status, 200);
    const oldCookie = oldLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(oldCookie);

    const request = await fetch(`${baseUrl}/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(request.status, 200);
    const requested = await request.json() as { message: string; developmentCode: string };
    assert.match(requested.developmentCode, /^\d{6}$/);

    const unknown = await fetch(`${baseUrl}/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing.account@uvgo.test' }),
    });
    assert.equal(unknown.status, 200);
    const unknownPayload = await unknown.json() as { message: string; developmentCode?: string };
    assert.equal(unknownPayload.message, requested.message);
    assert.equal(unknownPayload.developmentCode, undefined);

    const reset = await fetch(`${baseUrl}/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        code: requested.developmentCode,
        newPassword: 'UpdatedPassenger123!',
        confirmPassword: 'UpdatedPassenger123!',
      }),
    });
    assert.equal(reset.status, 200);

    const oldSession = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: oldCookie } });
    assert.equal(oldSession.status, 401);

    const oldPassword = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'UVGoDemo123!' }),
    });
    assert.equal(oldPassword.status, 401);

    const newPassword = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'UpdatedPassenger123!' }),
    });
    assert.equal(newPassword.status, 200);

    const reusedCode = await fetch(`${baseUrl}/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        code: requested.developmentCode,
        newPassword: 'AnotherPassenger123!',
        confirmPassword: 'AnotherPassenger123!',
      }),
    });
    assert.equal(reusedCode.status, 422);
    assert.equal(((await reusedCode.json()) as { error: { code: string } }).error.code, 'INVALID_OR_EXPIRED_CODE');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('drivers and dispatchers can use the same self-service password-reset flow', async () => {
  const accounts = [
    { email: 'driver.rodel@uvgo.demo', role: UserRole.DRIVER, newPassword: 'UpdatedDriver123!' },
    { email: 'dispatcher@uvgo.demo', role: UserRole.DISPATCHER, newPassword: 'UpdatedDispatcher123!' },
  ] as const;

  for (const account of accounts) {
    const before = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
    const delivery = await requestPasswordReset(account.email);
    assert.match(delivery.developmentCode ?? '', /^\d{6}$/);

    await resetPasswordWithCode(account.email, delivery.developmentCode!, account.newPassword);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
    assert.equal(after.role, account.role);
    assert.equal(after.tokenVersion, before.tokenVersion + 1);
    assert.equal(await compare(account.newPassword, after.passwordHash), true);
    assert.ok(after.emailVerifiedAt);
  }
});

test('13a. an active driver cancellation promotes the next driver and resolves seat conflicts', async () => {
  const sourceTrip = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } });
  const targetTrip = await prisma.trip.create({
    data: {
      vehicleId: 'seed_vehicle_021',
      route: RouteCode.GOA,
      scheduledOrTriggeredTime: sourceTrip.scheduledOrTriggeredTime,
      status: TripStatus.SCHEDULED,
      fareAmount: sourceTrip.fareAmount,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  await prisma.reservation.create({
    data: {
      reference: 'UVGO-CONFLICT-001',
      passengerId: 'seed_user_passenger_john',
      tripId: targetTrip.id,
      seatCount: 1,
      fareAmount: DEFAULT_GOA_FARE,
      status: ReservationStatus.CONFIRMED,
      seats: { create: { tripId: targetTrip.id, seatNumber: 4 } },
    },
  });

  const result = await cancelDriverScheduledAssignment('seed_user_driver_rodel', 'seed_assignment_goa', 'Vehicle needs urgent repair.');
  const [cancelledAssignment, replacementAssignment, movedConfirmed, movedPending, targetSeats, replacementNotification, confirmedPassengerNotification, pendingPassengerNotification, cancellationLog] = await Promise.all([
    prisma.tripAssignment.findUnique({ where: { id: 'seed_assignment_goa' } }),
    prisma.tripAssignment.findFirst({ where: { tripId: targetTrip.id, driverId: 'seed_user_driver_mario' } }),
    prisma.reservation.findUnique({ where: { reference: 'UVGO-DEMO-001' }, include: { seats: { orderBy: { seatNumber: 'asc' } } } }),
    prisma.reservation.findUnique({ where: { reference: 'UVGO-DEMO-002' }, include: { seats: { orderBy: { seatNumber: 'asc' } } } }),
    prisma.reservationSeat.findMany({ where: { tripId: targetTrip.id }, orderBy: { seatNumber: 'asc' } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_driver_mario', type: 'ASSIGNMENT' }, orderBy: { createdAt: 'desc' } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_passenger_ana', type: 'REALLOCATION' }, orderBy: { createdAt: 'desc' } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_passenger_maria', type: 'REALLOCATION' }, orderBy: { createdAt: 'desc' } }),
    prisma.dispatchLog.findFirst({ where: { action: 'ASSIGNMENT_CANCELLED', targetId: sourceTrip.id }, orderBy: { timestamp: 'desc' } }),
  ]);

  assert.equal(result.replacementDriverId, 'seed_user_driver_mario');
  assert.equal(result.reservationsMoved, 2);
  assert.equal(cancelledAssignment?.status, 'CANCELLED');
  assert.equal(replacementAssignment?.status, 'ACCEPTED');
  assert.equal(movedConfirmed?.tripId, targetTrip.id);
  assert.equal(movedConfirmed?.status, ReservationStatus.REALLOCATED);
  assert.deepEqual(movedConfirmed?.seats.map((seat) => seat.seatNumber), [1]);
  assert.equal(movedPending?.tripId, targetTrip.id);
  assert.equal(movedPending?.status, ReservationStatus.PENDING_VERIFICATION);
  assert.deepEqual(movedPending?.seats.map((seat) => seat.seatNumber), [8, 9]);
  assert.deepEqual(targetSeats.map((seat) => seat.seatNumber), [1, 4, 8, 9]);
  assert.match(replacementNotification?.message ?? '', /assigned to the Goa trip/);
  assert.match(replacementNotification?.message ?? '', /Cancel the assignment/);
  assert.match(confirmedPassengerNotification?.message ?? '', /seat changed from 4 to 1/i);
  assert.match(pendingPassengerNotification?.message ?? '', /seat remains 8, 9/i);
  assert.equal(cancellationLog?.reason, 'Vehicle needs urgent repair.');
});

test('13b. a driver can cancel even when no replacement van is currently available', async () => {
  const assignment = await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_goa' } });
  await prisma.queueEntry.updateMany({
    where: {
      route: RouteCode.GOA,
      ...(assignment.queueEntryId ? { id: { not: assignment.queueEntryId } } : {}),
    },
    data: { status: QueueStatus.REPLACED },
  });

  const result = await cancelDriverScheduledAssignment(
    'seed_user_driver_rodel',
    assignment.id,
    'Cannot make the scheduled trip.',
  );
  const [cancelledAssignment, sourceTrip, sourceQueue, sourceVehicle, reservation] = await Promise.all([
    prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id } }),
    prisma.trip.findUniqueOrThrow({ where: { id: assignment.tripId } }),
    assignment.queueEntryId ? prisma.queueEntry.findUniqueOrThrow({ where: { id: assignment.queueEntryId } }) : null,
    prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } }),
    prisma.reservation.findUniqueOrThrow({ where: { reference: 'UVGO-DEMO-001' } }),
  ]);

  assert.equal(result.replacementRequired, true);
  assert.equal(result.replacementDriverId, null);
  assert.equal(result.replacementVehicleId, null);
  assert.equal(result.reservationsMoved, 0);
  assert.equal(cancelledAssignment.status, AssignmentStatus.CANCELLED);
  assert.equal(sourceTrip.status, TripStatus.ASSIGNING);
  assert.equal(sourceTrip.awaitingQueueReplacement, true);
  assert.equal(sourceQueue?.status, QueueStatus.REPLACED);
  assert.equal(sourceVehicle.status, VehicleStatus.UNAVAILABLE);
  assert.equal(reservation.tripId, assignment.tripId);
});

test('15. dispatchers can access only their assigned route', async () => {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function login(email: string) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'UVGoDemo123!' }),
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      return cookie;
    }

    const goaCookie = await login('dispatcher@uvgo.demo');
    const legazpiCookie = await login('dispatcher.legazpi@uvgo.demo');

    const goaFleetResponse = await fetch(`${baseUrl}/dispatcher/fleet`, { headers: { Cookie: goaCookie } });
    assert.equal(goaFleetResponse.status, 200);
    const goaFleet = await goaFleetResponse.json() as { fleet: { vehicles: Array<{ routeCode: string }> } };
    assert.ok(goaFleet.fleet.vehicles.length > 0);
    assert.ok(goaFleet.fleet.vehicles.every((vehicle) => vehicle.routeCode === 'goa'));

    const legazpiFleetResponse = await fetch(`${baseUrl}/dispatcher/fleet`, { headers: { Cookie: legazpiCookie } });
    assert.equal(legazpiFleetResponse.status, 200);
    const legazpiFleet = await legazpiFleetResponse.json() as { fleet: { vehicles: Array<{ routeCode: string }> } };
    assert.ok(legazpiFleet.fleet.vehicles.length > 0);
    assert.ok(legazpiFleet.fleet.vehicles.every((vehicle) => vehicle.routeCode === 'legazpi'));

    const crossRouteRead = await fetch(`${baseUrl}/dispatcher/queue?route=legazpi`, { headers: { Cookie: goaCookie } });
    assert.equal(crossRouteRead.status, 403);
    const crossRouteReadPayload = await crossRouteRead.json() as { error: { code: string } };
    assert.equal(crossRouteReadPayload.error.code, 'ROUTE_ACCESS_DENIED');

    const crossRouteWrite = await fetch(`${baseUrl}/dispatcher/queue/seed_queue_legazpi_1/actions`, {
      method: 'POST',
      headers: { Cookie: goaCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'notify_driver', reason: 'Unauthorized route test.' }),
    });
    assert.equal(crossRouteWrite.status, 403);
    const crossRouteWritePayload = await crossRouteWrite.json() as { error: { code: string } };
    assert.equal(crossRouteWritePayload.error.code, 'ROUTE_ACCESS_DENIED');

    const legazpiPaymentDecision = await fetch(`${baseUrl}/dispatcher/payments/seed_payment_gcash/decision`, {
      method: 'POST',
      headers: { Cookie: legazpiCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve', reason: '' }),
    });
    assert.equal(legazpiPaymentDecision.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('16. a dispatcher creates only owned drivers and route-derived vehicles', async () => {
  const management = await createManagedDriver('seed_user_dispatcher', RouteCode.GOA, {
    name: 'New Goa Driver',
    contact: '09170000016',
    email: 'new.goa.driver@uvgo.test',
    password: 'Temporary123!',
    vehicle: { vanId: 'VAN-116', plateNo: 'EAG-116', capacity: VAN_PASSENGER_CAPACITY },
  });
  const created = management.drivers.find((driver) => driver?.email === 'new.goa.driver@uvgo.test');
  assert.equal(created?.vehicle?.routeCode, 'goa');
  assert.equal(created?.vehicle?.protocol, 'Goso');
  const driver = await prisma.user.findUnique({ where: { email: 'new.goa.driver@uvgo.test' } });
  const vehicle = await prisma.vehicle.findUnique({ where: { vanId: 'VAN-116' } });
  assert.equal(driver?.managedByDispatcherId, 'seed_user_dispatcher');
  assert.equal(vehicle?.managedByDispatcherId, 'seed_user_dispatcher');
  assert.equal(vehicle?.route, RouteCode.GOA);
  assert.equal(vehicle?.protocol, 'GOSO');
  const legazpiManagement = await getManagedDrivers('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI);
  assert.equal(legazpiManagement.drivers.some((item) => item?.id === driver?.id), false);
});

test('16a. a dispatcher can create a backup dispatcher only for the same route', async () => {
  const management = await createBackupDispatcher('seed_user_dispatcher', RouteCode.GOA, {
    name: 'Backup Goa Dispatcher',
    contact: '09170000161',
    email: 'backup.goa.dispatcher@uvgo.test',
    password: 'BackupDispatcher123!',
  });

  const created = await prisma.user.findUniqueOrThrow({ where: { email: 'backup.goa.dispatcher@uvgo.test' } });
  assert.equal(created.role, UserRole.DISPATCHER);
  assert.equal(created.dispatcherRoute, RouteCode.GOA);
  assert.equal(created.managedByDispatcherId, 'seed_user_dispatcher');
  assert.equal(created.isActive, true);
  assert.ok(created.emailVerifiedAt);
  assert.equal(await compare('BackupDispatcher123!', created.passwordHash), true);
  assert.equal(management.dispatchers.some((dispatcher) => dispatcher.id === created.id), true);

  const legazpiTeam = await getRouteDispatchers('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI);
  assert.equal(legazpiTeam.dispatchers.some((dispatcher) => dispatcher.id === created.id), false);

  await assert.rejects(
    createBackupDispatcher('seed_user_dispatcher', RouteCode.LEGAZPI, {
      name: 'Forbidden Cross-route Dispatcher',
      contact: '09170000162',
      email: 'forbidden.dispatcher@uvgo.test',
      password: 'ForbiddenDispatcher123!',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'ROUTE_ACCESS_DENIED',
  );
});

test('16b. a dispatcher can delete only an owned driver while retaining operational history', async () => {
  const management = await createManagedDriver('seed_user_dispatcher', RouteCode.GOA, {
    name: 'Driver To Delete',
    contact: '09170000163',
    email: 'driver.delete@uvgo.test',
    password: 'Temporary123!',
    vehicle: { vanId: 'VAN-163', plateNo: 'EAG-163', capacity: VAN_PASSENGER_CAPACITY },
  });
  const driver = management.drivers.find((item) => item?.email === 'driver.delete@uvgo.test');
  assert.ok(driver?.vehicle);
  const observedAt = new Date();
  await prisma.vehicle.update({
    where: { id: driver!.vehicle!.id },
    data: {
      lastKnownInsideZone: true,
      insideTerminalZone: true,
      locationTrackingActive: true,
      latestArrivalAt: observedAt,
      latestLatitude: 13.6255,
      latestLongitude: 123.1948,
      latestLocationAccuracyM: 8,
      latestLocationObservedAt: observedAt,
      latestDistanceKm: 0.05,
      terminalEntrySampleCount: 1,
    },
  });
  const locationEvent = await prisma.geofenceEvent.create({
    data: {
      vehicleId: driver!.vehicle!.id,
      eventType: GeofenceEventType.ENTERED,
      latitude: 13.6255,
      longitude: 123.1948,
      distanceKm: 0.05,
      accuracyMeters: 8,
    },
  });
  const fleetBeforeDelete = await getFleetSnapshot(RouteCode.GOA);
  assert.equal(fleetBeforeDelete.vehicles.some((item) => item.id === driver!.vehicle!.id), true);
  assert.equal(fleetBeforeDelete.events.some((item) => item.id === locationEvent.id), true);
  const boardingStartTime = new Date(Date.now() + 10 * 60_000).toISOString();
  const departureTime = new Date(Date.now() + 20 * 60_000).toISOString();
  const scheduleManagement = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime,
    departureTime,
    vehicleId: driver!.vehicle!.id,
    fareAmount: DEFAULT_GOA_FARE,
  });
  const schedule = scheduleManagement.schedules.find((item) => item.vehicle.id === driver!.vehicle!.id && item.departureTime === departureTime);
  assert.ok(schedule?.assignment);
  await prisma.reservation.create({
    data: {
      id: 'test_deleted_driver_preserved_booking',
      reference: 'DEL-DRIVER-BOOKED',
      passengerId: 'seed_user_passenger_ana',
      tripId: schedule!.id,
      seatCount: 1,
      fareAmount: DEFAULT_GOA_FARE,
      status: ReservationStatus.CONFIRMED,
    },
  });
  const weeklyRule = await prisma.weeklySchedule.create({
    data: {
      id: 'test_deleted_driver_weekly_rule',
      dispatcherId: 'seed_user_dispatcher',
      vehicleId: driver!.vehicle!.id,
      weekday: 1,
      boardingMinute: 540,
      departureMinute: 570,
      fareAmount: DEFAULT_GOA_FARE,
    },
  });
  const unbookedOccurrence = await prisma.trip.create({
    data: {
      id: 'test_deleted_driver_unbooked_occurrence',
      vehicleId: driver!.vehicle!.id,
      route: RouteCode.GOA,
      scheduledOrTriggeredTime: new Date(Date.now() + 2 * 24 * 60 * 60_000),
      boardingStartTime: new Date(Date.now() + 2 * 24 * 60 * 60_000 - 30 * 60_000),
      fareAmount: DEFAULT_GOA_FARE,
      status: TripStatus.SCHEDULED,
      createdByDispatcherId: 'seed_user_dispatcher',
      weeklyScheduleId: weeklyRule.id,
      weeklyOccurrenceDate: new Date(Date.now() + 2 * 24 * 60 * 60_000),
    },
  });

  await assert.rejects(
    () => deleteManagedDriver('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, driver!.id),
    (error: unknown) => error instanceof AppError && error.code === 'MANAGED_DRIVER_NOT_FOUND',
  );
  const afterDelete = await deleteManagedDriver('seed_user_dispatcher', RouteCode.GOA, driver!.id);
  assert.equal(afterDelete.drivers.some((item) => item?.id === driver!.id), false);

  const deletedUser = await prisma.user.findUniqueOrThrow({ where: { id: driver!.id } });
  assert.equal(deletedUser.isActive, false);
  assert.equal(deletedUser.managedByDispatcherId, null);
  assert.equal(deletedUser.name, 'Deleted driver');
  assert.match(deletedUser.email, /^deleted\..+@removed\.uvgo$/);
  assert.equal(await prisma.vehicle.findUnique({ where: { id: driver!.vehicle!.id } }), null);
  assert.equal(await prisma.geofenceEvent.count({ where: { vehicleId: driver!.vehicle!.id } }), 0);
  const retainedBookedTrip = await prisma.trip.findUniqueOrThrow({
    where: { id: schedule!.id },
    include: { vehicle: true },
  });
  const historyVehicle = retainedBookedTrip.vehicle;
  assert.notEqual(historyVehicle.id, driver!.vehicle!.id);
  assert.match(historyVehicle.vanId, /^deleted-/);
  assert.match(historyVehicle.plateNo, /^deleted-/);
  assert.equal(historyVehicle.assignedDriverId, null);
  assert.equal(historyVehicle.managedByDispatcherId, null);
  assert.equal(historyVehicle.status, VehicleStatus.UNAVAILABLE);
  assert.equal(historyVehicle.lastKnownInsideZone, false);
  assert.equal(historyVehicle.insideTerminalZone, false);
  assert.equal(historyVehicle.locationTrackingActive, false);
  assert.equal(historyVehicle.latestArrivalAt, null);
  assert.equal(historyVehicle.latestLatitude, null);
  assert.equal(historyVehicle.latestLongitude, null);
  assert.equal(historyVehicle.latestLocationAccuracyM, null);
  assert.equal(historyVehicle.latestLocationObservedAt, null);
  assert.equal(historyVehicle.latestDistanceKm, null);
  assert.equal(historyVehicle.terminalEntrySampleCount, 0);
  assert.equal(historyVehicle.terminalExitSampleCount, 0);
  const fleetAfterDelete = await getFleetSnapshot(RouteCode.GOA);
  assert.equal(fleetAfterDelete.vehicles.some((item) => item.id === driver!.vehicle!.id || item.id === historyVehicle.id), false);
  assert.equal(fleetAfterDelete.events.some((item) => item.vanId === driver!.vehicle!.vanId || item.vanId === historyVehicle.vanId), false);
  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: schedule!.assignment!.id } })).status, 'CANCELLED');
  assert.equal(retainedBookedTrip.awaitingQueueReplacement, true);
  assert.equal(await prisma.trip.findUnique({ where: { id: unbookedOccurrence.id } }), null);
  assert.equal(await prisma.weeklySchedule.findUnique({ where: { id: weeklyRule.id } }), null);
  const schedulesAfterDelete = await getManagedSchedules('seed_user_dispatcher', RouteCode.GOA);
  assert.equal(schedulesAfterDelete.vehicles.some((item) => item.id === driver!.vehicle!.id || item.id === historyVehicle.id), false);
  assert.equal(schedulesAfterDelete.schedules.some((item) => item.vehicle.id === driver!.vehicle!.id || item.vehicle.id === historyVehicle.id), false);
  assert.equal(schedulesAfterDelete.weeklySchedules.some((item) => item.vehicle.id === driver!.vehicle!.id || item.vehicle.id === historyVehicle.id), false);
  assert.equal(await prisma.queueEntry.count({ where: { vehicleId: driver!.vehicle!.id } }), 0);
  assert.equal(await prisma.dispatchLog.count({ where: { targetId: driver!.id, reason: 'Dispatcher deleted the managed driver account.' } }), 1);

  // Deleting the actual vehicle frees both unique identifiers for reuse.
  const replacement = await createManagedDriver('seed_user_dispatcher', RouteCode.GOA, {
    name: 'Replacement Driver',
    contact: '09170000164',
    email: 'replacement.driver@uvgo.test',
    password: 'Temporary123!',
    vehicle: { vanId: 'VAN-163', plateNo: 'EAG-163', capacity: VAN_PASSENGER_CAPACITY },
  });
  assert.equal(replacement.drivers.some((item) => item?.email === 'replacement.driver@uvgo.test' && item.vehicle?.vanId === 'VAN-163'), true);
});

test('16c. deleting a Taya driver also deletes the van and its saved weekly and daily sequences', async () => {
  assert.equal(await prisma.tayaDailySchedule.count({ where: { vehicleId: 'seed_vehicle_019' } }), 1);
  assert.equal(await prisma.tayaWeeklySchedule.count({ where: { vehicleId: 'seed_vehicle_019' } }), 1);
  await deleteManagedDriver('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, 'seed_user_driver_pedro');
  assert.equal(await prisma.vehicle.findUnique({ where: { id: 'seed_vehicle_019' } }), null);
  assert.equal(await prisma.tayaDailySchedule.count({ where: { vehicleId: 'seed_vehicle_019' } }), 0);
  assert.equal(await prisma.tayaWeeklySchedule.count({ where: { vehicleId: 'seed_vehicle_019' } }), 0);
  const deletedDriver = await prisma.user.findUniqueOrThrow({ where: { id: 'seed_user_driver_pedro' } });
  assert.equal(deletedDriver.isActive, false);
  assert.equal(deletedDriver.managedByDispatcherId, null);
});

test('17. Goa schedule management creates a bookable concrete departure', async () => {
  const departureTime = new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString();
  const result = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: 195,
  });
  const created = result.schedules.find((schedule) => schedule.departureTime === departureTime);
  assert.ok(created);
  assert.equal(created?.vehicle.id, 'seed_vehicle_033');
  assert.equal(created?.fareAmount, 195);
  const trip = created ? await prisma.trip.findUnique({ where: { id: created.id }, include: { assignments: true } }) : null;
  const assignmentNotification = trip?.assignments[0]
    ? await prisma.notification.findFirst({
      where: { userId: trip.assignments[0].driverId, type: 'ASSIGNMENT', message: { contains: 'You are assigned to the Goa trip' } },
      orderBy: { createdAt: 'desc' },
    })
    : null;
  assert.equal(trip?.createdByDispatcherId, 'seed_user_dispatcher');
  assert.equal(trip?.status, TripStatus.ASSIGNED);
  assert.equal(trip?.assignments.length, 1);
  assert.equal(trip?.assignments[0]?.driverId, 'seed_user_driver_rodel');
  assert.equal(trip?.assignments[0]?.queueEntryId, null);
  assert.equal(trip?.assignments[0]?.status, 'ACCEPTED');
  assert.ok(assignmentNotification);
});

test('17b. an edited schedule replaces its assignment with another automatically active assignment', async () => {
  const departureTime = new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString();
  const createdPayload = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: 195,
  });
  const created = createdPayload.schedules.find((schedule) => schedule.departureTime === departureTime);
  assert.ok(created);
  const original = await prisma.tripAssignment.findFirstOrThrow({ where: { tripId: created!.id } });
  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: original.id } })).status, 'ACCEPTED');

  await updateManagedSchedule('seed_user_dispatcher', RouteCode.GOA, created!.id, {
    boardingStartTime: loadingAt(departureTime, 20),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: 205,
  });

  const assignments = await prisma.tripAssignment.findMany({ where: { tripId: created!.id }, orderBy: { assignedAt: 'asc' } });
  assert.equal(assignments.length, 2);
  assert.equal(assignments.find((assignment) => assignment.id === original.id)?.status, 'CANCELLED');
  assert.equal(assignments.at(-1)?.status, 'ACCEPTED');
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: created!.id } })).status, TripStatus.ASSIGNED);
});

test('17c. a dispatcher can cancel an automatically active current-day assignment and remove its queue row', async () => {
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_021' } });
  assert.ok(vehicle.assignedDriverId);
  await prisma.queueEntry.updateMany({ where: { vehicleId: vehicle.id }, data: { status: QueueStatus.REPLACED } });
  const serviceDay = manilaServiceDay(new Date());
  const departureTime = new Date(serviceDay.start.getTime() + 12 * 60 * 60_000);
  const trip = await prisma.trip.create({
    data: {
      vehicleId: vehicle.id,
      route: RouteCode.GOA,
      scheduledOrTriggeredTime: departureTime,
      boardingStartTime: new Date(departureTime.getTime() - 10 * 60_000),
      status: TripStatus.ASSIGNED,
      fareAmount: DEFAULT_GOA_FARE,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const assignment = await prisma.tripAssignment.create({
    data: {
      tripId: trip.id,
      driverId: vehicle.assignedDriverId!,
      status: AssignmentStatus.ACCEPTED,
      respondedAt: new Date(),
      responseDeadline: new Date(),
    },
  });

  await admitAcceptedGosoSchedulesForDay(new Date());
  const accepted = await prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert.equal(accepted.status, 'ACCEPTED');
  assert.ok(accepted.queueEntryId);
  const driverOverview = await getDriverOverview(vehicle.assignedDriverId!);
  assert.equal(driverOverview.assignments.find((item) => item.id === assignment.id)?.status, 'accepted');
  const queue = await prisma.queueEntry.findUniqueOrThrow({ where: { id: accepted.queueEntryId! } });
  assert.equal(queue.vehicleId, vehicle.id);
  assert.equal(queue.status, QueueStatus.ACCEPTED);
  await cancelAssignmentByDispatcher('seed_user_dispatcher', RouteCode.GOA, assignment.id);
  const cancelled = await prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  const removedQueue = await prisma.queueEntry.findUniqueOrThrow({ where: { id: accepted.queueEntryId! } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(removedQueue.status, QueueStatus.REPLACED);
  assert.equal(await prisma.queueEntry.count({ where: { vehicleId: vehicle.id, status: { in: [QueueStatus.WAITING, QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH, QueueStatus.DELAYED] } } }), 0);
  const cancellationLog = await prisma.dispatchLog.findFirstOrThrow({ where: { targetId: trip.id, action: 'ASSIGNMENT_CANCELLED' }, orderBy: { timestamp: 'desc' } });
  assert.equal(cancellationLog.actorUserId, 'seed_user_dispatcher');
  assert.equal((cancellationLog.metadata as { cancelledByDispatcher?: boolean }).cancelledByDispatcher, true);
});

test('17d. an active future Friday-style schedule automatically enters the queue on its service day', async () => {
  const driver = await prisma.user.create({
    data: {
      role: UserRole.DRIVER,
      name: 'Future Accepted Driver',
      email: 'future-accepted-driver@example.test',
      passwordHash: 'test-only',
      isActive: true,
      managedByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      vanId: 'FUTURE-ACCEPTED-VAN',
      plateNo: 'FUTURE-ACCEPTED-PLATE',
      route: RouteCode.GOA,
      protocol: 'GOSO',
      capacity: 11,
      status: VehicleStatus.OUTSIDE_ZONE,
      assignedDriverId: driver.id,
      managedByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const today = manilaServiceDay(new Date());
  const serviceDayStart = today.end;
  const departureTime = new Date(serviceDayStart.getTime() + 12 * 60 * 60_000);
  const boardingStartTime = new Date(departureTime.getTime() - 10 * 60_000);
  const trip = await prisma.trip.create({
    data: {
      vehicleId: vehicle.id,
      route: RouteCode.GOA,
      scheduledOrTriggeredTime: departureTime,
      boardingStartTime,
      status: TripStatus.ASSIGNED,
      fareAmount: DEFAULT_GOA_FARE,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const assignment = await prisma.tripAssignment.create({
    data: {
      tripId: trip.id,
      driverId: driver.id,
      status: AssignmentStatus.ACCEPTED,
      respondedAt: new Date(),
      responseDeadline: boardingStartTime,
    },
  });

  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).queueEntryId, null);

  const serviceDayNow = new Date(serviceDayStart.getTime() + 60 * 60_000);
  const first = await admitAcceptedGosoSchedulesForDay(serviceDayNow);
  const accepted = await prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include: { queueEntry: true } });
  assert.equal(first.admitted, 1);
  assert.ok(accepted.queueEntryId);
  assert.equal(accepted.queueEntry?.status, QueueStatus.ACCEPTED);
  assert.equal(accepted.queueEntry?.scheduledLoadingTime?.getTime(), boardingStartTime.getTime());
  assert.equal((await admitAcceptedGosoSchedulesForDay(serviceDayNow)).admitted, 0);
  assert.equal(await prisma.queueEntry.count({ where: { vehicleId: vehicle.id, status: { in: [QueueStatus.WAITING, QueueStatus.ASSIGNED, QueueStatus.ACCEPTED, QueueStatus.READY_FOR_DISPATCH, QueueStatus.DELAYED] } } }), 1);
});

test('17e. an obsolete active Goa occurrence does not enter the current queue', async () => {
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_021' } });
  assert.ok(vehicle.assignedDriverId);
  const currentDay = manilaServiceDay(new Date());
  const departureTime = new Date(currentDay.start.getTime() - 60 * 60_000);
  const trip = await prisma.trip.create({
    data: {
      vehicleId: vehicle.id,
      route: RouteCode.GOA,
      scheduledOrTriggeredTime: departureTime,
      boardingStartTime: new Date(departureTime.getTime() - 10 * 60_000),
      status: TripStatus.ASSIGNED,
      fareAmount: DEFAULT_GOA_FARE,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const assignment = await prisma.tripAssignment.create({
    data: {
      tripId: trip.id,
      driverId: vehicle.assignedDriverId!,
      status: AssignmentStatus.ACCEPTED,
      respondedAt: new Date(),
      responseDeadline: new Date(),
    },
  });
  assert.equal((await admitAcceptedGosoSchedulesForDay(new Date())).admitted, 0);
  assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).queueEntryId, null);
});

test('18. fixed schedules are forbidden for the Legazpi dispatcher', async () => {
  await assert.rejects(
    createManagedSchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, {
      boardingStartTime: loadingAt(new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString()),
      departureTime: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
      vehicleId: 'seed_vehicle_019',
      fareAmount: 250,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'GOSO_SCHEDULE_ONLY',
  );
});

test('19. booked or assigned departures cannot change their time or van', async () => {
  await assert.rejects(
    updateManagedSchedule('seed_user_dispatcher', RouteCode.GOA, 'seed_trip_goa_morning', {
      boardingStartTime: loadingAt(new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString()),
      departureTime: new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString(),
      vehicleId: 'seed_vehicle_021',
      fareAmount: DEFAULT_GOA_FARE,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'BOOKED_SCHEDULE_LOCKED',
  );
});

test('20. a newly geofenced Taya van receives an active trip and assignment', async () => {
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: {
      goOnTripEnabled: true,
      lastKnownInsideZone: false,
      insideTerminalZone: false,
      terminalEntrySampleCount: 0,
      latestLocationObservedAt: null,
    },
  });
  const result = await recordReliableSequence(
    'seed_user_driver_noel',
    Array.from({ length: TERMINAL_GEOFENCE.requiredSamples }, () => 0.05),
  );
  const trip = await prisma.trip.findFirst({
    where: { vehicleId: 'seed_vehicle_005', route: RouteCode.LEGAZPI, status: { in: [TripStatus.ASSIGNING, TripStatus.ASSIGNED] } },
    include: { assignments: true },
  });
  assert.equal(result?.transition, 'terminal_arrival_confirmed');
  assert.ok(trip);
  assert.equal(trip?.assignments[0]?.driverId, 'seed_user_driver_noel');
  assert.equal(trip?.assignments[0]?.status, 'ACCEPTED');
});

test('20b. only the driver can switch Go on Trip off', async () => {
  const driverId = 'seed_user_driver_noel';
  const vehicleId = 'seed_vehicle_005';
  await prisma.vehicle.update({ where: { id: vehicleId }, data: { latestLocationObservedAt: null } });
  await setGoOnTrip(driverId, false);
  const observedAt = new Date();
  const blocked = await recordDriverLocation(driverId, latitudeAtDistanceKm(3), NCEBT.longitude, observedAt, 10);
  assert.equal(blocked.transition, 'disabled');
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).latestLocationObservedAt, null);

  await setGoOnTrip(driverId, true);
  const accepted = await recordDriverLocation(driverId, latitudeAtDistanceKm(3), NCEBT.longitude, new Date(observedAt.getTime() + 1_000), 10);
  assert.notEqual(accepted.transition, 'disabled');
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).goOnTripEnabled, true);

  await setGoOnTrip(driverId, false);
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).goOnTripEnabled, false);
});

test('21. a rejected GCash payment releases the seat and notifies the passenger', async () => {
  await decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, 'seed_payment_gcash', 'reject', 'Receipt amount does not match the booking total.');
  const booking = await getPassengerBooking('seed_user_passenger_maria', 'UVGO-DEMO-002');
  const notification = await prisma.notification.findFirst({
    where: { userId: 'seed_user_passenger_maria', message: { contains: 'was rejected' } },
    orderBy: { createdAt: 'desc' },
  });

  // Rejected manual payments move to FORFEITED so the seat is released for
  // other passengers. PENDING_PAYMENT would keep the seat blocked indefinitely.
  assert.equal(booking.status, 'forfeited');
  assert.equal(booking.payment?.status, 'rejected');
  assert.equal(booking.payment?.rejectionReason, 'Receipt amount does not match the booking total.');
  assert.equal(booking.totalAmount, DEFAULT_GOA_FARE * 2);
  assert.equal(booking.canReschedule, false);
  assert.match(notification?.message ?? '', /Receipt amount does not match/);
});

test('22. dispatcher announcements reach only active drivers managed by that dispatcher', async () => {
  await prisma.user.update({ where: { id: 'seed_user_driver_mario' }, data: { isActive: false } });
  const message = 'Please return to the Goa terminal for the 3:00 PM dispatch briefing.';

  const announcement = await sendDriverAnnouncement('seed_user_dispatcher', RouteCode.GOA, {
    driverId: 'all',
    message,
  });
  const [rodelNotification, marioNotification, pedroNotification, auditLog] = await Promise.all([
    prisma.notification.findFirst({ where: { userId: 'seed_user_driver_rodel', type: 'SYSTEM', message } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_driver_mario', type: 'SYSTEM', message } }),
    prisma.notification.findFirst({ where: { userId: 'seed_user_driver_pedro', type: 'SYSTEM', message } }),
    prisma.dispatchLog.findFirst({ where: { actorUserId: 'seed_user_dispatcher', action: 'DRIVER_NOTIFIED', reason: message } }),
  ]);

  assert.equal(announcement.recipientCount, 1);
  assert.deepEqual(announcement.recipients.map((driver) => driver.id), ['seed_user_driver_rodel']);
  assert.ok(rodelNotification);
  assert.equal(marioNotification, null);
  assert.equal(pedroNotification, null);
  assert.equal((auditLog?.metadata as { announcement?: boolean } | null)?.announcement, true);

  await assert.rejects(
    sendDriverAnnouncement('seed_user_dispatcher', RouteCode.GOA, {
      driverId: 'seed_user_driver_pedro',
      message: 'This cross-route announcement must not be delivered.',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'ANNOUNCEMENT_RECIPIENT_NOT_FOUND',
  );
});

test('23. entering the 5 km Active Zone starts tracking but does not create a FIFO arrival', async () => {
  await prisma.queueEntry.delete({ where: { id: 'seed_queue_goa_2' } });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_021' },
    data: {
      status: VehicleStatus.OUTSIDE_ZONE,
      goOnTripEnabled: true,
      lastKnownInsideZone: false,
      insideTerminalZone: false,
      latestArrivalAt: null,
      latestLocationObservedAt: null,
    },
  });

  const result = await recordDriverLocation(
    'seed_user_driver_mario',
    latitudeAtDistanceKm(3),
    NCEBT.longitude,
    new Date(),
    10,
  );
  const [vehicle, queueCount] = await Promise.all([
    prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_021' } }),
    prisma.queueEntry.count({ where: { vehicleId: 'seed_vehicle_021' } }),
  ]);

  assert.equal(result.transition, 'active_zone_entered');
  assert.equal(vehicle.status, VehicleStatus.INCOMING);
  assert.equal(vehicle.lastKnownInsideZone, true);
  assert.equal(vehicle.insideTerminalZone, false);
  assert.equal(vehicle.latestArrivalAt, null);
  assert.equal(queueCount, 0);
});

test('23a. browser location reports use server receipt time instead of a repeated device timestamp', async () => {
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_033' },
    data: { goOnTripEnabled: true, latestLocationObservedAt: null },
  });
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'driver.rodel@uvgo.demo', password: 'UVGoDemo123!' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);

    const receivedAfter = Date.now();
    const location = await fetch(`${baseUrl}/driver/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        latitude: NCEBT.latitude,
        longitude: NCEBT.longitude,
        accuracyMeters: 20,
        observedAt: '2020-01-01T00:00:00.000Z',
      }),
    });
    assert.equal(location.status, 200);
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } });
    assert.ok(vehicle.latestLocationObservedAt);
    assert.ok(vehicle.latestLocationObservedAt.getTime() >= receivedAfter);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('24. a lower-position Taya exit becomes an exception without advancing the queue', async () => {
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: {
      goOnTripEnabled: true,
      insideTerminalZone: true,
      latestLocationObservedAt: null,
      terminalExitSampleCount: 0,
      departureAuthorizedAt: null,
      departureAuthorizedTripId: null,
    },
  });
  const distances = Array.from(
    { length: TERMINAL_GEOFENCE.requiredSamples },
    (_, index) => TERMINAL_GEOFENCE.departureRadiusKm + 0.03 + index * 0.05,
  );

  const result = await recordReliableSequence('seed_user_driver_noel', distances);
  const [vehicle, queue, head] = await Promise.all([
    prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_005' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_legazpi_2' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_legazpi_1' } }),
  ]);

  assert.equal(result?.transition, 'departure_review_required');
  assert.equal(vehicle.status, VehicleStatus.DEPARTURE_REVIEW);
  assert.equal(vehicle.departureReviewRequired, true);
  assert.notEqual(queue.status, QueueStatus.DEPARTED);
  assert.equal(queue.position, 2);
  assert.equal(head.position, 1);
  assert.equal(await prisma.dispatchLog.count({ where: { action: DispatchAction.TRIP_DEPARTED } }), 0);
});

test('25. protocol authorization waits for reliable outward GPS samples before atomically advancing FIFO', async () => {
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_morning' },
    data: { scheduledOrTriggeredTime: new Date(Date.now() - 60_000) },
  });
  await startDriverTrip('seed_user_driver_rodel');

  const beforeGps = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } }),
    prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } }),
  ]);
  assert.equal(beforeGps[0].status, TripStatus.READY);
  assert.equal(beforeGps[0].departedAt, null);
  assert.equal(beforeGps[1].status, QueueStatus.READY_FOR_DISPATCH);
  assert.equal(beforeGps[2].status, VehicleStatus.DEPARTURE_PENDING);

  const distances = Array.from(
    { length: TERMINAL_GEOFENCE.requiredSamples },
    (_, index) => TERMINAL_GEOFENCE.departureRadiusKm + 0.03 + index * 0.05,
  );
  const result = await recordReliableSequence('seed_user_driver_rodel', distances);
  const [trip, departedQueue, nextQueue, vehicle] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } }),
    prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } }),
  ]);

  assert.equal(result?.transition, 'departure_confirmed');
  assert.equal(trip.status, TripStatus.DEPARTED);
  assert.ok(trip.departedAt);
  assert.equal(departedQueue.status, QueueStatus.DEPARTED);
  assert.equal(nextQueue.position, 1);
  assert.equal(vehicle.status, VehicleStatus.ON_TRIP);
  assert.equal(vehicle.departureAuthorizedAt, null);
});

test('26. a dispatcher can confirm an authorized departure when GPS is uncertain', async () => {
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_morning' },
    data: { scheduledOrTriggeredTime: new Date(Date.now() - 60_000) },
  });
  await startDriverTrip('seed_user_driver_rodel');

  await assert.rejects(
    confirmDepartureByDispatcher(
      'seed_user_dispatcher',
      RouteCode.GOA,
      'seed_trip_goa_morning',
      'This must remain blocked until GPS uncertainty is recorded.',
    ),
    (error: unknown) => error instanceof AppError && error.code === 'MANUAL_GPS_REVIEW_REQUIRED',
  );
  const gpsResult = await recordDriverLocation(
    'seed_user_driver_rodel',
    latitudeAtDistanceKm(TERMINAL_GEOFENCE.departureRadiusKm + 0.1),
    NCEBT.longitude,
    new Date(),
    TERMINAL_GEOFENCE.maxAccuracyMeters + 25,
  );
  assert.equal(gpsResult.transition, 'departure_review_required');

  const result = await confirmDepartureByDispatcher(
    'seed_user_dispatcher',
    RouteCode.GOA,
    'seed_trip_goa_morning',
    'Gate officer visually confirmed the van exited while phone GPS was unstable.',
  );
  const [trip, queue, log] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } }),
    prisma.dispatchLog.findFirst({
      where: { targetId: 'seed_trip_goa_morning', action: 'TRIP_DEPARTED', actorUserId: 'seed_user_dispatcher' },
      orderBy: { timestamp: 'desc' },
    }),
  ]);

  assert.equal(result.method, 'dispatcher');
  assert.equal(trip.status, TripStatus.DEPARTED);
  assert.equal(queue.status, QueueStatus.DEPARTED);
  assert.equal((log?.metadata as { manualGpsFallback?: boolean } | null)?.manualGpsFallback, true);
});

test('27. abandoning a PayPal checkout releases the held seats', { skip: process.env.DEMO_MODE === 'false' }, async () => {
  const order = await createPaypalReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [4], contact: '09170000001' });

  const held = await prisma.reservationSeat.findUnique({ where: { tripId_seatNumber: { tripId: 'seed_trip_goa_day_three', seatNumber: 4 } } });
  assert.equal(held?.reservationId !== undefined, true);

  const released = await releasePaypalReservation('seed_user_passenger_ana', order.reference);
  assert.equal(released.released, true);

  // The reservation and its seat hold are gone, so the seat is bookable again.
  assert.equal(await prisma.reservation.findUnique({ where: { reference: order.reference } }), null);
  assert.equal(await prisma.reservationSeat.findUnique({ where: { tripId_seatNumber: { tripId: 'seed_trip_goa_day_three', seatNumber: 4 } } }), null);
});

test('28. abandoning a PayPal checkout never discards a captured payment', { skip: process.env.DEMO_MODE === 'false' }, async () => {
  const order = await createPaypalReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [5], contact: '09170000001' });
  await capturePaypalReservation('seed_user_passenger_ana', order.reference);

  const released = await releasePaypalReservation('seed_user_passenger_ana', order.reference);
  assert.equal(released.released, false);

  const survivor = await prisma.reservation.findUniqueOrThrow({ where: { reference: order.reference } });
  assert.equal(survivor.status, ReservationStatus.CONFIRMED);
});

test('29. a single-button PayPal report is held for dispatcher verification', async () => {
  // The dashboard button pays on PayPal's own page and hands back no order id,
  // so unlike createPaypalReservation this must land in PENDING_VERIFICATION
  // with no paypalOrderId, ready for a dispatcher decision.
  const booking = await createPaypalHostedReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: 'seed_trip_goa_day_three',
    seats: [6],
    contact: '09170000001',
    paypalTransactionReference: 'PP-HOSTED-TEST-001',
  });

  assert.equal(booking.status, 'pending_verification');
  assert.equal(booking.payment?.status, 'pending_verification');
  assert.equal(booking.payment?.method, 'paypal');
  assert.equal(booking.payment?.transactionReference, 'PP-HOSTED-TEST-001');

  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { reference: booking.reference },
    include: { payments: true, seats: true },
  });
  assert.equal(reservation.payments[0]?.paypalOrderId, null);
  assert.equal(reservation.payments[0]?.gcashReference, 'PP-HOSTED-TEST-001');
  assert.equal(reservation.payments[0]?.externalReferenceKey, 'PAYPAL:PP-HOSTED-TEST-001');
  assert.equal(reservation.seats[0]?.seatNumber, 6);
  const notification = await prisma.notification.findFirst({ where: { userId: 'seed_user_passenger_ana', message: { contains: booking.reference } } });
  assert.ok(notification, 'reservation and PayPal notification should commit together');
  const dispatcherPayment = (await getDispatcherPayments(RouteCode.GOA)).paypal.find((item) => item.reservation.reference === booking.reference);
  assert.equal(dispatcherPayment?.transactionReference, booking.payment?.transactionReference);

  // A passenger cannot create a reviewable hold without identifying the
  // completed PayPal transaction they claim to have paid.
  await assert.rejects(
    () => createPaypalHostedReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seats: [7],
      contact: '09170000001',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'PAYPAL_REFERENCE_REQUIRED',
  );

  // The seats are held while verification is pending, so a second passenger
  // cannot take them.
  await assert.rejects(
    () => createPaypalHostedReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seats: [6],
      contact: '09170000001',
      paypalTransactionReference: 'PP-HOSTED-TEST-002',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'SEAT_UNAVAILABLE',
  );

  await assert.rejects(
    () => createPaypalHostedReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seats: [7],
      contact: '09170000001',
      paypalTransactionReference: 'PP-HOSTED-TEST-001',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'PAYPAL_REFERENCE_ALREADY_REPORTED',
  );
});

test('30. dispatcher approval and rejection handle reported PayPal payments safely', async () => {
  const approved = await createPaypalHostedReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: 'seed_trip_goa_day_three',
    seats: [6],
    contact: '09170000001',
    paypalTransactionReference: 'PP-MANUAL-APPROVE',
  });
  const approvedPayment = await prisma.payment.findFirstOrThrow({ where: { reservation: { reference: approved.reference } } });
  await decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, approvedPayment.id, 'approve', '');
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { reference: approved.reference } })).status, ReservationStatus.CONFIRMED);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: approvedPayment.id } })).status, PaymentStatus.VERIFIED);
  const approvalNotification = await prisma.notification.findFirst({ where: { userId: 'seed_user_passenger_ana', message: { contains: approved.reference } }, orderBy: { createdAt: 'desc' } });
  assert.match(approvalNotification?.message ?? '', /bring a valid ID/i);

  const rejected = await createPaypalHostedReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: 'seed_trip_goa_day_three',
    seats: [7],
    contact: '09170000001',
    paypalTransactionReference: 'PP-MANUAL-REJECT',
  });
  const rejectedPayment = await prisma.payment.findFirstOrThrow({ where: { reservation: { reference: rejected.reference } } });
  await assert.rejects(
    () => decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, rejectedPayment.id, 'reject', '   '),
    (error: unknown) => error instanceof AppError && error.code === 'REJECTION_REASON_REQUIRED',
  );
  await decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, rejectedPayment.id, 'reject', 'Transaction was not found.');
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { reference: rejected.reference } })).status, ReservationStatus.FORFEITED);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: rejectedPayment.id } })).status, PaymentStatus.REJECTED);

  // REJECTED is intentionally outside activeReservationStatuses, so the seat is
  // available to the next passenger instead of being blocked indefinitely.
  const reused = await createPaypalHostedReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: 'seed_trip_goa_day_three',
    seats: [7],
    contact: '09170000001',
    paypalTransactionReference: 'PP-MANUAL-REUSED-SEAT',
  });
  assert.equal(reused.status, 'pending_verification');
});

test('31. an unbooked schedule can be removed even though it carries an auto-assignment', async () => {
  const departureTime = new Date(Date.now() + 6 * 24 * 60 * 60_000).toISOString();
  const result = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
  });
  const created = result.schedules.find((schedule) => schedule.departureTime === departureTime);
  assert.ok(created);

  // Creating a schedule always assigns its driver. That assignment is a
  // consequence of the schedule, not a passenger commitment, so it must not
  // block removal — previously it did, making every schedule undeletable.
  assert.equal(created?.assignmentCount, 1);

  const afterRemoval = await deleteManagedSchedule('seed_user_dispatcher', RouteCode.GOA, created!.id);
  assert.equal(afterRemoval.schedules.some((schedule) => schedule.id === created?.id), false);
  assert.equal(await prisma.trip.findUnique({ where: { id: created!.id } }), null);
  // Assignments cascade away with the trip instead of orphaning.
  assert.equal(await prisma.tripAssignment.count({ where: { tripId: created!.id } }), 0);

  const log = await prisma.dispatchLog.findFirst({ where: { action: 'SCHEDULE_DELETED', targetId: created!.id } });
  assert.ok(log);
  const notification = await prisma.notification.findFirst({
    where: { userId: 'seed_user_driver_rodel', type: 'ASSIGNMENT', message: { contains: 'was removed by the dispatcher' } },
  });
  assert.ok(notification);
});

test('32. a schedule with passenger reservations cannot be removed', async () => {
  const departureTime = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  const result = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
  });
  const created = result.schedules.find((schedule) => schedule.departureTime === departureTime);
  assert.ok(created);
  await createGcashReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: created!.id,
    seats: [1],
    contact: '09170000001',
    gcashReference: 'GCASH-SCHEDULE-DELETE',
    receiptImageKey: 'test.png',
    receiptMimeType: 'image/png',
  });

  await assert.rejects(
    () => deleteManagedSchedule('seed_user_dispatcher', RouteCode.GOA, created!.id),
    (error: unknown) => error instanceof AppError && error.code === 'SCHEDULE_DELETE_BLOCKED',
  );
  assert.ok(await prisma.trip.findUnique({ where: { id: created!.id } }));
});

test('33. dispatcher-set seat capacity drives the seat map, booking and occupancy', async () => {
  const management = await createManagedDriver('seed_user_dispatcher', RouteCode.GOA, {
    name: 'Capacity Test Driver',
    contact: '09170000033',
    email: 'capacity.test@uvgo.test',
    password: 'Temporary123!',
    vehicle: { vanId: 'VAN-132', plateNo: 'EAG-132', capacity: 14 },
  });
  const created = management.drivers.find((driver) => driver?.email === 'capacity.test@uvgo.test');
  assert.equal(created?.vehicle?.capacity, 14);
  const vehicle = await prisma.vehicle.findUnique({ where: { vanId: 'VAN-132' } });
  assert.equal(vehicle?.capacity, 14);

  const departureTime = new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString();
  const schedules = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime),
    departureTime,
    vehicleId: vehicle!.id,
    fareAmount: DEFAULT_GOA_FARE,
  });
  const schedule = schedules.schedules.find((item) => item.departureTime === departureTime);
  assert.ok(schedule);
  assert.equal(schedule?.vehicle.capacity, 14);

  // The seat map must follow the van, not a global constant.
  const seatMap = await getTripSeats(schedule!.id);
  assert.equal(seatMap.trip.capacity, 14);
  assert.equal(seatMap.seats.length, 14);

  // Seat 14 is inside this van's capacity; seat 15 is not.
  const booking = await createGcashReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: schedule!.id,
    seats: [14],
    contact: '09170000001',
    gcashReference: 'GCASH-CAPACITY-VALID',
    receiptImageKey: 'test.png',
    receiptMimeType: 'image/png',
  });
  assert.deepEqual(booking.seats, [14]);
  await assert.rejects(
    () => createGcashReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: schedule!.id,
      seats: [15],
      contact: '09170000001',
      gcashReference: 'GCASH-CAPACITY-INVALID',
      receiptImageKey: 'test.png',
      receiptMimeType: 'image/png',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_SEAT',
  );

  // Out-of-range capacities are refused rather than silently clamped.
  await assert.rejects(
    () => createManagedDriver('seed_user_dispatcher', RouteCode.GOA, {
      name: 'Too Many Seats',
      contact: '09170000034',
      email: 'too.many@uvgo.test',
      password: 'Temporary123!',
      vehicle: { vanId: 'VAN-199', plateNo: 'EAG-199', capacity: 99 },
    }),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_VEHICLE_CAPACITY',
  );
});

test('34. creating a schedule requires both a loading start and a departure time', async () => {
  const departureTime = new Date(Date.now() + 9 * 24 * 60 * 60_000).toISOString();

  // A departure with no loading window is not dispatchable.
  await assert.rejects(
    () => createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
      boardingStartTime: '',
      departureTime,
      vehicleId: 'seed_vehicle_033',
      fareAmount: DEFAULT_GOA_FARE,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'BOARDING_START_REQUIRED',
  );

  // Loading cannot begin at or after the van leaves.
  await assert.rejects(
    () => createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
      boardingStartTime: departureTime,
      departureTime,
      vehicleId: 'seed_vehicle_033',
      fareAmount: DEFAULT_GOA_FARE,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'BOARDING_START_AFTER_DEPARTURE',
  );

  // Both times are persisted and returned, with the dispatcher's own lead time.
  const result = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loadingAt(departureTime, 25),
    departureTime,
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
  });
  const created = result.schedules.find((schedule) => schedule.departureTime === departureTime);
  assert.ok(created);
  assert.equal(new Date(created!.boardingStartTime).toISOString(), loadingAt(departureTime, 25));
  assert.equal(new Date(created!.departureTime).toISOString(), departureTime);

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: created!.id } });
  assert.equal(trip.boardingStartTime?.toISOString(), loadingAt(departureTime, 25));
  assert.equal(trip.scheduledOrTriggeredTime.toISOString(), departureTime);
});

test('35. every Goa departure exposes both schedule times to the driver', async () => {
  const trips = await prisma.trip.findMany({
    where: { route: RouteCode.GOA },
    select: { id: true, boardingStartTime: true, scheduledOrTriggeredTime: true },
  });
  assert.ok(trips.length > 0);
  for (const trip of trips) {
    assert.ok(trip.scheduledOrTriggeredTime, `${trip.id} has no departure time`);
    assert.ok(trip.boardingStartTime, `${trip.id} has no passenger loading start time`);
    assert.ok(
      trip.boardingStartTime!.getTime() < trip.scheduledOrTriggeredTime.getTime(),
      `${trip.id} starts loading at or after departure`,
    );
  }

  // A departure with no explicit loading time still derives one from the
  // boarding window, so a driver is never left without a loading window.
  await prisma.trip.update({ where: { id: 'seed_trip_goa_day_three' }, data: { boardingStartTime: null } });
  const payload = await getManagedSchedules('seed_user_dispatcher', RouteCode.GOA);
  const fallback = payload.schedules.find((schedule) => schedule.id === 'seed_trip_goa_day_three');
  assert.ok(fallback);
  assert.equal(
    new Date(fallback!.boardingStartTime).getTime(),
    new Date(fallback!.departureTime).getTime() - 10 * 60_000,
  );
});

test('36. passenger trip and booking responses expose loading and departure times', async () => {
  const storedTrip = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_day_three' } });
  const boardingStartTime = new Date(storedTrip.scheduledOrTriggeredTime.getTime() - 25 * 60_000);
  await prisma.trip.update({
    where: { id: storedTrip.id },
    data: { boardingStartTime },
  });

  const searchResult = (await searchGoaTrips(undefined, 1)).find((trip) => trip.id === storedTrip.id);
  assert.ok(searchResult);
  assert.equal(searchResult.boardingStartTime, boardingStartTime.toISOString());
  assert.equal(searchResult.departureTime, storedTrip.scheduledOrTriggeredTime.toISOString());

  const seatMap = await getTripSeats(storedTrip.id);
  assert.equal(seatMap.trip.boardingStartTime, boardingStartTime.toISOString());
  assert.equal(seatMap.trip.departureTime, storedTrip.scheduledOrTriggeredTime.toISOString());
  const availableSeat = seatMap.seats.find((seat) => seat.available);
  assert.ok(availableSeat);

  const booking = await createGcashReservation({
    passengerId: 'seed_user_passenger_ana',
    tripId: storedTrip.id,
    seats: [availableSeat.number],
    contact: '09170000001',
    gcashReference: 'GCASH-SCHEDULE-TIMES',
    receiptImageKey: 'test.png',
    receiptMimeType: 'image/png',
  });
  assert.equal(booking.boardingStartTime, boardingStartTime.toISOString());
  assert.equal(booking.departureTime, storedTrip.scheduledOrTriggeredTime.toISOString());
});

test('37. a trip that closes after search cannot expose seats or accept a reservation', async () => {
  await prisma.trip.update({ where: { id: 'seed_trip_goa_day_three' }, data: { status: TripStatus.UNABLE_TO_DEPART } });

  const searchResult = await searchGoaTrips(undefined, 1);
  assert.equal(searchResult.some((trip) => trip.id === 'seed_trip_goa_day_three'), false);
  await assert.rejects(
    () => getTripSeats('seed_trip_goa_day_three'),
    (error: unknown) => error instanceof AppError && error.code === 'TRIP_CLOSED',
  );
  await assert.rejects(
    () => createGcashReservation({
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seats: [1],
      contact: '09170000001',
      gcashReference: 'GCASH-CLOSED-TRIP',
      receiptImageKey: 'test.png',
      receiptMimeType: 'image/png',
    }),
    (error: unknown) => error instanceof AppError && error.code === 'TRIP_CLOSED',
  );
});

test('38. only confirmed bookings can be rescheduled', async () => {
  await assert.rejects(
    () => reschedulePassengerBooking('seed_user_passenger_maria', 'UVGO-DEMO-002', 'seed_trip_goa_day_three', [5, 6]),
    (error: unknown) => error instanceof AppError && error.code === 'BOOKING_NOT_RESCHEDULABLE',
  );
});

test('39. rescheduling cannot move a passenger onto a closed trip', async () => {
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_morning' },
    data: { scheduledOrTriggeredTime: new Date(Date.now() + 4 * 24 * 60 * 60_000) },
  });
  await prisma.trip.update({ where: { id: 'seed_trip_goa_day_three' }, data: { status: TripStatus.UNABLE_TO_DEPART } });

  await assert.rejects(
    () => reschedulePassengerBooking('seed_user_passenger_ana', 'UVGO-DEMO-001', 'seed_trip_goa_day_three', [5]),
    (error: unknown) => error instanceof AppError && error.code === 'INVALID_RESCHEDULE_TRIP',
  );
});

async function loadingQueueFixture(now = new Date()) {
  const departure = new Date(now.getTime() + 20 * 60_000);
  await prisma.trip.update({ where: { id: 'seed_trip_goa_morning' }, data: { boardingStartTime: now, scheduledOrTriggeredTime: departure, status: TripStatus.ASSIGNED } });
  await prisma.tripAssignment.update({ where: { id: 'seed_assignment_goa' }, data: { status: 'ACCEPTED', respondedAt: now } });
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: false, latestDistanceKm: 0.2 } });
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_021' }, data: { insideTerminalZone: true, latestDistanceKm: 0.02, latestLocationObservedAt: now, latestLocationAccuracyM: 10, status: VehicleStatus.AT_TERMINAL, goOnTripEnabled: true } });
  const next = await prisma.trip.create({ data: { vehicleId: 'seed_vehicle_021', route: RouteCode.GOA, boardingStartTime: new Date(now.getTime() + 30 * 60_000), scheduledOrTriggeredTime: new Date(now.getTime() + 40 * 60_000), fareAmount: 190, status: TripStatus.ASSIGNED, createdByDispatcherId: 'seed_user_dispatcher' } });
  await prisma.tripAssignment.create({ data: { tripId: next.id, driverId: 'seed_user_driver_mario', status: 'ACCEPTED', responseDeadline: now, respondedAt: now } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { scheduledLoadingTime: now, lateAt: null } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { status: QueueStatus.ACCEPTED, scheduledLoadingTime: new Date(now.getTime() + 30 * 60_000), lateAt: null } });
  await prisma.tripAssignment.updateMany({ where: { tripId: next.id }, data: { queueEntryId: 'seed_queue_goa_2' } });
  return { now, departure, next };
}

test('40. GOSO rotates chronological slots when the due queue head is absent', async () => {
  const { now, departure, next } = await loadingQueueFixture();
  const driver = await prisma.user.create({ data: { email: 'queue-third@example.test', name: 'Driver C', passwordHash: 'test-only', role: 'DRIVER', managedByDispatcherId: 'seed_user_dispatcher' } });
  const van = await prisma.vehicle.create({ data: { vanId: 'TEST-THIRD', plateNo: 'TEST-THIRD', route: 'GOA', protocol: 'GOSO', assignedDriverId: driver.id, capacity: 11, insideTerminalZone: true, latestDistanceKm: 0.01, latestLocationObservedAt: now, latestLocationAccuracyM: 10, status: VehicleStatus.AT_TERMINAL, managedByDispatcherId: 'seed_user_dispatcher' } });
  const loadingC = new Date(now.getTime() + 60 * 60_000);
  const queueC = await prisma.queueEntry.create({ data: { vehicleId: van.id, route: 'GOA', position: 1, arrivalTimestamp: new Date(now.getTime() - 60 * 60_000), status: QueueStatus.ACCEPTED, scheduledLoadingTime: loadingC } });
  const tripC = await prisma.trip.create({ data: { vehicleId: van.id, route: 'GOA', status: TripStatus.ASSIGNED, fareAmount: 190, boardingStartTime: loadingC, scheduledOrTriggeredTime: new Date(loadingC.getTime() + 10 * 60_000) } });
  await prisma.tripAssignment.create({ data: { tripId: tripC.id, driverId: driver.id, queueEntryId: queueC.id, status: 'ACCEPTED', responseDeadline: loadingC, respondedAt: now } });
  const middleReservation = await prisma.reservation.create({ data: { reference: 'ROTATE-MIDDLE', passengerId: 'seed_user_passenger_ana', tripId: next.id, seatCount: 1, fareAmount: 190, status: ReservationStatus.CONFIRMED } });
  await prisma.reservationSeat.create({ data: { reservationId: middleReservation.id, tripId: next.id, seatNumber: 2 } });
  const finalReservation = await prisma.reservation.create({ data: { reference: 'ROTATE-FINAL', passengerId: 'seed_user_passenger_maria', tripId: tripC.id, seatCount: 1, fareAmount: 190, status: ReservationStatus.CONFIRMED } });
  await prisma.reservationSeat.create({ data: { reservationId: finalReservation.id, tripId: tripC.id, seatNumber: 3 } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { position: 3, arrivalTimestamp: new Date(now.getTime() + 5 * 60_000) } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { position: 2, arrivalTimestamp: new Date(now.getTime() - 30 * 60_000) } });

  await withRouteQueue(RouteCode.GOA, (tx) => normalizeSavedQueue(tx, RouteCode.GOA));
  const before = await prisma.queueEntry.findMany({ where: { route: RouteCode.GOA, status: { in: [QueueStatus.ACCEPTED, QueueStatus.ASSIGNED, QueueStatus.WAITING] } }, orderBy: { position: 'asc' } });
  assert.deepEqual(before.map((row) => row.id), ['seed_queue_goa_1', 'seed_queue_goa_2', queueC.id]);
  assert.equal((await evaluateGosoLoading('seed_user_dispatcher', new Date(now.getTime() - 1))).moved, 0);

  const payments = await prisma.payment.findMany({ orderBy: { id: 'asc' } });
  const result = await evaluateGosoLoading('seed_user_dispatcher', now);
  assert.equal(result.moved, 1);
  const source = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' }, include: { assignments: { where: { status: 'ACCEPTED' } }, reservations: { include: { seats: true } } } });
  assert.equal(source.vehicleId, 'seed_vehicle_021');
  assert.equal(source.status, TripStatus.BOARDING);
  assert.equal(source.awaitingQueueReplacement, false);
  assert.equal(source.scheduledOrTriggeredTime.getTime(), departure.getTime());
  assert.equal(source.boardingStartTime?.getTime(), now.getTime());
  assert.equal(source.assignments[0]?.driverId, 'seed_user_driver_mario');
  assert.equal(source.assignments[0]?.queueEntryId, 'seed_queue_goa_2');
  assert.equal(source.reservations.length, 2);
  assert.equal(source.reservations.find((r) => r.reference === 'UVGO-DEMO-001')?.status, ReservationStatus.REALLOCATED);
  assert.equal(source.reservations.find((r) => r.reference === 'UVGO-DEMO-002')?.status, ReservationStatus.PENDING_VERIFICATION);
  assert.deepEqual(source.reservations.flatMap((r) => r.seats.map((s) => s.seatNumber)).sort(), [4, 8, 9]);
  assert.deepEqual(await prisma.payment.findMany({ orderBy: { id: 'asc' } }), payments);
  const rotatedMiddle = await prisma.trip.findUniqueOrThrow({ where: { id: next.id }, include: { assignments: { where: { status: AssignmentStatus.ACCEPTED } }, reservations: true } });
  assert.equal(rotatedMiddle.vehicleId, van.id);
  assert.equal(rotatedMiddle.assignments[0]?.driverId, driver.id);
  assert.equal(rotatedMiddle.assignments[0]?.queueEntryId, queueC.id);
  assert.deepEqual(rotatedMiddle.reservations.map((reservation) => reservation.id), [middleReservation.id]);
  const rotatedFinal = await prisma.trip.findUniqueOrThrow({ where: { id: tripC.id }, include: { assignments: { where: { status: AssignmentStatus.ACCEPTED } }, reservations: true } });
  assert.equal(rotatedFinal.vehicleId, 'seed_vehicle_033');
  assert.equal(rotatedFinal.assignments[0]?.driverId, 'seed_user_driver_rodel');
  assert.equal(rotatedFinal.assignments[0]?.queueEntryId, 'seed_queue_goa_1');
  assert.deepEqual(rotatedFinal.reservations.map((reservation) => reservation.id), [finalReservation.id]);
  assert.equal(await prisma.reservation.count({ where: { id: { in: [middleReservation.id, finalReservation.id] } } }), 2);
  const after = await prisma.queueEntry.findMany({ where: { route: RouteCode.GOA, status: { in: [QueueStatus.ACCEPTED, QueueStatus.ASSIGNED, QueueStatus.WAITING] } }, orderBy: { position: 'asc' } });
  assert.deepEqual(after.map((row) => row.id), ['seed_queue_goa_2', queueC.id, 'seed_queue_goa_1']);
  assert.deepEqual(after.map((row) => row.scheduledLoadingTime?.getTime()), [now.getTime(), now.getTime() + 30 * 60_000, loadingC.getTime()]);
  assert.equal(after[2]?.lateAt?.getTime(), now.getTime());
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).position, 1);
  const second = await evaluateGosoLoading('seed_user_dispatcher', new Date(now.getTime() + 10_000));
  assert.equal(second.moved, 0);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 1);
});

test('40a. GOSO rotates every queue occurrence when the late driver also has a later schedule', async () => {
  const { now, next } = await loadingQueueFixture();
  const repeatLoading = new Date(now.getTime() + 60 * 60_000);
  const repeatQueue = await prisma.queueEntry.create({
    data: {
      vehicleId: 'seed_vehicle_033',
      route: RouteCode.GOA,
      position: 3,
      arrivalTimestamp: now,
      status: QueueStatus.ACCEPTED,
      scheduledLoadingTime: repeatLoading,
    },
  });
  const repeatTrip = await prisma.trip.create({
    data: {
      vehicleId: 'seed_vehicle_033',
      route: RouteCode.GOA,
      status: TripStatus.ASSIGNED,
      fareAmount: 190,
      boardingStartTime: repeatLoading,
      scheduledOrTriggeredTime: new Date(repeatLoading.getTime() + 10 * 60_000),
    },
  });
  await prisma.tripAssignment.create({
    data: {
      tripId: repeatTrip.id,
      driverId: 'seed_user_driver_rodel',
      queueEntryId: repeatQueue.id,
      status: AssignmentStatus.ACCEPTED,
      responseDeadline: repeatLoading,
      respondedAt: now,
    },
  });
  const reservation = await prisma.reservation.create({
    data: {
      reference: 'ROTATE-REPEAT',
      passengerId: 'seed_user_passenger_ana',
      tripId: repeatTrip.id,
      seatCount: 1,
      fareAmount: 190,
      status: ReservationStatus.CONFIRMED,
    },
  });
  await prisma.reservationSeat.create({ data: { reservationId: reservation.id, tripId: repeatTrip.id, seatNumber: 2 } });

  assert.equal((await evaluateGosoLoading('seed_user_dispatcher', now)).moved, 1);

  const rows = await prisma.queueEntry.findMany({
    where: { id: { in: ['seed_queue_goa_1', 'seed_queue_goa_2', repeatQueue.id] } },
    orderBy: { position: 'asc' },
  });
  assert.deepEqual(rows.map((row) => row.id), ['seed_queue_goa_2', repeatQueue.id, 'seed_queue_goa_1']);
  assert.deepEqual(rows.map((row) => row.scheduledLoadingTime?.getTime()), [now.getTime(), now.getTime() + 30 * 60_000, repeatLoading.getTime()]);

  const middleAssignment = await prisma.tripAssignment.findFirstOrThrow({ where: { tripId: next.id, status: AssignmentStatus.ACCEPTED } });
  assert.equal(middleAssignment.driverId, 'seed_user_driver_rodel');
  assert.equal(middleAssignment.queueEntryId, repeatQueue.id);
  const finalAssignment = await prisma.tripAssignment.findFirstOrThrow({ where: { tripId: repeatTrip.id, status: AssignmentStatus.ACCEPTED } });
  assert.equal(finalAssignment.driverId, 'seed_user_driver_rodel');
  assert.equal(finalAssignment.queueEntryId, 'seed_queue_goa_1');
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).tripId, repeatTrip.id);
  assert.equal(await prisma.reservation.count({ where: { id: reservation.id } }), 1);
});

test('41. a present accepted driver at loading is retained and absence before loading is not penalized', async () => {
  const { now } = await loadingQueueFixture();
  assert.equal((await evaluateGosoLoading('seed_user_dispatcher', new Date(now.getTime() - 1))).moved, 0);
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestDistanceKm: 0.05, latestLocationObservedAt: new Date(now.getTime() - 120_000), latestLocationAccuracyM: 10 } });
  await evaluateGosoLoading('seed_user_dispatcher', now);
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } });
  assert.equal(trip.vehicleId, 'seed_vehicle_033');
  assert.equal(trip.status, TripStatus.BOARDING);
  assert.equal(trip.loadingConfirmedVehicleId, trip.vehicleId);
  assert.ok(trip.loadingConfirmedAt);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 0);
});

test('42. a successor adopts the missed slot and is checked against that adopted loading time', async () => {
  const { now, next } = await loadingQueueFixture();
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_021' }, data: { insideTerminalZone: false, latestDistanceKm: 1 } });
  await evaluateGosoLoading('seed_user_dispatcher', now);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).lateAt, null);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 1);
  const loadingB = (await prisma.trip.findUniqueOrThrow({ where: { id: next.id } })).boardingStartTime!;
  const nextCheck = new Date(loadingB.getTime() - 1);
  await evaluateGosoLoading('seed_user_dispatcher', nextCheck);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).lateAt?.getTime(), nextCheck.getTime());
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 2);
  await evaluateGosoLoading('seed_user_dispatcher', loadingB);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).lateAt?.getTime(), nextCheck.getTime());
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 2);
});

test('43. a loading no-show is idempotent and never cancels the accepted assignment', async () => {
  const { now } = await loadingQueueFixture();
  await Promise.all([evaluateGosoLoading('seed_user_dispatcher', now), evaluateGosoLoading('seed_user_dispatcher', now)]);
  assert.equal(await prisma.dispatchLog.count({ where: { targetId: 'seed_queue_goa_1', action: 'MOVED_TO_LAST' } }), 1);
  assert.equal(await prisma.tripAssignment.count({ where: { tripId: 'seed_trip_goa_morning', status: 'ACCEPTED' } }), 1);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).awaitingQueueReplacement, false);
});

test('44. normalization uses scheduled loading time rather than terminal arrival time', async () => {
  const { now } = await loadingQueueFixture();
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { position: 2, arrivalTimestamp: now } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { position: 1, arrivalTimestamp: new Date(now.getTime() - 2 * 60 * 60_000) } });
  await withRouteQueue(RouteCode.GOA, (tx) => normalizeSavedQueue(tx, RouteCode.GOA));
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } })).position, 1);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).position, 2);
});

test('44a. a current-day Goa schedule repairs a stale queue date and remains visible', async () => {
  const { now } = await loadingQueueFixture();
  const today = manilaServiceDay(now);
  await prisma.queueEntry.update({
    where: { id: 'seed_queue_goa_2' },
    data: { scheduledLoadingTime: new Date(today.start.getTime() - 60 * 60_000), position: 7 },
  });
  const queue = await getDispatcherQueue(RouteCode.GOA);
  assert.deepEqual(queue.entries.map((entry) => entry.id), ['seed_queue_goa_1', 'seed_queue_goa_2']);
  assert.equal(queue.entries[0]?.position, 1);
  assert.equal(queue.entries[1]?.position, 2);
  assert.ok(new Date(queue.entries[1]!.scheduledLoadingTime!) >= today.start);
});

test('44b. a shared van queue row represents its earliest active loading schedule', async () => {
  const { now } = await loadingQueueFixture();
  const otherDeparture = new Date(now.getTime() + 5 * 60_000);
  const otherTrip = await prisma.trip.create({
    data: {
      vehicleId: 'seed_vehicle_033',
      route: RouteCode.GOA,
      boardingStartTime: new Date(now.getTime() - 5 * 60_000),
      scheduledOrTriggeredTime: otherDeparture,
      fareAmount: DEFAULT_GOA_FARE,
      status: TripStatus.ASSIGNED,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  await prisma.tripAssignment.create({
    data: {
      tripId: otherTrip.id,
      driverId: 'seed_user_driver_rodel',
      queueEntryId: 'seed_queue_goa_1',
      status: 'ACCEPTED',
      responseDeadline: now,
      respondedAt: now,
      assignedAt: new Date(now.getTime() + 1_000),
    },
  });

  const queue = await getDispatcherQueue(RouteCode.GOA);
  const row = queue.entries.find((entry) => entry.id === 'seed_queue_goa_1');
  assert.equal(row?.tripId, otherTrip.id);
  assert.equal(row?.departureTime, otherDeparture.toISOString());

  const publicQueue = await getPublicDepartures();
  const publicRow = publicQueue.departures.find((entry) => entry.id === 'seed_queue_goa_1');
  assert.equal(publicRow?.departureTime, row?.departureTime);
  assert.equal(publicRow?.queuePosition, row?.position);

  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_1', {
    action: 'update_passengers', passengerCount: 2, reason: '',
  });
  assert.equal((await prisma.passengerCount.findFirstOrThrow({ where: { tripId: otherTrip.id }, orderBy: { timestamp: 'desc' } })).count, 2);
});

test('44c. a dispatched van automatically returns for its next current-day schedule', async () => {
  const { now } = await loadingQueueFixture();
  const nextLoading = new Date(now.getTime() + 60 * 60_000);
  const laterTrip = await prisma.trip.create({
    data: {
      vehicleId: 'seed_vehicle_033',
      route: RouteCode.GOA,
      boardingStartTime: nextLoading,
      scheduledOrTriggeredTime: new Date(nextLoading.getTime() + 10 * 60_000),
      fareAmount: DEFAULT_GOA_FARE,
      status: TripStatus.ASSIGNED,
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  await prisma.tripAssignment.create({
    data: {
      tripId: laterTrip.id,
      driverId: 'seed_user_driver_rodel',
      status: 'ACCEPTED',
      responseDeadline: now,
      respondedAt: now,
      assignedAt: new Date(now.getTime() + 1_000),
    },
  });

  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_1', {
    action: 'update_passengers', passengerCount: 1, reason: '',
  });
  const afterDispatch = await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_1', {
    action: 'dispatch', reason: 'Passenger loading completed',
  });

  assert.equal(afterDispatch.entries.some((entry) => entry.vanId === 'VAN-033' && entry.tripId === laterTrip.id), true);
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } })).status, VehicleStatus.OUTSIDE_ZONE);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).status, TripStatus.DEPARTED);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: laterTrip.id } })).status, TripStatus.ASSIGNED);
  assert.equal(await prisma.passengerCount.count({ where: { tripId: 'seed_trip_goa_morning', count: 1 } }), 1);
  assert.equal(await prisma.queueEntry.count({
    where: { vehicleId: 'seed_vehicle_033', status: { in: operationalQueueStatuses } },
  }), 1);

  const nextQueue = await getDispatcherQueue(RouteCode.GOA);
  assert.equal(nextQueue.entries.some((entry) => entry.vanId === 'VAN-033' && entry.tripId === laterTrip.id), true);
});

test('44d. moving a departed Goso weekly rule later today creates and admits the new queue occurrence', async () => {
  const serviceNow = new Date('2030-01-05T06:00:00+08:00');
  const day = manilaServiceDay(serviceNow);
  const manilaDate = new Date(day.start.getTime() + 8 * 60 * 60_000);
  const weekday = manilaDate.getUTCDay() || 7;
  const templateId = await createWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, {
    weekday,
    boardingTime: '07:07',
    departureTime: '07:17',
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
    isActive: true,
  }, serviceNow);
  const departedOccurrence = await prisma.trip.findUniqueOrThrow({
    where: {
      weeklyScheduleId_weeklyOccurrenceDate: {
        weeklyScheduleId: templateId,
        weeklyOccurrenceDate: day.start,
      },
    },
  });
  const departedAt = new Date(day.start.getTime() + (7 * 60 + 17) * 60_000);
  await prisma.trip.update({
    where: { id: departedOccurrence.id },
    data: { status: TripStatus.DEPARTED, departedAt },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_033' },
    data: { status: VehicleStatus.ON_TRIP, insideTerminalZone: false },
  });

  const updateNow = new Date(day.start.getTime() + 8 * 60 * 60_000);
  await updateWeeklySchedule('seed_user_dispatcher', RouteCode.GOA, templateId, {
    weekday,
    boardingTime: '21:37',
    departureTime: '21:47',
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
    isActive: true,
  }, updateNow);
  const admission = await admitAcceptedGosoSchedulesForDay(updateNow);

  const preservedHistory = await prisma.trip.findUniqueOrThrow({ where: { id: departedOccurrence.id } });
  assert.equal(preservedHistory.status, TripStatus.DEPARTED);
  assert.equal(preservedHistory.weeklyScheduleId, null);
  assert.equal(preservedHistory.weeklyOccurrenceDate, null);

  const replacement = await prisma.trip.findUniqueOrThrow({
    where: {
      weeklyScheduleId_weeklyOccurrenceDate: {
        weeklyScheduleId: templateId,
        weeklyOccurrenceDate: day.start,
      },
    },
    include: { assignments: { include: { queueEntry: true } } },
  });
  assert.equal(replacement.boardingStartTime?.getTime(), day.start.getTime() + (21 * 60 + 37) * 60_000);
  assert.equal(replacement.scheduledOrTriggeredTime.getTime(), day.start.getTime() + (21 * 60 + 47) * 60_000);
  assert.equal(replacement.status, TripStatus.ASSIGNED);
  assert.equal(admission.admitted, 0);
  assert.ok(replacement.assignments.some((assignment) => (
    assignment.status === AssignmentStatus.ACCEPTED
    && assignment.queueEntry?.status === QueueStatus.ACCEPTED
  )));
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } })).status, VehicleStatus.OUTSIDE_ZONE);
});

test('44e. editing a Goa loading schedule updates its queue row and sorts the earliest loading first', async () => {
  const { now, next } = await loadingQueueFixture();
  const laterLoading = new Date(now.getTime() + 45 * 60_000);
  const laterDeparture = new Date(now.getTime() + 55 * 60_000);
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_morning' },
    data: { boardingStartTime: laterLoading, scheduledOrTriggeredTime: laterDeparture },
  });
  await prisma.queueEntry.update({
    where: { id: 'seed_queue_goa_1' },
    data: { scheduledLoadingTime: laterLoading },
  });

  const editedLoading = new Date(now.getTime() + 10 * 60_000);
  const editedDeparture = new Date(now.getTime() + 20 * 60_000);
  await updateManagedSchedule('seed_user_dispatcher', RouteCode.GOA, next.id, {
    boardingStartTime: editedLoading.toISOString(),
    departureTime: editedDeparture.toISOString(),
    vehicleId: 'seed_vehicle_021',
    fareAmount: DEFAULT_GOA_FARE,
  });

  const ordered = await prisma.queueEntry.findMany({
    where: { id: { in: ['seed_queue_goa_1', 'seed_queue_goa_2'] } },
    orderBy: { position: 'asc' },
  });
  assert.deepEqual(ordered.map((row) => row.id), ['seed_queue_goa_2', 'seed_queue_goa_1']);
  assert.deepEqual(
    ordered.map((row) => row.scheduledLoadingTime?.getTime()),
    [editedLoading.getTime(), laterLoading.getTime()],
  );
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: next.id } })).boardingStartTime?.getTime(), editedLoading.getTime());
});

test('44f. a new upcoming Goa schedule appears immediately as its own current-day queue occurrence', async () => {
  const { now } = await loadingQueueFixture();
  const loading = new Date(now.getTime() + 15 * 60_000);
  const departure = new Date(now.getTime() + 25 * 60_000);
  const payload = await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: loading.toISOString(),
    departureTime: departure.toISOString(),
    vehicleId: 'seed_vehicle_033',
    fareAmount: DEFAULT_GOA_FARE,
  });
  const created = payload.schedules.find((schedule) => schedule.departureTime === departure.toISOString());
  assert.ok(created);

  const assignment = await prisma.tripAssignment.findFirstOrThrow({
    where: { tripId: created!.id, status: AssignmentStatus.ACCEPTED },
  });
  assert.ok(assignment.queueEntryId);
  assert.notEqual(assignment.queueEntryId, 'seed_queue_goa_1');
  const ordered = await prisma.queueEntry.findMany({
    where: {
      id: { in: ['seed_queue_goa_1', assignment.queueEntryId!] },
      status: { in: operationalQueueStatuses },
    },
    orderBy: { position: 'asc' },
  });
  assert.deepEqual(ordered.map((row) => row.scheduledLoadingTime?.getTime()), [now.getTime(), loading.getTime()]);
});

test('45. dispatcher order persists through normalization and subsequent engine ticks', async () => {
  const { now } = await loadingQueueFixture();
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestDistanceKm: 0.02 } });
  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'override', newPosition: 1, reason: 'Terminal supervisor adjustment' });
  await withRouteQueue(RouteCode.GOA, (tx) => normalizeSavedQueue(tx, RouteCode.GOA));
  await runDispatchEngine('seed_user_dispatcher', now);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).position, 1);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).vehicleId, 'seed_vehicle_021');
  await assert.rejects(applyQueueAction('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, 'seed_queue_goa_2', { action: 'override', newPosition: 1, reason: 'Wrong route' }), (error: unknown) => error instanceof AppError && error.code === 'ROUTE_ACCESS_DENIED');
});

test('45a. a Goa queue override moves loading times with the new queue positions', async () => {
  const { now } = await loadingQueueFixture();
  const driver = await prisma.user.create({
    data: { email: 'queue-time-third@example.test', name: 'Queue Time Driver', passwordHash: 'test-only', role: 'DRIVER', managedByDispatcherId: 'seed_user_dispatcher' },
  });
  const van = await prisma.vehicle.create({
    data: {
      vanId: 'QUEUE-TIME-3', plateNo: 'QUEUE-TIME-3', route: RouteCode.GOA, protocol: 'GOSO',
      assignedDriverId: driver.id, managedByDispatcherId: 'seed_user_dispatcher', capacity: 11,
      insideTerminalZone: true, latestDistanceKm: 0.01, latestLocationObservedAt: now,
      latestLocationAccuracyM: 10, status: VehicleStatus.AT_TERMINAL,
    },
  });
  const thirdLoading = new Date(now.getTime() + 60 * 60_000);
  const thirdTrip = await prisma.trip.create({
    data: {
      vehicleId: van.id, route: RouteCode.GOA, status: TripStatus.ASSIGNED, fareAmount: DEFAULT_GOA_FARE,
      boardingStartTime: thirdLoading, scheduledOrTriggeredTime: new Date(thirdLoading.getTime() + 10 * 60_000),
      createdByDispatcherId: 'seed_user_dispatcher',
    },
  });
  const thirdQueue = await prisma.queueEntry.create({
    data: {
      vehicleId: van.id, route: RouteCode.GOA, position: 3, arrivalTimestamp: now,
      status: QueueStatus.ACCEPTED, scheduledLoadingTime: thirdLoading,
    },
  });
  await prisma.tripAssignment.create({
    data: {
      tripId: thirdTrip.id, driverId: driver.id, queueEntryId: thirdQueue.id, status: 'ACCEPTED',
      responseDeadline: thirdLoading, respondedAt: now,
    },
  });

  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, thirdQueue.id, {
    action: 'override', newPosition: 1, reason: 'Move third loading slot to the front.',
  });

  const reordered = await prisma.queueEntry.findMany({
    where: { id: { in: [thirdQueue.id, 'seed_queue_goa_1', 'seed_queue_goa_2'] } },
    orderBy: { position: 'asc' },
  });
  assert.deepEqual(reordered.map((row) => row.id), [thirdQueue.id, 'seed_queue_goa_1', 'seed_queue_goa_2']);
  assert.deepEqual(
    reordered.map((row) => row.scheduledLoadingTime?.getTime()),
    [now.getTime(), now.getTime() + 30 * 60_000, thirdLoading.getTime()],
  );

  // A queue read also repairs older/legacy rows whose positions were changed
  // without moving their loading slots, matching the mismatch shown in the
  // dispatcher table (for example 9:55, 9:45, 9:50).
  await prisma.queueEntry.update({ where: { id: thirdQueue.id }, data: { scheduledLoadingTime: thirdLoading } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { scheduledLoadingTime: now } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { scheduledLoadingTime: new Date(now.getTime() + 30 * 60_000) } });
  const reconciled = await getDispatcherQueue(RouteCode.GOA);
  assert.deepEqual(
    reconciled.entries.map((row) => new Date(row.scheduledLoadingTime!).getTime()),
    [now.getTime(), now.getTime() + 30 * 60_000, thirdLoading.getTime()],
  );
});

for (const route of [RouteCode.GOA, RouteCode.LEGAZPI]) {
  test(`46. ${route} first active van automatically departs at the 100m boundary without a start button`, async () => {
    const goa = route === RouteCode.GOA;
    const vehicleId = goa ? 'seed_vehicle_033' : 'seed_vehicle_019';
    const driverId = goa ? 'seed_user_driver_rodel' : 'seed_user_driver_pedro';
    const tripId = goa ? 'seed_trip_goa_morning' : 'seed_trip_legazpi_loading';
    const queueId = goa ? 'seed_queue_goa_1' : 'seed_queue_legazpi_1';
    const now = new Date();
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { goOnTripEnabled: true, insideTerminalZone: true, status: VehicleStatus.LOADING, latestLocationObservedAt: null, terminalExitSampleCount: 0 } });
    await prisma.queueEntry.update({
      where: { id: queueId },
      data: { status: QueueStatus.ACCEPTED, ...(goa ? { scheduledLoadingTime: now } : {}) },
    });
    if (goa) await prisma.tripAssignment.update({ where: { id: 'seed_assignment_goa' }, data: { status: 'ACCEPTED' } });
    else await prisma.tripAssignment.update({ where: { id: 'seed_assignment_legazpi' }, data: { status: 'PENDING', respondedAt: null } });
    // These points are outside 100m but still inside the former 250m boundary.
    const result = await recordReliableSequence(driverId, [0.12, 0.14, 0.16], now.getTime());
    assert.equal(result?.transition, 'departure_confirmed');
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).status, TripStatus.DEPARTED);
    assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: queueId } })).status, QueueStatus.DEPARTED);
    if (!goa) assert.equal((await prisma.tripAssignment.findUniqueOrThrow({ where: { id: 'seed_assignment_legazpi' } })).status, 'EXPIRED');
    assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).goOnTripEnabled, true);
    const remaining = await prisma.queueEntry.findFirst({ where: { route, status: { notIn: [QueueStatus.DEPARTED, QueueStatus.REJECTED, QueueStatus.REPLACED] } } });
    assert.equal(remaining?.position, 1);
    const duplicate = await recordDriverLocation(driverId, latitudeAtDistanceKm(0.18), NCEBT.longitude, new Date(now.getTime() + 30_000), 10, 2);
    assert.equal(duplicate.transition, 'none');
    await recordDriverLocation(driverId, latitudeAtDistanceKm(6), NCEBT.longitude, new Date(now.getTime() + 40_000), 10, 2);
    assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).goOnTripEnabled, true);
    assert.equal(await prisma.dispatchLog.count({ where: { targetId: tripId, action: 'TRIP_DEPARTED' } }), 1);
  });
}

test('46a. a GOSO van promoted by the existing late rotation automatically departs as the current head', async () => {
  const serviceDay = manilaServiceDay(new Date());
  const serviceNow = new Date(Math.min(Date.now(), serviceDay.end.getTime() - 2 * 60 * 60_000));
  const { now } = await loadingQueueFixture(serviceNow);

  await evaluateGosoLoading('seed_user_dispatcher', now);
  const promotedQueue = await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } });
  assert.equal(promotedQueue.position, 1);
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_021' },
    data: {
      goOnTripEnabled: true,
      insideTerminalZone: true,
      status: VehicleStatus.LOADING,
      latestLocationObservedAt: null,
      terminalExitSampleCount: 0,
      departureAuthorizedAt: null,
      departureAuthorizedTripId: null,
    },
  });

  const result = await recordReliableSequence('seed_user_driver_mario', [0.12, 0.14, 0.16]);
  const [trip, queue, log] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } }),
    prisma.dispatchLog.findFirstOrThrow({
      where: { targetId: 'seed_trip_goa_morning', action: DispatchAction.TRIP_DEPARTED },
      orderBy: { timestamp: 'desc' },
    }),
  ]);
  assert.equal(result?.transition, 'departure_confirmed');
  assert.equal(trip.status, TripStatus.DEPARTED);
  assert.equal(queue.status, QueueStatus.DEPARTED);
  assert.equal((log.metadata as { automaticQueueHeadExit?: boolean } | null)?.automaticQueueHeadExit, true);
});

test('46b. a TAYA van promoted past an absent follower automatically departs as the current head', async () => {
  const now = new Date();
  const serviceDate = manilaServiceDay(now).date;
  const jsWeekday = new Date(`${serviceDate}T00:00:00.000Z`).getUTCDay();
  const weekday = jsWeekday === 0 ? 7 : jsWeekday;
  const promotedDriver = await prisma.user.create({
    data: {
      email: 'taya-promoted-head@example.test',
      name: 'Taya Promoted Head',
      passwordHash: 'test-only',
      role: UserRole.DRIVER,
      managedByDispatcherId: 'seed_user_dispatcher_legazpi',
    },
  });
  const promotedVehicle = await prisma.vehicle.create({
    data: {
      vanId: 'TAYA-PROMOTED',
      plateNo: 'TAYA-PROMOTED',
      route: RouteCode.LEGAZPI,
      protocol: 'TAYA',
      assignedDriverId: promotedDriver.id,
      managedByDispatcherId: 'seed_user_dispatcher_legazpi',
      capacity: VAN_PASSENGER_CAPACITY,
      status: VehicleStatus.AT_TERMINAL,
      goOnTripEnabled: true,
      insideTerminalZone: true,
      latestDistanceKm: 0.02,
    },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_019' },
    data: { status: VehicleStatus.LOADING, insideTerminalZone: true, latestDistanceKm: 0.02 },
  });
  await prisma.vehicle.update({
    where: { id: 'seed_vehicle_005' },
    data: { status: VehicleStatus.OUTSIDE_ZONE, insideTerminalZone: false, latestDistanceKm: 0.2 },
  });
  await saveTayaWeeklySchedule('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, {
    weekday,
    vehicleIds: ['seed_vehicle_019', 'seed_vehicle_005', promotedVehicle.id],
  }, now);

  const original = await getDispatcherQueue(RouteCode.LEGAZPI);
  await applyQueueAction('seed_user_dispatcher_legazpi', RouteCode.LEGAZPI, original.entries[0]!.id, {
    action: 'dispatch',
    reason: 'Advance the saved Taya queue for the automatic-exit test.',
  });
  const promoted = await getDispatcherQueue(RouteCode.LEGAZPI);
  assert.equal(promoted.entries[0]?.vanId, 'TAYA-PROMOTED');
  assert.equal(promoted.entries[0]?.position, 1);
  assert.equal(promoted.entries[1]?.vanId, 'VAN-005');
  assert.equal(promoted.entries[1]?.isLate, true);

  await prisma.vehicle.update({
    where: { id: promotedVehicle.id },
    data: {
      status: VehicleStatus.LOADING,
      insideTerminalZone: true,
      latestLocationObservedAt: null,
      terminalExitSampleCount: 0,
      departureAuthorizedAt: null,
      departureAuthorizedTripId: null,
    },
  });
  const result = await recordReliableSequence(promotedDriver.id, [0.12, 0.14, 0.16]);
  const promotedTripId = promoted.entries[0]!.tripId!;
  const [trip, queue, log] = await Promise.all([
    prisma.trip.findUniqueOrThrow({ where: { id: promotedTripId } }),
    prisma.queueEntry.findUniqueOrThrow({ where: { id: promoted.entries[0]!.id } }),
    prisma.dispatchLog.findFirstOrThrow({
      where: { targetId: promotedTripId, action: DispatchAction.TRIP_DEPARTED },
      orderBy: { timestamp: 'desc' },
    }),
  ]);
  assert.equal(result?.transition, 'departure_confirmed');
  assert.equal(trip.status, TripStatus.DEPARTED);
  assert.equal(queue.status, QueueStatus.DEPARTED);
  assert.equal((log.metadata as { automaticQueueHeadExit?: boolean } | null)?.automaticQueueHeadExit, true);
});

test('47. a later queued van cannot advance FIFO and unreliable or duplicate GPS cannot confirm departure', async () => {
  const { now } = await loadingQueueFixture();
  const result = await recordReliableSequence('seed_user_driver_mario', [0.12, 0.14, 0.16], now.getTime() + 8_000);
  assert.equal(result?.transition, 'departure_review_required');
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_2' } })).position, 2);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'TRIP_DEPARTED' } }), 0);
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestLocationObservedAt: null } });
  await recordDriverLocation('seed_user_driver_rodel', latitudeAtDistanceKm(0.13), NCEBT.longitude, now, 100, 2);
  const duplicate = await recordDriverLocation('seed_user_driver_rodel', latitudeAtDistanceKm(0.15), NCEBT.longitude, now, 10, 2);
  assert.equal(duplicate.transition, 'out_of_order');
  await recordDriverLocation('seed_user_driver_rodel', latitudeAtDistanceKm(0.15), NCEBT.longitude, new Date(now.getTime() + 10_000), 100, 2);
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } })).terminalExitSampleCount, 0);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'TRIP_DEPARTED' } }), 0);
});

test('48. simultaneous attendance ticks do not duplicate no-show penalties or passenger transfers', async () => {
  const { now } = await loadingQueueFixture();
  await Promise.all([evaluateGosoLoading('seed_user_dispatcher', now), evaluateGosoLoading('seed_user_dispatcher', now)]);
  assert.equal(await prisma.dispatchLog.count({ where: { targetId: 'seed_queue_goa_1', action: 'MOVED_TO_LAST' } }), 1);
  assert.equal(await prisma.tripAssignment.count({ where: { tripId: 'seed_trip_goa_morning', status: 'ACCEPTED' } }), 1);
});

test('49. an impossible manual queue order rolls back instead of silently skipping the chosen van', async () => {
  await loadingQueueFixture();
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_021' }, data: { capacity: 2 } });
  await assert.rejects(
    applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'override', newPosition: 1, reason: 'Test capacity guard' }),
    (error: unknown) => error instanceof AppError && error.code === 'QUEUE_REALLOCATION_BLOCKED',
  );
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } })).position, 1);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).vehicleId, 'seed_vehicle_033');
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'QUEUE_OVERRIDDEN' } }), 0);
});

test('50. a returning late driver can report occupancy only after the adopted last loading slot opens', async () => {
  const { now } = await loadingQueueFixture();
  await prisma.passengerCount.deleteMany({ where: { tripId: 'seed_trip_goa_morning' } });
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestDistanceKm: 0.02, latestLocationObservedAt: new Date(now.getTime() - 120_000) } });
  await assert.rejects(submitOccupancy('seed_user_driver_rodel', 1), (error: unknown) => error instanceof AppError && error.code === 'TERMINAL_PRESENCE_REQUIRED');
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { latestDistanceKm: 0.2, latestLocationObservedAt: now } });
  await assert.rejects(submitOccupancy('seed_user_driver_rodel', 1), (error: unknown) => error instanceof AppError && error.code === 'TERMINAL_PRESENCE_REQUIRED');
  await evaluateGosoLoading('seed_user_dispatcher', now);
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { latestDistanceKm: 0.02 } });
  await assert.rejects(submitOccupancy('seed_user_driver_rodel', 1), (error: unknown) => error instanceof AppError && error.code === 'OCCUPANCY_WINDOW_NOT_OPEN');
  const adopted = await prisma.trip.findFirstOrThrow({ where: { vehicleId: 'seed_vehicle_033', assignments: { some: { driverId: 'seed_user_driver_rodel', status: AssignmentStatus.ACCEPTED } } } });
  await prisma.trip.update({ where: { id: adopted.id }, data: { boardingStartTime: now } });
  await submitOccupancy('seed_user_driver_rodel', 1);
  assert.equal(await prisma.passengerCount.count({ where: { tripId: adopted.id, submittedByDriverId: 'seed_user_driver_rodel', count: 1, timestamp: { gte: now } } }), 1);
});

test('51. a scheduled driver still on a previous trip is not penalized or re-added to the active queue', async () => {
  const { now } = await loadingQueueFixture();
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { status: VehicleStatus.ON_TRIP } });
  assert.equal((await evaluateGosoLoading('seed_user_dispatcher', now)).moved, 0);
  const queue = await getDispatcherQueue(RouteCode.GOA);
  assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } })).vehicleId, 'seed_vehicle_033');
  assert.equal(queue.entries.some((entry) => entry.vanId === 'VAN-033'), false);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } })).status, QueueStatus.REPLACED);
  assert.equal((await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } })).lateAt, null);
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: 'seed_vehicle_033' } })).status, VehicleStatus.ON_TRIP);
});

test('52. a dispatcher can edit a confirmed loading queue while preserving the original booking slot', async () => {
  const { now, departure } = await loadingQueueFixture();
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestDistanceKm: 0.02 } });
  await evaluateGosoLoading('seed_user_dispatcher', now);
  await applyQueueAction('seed_user_dispatcher', RouteCode.GOA, 'seed_queue_goa_2', { action: 'override', newPosition: 1, reason: 'Dispatcher loading adjustment' });
  await evaluateGosoLoading('seed_user_dispatcher', now);
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } });
  assert.equal(trip.vehicleId, 'seed_vehicle_021');
  assert.equal(trip.loadingConfirmedVehicleId, 'seed_vehicle_021');
  assert.equal(trip.scheduledOrTriggeredTime.getTime(), departure.getTime());
  assert.equal((await getPassengerBooking('seed_user_passenger_ana', 'UVGO-DEMO-001')).departureTime, departure.toISOString());
});

test('53. a late driver returning to the geofence does not regain the original queue position', async () => {
  const { now } = await loadingQueueFixture();
  await evaluateGosoLoading('seed_user_dispatcher', now);
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_033' }, data: { insideTerminalZone: true, latestDistanceKm: 0.02, latestLocationObservedAt: new Date(now.getTime() + 5_000), latestLocationAccuracyM: 10 } });
  await evaluateGosoLoading('seed_user_dispatcher', new Date(now.getTime() + 10_000));
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: 'seed_trip_goa_morning' } });
  assert.equal(trip.vehicleId, 'seed_vehicle_021');
  assert.equal(trip.status, TripStatus.BOARDING);
  assert.ok(trip.loadingConfirmedAt);
  assert.equal(await prisma.dispatchLog.count({ where: { action: 'MOVED_TO_LAST' } }), 1);
  const queue = await prisma.queueEntry.findUniqueOrThrow({ where: { id: 'seed_queue_goa_1' } });
  assert.equal(queue.position, 2);
  assert.equal(queue.lateAt?.getTime(), now.getTime());
  const adopted = await prisma.tripAssignment.findFirstOrThrow({ where: { driverId: 'seed_user_driver_rodel', queueEntryId: queue.id, status: AssignmentStatus.ACCEPTED }, include: { trip: true } });
  assert.equal(adopted.trip.vehicleId, 'seed_vehicle_033');
  assert.equal(adopted.trip.boardingStartTime?.getTime(), queue.scheduledLoadingTime?.getTime());
});

test('54. a Goa driver can hold multiple schedules on the same Manila calendar day', async () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60_000 + 8 * 60 * 60_000).toISOString().slice(0, 10);
  await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: `${future}T11:30:00.000+08:00`, departureTime: `${future}T12:00:00.000+08:00`,
    vehicleId: 'seed_vehicle_033', fareAmount: DEFAULT_GOA_FARE,
  });
  await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: `${future}T13:30:00.000+08:00`, departureTime: `${future}T14:00:00.000+08:00`,
    vehicleId: 'seed_vehicle_033', fareAmount: DEFAULT_GOA_FARE,
  });
  await createManagedSchedule('seed_user_dispatcher', RouteCode.GOA, {
    boardingStartTime: `${future}T15:30:00.000+08:00`, departureTime: `${future}T16:00:00.000+08:00`,
    vehicleId: 'seed_vehicle_021', fareAmount: DEFAULT_GOA_FARE,
  });
  const direct = await prisma.trip.create({ data: {
    vehicleId: 'seed_vehicle_021', route: RouteCode.GOA, boardingStartTime: new Date(`${future}T16:30:00.000+08:00`),
    scheduledOrTriggeredTime: new Date(`${future}T17:00:00.000+08:00`), status: TripStatus.SCHEDULED, fareAmount: DEFAULT_GOA_FARE,
  } });
  await withRouteQueue(RouteCode.GOA, (tx) => assignScheduledVehicleDriver(tx, 'seed_user_dispatcher', direct.id, 'seed_vehicle_021', 'seed_user_driver_mario', RouteCode.GOA, new Date(), { trigger: 'multiple-daily-schedules-test' }));
  assert.equal(await prisma.tripAssignment.count({ where: { tripId: direct.id } }), 1);
  assert.equal(await prisma.trip.count({
    where: {
      scheduledOrTriggeredTime: {
        gte: new Date(`${future}T00:00:00.000+08:00`),
        lt: new Date(new Date(`${future}T00:00:00.000+08:00`).getTime() + 24 * 60 * 60_000),
      },
      assignments: { some: { driverId: 'seed_user_driver_rodel' } },
    },
  }), 2);
});

test('55. PayMongo webhook signatures use the timestamp and exact raw payload', () => {
  const secret = 'whsk_test_uvgo_signature_secret';
  const rawBody = Buffer.from('{"data":{"id":"evt_uvgo","type":"event"}}');
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  assert.equal(verifyPaymongoWebhookSignature(rawBody, `t=${timestamp},te=${signature},li=`, secret), true);
  assert.equal(verifyPaymongoWebhookSignature(Buffer.from(`${rawBody.toString('utf8')} `), `t=${timestamp},te=${signature},li=`, secret), false);
});

test('56. a verified QR Ph payment confirms its reservation exactly once', async () => {
  await prisma.reservation.create({
    data: {
      id: 'paymongo_reservation_paid',
      reference: 'UVGO-QRPH-PAID',
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seatCount: 1,
      fareAmount: DEFAULT_GOA_FARE,
      status: ReservationStatus.PENDING_PAYMENT,
      seats: { create: { tripId: 'seed_trip_goa_day_three', seatNumber: 6 } },
      payments: {
        create: {
          id: 'paymongo_payment_paid',
          method: PaymentMethod.PAYMONGO_QRPH,
          amount: DEFAULT_GOA_FARE,
          status: PaymentStatus.PENDING,
          paymongoPaymentIntentId: 'pi_uvgo_paid',
          paymongoPaymentMethodId: 'pm_uvgo_paid',
          paymongoQrExpiresAt: new Date(Date.now() + 30 * 60_000),
        },
      },
    },
  });
  const event: PaymongoWebhookEvent = {
    data: {
      id: 'evt_uvgo_paid',
      type: 'event',
      attributes: {
        type: 'payment.paid',
        livemode: false,
        data: {
          id: 'pay_uvgo_paid',
          type: 'payment',
          attributes: {
            amount: Math.round(DEFAULT_GOA_FARE * 100),
            currency: 'PHP',
            status: 'paid',
            payment_intent_id: 'pi_uvgo_paid',
            paid_at: Math.floor(Date.now() / 1_000),
          },
        },
      },
    },
  };
  await processPaymongoWebhookEvent(event);
  await processPaymongoWebhookEvent(event);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: 'paymongo_payment_paid' }, include: { reservation: true } });
  assert.equal(payment.status, PaymentStatus.CAPTURED);
  assert.equal(payment.paymongoPaymentId, 'pay_uvgo_paid');
  assert.equal(payment.reservation.status, ReservationStatus.CONFIRMED);
  assert.equal(await prisma.notification.count({ where: { userId: 'seed_user_passenger_ana', message: { contains: 'UVGO-QRPH-PAID' } } }), 1);
});

test('57. an expired QR Ph payment forfeits the unpaid hold and releases its seat', async () => {
  await prisma.reservation.create({
    data: {
      id: 'paymongo_reservation_expired',
      reference: 'UVGO-QRPH-EXPIRED',
      passengerId: 'seed_user_passenger_ana',
      tripId: 'seed_trip_goa_day_three',
      seatCount: 1,
      fareAmount: DEFAULT_GOA_FARE,
      status: ReservationStatus.PENDING_PAYMENT,
      seats: { create: { tripId: 'seed_trip_goa_day_three', seatNumber: 6 } },
      payments: {
        create: {
          id: 'paymongo_payment_expired',
          method: PaymentMethod.PAYMONGO_QRPH,
          amount: DEFAULT_GOA_FARE,
          status: PaymentStatus.PENDING,
          paymongoPaymentIntentId: 'pi_uvgo_expired',
          paymongoPaymentMethodId: 'pm_uvgo_expired',
          paymongoQrExpiresAt: new Date(Date.now() - 1_000),
        },
      },
    },
  });
  await processPaymongoWebhookEvent({
    data: {
      id: 'evt_uvgo_expired',
      type: 'event',
      attributes: {
        type: 'qrph.expired',
        livemode: false,
        data: { id: 'pm_uvgo_expired', type: 'payment_method', attributes: { payment_intent_id: 'pi_uvgo_expired' } },
      },
    },
  });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: 'paymongo_payment_expired' }, include: { reservation: true } });
  assert.equal(payment.status, PaymentStatus.FAILED);
  assert.equal(payment.reservation.status, ReservationStatus.FORFEITED);
  const seatMap = await getTripSeats('seed_trip_goa_day_three');
  assert.equal(seatMap.seats.find((seat) => seat.number === 6)?.available, true);
});
