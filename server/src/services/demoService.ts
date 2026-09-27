import { DispatchAction, RouteCode } from '@prisma/client';
import { env } from '../config/env.js';
import { NCEBT, TERMINAL_GEOFENCE } from '../config/terminal.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../utils/AppError.js';
import { recordDriverLocation, runDispatchEngine } from './automationService.js';

function requireDemoMode() {
  if (!env.DEMO_MODE) throw new AppError(403, 'DEMO_MODE_DISABLED', 'Simulation controls are available only in demo mode.');
}

const demoVehicles: Record<RouteCode, string> = { GOA: 'VAN-021', LEGAZPI: 'VAN-005' };

export async function getDemoState(route: RouteCode) {
  requireDemoMode();
  const vehicle = await prisma.vehicle.findUnique({
    where: { vanId: demoVehicles[route] },
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

export async function simulateGeofenceEntry(actorUserId: string, route: RouteCode) {
  requireDemoMode();
  const vanId = demoVehicles[route];
  const vehicle = await prisma.vehicle.findUnique({ where: { vanId }, select: { id: true, route: true, assignedDriverId: true, lastKnownInsideZone: true, goOnTripEnabled: true } });
  if (!vehicle?.assignedDriverId) throw new AppError(409, 'DEMO_VEHICLE_UNAVAILABLE', 'The demo geofence vehicle is not available. Reset the demo data and try again.');
  if (vehicle.route !== route) throw new AppError(403, 'ROUTE_ACCESS_DENIED', 'You cannot simulate another dispatcher route.');
  if (!vehicle.goOnTripEnabled) throw new AppError(409, 'GO_ON_TRIP_DISABLED', 'The driver must turn on Go on Trip before simulating GPS entry.');

  const startedAt = Date.now();
  if (vehicle.lastKnownInsideZone) {
    await recordDriverLocation(
      vehicle.assignedDriverId,
      NCEBT.latitude + 0.06,
      NCEBT.longitude,
      new Date(startedAt),
      20,
    );
  }
  let result = await recordDriverLocation(
    vehicle.assignedDriverId,
    NCEBT.latitude,
    NCEBT.longitude,
    new Date(startedAt + TERMINAL_GEOFENCE.sampleMinIntervalMs),
    20,
  );
  for (let sample = 1; sample < TERMINAL_GEOFENCE.requiredSamples; sample += 1) {
    result = await recordDriverLocation(
      vehicle.assignedDriverId,
      NCEBT.latitude,
      NCEBT.longitude,
      new Date(startedAt + TERMINAL_GEOFENCE.sampleMinIntervalMs * (sample + 1)),
      20,
    );
  }
  await prisma.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.DEMO_SIMULATION,
      targetId: vehicle.id,
      route,
      reason: 'Dispatcher triggered the demo geofence-entry simulation.',
      metadata: { simulation: 'geofence_entry', vanId, transition: result.transition },
    },
  });
  return result;
}

export async function simulateDispatchEngine(actorUserId: string, route: RouteCode) {
  requireDemoMode();
  const result = await runDispatchEngine(actorUserId, new Date(), route);
  await prisma.dispatchLog.create({
    data: {
      actorUserId,
      action: DispatchAction.DEMO_SIMULATION,
      targetId: 'dispatch-engine',
      route,
      reason: 'Dispatcher triggered the demo dispatch-engine evaluation.',
      metadata: { simulation: 'dispatch_engine', evaluatedAt: result.evaluatedAt },
    },
  });
  return result;
}
