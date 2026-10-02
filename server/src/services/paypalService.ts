import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { randomUUID } from 'node:crypto';

interface PayPalCapture {
  id: string;
  status: string;
  final_capture?: boolean;
  amount: { currency_code: string; value: string };
}
interface PayPalUnit {
  reference_id?: string;
  amount?: { currency_code: string; value: string };
  payee?: { merchant_id?: string };
  payments?: { captures?: PayPalCapture[] };
}
interface PayPalOrderResponse {
  id: string;
  status: string;
  intent?: string;
  purchase_units?: PayPalUnit[];
  links?: { href: string; rel: string }[];
}
export interface ExpectedPayPalPayment { reference: string; amount: number }

const sandboxUrl = 'https://api-m.sandbox.paypal.com';
export function paypalConfigured() {
  return Boolean(env.PAYPAL_CLIENT_ID.trim() && env.PAYPAL_CLIENT_SECRET.trim());
}

/** Public checkout never falls back to simulated payments or switches to live money. */
export function getPayPalCheckoutConfig() {
  if (env.PAYPAL_BASE_URL !== sandboxUrl) throw new AppError(503, 'PAYPAL_SANDBOX_REQUIRED', 'This checkout requires PayPal Sandbox configuration.');
  if (!paypalConfigured()) throw new AppError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox credentials are not configured.');
  return { clientId: env.PAYPAL_CLIENT_ID.trim(), currency: 'PHP' as const, intent: 'capture' as const, environment: 'sandbox' as const };
}

async function getAccessToken() {
  getPayPalCheckoutConfig();
  const credentials = Buffer.from(`${env.PAYPAL_CLIENT_ID.trim()}:${env.PAYPAL_CLIENT_SECRET.trim()}`).toString('base64');
  const response = await fetch(`${sandboxUrl}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal Sandbox could not authenticate. Please try again.');
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal Sandbox did not provide an access token.');
  return data.access_token;
}

async function readOrder(orderId: string, token: string) {
  const response = await fetch(`${sandboxUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_VERIFICATION_UNAVAILABLE', 'Payment could not be checked with PayPal. Keep this reservation and check again; do not pay again.');
  return await response.json() as PayPalOrderResponse;
}

function verifyOrder(order: PayPalOrderResponse, orderId: string, expected: ExpectedPayPalPayment) {
  const unit = order.purchase_units?.[0];
  if (order.id !== orderId || order.intent !== 'CAPTURE' || order.purchase_units?.length !== 1
    || unit?.reference_id !== expected.reference || unit.amount?.currency_code !== 'PHP'
    || unit.amount.value !== expected.amount.toFixed(2) || !unit.payee?.merchant_id) {
    throw new AppError(409, 'PAYPAL_PAYMENT_MISMATCH', 'PayPal payment details do not match this reservation. Do not pay again; contact the terminal.');
  }
  return unit;
}

function completedCapture(order: PayPalOrderResponse, orderId: string, expected: ExpectedPayPalPayment, merchantId: string) {
  const unit = order.purchase_units?.[0];
  const captures = unit?.payments?.captures;
  const capture = captures?.[0];
  if (order.status !== 'COMPLETED' || capture?.status !== 'COMPLETED') return null;
  if (order.id !== orderId || order.purchase_units?.length !== 1 || unit?.reference_id !== expected.reference
    || (unit.payee?.merchant_id && unit.payee.merchant_id !== merchantId)
    || captures?.length !== 1 || !capture.id || capture.final_capture !== true
    || capture.amount?.currency_code !== 'PHP' || capture.amount.value !== expected.amount.toFixed(2)) {
    throw new AppError(409, 'PAYPAL_PAYMENT_MISMATCH', 'The captured payment does not match this reservation. Do not pay again; contact the terminal.');
  }
  return capture.id;
}

export async function createPayPalOrder(reference: string, amount: number) {
  // Historical service-level demo tests remain available; HTTP checkout requires real Sandbox credentials.
  if (!paypalConfigured()) {
    if (!env.DEMO_MODE) throw new AppError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal Sandbox credentials are not configured.');
    return { orderId: `DEMO-${randomUUID()}`, approvalUrl: null, demo: true };
  }
  const token = await getAccessToken();
  const response = await fetch(`${sandboxUrl}/v2/checkout/orders`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': reference },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: reference, amount: { currency_code: 'PHP', value: amount.toFixed(2) } }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_ORDER_FAILED', 'PayPal could not create the Sandbox order.');
  const order = await response.json() as PayPalOrderResponse;
  if (!order.id || order.id.startsWith('DEMO-')) throw new AppError(502, 'PAYPAL_ORDER_FAILED', 'PayPal did not return a valid order.');
  return { orderId: order.id, approvalUrl: order.links?.find((link) => ['approve', 'payer-action'].includes(link.rel))?.href ?? null, demo: false };
}

export async function getPayPalOrderState(orderId: string, expected: ExpectedPayPalPayment) {
  if (orderId.startsWith('DEMO-')) {
    if (env.DEMO_MODE && !paypalConfigured()) return { status: 'unpaid' as const, captureId: null };
    throw new AppError(409, 'PAYPAL_INVALID_ORDER', 'A simulated order cannot be verified as a PayPal Sandbox payment.');
  }
  const order = await readOrder(orderId, await getAccessToken());
  const unit = verifyOrder(order, orderId, expected);
  const captureId = completedCapture(order, orderId, expected, unit.payee!.merchant_id!);
  if (captureId) return { status: 'completed' as const, captureId };
  // An approved order or a pending capture may still settle. Never delete those holds.
  if (unit.payments?.captures?.length) return { status: 'pending' as const, captureId: null };
  if (order.status === 'APPROVED') return { status: 'approved' as const, captureId: null };
  if (['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED', 'VOIDED'].includes(order.status)) return { status: 'unpaid' as const, captureId: null };
  return { status: 'pending' as const, captureId: null };
}

export async function capturePayPalOrder(orderId: string, expected: ExpectedPayPalPayment) {
  if (orderId.startsWith('DEMO-')) {
    if (env.DEMO_MODE && !paypalConfigured()) return { completed: true, demo: true, captureId: null };
    throw new AppError(409, 'PAYPAL_INVALID_ORDER', 'A simulated order cannot be verified as a PayPal Sandbox payment.');
  }
  const token = await getAccessToken();
  const before = await readOrder(orderId, token);
  const unit = verifyOrder(before, orderId, expected);
  const merchantId = unit.payee!.merchant_id!;
  const existing = completedCapture(before, orderId, expected, merchantId);
  if (existing) return { completed: true, demo: false, captureId: existing };
  if (before.status !== 'APPROVED' || unit.payments?.captures?.length) return { completed: false, demo: false, captureId: null };
  // A deterministic request id makes retries safe even when the first response was lost.
  try {
    const response = await fetch(`${sandboxUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `${expected.reference}-capture`, Prefer: 'return=representation' },
      body: '{}', signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const order = await response.json() as PayPalOrderResponse;
      const captureId = completedCapture(order, orderId, expected, merchantId);
      return { completed: Boolean(captureId), demo: false, captureId };
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Reconcile with PayPal below instead of charging a second order or releasing its seats.
  }
  const after = await readOrder(orderId, token);
  verifyOrder(after, orderId, expected);
  const captureId = completedCapture(after, orderId, expected, merchantId);
  if (captureId) return { completed: true, demo: false, captureId };
  throw new AppError(502, 'PAYPAL_CAPTURE_UNCERTAIN', 'Payment has not been verified. Check this reservation again; do not pay again.');
}
