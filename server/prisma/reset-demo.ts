import { disconnectSeedClient, resetDemoData } from './seed.js';

resetDemoData()
  .then(() => {
    console.log('UVGo demo data reset complete.');
  })
  .catch((error: unknown) => {
    console.error('UVGo demo reset failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectSeedClient();
  });
