import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { startDispatchScheduler } from './services/dispatchScheduler.js';

const stopDispatchScheduler = env.NODE_ENV === 'test' ? async () => undefined : startDispatchScheduler();

const server = app.listen(env.PORT, () => {
  console.log(`UVGo API listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Closing UVGo API.`);

  const forceShutdown = setTimeout(() => {
    console.error('UVGo API did not shut down within 10 seconds. Forcing exit.');
    process.exit(1);
  }, 10_000);
  forceShutdown.unref();

  try {
    await stopDispatchScheduler();
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      });
      server.closeIdleConnections();
    });
    await prisma.$disconnect();
    clearTimeout(forceShutdown);
    console.log('UVGo API shut down cleanly.');
    process.exitCode = 0;
  } catch (error) {
    clearTimeout(forceShutdown);
    console.error('UVGo API shutdown failed:', error);
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
