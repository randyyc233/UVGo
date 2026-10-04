import { BusFront, X } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime12 } from '../../lib/dateTime';
import { fleetEventLabel } from '../../lib/fleetEvents';
import type { FleetSnapshot } from '../../types/dispatcher';
import { Card, StatusBadge } from '../ui';

function time(value: string) {
  return formatDateTime12(value);
}

function locationLabel(vehicle: FleetSnapshot['vehicles'][number]) {
  if (vehicle.insideTerminalZone) return 'Ready for departure';
  if (vehicle.insideActiveZone) return 'Within 5 km Active Zone';
  return 'Outside 5 km Active Zone';
}

function locationTone(vehicle: FleetSnapshot['vehicles'][number]): 'success' | 'info' | 'neutral' {
  if (vehicle.insideTerminalZone) return 'success';
  if (vehicle.insideActiveZone) return 'info';
  return 'neutral';
}

export function MobileFleetSheet({ fleet }: { fleet: FleetSnapshot }) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <button
        type="button"
        className="absolute inset-x-3 bottom-4 z-20 inline-flex min-h-touch items-center justify-center gap-2 rounded-pill border border-primary/20 bg-primary px-3 py-3 text-sm font-extrabold text-white shadow-floating transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-controls="mobile-fleet-details"
        aria-expanded="false"
        onClick={() => setVisible(true)}
      >
        <BusFront className="h-5 w-5" aria-hidden="true" />
        View active vehicles ({fleet.vehicles.length})
      </button>
    );
  }

  return (
    <section
      id="mobile-fleet-details"
      className="absolute inset-x-3 bottom-3 z-20 flex max-h-[min(72dvh,42rem)] flex-col overflow-hidden rounded-card border border-border bg-surface/95 shadow-floating backdrop-blur"
      aria-label="Active vehicles and recent geofence events"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
            <BusFront className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-extrabold">Active vehicles</p>
            <p className="text-xs text-text-secondary">{fleet.vehicles.length} currently listed</p>
          </div>
        </div>
        <button
          type="button"
          className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-cream hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Close active vehicles"
          aria-controls="mobile-fleet-details"
          aria-expanded="true"
          onClick={() => setVisible(false)}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        <Card className="p-3">
          {fleet.vehicles.length ? (
            <div className="space-y-2">
              {fleet.vehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-control border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold">{vehicle.vanId}</p>
                    <StatusBadge tone={locationTone(vehicle)}>{locationLabel(vehicle)}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    {vehicle.driver} · {vehicle.route} · Queue #{vehicle.queuePosition ?? '—'}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-primary-dark">
                    {vehicle.insideTerminalZone
                      ? 'Inside 100-meter terminal zone · departure ready'
                      : vehicle.insideActiveZone
                        ? 'Inside 5 km Active Zone · approaching terminal'
                        : 'Outside 5 km Active Zone'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-5 text-center text-sm text-text-secondary">No active vehicles.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="font-extrabold">Recent geofence events</h2>
          <div className="mt-3 divide-y divide-border">
            {fleet.events.length ? (
              fleet.events.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="text-sm font-bold">{event.vanId} {fleetEventLabel(event)}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {event.route} · {event.eventType === 'terminal_arrival' ? 'Arrival time: ' : ''}{time(event.timestamp)}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary">No recent events.</p>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
