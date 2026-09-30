import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  GOOGLE_CLIENT_ID: z.string().trim().optional().default(''),
  GMAIL_USER: z.union([z.literal(''), z.email()]).default(''),
  GMAIL_APP_PASSWORD: z.string().optional().default('').transform((value) => value.replaceAll(' ', '')),
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default('UVGo'),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().int().min(5).max(30).default(10),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  PAYPAL_BASE_URL: z.url().default('https://api-m.sandbox.paypal.com'),
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

});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid server environment configuration:', parsedEnvironment.error.flatten().fieldErrors);
  throw new Error('Server environment validation failed.');
}

export const env = parsedEnvironment.data;
