import 'dotenv/config';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  PAYPAL_CLIENT_ID: z.string().optional().default(''),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(''),
  PAYPAL_BASE_URL: z.url().default('https://api-m.sandbox.paypal.com'),
  UPLOAD_DIR: z.string().default('uploads/receipts'),
  DEMO_MODE: z.string().default('true').transform((value) => value === 'true'),
  DISPATCH_ENGINE_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(10_000),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error('Invalid server environment configuration:', parsedEnvironment.error.flatten().fieldErrors);
  throw new Error('Server environment validation failed.');
}

export const env = parsedEnvironment.data;
