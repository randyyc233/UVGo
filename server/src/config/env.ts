import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  GMAIL_USER: z.union([z.literal(''), z.email()]).default(''),
  GMAIL_APP_PASSWORD: z.string().optional().default('').transform((value) => value.replaceAll(' ', '')),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default('UVGo'),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().int().min(5).max(30).default(10),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  PAYPAL_BASE_URL: z.url().default('https://api-m.sandbox.paypal.com'),
  PAYMONGO_SECRET_KEY: z.string().optional().default(''),
  PAYMONGO_PUBLIC_KEY: z.string().optional().default(''),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional().default(''),
  PAYMONGO_BASE_URL: z.url().default('https://api.paymongo.com/v1'),
  PAYMONGO_QR_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(9_000).default(1_800),
  UPLOAD_DIR: z.string().default('uploads/receipts'),
  DEMO_MODE: z.string().default('true').transform((value) => value === 'true'),
  DISPATCH_ENGINE_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(10_000),
  TERMINAL_ARRIVAL_RADIUS_M: z.coerce.number().int().min(100).max(500).default(100),
  GEOFENCE_REQUIRED_SAMPLES: z.coerce.number().int().min(1).max(5).default(1),
  GEOFENCE_MAX_ACCURACY_M: z.coerce.number().positive().max(500).default(50),
  GEOFENCE_SAMPLE_MIN_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(8_000),
  GEOFENCE_SAMPLE_MAX_AGE_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  GEOFENCE_MIN_OUTWARD_PROGRESS_M: z.coerce.number().nonnegative().max(100).default(5),
}).superRefine((environment, context) => {
  const gmailUserConfigured = environment.GMAIL_USER.length > 0;
  const gmailPasswordConfigured = environment.GMAIL_APP_PASSWORD.length > 0;

  if (gmailUserConfigured !== gmailPasswordConfigured) {
    context.addIssue({
      code: 'custom',
      path: gmailUserConfigured ? ['GMAIL_APP_PASSWORD'] : ['GMAIL_USER'],
      message: 'GMAIL_USER and GMAIL_APP_PASSWORD must either both be configured or both be blank.',
    });
  }

  if (gmailPasswordConfigured && environment.GMAIL_APP_PASSWORD.length !== 16) {
    context.addIssue({
      code: 'custom',
      path: ['GMAIL_APP_PASSWORD'],
      message: 'Use the 16-character Google App Password, not the account password. Spaces are optional.',
    });
  }

  const paymongoSecretConfigured = environment.PAYMONGO_SECRET_KEY.length > 0;
  const paymongoPublicConfigured = environment.PAYMONGO_PUBLIC_KEY.length > 0;
  if (paymongoSecretConfigured !== paymongoPublicConfigured) {
    context.addIssue({
      code: 'custom',
      path: paymongoSecretConfigured ? ['PAYMONGO_PUBLIC_KEY'] : ['PAYMONGO_SECRET_KEY'],
      message: 'PAYMONGO_SECRET_KEY and PAYMONGO_PUBLIC_KEY must either both be configured or both be blank.',
    });
  }

  if (paymongoSecretConfigured && !/^sk_(test|live)_/.test(environment.PAYMONGO_SECRET_KEY)) {
    context.addIssue({ code: 'custom', path: ['PAYMONGO_SECRET_KEY'], message: 'Use a PayMongo sk_test_ or sk_live_ secret key.' });
  }
  if (paymongoPublicConfigured && !/^pk_(test|live)_/.test(environment.PAYMONGO_PUBLIC_KEY)) {
    context.addIssue({ code: 'custom', path: ['PAYMONGO_PUBLIC_KEY'], message: 'Use a PayMongo pk_test_ or pk_live_ public key.' });
  }
  if (paymongoSecretConfigured && paymongoPublicConfigured) {
    const secretMode = environment.PAYMONGO_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test';
    const publicMode = environment.PAYMONGO_PUBLIC_KEY.startsWith('pk_live_') ? 'live' : 'test';
    if (secretMode !== publicMode) {
      context.addIssue({ code: 'custom', path: ['PAYMONGO_PUBLIC_KEY'], message: 'PayMongo public and secret keys must use the same test/live mode.' });
    }
  }
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid server environment configuration:', parsedEnvironment.error.flatten().fieldErrors);
  throw new Error('Server environment validation failed.');
}

export const env = parsedEnvironment.data;
