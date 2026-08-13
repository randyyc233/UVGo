import { ChevronUp } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { FleetSnapshot } from '../../types/dispatcher';
import { Card, StatusBadge } from '../ui';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function tone(value: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['ready_for_dispatch', 'accepted', 'verified', 'captured', 'confirmed', 'at_terminal'].includes(value)) return 'success';
  if (['pending', 'pending_verification', 'waiting', 'loading', 'assigned'].includes(value)) return 'warning';
  if (['delayed', 'rejected', 'replaced', 'unavailable'].includes(value)) return 'danger';
  if (['incoming', 'assigning'].includes(value)) return 'info';
  return 'neutral';
}

function time(value: string) {
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface DragGesture {
  pointerId: number;
  startY: number;
  startHeight: number;
  currentHeight: number;
  minHeight: number;
  maxHeight: number;
}

export function MobileFleetSheet({ fleet }: { fleet: FleetSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const didDragRef = useRef(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const sheet = sheetRef.current;
    const minHeight = 240;
    const parentHeight = sheet?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    const maxHeight = Math.max(minHeight, Math.min(parentHeight - 24, window.innerHeight * 0.72, 672));
    const startHeight = sheet?.getBoundingClientRect().height ?? minHeight;

    gestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      currentHeight: startHeight,
      minHeight,
      maxHeight,
    };
    didDragRef.current = false;
    setDragHeight(startHeight);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const distance = gesture.startY - event.clientY;
    const nextHeight = Math.min(gesture.maxHeight, Math.max(gesture.minHeight, gesture.startHeight + distance));
    gesture.currentHeight = nextHeight;
    if (Math.abs(distance) > 4) didDragRef.current = true;
    setDragHeight(nextHeight);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current;
    if (gesture) {
      setExpanded(gesture.currentHeight > (gesture.minHeight + gesture.maxHeight) / 2);
    }
    gestureRef.current = null;
    setDragHeight(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const sheetHeight = dragHeight === null ? (expanded ? 'min(72dvh, 42rem)' : '15rem') : `${dragHeight}px`;

  return (
    <section
      ref={sheetRef}
      className={`absolute inset-x-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-card border border-border bg-surface/95 shadow-floating backdrop-blur ${dragHeight === null ? 'transition-[height] duration-300 ease-out' : ''}`}
      style={{ height: sheetHeight, maxHeight: 'calc(100% - 1.5rem)' }}
      aria-label="Fleet status"
    >
      <button
        type="button"
        className="flex w-full shrink-0 touch-none cursor-grab flex-col items-center px-4 pb-3 pt-2 text-left active:cursor-grabbing"
        aria-controls="mobile-fleet-details"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse fleet details' : 'Expand fleet details'}
        onClick={() => {
          if (!didDragRef.current) setExpanded((current) => !current);
          didDragRef.current = false;
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <span className="h-1.5 w-12 rounded-pill bg-border-strong" aria-hidden="true" />
        <span className="mt-2 flex w-full items-center justify-between gap-3">
          <span className="font-extrabold">Active vehicles ({fleet.vehicles.length})</span>
          <ChevronUp className={`h-5 w-5 text-primary transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>

      <div id="mobile-fleet-details" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3">
        <Card className="p-3">
          <div className="space-y-2">
            {fleet.vehicles.map((vehicle) => (
              <div key={vehicle.id} className="rounded-control border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">{vehicle.vanId}</p>
                  <StatusBadge tone={tone(vehicle.status)}>{label(vehicle.status)}</StatusBadge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {vehicle.driver} · {vehicle.route} · Queue #{vehicle.queuePosition ?? '—'}
                </p>
                <p className="mt-2 text-xs font-semibold text-primary-dark">
                  {vehicle.insideActiveZone ? 'Inside Active Zone' : 'Outside Active Zone'}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-extrabold">Recent geofence events</h2>
          <div className="mt-3 divide-y divide-border">
            {fleet.events.length ? (
              fleet.events.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="text-sm font-bold">{event.vanId} {label(event.eventType)}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {event.route} · {time(event.timestamp)}{event.distanceKm !== null ? ` · ${event.distanceKm} km` : ''}
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
