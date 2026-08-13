import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  PaymentStatus,
  QueueStatus,
  ReservationStatus,
  TripStatus,
  VehicleStatus,
} from '@prisma/client';
import { app } from '../src/app.js';
import { NCEBT } from '../src/config/terminal.js';
import { prisma } from '../src/lib/prisma.js';
import {
  distanceFromNcebtKm,
  reallocateUnavailableVehicle,
  recalculateTayaReadiness,
  runDispatchEngine,
} from '../src/services/automationService.js';
import { applyQueueAction, decideGcashPayment } from '../src/services/dispatcherService.js';
import { respondToAssignment } from '../src/services/driverService.js';
import {
  capturePaypalReservation,
  createGcashReservation,
  createPaypalReservation,
  reschedulePassengerBooking,
} from '../src/services/passengerService.js';
import { AppError } from '../src/utils/AppError.js';
import { queueActionSchema } from '../src/validators/dispatcherValidators.js';
import { disconnectSeedClient, resetDemoData } from '../prisma/seed.js';

beforeEach(async () => {
  await resetDemoData();
});

after(async () => {
  await resetDemoData();
  await prisma.$disconnect();
  await disconnectSeedClient();
});

test('1. the NCEBT geofence uses a 5 km radius', () => {
  assert.ok(distanceFromNcebtKm(NCEBT.latitude, NCEBT.longitude) < 0.01);
  assert.ok(distanceFromNcebtKm(NCEBT.latitude + 0.03, NCEBT.longitude) < 5);
  assert.ok(distanceFromNcebtKm(NCEBT.latitude + 0.06, NCEBT.longitude) > 5);
});

test('2. Goso assigns the earliest eligible Goa queue entry', async () => {
  const now = new Date();
  await prisma.trip.update({
    where: { id: 'seed_trip_goa_day_two' },
    data: { scheduledOrTriggeredTime: new Date(now.getTime() + 5 * 60_000), status: TripStatus.SCHEDULED },
  });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_1' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 20 * 60_000) } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_goa_2' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 10 * 60_000) } });

  await runDispatchEngine('seed_user_dispatcher', now);
  const assignment = await prisma.tripAssignment.findFirst({ where: { tripId: 'seed_trip_goa_day_two' } });
  assert.equal(assignment?.queueEntryId, 'seed_queue_goa_1');
});

test('3. Taya readiness respects strict geofence-arrival FIFO', async () => {
  const now = new Date();
  await prisma.vehicle.updateMany({ where: { id: { in: ['seed_vehicle_019', 'seed_vehicle_005'] } }, data: { status: VehicleStatus.LOADING } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_1' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 20 * 60_000) } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_2' }, data: { status: QueueStatus.WAITING, arrivalTimestamp: new Date(now.getTime() - 10 * 60_000) } });
  await prisma.trip.update({ where: { id: 'seed_trip_legazpi_loading' }, data: { status: TripStatus.BOARDING } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_019', tripId: 'seed_trip_legazpi_loading', count: 15, submittedByDriverId: 'seed_user_driver_pedro' } });
  const secondTrip = await prisma.trip.create({ data: { vehicleId: 'seed_vehicle_005', route: 'LEGAZPI', scheduledOrTriggeredTime: now, status: TripStatus.BOARDING, fareAmount: 250 } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_005', tripId: secondTrip.id, count: 15, submittedByDriverId: 'seed_user_driver_noel' } });

  const result = await recalculateTayaReadiness();
  assert.equal(result.readyEntryId, 'seed_queue_legazpi_1');
  assert.equal((await prisma.queueEntry.findUnique({ where: { id: 'seed_queue_legazpi_2' } }))?.status, QueueStatus.WAITING);
});

test('4. Taya does not become ready below 100% occupancy', async () => {
  await prisma.vehicle.update({ where: { id: 'seed_vehicle_019' }, data: { status: VehicleStatus.LOADING } });
  await prisma.queueEntry.update({ where: { id: 'seed_queue_legazpi_1' }, data: { status: QueueStatus.WAITING } });
  await prisma.trip.update({ where: { id: 'seed_trip_legazpi_loading' }, data: { status: TripStatus.BOARDING } });
  await prisma.passengerCount.create({ data: { vehicleId: 'seed_vehicle_019', tripId: 'seed_trip_legazpi_loading', count: 14, submittedByDriverId: 'seed_user_driver_pedro' } });

  const result = await recalculateTayaReadiness();
  assert.equal(result.readyEntryId, null);
  assert.equal((await prisma.queueEntry.findUnique({ where: { id: 'seed_queue_legazpi_1' } }))?.status, QueueStatus.WAITING);
});

test('5. driver rejection advances the assignment to the next eligible van', async () => {
  const result = await respondToAssignment('seed_user_driver_rodel', 'seed_assignment_goa', false);
  const next = await prisma.tripAssignment.findFirst({ where: { tripId: 'seed_trip_goa_morning', queueEntryId: 'seed_queue_goa_2' } });
  assert.equal(result.advanced, true);
  assert.equal(next?.driverId, 'seed_user_driver_mario');
  assert.equal(next?.status, 'PENDING');
});

test('6. dispatcher queue override creates an audit log', async () => {
  const input = queueActionSchema.parse({ action: 'override', newPosition: 1 });
  await applyQueueAction('seed_user_dispatcher', 'seed_queue_goa_2', input);
  const log = await prisma.dispatchLog.findFirst({ where: { targetId: 'seed_queue_goa_2', action: 'QUEUE_OVERRIDDEN' }, orderBy: { timestamp: 'desc' } });
  assert.equal(log?.reason, null);
  assert.equal((log?.metadata as { newPosition?: number } | null)?.newPosition, 1);
});

test('7. Legazpi reservations are rejected', async () => {
  await assert.rejects(
    createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_legazpi_loading', seats: [1], contact: '09170000001', receiptImageKey: 'test.png', receiptMimeType: 'image/png' }),
    (error: unknown) => error instanceof AppError && error.code === 'GOA_ONLY',
  );
});

test('8. a Goa reservation can be created', async () => {
  const booking = await createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [1], contact: '09170000001', receiptImageKey: 'test.png', receiptMimeType: 'image/png' });
  assert.equal(booking.route, 'Goa');
  assert.deepEqual(booking.seats, [1]);
});

test('9. PayPal demo capture confirms the reservation', async () => {
  const order = await createPaypalReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [2], contact: '09170000001' });
  assert.equal(order.demo, true);
  const booking = await capturePaypalReservation('seed_user_passenger_ana', order.reference);
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.payment?.status, 'captured');
});

test('10. GCash receipt upload produces PendingVerification', async () => {
  const booking = await createGcashReservation({ passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [3], contact: '09170000001', receiptImageKey: 'test.png', receiptMimeType: 'image/png' });
  assert.equal(booking.status, 'pending_verification');
  assert.equal(booking.payment?.status, 'pending_verification');
});

test('11. dispatcher GCash approval confirms the booking', async () => {
  await decideGcashPayment('seed_user_dispatcher', 'seed_payment_gcash', 'approve', '');
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
  const targetTrip = reservation ? await prisma.trip.findUnique({ where: { id: reservation.tripId } }) : null;
  assert.equal(result.reservationsMoved, 1);
  assert.equal(reservation?.status, ReservationStatus.REALLOCATED);
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
