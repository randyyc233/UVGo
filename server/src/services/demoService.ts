import { DispatchAction } from '@prisma/client';
import { env } from '../config/env.js';
import { NCEBT } from '../config/terminal.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { recordDriverLocation, runDispatchEngine } from './automationService.js';

function requireDemoMode() {
  if (!env.DEMO_MODE) throw new AppError(403, 'DEMO_MODE_DISABLED', 'Simulation controls are available only in demo mode.');
}

export async function getDemoState() {
  requireDemoMode();
  const vehicle = await prisma.vehicle.findUnique({
    where: { vanId: 'VAN-005' },
    select: { vanId: true, status: true, lastKnownInsideZone: true, assignedDriverId: true },
  });
  return {
    demoMode: true,
    geofenceVehicle: vehicle ? {
      vanId: vehicle.vanId,
      status: vehicle.status.toLowerCase(),
      insideActiveZone: vehicle.lastKnownInsideZone,
    } : null,
  };
}

export async function simulateGeofenceEntry(actorUserId: string) {
  requireDemoMode();
  const vehicle = await prisma.vehicle.findUnique({ where: { vanId: 'VAN-005' }, select: { id: true, assignedDriverId: true } });
  if (!vehicle?.assignedDriverId) throw new AppError(409, 'DEMO_VEHICLE_UNAVAILABLE', 'The demo geofence vehicle is not available. Reset the demo data and try again.');

  const result = await recordDriverLocation(vehicle.assignedDriverId, NCEBT.latitude, NCEBT.longitude, new Date());
  await prisma.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.DEMO_SIMULATION,
      targetId: vehicle.id,
      reason: 'Dispatcher triggered the demo geofence-entry simulation.',
      metadata: { simulation: 'geofence_entry', vanId: 'VAN-005', transition: result.transition },
    },
  });
  return result;
}

export async function simulateDispatchEngine(actorUserId: string) {
  requireDemoMode();
  const result = await runDispatchEngine(actorUserId, new Date());
  await prisma.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.DEMO_SIMULATION,
      targetId: 'dispatch-engine',
      reason: 'Dispatcher triggered the demo dispatch-engine evaluation.',
      metadata: { simulation: 'dispatch_engine', evaluatedAt: result.evaluatedAt },
    },
  });
  return result;
}
