import { app } from './app.js';
import { env } from './config/env.js';
import { startDispatchScheduler } from './services/dispatchScheduler.js';

const stopDispatchScheduler = env.NODE_ENV === 'test' ? () => undefined : startDispatchScheduler();

const server = app.listen(env.PORT, () => {
  console.log(`UVGo API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received. Closing UVGo API.`);
  stopDispatchScheduler();
  server.close((error) => {
    if (error) {
      console.error('UVGo API shutdown failed:', error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
