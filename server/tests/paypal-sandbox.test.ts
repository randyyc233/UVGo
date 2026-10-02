import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { PaymentStatus, ReservationStatus, RouteCode } from '@prisma/client';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { disconnectSeedClient, resetDemoData } from '../prisma/seed.js';
import { capturePaypalReservation, createPaypalReservation, getTripSeats, releasePaypalReservation } from '../src/services/passengerService.js';
import { getPayPalCheckoutConfig } from '../src/services/paypalService.js';
import { AppError } from '../src/utils/AppError.js';
import { dismissDispatcherPayment, getDispatcherDashboard, getDispatcherPayments } from '../src/services/dispatcherService.js';

if (!process.env.UVGO_ISOLATED_TEST_DATABASE || new URL(env.DATABASE_URL).pathname !== `/${process.env.UVGO_ISOLATED_TEST_DATABASE}`) {
  throw new Error('Run PayPal tests through the isolated database test runner.');
}

type ProviderOrder = {
  id: string; status: string; intent: string;
  purchase_units: { reference_id: string; amount: { currency_code: string; value: string }; payee: { merchant_id: string }; payments?: { captures: { id: string; status: string; final_capture: boolean; amount: { currency_code: string; value: string } }[] } }[];
};
const originalConfig = { PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL: env.PAYPAL_BASE_URL };
const realFetch = globalThis.fetch;
let orders = new Map<string, ProviderOrder>();
let captureRequests: { orderId: string; requestId: string | null }[] = [];
let captureStatus = 'COMPLETED';
let corruptCapture: ((order: ProviderOrder) => void) | null = null;
let loseCaptureResponse = false;
let tokenFailure = false;
let captureStarted: (() => void) | null = null;
let captureDelay = 0;
let createRequests: Array<{ intent: string; purchase_units: ProviderOrder['purchase_units']; payment_source?: { paypal?: { experience_context?: { shipping_preference?: string } } } }> = [];

beforeEach(async () => {
  await resetDemoData();
  env.PAYPAL_CLIENT_ID = 'test-sandbox-client'; env.PAYPAL_CLIENT_SECRET = 'test-server-secret'; env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  orders = new Map(); captureRequests = []; createRequests = []; captureStatus = 'COMPLETED'; corruptCapture = null; loseCaptureResponse = false; tokenFailure = false; captureStarted = null; captureDelay = 0;
  mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.origin !== 'https://api-m.sandbox.paypal.com') return realFetch(input, init);
    if (url.pathname === '/v1/oauth2/token') return Response.json(tokenFailure ? { error: 'invalid_client' } : { access_token: 'test-token' }, { status: tokenFailure ? 401 : 200 });
    if (url.pathname === '/v2/checkout/orders') {
      const body = JSON.parse(String(init?.body)) as typeof createRequests[number];
      createRequests.push(body);
      const id = `ORDER-${orders.size + 1}`;
      const order: ProviderOrder = { id, status: 'CREATED', intent: 'CAPTURE', purchase_units: [{ ...body.purchase_units[0]!, payee: { merchant_id: 'UVGO-MERCHANT' } }] };
      orders.set(id, order);
      return Response.json(order, { status: 201 });
    }
    const orderId = url.pathname.split('/')[4]!;
    const order = orders.get(orderId);
    assert.ok(order, 'Provider order must have been created by the server');
    if (url.pathname.endsWith('/capture')) {
      captureRequests.push({ orderId, requestId: new Headers(init?.headers).get('PayPal-Request-Id') });
      captureStarted?.();
      if (captureDelay) await new Promise((resolve) => setTimeout(resolve, captureDelay));
      order.status = 'COMPLETED';
      const unit = order.purchase_units[0]!;
      unit.payments = { captures: [{ id: `CAPTURE-${orderId}`, status: captureStatus, final_capture: true, amount: { ...unit.amount } }] };
      const response = structuredClone(order);
      corruptCapture?.(response);
      if (loseCaptureResponse) return Response.json({ error: 'response_lost' }, { status: 500 });
      return Response.json(response, { status: 201 });
    }
    return Response.json(order);
  });
});
afterEach(() => { mock.restoreAll(); Object.assign(env, originalConfig); });
after(async () => { await prisma.$disconnect(); await disconnectSeedClient(); });

const input = { passengerId: 'seed_user_passenger_ana', tripId: 'seed_trip_goa_day_three', seats: [1, 3], contact: '09170000001' };
async function startOrder(seats = input.seats) { return createPaypalReservation({ ...input, seats }); }
function approve(orderId: string) { orders.get(orderId)!.status = 'APPROVED'; }
const errorCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test('Sandbox PayPal: completed capture confirms once, stores its transaction id, and retains the server fare', async () => {
  const order = await startOrder(Array.from({ length: 11 }, (_, index) => index + 1));
  approve(order.orderId);
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.status, 'confirmed'); assert.equal(booking.payment?.status, 'captured');
  assert.equal(booking.payment?.transactionReference, `CAPTURE-${order.orderId}`);
  assert.equal(booking.totalAmount, Number(orders.get(order.orderId)!.purchase_units[0]!.amount.value));
  assert.equal(booking.seatCount, 11);
  await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(captureRequests.length, 1);
  assert.equal(captureRequests[0]?.requestId, `${order.reference}-capture`);
  assert.equal(await prisma.notification.count({ where: { userId: input.passengerId, message: { contains: order.reference } } }), 1);
});

test('Sandbox PayPal: transport checkout hides shipping without changing the stored fare or reservation reference', async () => {
  const order = await startOrder();
  assert.equal(createRequests.length, 1);
  const request = createRequests[0]!;
  const payment = await prisma.payment.findFirstOrThrow({ where: { paypalOrderId: order.orderId } });
  assert.equal(request.payment_source?.paypal?.experience_context?.shipping_preference, 'NO_SHIPPING');
  assert.equal(request.intent, 'CAPTURE');
  assert.equal(request.purchase_units.length, 1);
  assert.equal(request.purchase_units[0]!.reference_id, order.reference);
  assert.deepEqual(request.purchase_units[0]!.amount, { currency_code: 'PHP', value: Number(payment.amount).toFixed(2) });
  assert.equal('shipping' in request.purchase_units[0]!, false);
  assert.equal(payment.status, PaymentStatus.PENDING);
  assert.equal(captureRequests.length, 0);
  approve(order.orderId);
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.payment?.status, 'captured');
  assert.equal(booking.status, 'confirmed');
  assert.deepEqual(booking.seats, input.seats);
  assert.equal(captureRequests.length, 1);
});

test('Sandbox PayPal: pending checkout removal preserves payment and seats, and completed capture reappears with details', async () => {
  const order = await startOrder();
  const payment = await prisma.payment.findFirstOrThrow({ where: { paypalOrderId: order.orderId } });
  const dispatcher = 'seed_user_dispatcher';
  const listed = (await getDispatcherPayments(RouteCode.GOA, dispatcher)).paypal.find((item) => item.id === payment.id)!;
  assert.equal(listed.status, 'pending');
  assert.equal(listed.canDelete, true);
  assert.equal(listed.receiptUrl, null);
  assert.equal(listed.paidAt, null);
  const snapshot = async () => ({
    payment: await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    reservation: await prisma.reservation.findUniqueOrThrow({ where: { id: payment.reservationId }, include: { seats: true } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    logs: await prisma.dispatchLog.findMany({ orderBy: { id: 'asc' } }),
  });
  const before = await snapshot();
  const removed = await dismissDispatcherPayment(dispatcher, RouteCode.GOA, payment.id);
  assert.equal(removed.paypal.some((item) => item.id === payment.id), false);
  await dismissDispatcherPayment(dispatcher, RouteCode.GOA, payment.id);
  assert.deepEqual(await snapshot(), before);
  assert.equal(captureRequests.length, 0);
  await getDispatcherDashboard(RouteCode.GOA, dispatcher);
  assert.equal((await getDispatcherPayments(RouteCode.GOA, dispatcher)).paypal.some((item) => item.id === payment.id), false);
  const backup = await prisma.user.create({ data: { name: 'Checkout backup', email: 'checkout-backup@uvgo.test', passwordHash: 'unused', role: 'DISPATCHER', dispatcherRoute: RouteCode.GOA } });
  assert.equal((await getDispatcherPayments(RouteCode.GOA, backup.id)).paypal.some((item) => item.id === payment.id), true);

  approve(order.orderId);
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.status, 'confirmed');
  assert.deepEqual(booking.seats, input.seats);
  const captured = (await getDispatcherPayments(RouteCode.GOA, dispatcher)).paypal.find((item) => item.id === payment.id)!;
  assert.equal(captured.status, 'captured');
  assert.equal(captured.canDelete, true);
  assert.equal(captured.paypalOrderId, order.orderId);
  assert.equal(captured.transactionReference, `CAPTURE-${order.orderId}`);
  assert.ok(captured.paidAt);
  const paidBefore = await snapshot();
  await dismissDispatcherPayment(dispatcher, RouteCode.GOA, payment.id);
  await getDispatcherDashboard(RouteCode.GOA, dispatcher);
  assert.equal((await getDispatcherPayments(RouteCode.GOA, dispatcher)).paypal.some((item) => item.id === payment.id), false);
  assert.deepEqual(await snapshot(), paidBefore);
  assert.equal(captureRequests.length, 1);
});

test('Reservation cutoff: PayPal checkout created earlier can still complete after reservations close', async () => {
  const order = await startOrder();
  await prisma.trip.update({ where: { id: input.tripId }, data: {
    boardingStartTime: new Date(Date.now() + 4 * 60 * 60_000),
    scheduledOrTriggeredTime: new Date(Date.now() + 5 * 60 * 60_000),
  } });
  await assert.rejects(() => getTripSeats(input.tripId), errorCode('TRIP_CLOSED'));
  approve(order.orderId);
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.payment?.status, 'captured');
  assert.deepEqual(booking.seats, input.seats);
  assert.equal(captureRequests.length, 1);
});

test('Sandbox PayPal: an approval is not a completed payment and pending capture cannot release seats', async () => {
  const order = await startOrder();
  await assert.rejects(capturePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_NOT_COMPLETED'));
  assert.equal(captureRequests.length, 0);
  approve(order.orderId); captureStatus = 'PENDING';
  await assert.rejects(capturePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_NOT_COMPLETED'));
  assert.equal((await releasePaypalReservation(input.passengerId, order.reference)).released, false);
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { reference: order.reference } })).status, ReservationStatus.PENDING_PAYMENT);
  assert.equal((await getTripSeats(input.tripId)).seats.find((seat) => seat.number === 1)?.available, false);
});

test('Sandbox PayPal: student and senior discounts price the order and verified capture with the same stored total', async () => {
  await prisma.trip.update({ where: { id: input.tripId }, data: { fareAmount: 108 } });
  const order = await createPaypalReservation({ ...input, studentPassengers: 1, seniorPassengers: 1, discountIdAcknowledged: true });
  assert.equal(orders.get(order.orderId)!.purchase_units[0]!.amount.value, '172.80');
  approve(order.orderId);
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.status, 'confirmed'); assert.equal(booking.totalAmount, 172.8);
  assert.equal(booking.discountAmount, 43.2); assert.equal(booking.studentPassengers, 1); assert.equal(booking.seniorPassengers, 1);
});

for (const mismatch of ['amount', 'currency', 'reference', 'order', 'merchant'] as const) {
  test(`Sandbox PayPal: rejects a captured ${mismatch} mismatch without confirming`, async () => {
    const order = await startOrder(); approve(order.orderId);
    corruptCapture = (response) => {
      const unit = response.purchase_units[0]!;
      const capture = unit.payments!.captures[0]!;
      if (mismatch === 'amount') capture.amount.value = '0.01';
      if (mismatch === 'currency') capture.amount.currency_code = 'USD';
      if (mismatch === 'reference') unit.reference_id = 'OTHER-BOOKING';
      if (mismatch === 'order') response.id = 'OTHER-ORDER';
      if (mismatch === 'merchant') unit.payee.merchant_id = 'OTHER-MERCHANT';
    };
    await assert.rejects(capturePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_PAYMENT_MISMATCH'));
    const payment = await prisma.payment.findFirstOrThrow({ where: { reservation: { reference: order.reference } } });
    assert.equal(payment.status, PaymentStatus.PENDING);
    assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { reference: order.reference } })).status, ReservationStatus.PENDING_PAYMENT);
  });
}

test('Sandbox PayPal: rejects an altered provider order before making a capture request', async () => {
  const order = await startOrder(); approve(order.orderId);
  orders.get(order.orderId)!.purchase_units[0]!.amount.value = '0.01';
  await assert.rejects(capturePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_PAYMENT_MISMATCH'));
  assert.equal(captureRequests.length, 0);
});

test('Sandbox PayPal: historical demo orders cannot be verified by configured checkout', async () => {
  const order = await startOrder();
  await prisma.payment.updateMany({ where: { reservation: { reference: order.reference } }, data: { paypalOrderId: 'DEMO-HISTORICAL-ORDER' } });
  await assert.rejects(capturePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_INVALID_ORDER'));
  await assert.rejects(releasePaypalReservation(input.passengerId, order.reference), errorCode('PAYPAL_INVALID_ORDER'));
  assert.equal((await prisma.reservation.findUniqueOrThrow({ where: { reference: order.reference } })).status, ReservationStatus.PENDING_PAYMENT);
  assert.equal(captureRequests.length, 0);
});

test('Sandbox PayPal: a lost capture response is reconciled without a second charge', async () => {
  const order = await startOrder(); approve(order.orderId); loseCaptureResponse = true;
  const booking = await capturePaypalReservation(input.passengerId, order.reference);
  assert.equal(booking.status, 'confirmed'); assert.equal(captureRequests.length, 1);
});

test('Sandbox PayPal: an unpaid cancellation releases seats, while cancellation recovers an already captured payment', async () => {
  const unpaid = await startOrder();
  assert.equal((await releasePaypalReservation(input.passengerId, unpaid.reference)).released, true);
  assert.equal(await prisma.reservation.findUnique({ where: { reference: unpaid.reference } }), null);
  const paid = await startOrder();
  const provider = orders.get(paid.orderId)!; provider.status = 'COMPLETED';
  provider.purchase_units[0]!.payments = { captures: [{ id: 'RECOVERED-CAPTURE', status: 'COMPLETED', final_capture: true, amount: { ...provider.purchase_units[0]!.amount } }] };
  const result = await releasePaypalReservation(input.passengerId, paid.reference);
  assert.equal(result.released, false); assert.equal(result.booking?.status, 'confirmed');
  assert.equal(result.booking?.payment?.transactionReference, 'RECOVERED-CAPTURE');
});

test('Sandbox PayPal: concurrent cancellation cannot delete an in-flight captured reservation', async () => {
  const order = await startOrder(); approve(order.orderId); captureDelay = 50;
  const started = new Promise<void>((resolve) => { captureStarted = resolve; });
  const capture = capturePaypalReservation(input.passengerId, order.reference);
  await started;
  const cancel = releasePaypalReservation(input.passengerId, order.reference);
  const [booking, released] = await Promise.all([capture, cancel]);
  assert.equal(booking.status, 'confirmed'); assert.equal(released.released, false);
  assert.equal(captureRequests.length, 1);
});

test('Sandbox PayPal: order creation failure rolls back its unpaid seat hold', async () => {
  tokenFailure = true;
  await assert.rejects(startOrder(), errorCode('PAYPAL_UNAVAILABLE'));
  assert.equal(await prisma.reservation.count({ where: { tripId: input.tripId } }), 0);
  assert.equal((await getTripSeats(input.tripId)).seats.find((seat) => seat.number === 1)?.available, true);
});

test('Sandbox PayPal: HTTP routes enforce passenger ownership, authoritative totals, real credentials and Sandbox mode', async () => {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    async function login(email: string) {
      const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'UVGoDemo123!' }) });
      assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return cookie;
    }
    const passenger = await login('passenger@uvgo.demo');
    const other = await login('maria.santos@uvgo.demo');
    const dispatcher = await login('dispatcher@uvgo.demo');
    const config = await fetch(`${base}/passenger/paypal/config`, { headers: { Cookie: passenger } });
    const publicConfig = await config.json() as Record<string, unknown>;
    assert.equal(publicConfig.clientId, env.PAYPAL_CLIENT_ID); assert.equal(publicConfig.environment, 'sandbox');
    assert.equal(JSON.stringify(publicConfig).includes(env.PAYPAL_CLIENT_SECRET), false);
    assert.equal((await fetch(`${base}/passenger/paypal/config`)).status, 401);
    assert.equal((await fetch(`${base}/passenger/paypal/config`, { headers: { Cookie: dispatcher } })).status, 403);
    const create = await fetch(`${base}/passenger/reservations/paypal`, { method: 'POST', headers: { Cookie: passenger, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, amount: 0.01, passengerId: 'seed_user_passenger_maria' }) });
    assert.equal(create.status, 201);
    const order = await create.json() as { reference: string; orderId: string };
    const held = await prisma.reservation.findUniqueOrThrow({ where: { reference: order.reference }, include: { payments: true } });
    assert.equal(held.passengerId, input.passengerId); assert.ok(Number(held.payments[0]!.amount) > 0.01);
    assert.equal(orders.get(order.orderId)!.purchase_units[0]!.amount.value, Number(held.payments[0]!.amount).toFixed(2));
    assert.equal((await fetch(`${base}/passenger/bookings/${order.reference}/paypal/capture`, { method: 'POST', headers: { Cookie: other } })).status, 404);
    assert.equal((await fetch(`${base}/passenger/bookings/${order.reference}/paypal/release`, { method: 'POST', headers: { Cookie: other } })).status, 200);
    assert.ok(await prisma.reservation.findUnique({ where: { reference: order.reference } }));
    approve(order.orderId);
    const capture = await fetch(`${base}/passenger/bookings/${order.reference}/paypal/capture`, { method: 'POST', headers: { Cookie: passenger, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: 'ANOTHER-ORDER', amount: 0.01 }) });
    assert.equal(capture.status, 200); assert.equal((await capture.json() as { booking: { status: string } }).booking.status, 'confirmed');
    env.PAYPAL_CLIENT_ID = ''; env.PAYPAL_CLIENT_SECRET = '';
    assert.equal((await fetch(`${base}/passenger/paypal/config`, { headers: { Cookie: passenger } })).status, 503);
    const simulated = await fetch(`${base}/passenger/reservations/paypal`, { method: 'POST', headers: { Cookie: passenger, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, seats: [5] }) });
    assert.equal(simulated.status, 503);
    assert.equal(await prisma.reservationSeat.findUnique({ where: { tripId_seatNumber: { tripId: input.tripId, seatNumber: 5 } } }), null);
    env.PAYPAL_CLIENT_ID = 'test'; env.PAYPAL_CLIENT_SECRET = 'test'; env.PAYPAL_BASE_URL = 'https://api-m.paypal.com';
    assert.throws(getPayPalCheckoutConfig, errorCode('PAYPAL_SANDBOX_REQUIRED'));
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
