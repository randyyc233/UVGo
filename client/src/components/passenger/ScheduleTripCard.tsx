import { CheckCircle2, Circle, Clock3 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatTime12 } from '../../lib/dateTime';
import type { GoaTrip } from '../../types/passenger';

interface ScheduleTripCardProps {
  trip: GoaTrip;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function ScheduleTripCard({ trip, selected, disabled = false, onSelect }: ScheduleTripCardProps) {
  const loadingDate = new Date(trip.boardingStartTime).toDateString();
  const departureDate = new Date(trip.departureTime).toDateString();
  const limit = Math.min(11, trip.availableSeats);

  return (
    <button
      type="button"
      disabled={disabled || limit === 0}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'w-full rounded-card border-2 p-4 text-left shadow-card transition sm:p-5',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        selected ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border-strong bg-white hover:border-primary hover:bg-primary-soft/40',
        (disabled || limit === 0) && 'cursor-not-allowed bg-cream opacity-60',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex items-start gap-2 font-extrabold">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          {new Date(trip.departureTime).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
        {selected ? <CheckCircle2 className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : <Circle className="h-6 w-6 shrink-0 text-text-muted" aria-hidden="true" />}
      </span>
      <span className="mt-4 grid grid-cols-2 gap-3">
        <span><span className="block text-sm text-text-secondary">Loading time</span><span className="block text-lg font-extrabold">{formatTime12(trip.boardingStartTime)}</span>{loadingDate !== departureDate ? <span className="block text-xs font-semibold text-warning-dark">Previous day</span> : null}</span>
        <span><span className="block text-sm text-text-secondary">Departure time</span><span className="block text-lg font-extrabold">{formatTime12(trip.departureTime)}</span></span>
      </span>
      <span className="mt-3 block break-words text-sm text-text-secondary">{trip.vanId} · Goa scheduled trip</span>
      <span className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span><span className="block font-extrabold text-primary-dark">₱{trip.fare.toFixed(2)} <span className="text-sm font-normal text-text-secondary">/ seat</span></span><span className="block text-sm text-text-secondary">{trip.availableSeats} seat{trip.availableSeats === 1 ? '' : 's'} left · Up to {limit} passenger{limit === 1 ? '' : 's'}</span></span>
        <span className={cn('text-sm font-bold', selected ? 'text-primary-dark' : 'text-text-secondary')}>
          {limit === 0 ? 'Fully booked' : disabled ? 'Unavailable for this party' : selected ? 'Selected' : 'Tap to select'}
        </span>
      </span>
    </button>
  );
}
