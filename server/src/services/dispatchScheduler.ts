import { env } from '../config/env.js';
import { runDispatchEngine } from './automationService.js';
import { materializeWeeklySchedules } from './weeklyScheduleService.js';

export function startDispatchScheduler() {
  let activeTick: Promise<void> | null = null;
  const tick = () => {
    if (activeTick) return activeTick;

    activeTick = (async () => {
      try {
        await materializeWeeklySchedules();
        await runDispatchEngine();
      } catch (error) {
        console.error('Dispatch engine tick failed:', error instanceof Error ? error.message : 'Unknown error');
      } finally {
        activeTick = null;
      }
    })();

    return activeTick;
  };
  const timer = setInterval(() => void tick(), env.DISPATCH_ENGINE_INTERVAL_MS);
  timer.unref();
  void tick();
  return async () => {
    clearInterval(timer);
    await activeTick;
  };
}
