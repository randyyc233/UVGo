import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

type PaymongoAuthentication = 'secret' | 'public';

interface PaymongoResource<TAttributes> {
  data: {
    id: string;
    type: string;
    attributes: TAttributes;
  };
}

interface PaymongoPaymentAttributes {
  amount: number;
  currency: string;
  livemode: boolean;
  payment_intent_id?: string | null;
  status: string;
  paid_at?: number | null;
}

export interface PaymongoPaymentResource {
  id: string;
  type: string;
  attributes: PaymongoPaymentAttributes;
}

export interface PaymongoPaymentIntentAttributes {
  amount: number;
  client_key: string;
  currency: string;
  livemode: boolean;
  status: 'awaiting_payment_method' | 'awaiting_next_action' | 'processing' | 'succeeded';
  last_payment_error?: {
    failed_code?: string;
    failed_message?: string;
  } | null;
  payments?: PaymongoPaymentResource[];
  next_action?: {
    code?: {
      image_url?: string;
      test_url?: string;
    };
  } | null;
}

export interface PaymongoQrphCheckout {
  paymentIntentId: string;
  qrImageUrl: string;
  expiresAt: string;
  livemode: boolean;
  testUrl: string | null;
}

interface PaymongoErrorResponse {
  errors?: Array<{ code?: string; detail?: string }>;
}

function paymongoKey(authentication: PaymongoAuthentication) {
  return authentication === 'secret' ? env.PAYMONGO_SECRET_KEY : env.PAYMONGO_PUBLIC_KEY;
}

async function paymongoRequest<T>(
  path: string,
  options: {
    authentication: PaymongoAuthentication;
    method?: 'GET' | 'POST';
    body?: unknown;
    idempotencyKey?: string;
  },
) {
  const key = paymongoKey(options.authentication);
  if (!key) throw new AppError(503, 'PAYMONGO_NOT_CONFIGURED', 'QR Ph payment is not configured. Choose another payment method.');

  let response: Response;
  try {
    response = await fetch(`${env.PAYMONGO_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(502, 'PAYMONGO_UNAVAILABLE', 'PayMongo could not be reached. No payment was collected; please try again.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppError(502, 'PAYMONGO_INVALID_RESPONSE', 'PayMongo returned an unreadable response. No payment was collected; please try again.');
  }

  if (!response.ok) {
    const errorPayload = payload as PaymongoErrorResponse;
    const detail = errorPayload.errors?.map((error) => error.detail).filter(Boolean).join(' ') || 'PayMongo rejected the payment request.';
    throw new AppError(502, 'PAYMONGO_REQUEST_FAILED', detail);
  }

  return payload as T;
}

export function paymongoQrphAvailable() {
  return Boolean(env.PAYMONGO_SECRET_KEY && env.PAYMONGO_PUBLIC_KEY && env.PAYMONGO_WEBHOOK_SECRET);
}

export function assertPaymongoQrphAvailable() {
  if (!paymongoQrphAvailable()) {
    throw new AppError(503, 'PAYMONGO_NOT_CONFIGURED', 'QR Ph payment is temporarily unavailable. Choose GCash receipt or PayPal instead.');
  }
}

export async function createPaymongoPaymentIntent(input: {
  amountCentavos: number;
  reservationReference: string;
  idempotencyKey: string;
}) {
  assertPaymongoQrphAvailable();
  return paymongoRequest<PaymongoResource<PaymongoPaymentIntentAttributes>>('/payment_intents', {
    authentication: 'secret',
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: {
      data: {
        attributes: {
          capture_type: 'automatic',
          amount: input.amountCentavos,
          payment_method_allowed: ['qrph'],
          currency: 'PHP',
          description: 'UVGo Passenger Fare',
          statement_descriptor: 'UVGO TRANSPORT',
          metadata: { reservation_reference: input.reservationReference },
        },
      },
    },
  });
}

export async function createAndAttachPaymongoQrph(input: {
  paymentIntentId: string;
  clientKey: string;
  paymentRecordId: string;
  billing: { name: string; email: string; phone: string };
}) {
  assertPaymongoQrphAvailable();
  const paymentMethod = await paymongoRequest<PaymongoResource<{ created_at: number; livemode: boolean }>>('/payment_methods', {
    authentication: 'public',
    method: 'POST',
    idempotencyKey: `uvgo-qrph-method-${input.paymentRecordId}`,
    body: {
      data: {
        attributes: {
          type: 'qrph',
          expiry_seconds: env.PAYMONGO_QR_EXPIRY_SECONDS,
          billing: input.billing,
          metadata: { uvgo_payment_id: input.paymentRecordId },
        },
      },
    },
  });

  const attached = await paymongoRequest<PaymongoResource<PaymongoPaymentIntentAttributes>>(
    `/payment_intents/${encodeURIComponent(input.paymentIntentId)}/attach`,
    {
      authentication: 'public',
      method: 'POST',
      idempotencyKey: `uvgo-qrph-attach-${input.paymentRecordId}`,
      body: {
        data: {
          attributes: {
            payment_method: paymentMethod.data.id,
            client_key: input.clientKey,
          },
        },
      },
    },
  );

  const qrImageUrl = attached.data.attributes.next_action?.code?.image_url;
  if (!qrImageUrl || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(qrImageUrl)) {
    throw new AppError(502, 'PAYMONGO_QR_MISSING', 'PayMongo did not return a valid QR Ph image. No payment was collected; please try again.');
  }

  const createdAt = Number(paymentMethod.data.attributes.created_at) * 1_000;
  const expiresAt = new Date((Number.isFinite(createdAt) ? createdAt : Date.now()) + env.PAYMONGO_QR_EXPIRY_SECONDS * 1_000);
  const testUrl = attached.data.attributes.next_action?.code?.test_url;
  return {
    paymentMethodId: paymentMethod.data.id,
    checkout: {
      paymentIntentId: attached.data.id,
      qrImageUrl,
      expiresAt: expiresAt.toISOString(),
      livemode: attached.data.attributes.livemode,
      testUrl: testUrl && /^https:\/\//i.test(testUrl) ? testUrl : null,
    } satisfies PaymongoQrphCheckout,
  };
}

export async function retrievePaymongoPaymentIntent(paymentIntentId: string) {
  return paymongoRequest<PaymongoResource<PaymongoPaymentIntentAttributes>>(
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { authentication: 'secret' },
  );
}

function safeHexEqual(expected: string, candidate: string | undefined) {
  if (!candidate || !/^[a-f\d]{64}$/i.test(candidate)) return false;
  const expectedBytes = Buffer.from(expected, 'hex');
  const candidateBytes = Buffer.from(candidate, 'hex');
  return expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes);
}

/** Verify the exact raw request bytes before any webhook data reaches the database. */
export function verifyPaymongoWebhookSignature(rawBody: Buffer, signatureHeader: string, secret = env.PAYMONGO_WEBHOOK_SECRET) {
  if (!secret) return false;
  const signatureParts = new Map(
    signatureHeader.split(',').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return [key, value.join('=')] as const;
    }),
  );
  const timestamp = signatureParts.get('t');
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1_000 - timestampSeconds) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  return safeHexEqual(expected, signatureParts.get('te')) || safeHexEqual(expected, signatureParts.get('li'));
}

export interface PaymongoWebhookEvent {
  data: {
    id: string;
    type: 'event';
    attributes: {
      type: string;
      livemode?: boolean;
      data: {
        id: string;
        type: string;
        attributes: Record<string, unknown>;
      };
    };
  };
}

export function parsePaymongoWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
  if (!signatureHeader || !verifyPaymongoWebhookSignature(rawBody, signatureHeader)) {
    throw new AppError(401, 'INVALID_PAYMONGO_SIGNATURE', 'The PayMongo webhook signature is invalid.');
  }
  try {
    return JSON.parse(rawBody.toString('utf8')) as PaymongoWebhookEvent;
  } catch {
    throw new AppError(400, 'INVALID_PAYMONGO_WEBHOOK', 'The PayMongo webhook body is invalid.');
  }
}
