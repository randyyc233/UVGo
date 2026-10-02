import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Never seed/reset the application's database to run regression tests.
const databaseName = `test_uvgo_${Date.now()}_${process.pid}`;
const testDemoMode = process.env.UVGO_TEST_DEMO_MODE ?? 'true';
if (!['true', 'false'].includes(testDemoMode)) throw new Error('UVGO_TEST_DEMO_MODE must be true or false.');
const applicationUrl = new URL(process.env.DATABASE_URL);
const testUrl = new URL(applicationUrl);
testUrl.pathname = `/${databaseName}`;
if (!/^test_uvgo_[0-9]+_[0-9]+$/.test(databaseName) || testUrl.pathname === applicationUrl.pathname) throw new Error('Invalid isolated test database.');
const admin = new PrismaClient();
const uploadDirectory = await mkdtemp(join(tmpdir(), 'uvgo-test-receipts-'));
if (dirname(uploadDirectory) !== tmpdir()) throw new Error('Invalid isolated upload directory.');
let created = false;
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${databaseName}\``);
  created = true;
  // Regression tests use demo helpers or mocked PayPal responses, never the developer's real credentials.
  const env = { ...process.env, DATABASE_URL: testUrl.toString(), UPLOAD_DIR: uploadDirectory, NODE_ENV: 'test', DEMO_MODE: testDemoMode, PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com', UVGO_ISOLATED_TEST_DATABASE: databaseName };
  // Resolve workspace-hoisted packages without depending on shell execution.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const migrate = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { env, stdio: 'inherit' });
  if (migrate.status !== 0) throw new Error('Isolated test migration failed.');
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--test', '--test-concurrency=1', ...process.argv.slice(2), 'tests/critical-business-rules.test.ts', 'tests/paypal-sandbox.test.ts', 'tests/reservation-discounts.test.ts'], { env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  // This exact database was created above by this run and contains test fixtures only.
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE \`${databaseName}\``);
  await admin.$disconnect();
  // Delete only the exact temporary upload directory created by this test run.
  await rm(uploadDirectory, { recursive: true, force: true });
}
