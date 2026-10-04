import type { FleetSnapshot } from '../types/dispatcher';

type FleetEvent = FleetSnapshot['events'][number];

export function fleetEventLabel(event: FleetEvent) {
  if (event.eventType === 'terminal_arrival') return 'Entered 100-meter geofence';
  if (event.eventType === 'terminal_exit') return 'Exited 100-meter geofence';
  if (event.eventType === 'entered') {
    return event.distanceKm !== null && event.distanceKm <= 0.1
      ? 'Entered 100-meter geofence'
      : 'Entered 5 km Active Zone';
  }
  // The API's ordinary EXITED events record the 5 km boundary, regardless
  // of how far beyond that boundary the confirming GPS sample was taken.
  if (event.eventType === 'exited') return 'Exited 5 km Active Zone';
  return event.eventType.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function distanceFromTerminalKm(fleet: FleetSnapshot, latitude: number, longitude: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(latitude - fleet.terminal.latitude);
  const lngDelta = radians(longitude - fleet.terminal.longitude);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(fleet.terminal.latitude)) * Math.cos(radians(latitude)) * Math.sin(lngDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

// The fleet API does not supply terminal-exit events. Keep these observations
// in the open map only; they never create or modify server records.
export function observeTerminalExits(
  fleet: FleetSnapshot,
  terminalPresence: Map<string, number>,
  previousExits: FleetEvent[],
) {
  const vehicleIds = new Set(fleet.vehicles.map((vehicle) => vehicle.id));
  for (const vehicleId of terminalPresence.keys()) {
    if (!vehicleIds.has(vehicleId)) terminalPresence.delete(vehicleId);
  }
  const exits = previousExits.filter((event) => vehicleIds.has(event.id.split(':')[1] ?? ''));

  for (const vehicle of fleet.vehicles) {
    const observedAt = new Date(vehicle.updatedAt).getTime();
    // Exclude fallback map coordinates and unusable GPS samples.
    if (vehicle.accuracyMeters === null || !Number.isFinite(vehicle.accuracyMeters)
      || !Number.isFinite(observedAt) || !Number.isFinite(vehicle.latitude) || !Number.isFinite(vehicle.longitude)) continue;

    const previousInsideAt = terminalPresence.get(vehicle.id);
    if (previousInsideAt !== undefined && observedAt < previousInsideAt) continue;
    if (vehicle.insideTerminalZone) {
      terminalPresence.set(vehicle.id, observedAt);
      continue;
    }
    if (previousInsideAt === undefined || observedAt <= previousInsideAt) continue;

    const distanceKm = distanceFromTerminalKm(fleet, vehicle.latitude, vehicle.longitude);
    // A dispatcher action can clear the terminal flag while the van is still
    // physically inside. Wait for a newer GPS fix outside the terminal circle.
    if (distanceKm <= fleet.terminal.terminalArrivalRadiusKm) {
      terminalPresence.set(vehicle.id, observedAt);
      continue;
    }
    terminalPresence.delete(vehicle.id);
    exits.push({
      id: `terminal_exit:${vehicle.id}:${vehicle.updatedAt}`,
      vanId: vehicle.vanId,
      route: vehicle.route,
      eventType: 'terminal_exit',
      timestamp: vehicle.updatedAt,
      distanceKm,
    });
  }

  return exits
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 12);
}

export function mergeFleetEvents(fleet: FleetSnapshot, terminalExits: FleetEvent[]): FleetSnapshot {
  if (!terminalExits.length) return fleet;
  return {
    ...fleet,
    events: [...fleet.events, ...terminalExits]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
        || left.id.localeCompare(right.id))
      .slice(0, 12),
  };
}
