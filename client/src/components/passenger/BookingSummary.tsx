import { CalendarDays, MapPin, TicketCheck, UsersRound, WalletCards } from 'lucide-react';
import { formatTime12 } from '../../lib/dateTime';
import type { GoaTrip } from '../../types/passenger';
import { Card } from '../ui';

interface BookingSummaryProps {
  trip: GoaTrip;
  seats: number[];
  paymentMethod?: 'paypal' | 'gcash' | 'paymongo_qrph';
  compact?: boolean;
  passengerCount?: number;
}

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

const paymentLabels = {
  paypal: 'PayPal — dispatcher verification',
  gcash: 'GCash — receipt verification',
  paymongo_qrph: 'QR Ph — secure PayMongo payment',
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

export function BookingSummary({ trip, seats, paymentMethod, compact = false, passengerCount }: BookingSummaryProps) {
  const count = seats.length || passengerCount || 0;
  const fare = trip.fare * count;
  const total = fare;
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
          </div>
        </div>
        <div className="flex gap-3"><UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{count} passenger{count === 1 ? '' : 's'}</p></div>
        <div className="flex gap-3"><TicketCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{seats.length ? `Seat${seats.length === 1 ? '' : 's'} ${seats.join(', ')}` : 'No seat selected yet'}</p></div>
        {paymentMethod ? <div className="flex gap-3"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{paymentLabels[paymentMethod]}</p></div> : null}
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between"><span className="text-text-secondary">{money.format(trip.fare)} × {count} seat{count === 1 ? '' : 's'}</span><span>{money.format(fare)}</span></div>
        <div className="flex justify-between text-base font-extrabold text-primary-dark"><span>Total</span><span>{money.format(total)}</span></div>
      </div>
    </Card>
  );
}
