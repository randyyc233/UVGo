import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { Prisma, RouteCode } from '@prisma/client';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { disconnectSeedClient, resetDemoData } from '../prisma/seed.js';
import { calculateReservationFare } from '../src/services/reservationFare.js';
import { createGcashReservation, quoteReservationFare, reschedulePassengerBooking } from '../src/services/passengerService.js';
import { decideGcashPayment, getDispatcherPayments } from '../src/services/dispatcherService.js';
import { paypalReservationSchema } from '../src/validators/passengerValidators.js';

if (!process.env.UVGO_ISOLATED_TEST_DATABASE || new URL(env.DATABASE_URL).pathname !== `/${process.env.UVGO_ISOLATED_TEST_DATABASE}`) throw new Error('Discount tests require the isolated database runner.');
beforeEach(async () => { await resetDemoData(); });
after(async () => { await prisma.$disconnect(); await disconnectSeedClient(); });
const input = { passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [1,3], contact: '09170000001' };

test('Discounts: only eligible seats receive 20%, using currency-safe per-seat rounding', () => {
  assert.deepEqual(calculateReservationFare(new Prisma.Decimal('108'), 2, { studentPassengers: 1, discountIdAcknowledged: true }), {
    subtotal: 216, discountAmount: 21.6, totalAmount: 194.4, studentPassengers: 1, seniorPassengers: 0, regularPassengers: 1,
  });
  assert.equal(calculateReservationFare(new Prisma.Decimal('108'), 3, { studentPassengers: 1, seniorPassengers: 1, discountIdAcknowledged: true }).totalAmount, 280.8);
  assert.equal(calculateReservationFare(new Prisma.Decimal('120'), 11, { seniorPassengers: 11, discountIdAcknowledged: true }).totalAmount, 1056);
  assert.equal(calculateReservationFare(new Prisma.Decimal('0.03'), 2, { studentPassengers: 2, discountIdAcknowledged: true }).totalAmount, 0.04);
  assert.equal(calculateReservationFare(new Prisma.Decimal('108'), 2, {}).totalAmount, 216);
});

test('Discounts: over-counting, overlapping claims, negative counts and missing ID acknowledgement are rejected', () => {
  for (const claim of [{ studentPassengers: 2, seniorPassengers: 1 }, { studentPassengers: -1 }, { seniorPassengers: 1.5 }, { studentPassengers: 1 }]) {
    assert.throws(() => calculateReservationFare(new Prisma.Decimal(108), 2, claim));
  }
  assert.equal(paypalReservationSchema.safeParse({ ...input, studentPassengers: 2, seniorPassengers: 1, discountIdAcknowledged: true }).success, false);
  assert.equal(paypalReservationSchema.safeParse({ ...input, seniorPassengers: 1 }).success, false);
  assert.equal(paypalReservationSchema.safeParse({ ...input, studentPassengers: '1', seniorPassengers: '0', discountIdAcknowledged: 'true' }).success, true);
});

test('Discounts: quote uses stored trip fare without creating reservations or holding seats', async () => {
  await prisma.trip.update({ where: { id: input.tripId }, data: { fareAmount: 108 } });
  const before = await prisma.reservation.count();
  const quote = await quoteReservationFare({ ...input, studentPassengers: 1 });
  assert.equal(quote.totalAmount, 194.4); assert.equal(quote.discountAmount, 21.6);
  assert.equal(await prisma.reservation.count(), before);
  assert.equal(await prisma.reservationSeat.count({ where: { tripId: input.tripId, seatNumber: { in: input.seats } } }), 0);
});

test('Discounts: GCash persists the net payment and eligibility counts, and retains both through rescheduling', async () => {
  await prisma.trip.update({ where: { id: input.tripId }, data: { fareAmount: 108 } });
  const booking = await createGcashReservation({ ...input, studentPassengers: 1, seniorPassengers: 1, discountIdAcknowledged: true, receiptImageKey: 'discount-fixture.png', receiptMimeType: 'image/png' });
  assert.equal(booking.fareAmount, 216); assert.equal(booking.discountAmount, 43.2); assert.equal(booking.totalAmount, 172.8);
  assert.equal(booking.studentPassengers, 1); assert.equal(booking.seniorPassengers, 1);
  const payment = await prisma.payment.findFirstOrThrow({ where: { reservation: { reference: booking.reference } } });
  assert.equal(Number(payment.amount), 172.8);
  await decideGcashPayment('seed_user_dispatcher', RouteCode.GOA, payment.id, 'approve', '');
  const payments = await getDispatcherPayments(RouteCode.GOA);
  const displayed = payments.gcash.find((item) => item.id === payment.id)!;
  assert.equal(displayed.reservation.studentPassengers, 1); assert.equal(displayed.reservation.discountAmount, 43.2);
  const rescheduled = await reschedulePassengerBooking(input.passengerId, booking.reference, 'seed_trip_goa_day_two', [5,6]);
  assert.equal(rescheduled.totalAmount, 172.8); assert.equal(rescheduled.discountAmount, 43.2);
  assert.equal(rescheduled.studentPassengers, 1); assert.equal(rescheduled.seniorPassengers, 1);
  assert.deepEqual(rescheduled.seats, [5,6]);
});

test('Discounts: rejected discounted input cannot create a reservation or occupy seats', async () => {
  await assert.rejects(createGcashReservation({ ...input, seniorPassengers: 1, receiptImageKey: 'fixture.png', receiptMimeType: 'image/png' }));
  assert.equal(await prisma.reservationSeat.count({ where: { tripId: input.tripId, seatNumber: { in: input.seats } } }), 0);
});

test('Discounts: authenticated quote endpoint ignores submitted amounts and rejects invalid counts', async () => {
  await prisma.trip.update({ where: { id: input.tripId }, data: { fareAmount: 108 } });
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'passenger@uvgo.demo', password: 'UVGoDemo123!' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const body = { tripId: input.tripId, seats: input.seats, studentPassengers: 1, amount: 0.01, discountAmount: 216 };
    const request = await fetch(`${base}/passenger/reservations/quote`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(request.status, 200); assert.equal((await request.json() as { quote: { totalAmount: number } }).quote.totalAmount, 194.4);
    assert.equal((await fetch(`${base}/passenger/reservations/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await fetch(`${base}/passenger/reservations/quote`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, seniorPassengers: 2 }) })).status, 422);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
