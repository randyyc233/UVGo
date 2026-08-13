import { env } from '../config/env.js';
import { runDispatchEngine } from './automationService.js';

export function startDispatchScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDispatchEngine();
    } catch (error) {
      console.error('Dispatch engine tick failed:', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), env.DISPATCH_ENGINE_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
