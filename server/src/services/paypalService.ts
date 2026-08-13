import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { randomUUID } from 'node:crypto';

interface PayPalLink {
  href: string;
  rel: string;
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: PayPalLink[];
}

export function paypalConfigured() {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}

async function getAccessToken() {
  const credentials = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal sandbox is unavailable. Please try again.');
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new AppError(502, 'PAYPAL_UNAVAILABLE', 'PayPal sandbox did not provide an access token.');
  return data.access_token;
}

export async function createPayPalOrder(reference: string, amount: number) {
  if (!paypalConfigured()) {
    if (!env.DEMO_MODE) throw new AppError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal sandbox credentials are not configured.');
    return { orderId: `DEMO-${randomUUID()}`, approvalUrl: null, demo: true };
  }

  const accessToken = await getAccessToken();
  const response = await fetch(`${env.PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': reference,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: reference, amount: { currency_code: 'PHP', value: amount.toFixed(2) } }],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: 'PAY_NOW',
            return_url: `${env.CLIENT_ORIGIN}/passenger/book?paypal=success&reference=${encodeURIComponent(reference)}`,
            cancel_url: `${env.CLIENT_ORIGIN}/passenger/book?paypal=cancelled&reference=${encodeURIComponent(reference)}`,
          },
        },
      },
    }),
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_ORDER_FAILED', 'PayPal could not create the sandbox order.');
  const order = await response.json() as PayPalOrderResponse;
  return { orderId: order.id, approvalUrl: order.links?.find((link) => link.rel === 'payer-action')?.href ?? null, demo: false };
}

export async function capturePayPalOrder(orderId: string) {
  if (orderId.startsWith('DEMO-') && env.DEMO_MODE) return { completed: true, demo: true };
  if (!paypalConfigured()) throw new AppError(503, 'PAYPAL_NOT_CONFIGURED', 'PayPal sandbox credentials are not configured.');

  const accessToken = await getAccessToken();
  const response = await fetch(`${env.PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new AppError(502, 'PAYPAL_CAPTURE_FAILED', 'PayPal could not capture this sandbox payment.');
  const order = await response.json() as PayPalOrderResponse;
  return { completed: order.status === 'COMPLETED', demo: false };
}
