import { CalendarDays, MapPin, ShieldCheck, TicketCheck, UsersRound, WalletCards } from 'lucide-react';
import type { GoaTrip } from '../../types/passenger';
import { Card } from '../ui';

interface BookingSummaryProps {
  trip: GoaTrip;
  seats: number[];
  paymentMethod?: 'paypal' | 'gcash';
  compact?: boolean;
  passengerCount?: number;
}

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function BookingSummary({ trip, seats, paymentMethod, compact = false, passengerCount }: BookingSummaryProps) {
  const count = seats.length || passengerCount || 0;
  const fare = trip.fare * count;
  const total = fare + trip.serviceFee;
  return (
    <Card className={compact ? 'p-4' : 'p-5'}>
      <h2 className="text-lg font-extrabold">Booking summary</h2>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex gap-3"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="font-semibold">{trip.origin}</p><p className="text-text-secondary">to {trip.destination}</p></div></div>
        <div className="flex gap-3"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{new Date(trip.departureTime).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</p></div>
        <div className="flex gap-3"><UsersRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{count} passenger{count === 1 ? '' : 's'}</p></div>
        <div className="flex gap-3"><TicketCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Seat{seats.length === 1 ? '' : 's'} {seats.join(', ') || 'not selected'}</p></div>
        {paymentMethod ? <div className="flex gap-3"><WalletCards className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>{paymentMethod === 'paypal' ? 'PayPal Sandbox' : 'GCash — receipt verification'}</p></div> : null}
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between"><span className="text-text-secondary">Fare</span><span>{money.format(fare)}</span></div>
        <div className="flex justify-between"><span className="text-text-secondary">Service fee</span><span>{money.format(trip.serviceFee)}</span></div>
        <div className="flex justify-between text-base font-extrabold text-primary-dark"><span>Total</span><span>{money.format(total)}</span></div>
      </div>
      {!compact ? <p className="mt-4 flex gap-2 rounded-control bg-primary-soft p-3 text-xs leading-5 text-primary-dark"><ShieldCheck className="h-4 w-4 shrink-0" />No refunds. Rescheduling is allowed until 24 hours before departure.</p> : null}
    </Card>
  );
}
