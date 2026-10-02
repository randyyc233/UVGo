import { CalendarDays, MapPin, TicketCheck, UsersRound, WalletCards } from 'lucide-react';
import { formatDateTime12, formatTime12 } from '../../lib/dateTime';
import type { GoaTrip, ReservationFareQuote } from '../../types/passenger';
import { Card } from '../ui';

interface BookingSummaryProps {
  trip: GoaTrip;
  seats: number[];
  paymentMethod?: 'paypal' | 'gcash';
  compact?: boolean;
  passengerCount?: number;
  total: number;
  discountQuote?: ReservationFareQuote;
}

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

const paymentLabels = {
  paypal: 'PayPal — automatic payment verification',
  gcash: 'GCash — receipt verification',
} as const;

function scheduleDate(value: string) {
  return new Date(value).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function scheduleTime(value: string) {
  return formatTime12(value);
}

function isSameCalendarDay(firstValue: string, secondValue: string) {
  const first = new Date(firstValue);
  const second = new Date(secondValue);
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

export function BookingSummary({ trip, seats, paymentMethod, compact = false, passengerCount, total, discountQuote }: BookingSummaryProps) {
  const count = passengerCount ?? seats.length;
  return (
    <Card className={compact ? 'p-4' : 'p-5'}>
      <h2 className="text-lg font-extrabold">Booking summary</h2>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="font-semibold">{trip.origin}</p><p className="text-text-secondary">to {trip.destination}</p></div></div>
        <div className="flex gap-3">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{scheduleDate(trip.departureTime)}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3">
              <div><dt className="text-xs text-text-secondary">Loading time</dt><dd className="whitespace-nowrap font-semibold">{scheduleTime(trip.boardingStartTime)}</dd>{!isSameCalendarDay(trip.boardingStartTime, trip.departureTime) ? <span className="text-[0.7rem] font-semibold text-warning-dark">Previous day</span> : null}</div>
              <div><dt className="text-xs text-text-secondary">Departure time</dt><dd className="whitespace-nowrap font-semibold">{scheduleTime(trip.departureTime)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-text-secondary">Reservations close {formatDateTime12(trip.reservationCutoffTime)}</p>
          </div>
        </div>
        <div className="flex gap-3"><UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p>{count} passenger{count === 1 ? '' : 's'}</p><p className="mt-1 text-text-secondary">{trip.availableSeats} seats available · Maximum {Math.min(11, trip.availableSeats)} passengers</p></div></div>
        <div className="flex gap-3"><TicketCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="font-bold">{seats.length ? `Seat${seats.length === 1 ? '' : 's'} ${seats.map((seat) => `#${seat}`).join(', ')}` : 'No seat selected yet'}</p></div>
        {paymentMethod ? <div className="flex gap-3"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{paymentLabels[paymentMethod]}</p></div> : null}
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span className="text-text-secondary">{money.format(trip.fare)} × {seats.length} selected seat{seats.length === 1 ? '' : 's'}</span><span>{money.format(discountQuote?.subtotal ?? total)}</span></div>
        {discountQuote && discountQuote.discountAmount > 0 ? <div className="rounded-control bg-cream p-3">
          <div className="flex justify-between gap-3"><span className="font-semibold">Student / senior discount (20%)</span><span className="shrink-0 font-semibold text-primary-dark">−{money.format(discountQuote.discountAmount)}</span></div>
          <p className="mt-1 text-xs text-text-secondary">{discountQuote.studentPassengers} student(s) · {discountQuote.seniorPassengers} senior citizen(s)</p>
          <p className="mt-1 text-xs text-text-secondary">Valid IDs required at the terminal.</p>
        </div> : null}
        <div className="rounded-control border border-primary/20 bg-primary-soft p-4" aria-live="polite" aria-atomic="true"><p className="text-sm font-bold text-primary-dark">Total Price</p><p className="mt-1 text-xl font-bold tracking-tight text-primary-dark">{money.format(total)}</p></div>
      </div>
    </Card>
  );
}
