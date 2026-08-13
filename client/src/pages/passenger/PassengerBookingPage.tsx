import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  MapPin,
  ShieldCheck,
  Smartphone,
  UploadCloud,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { BookingSummary } from '../../components/passenger/BookingSummary';
import { VanSeatPicker } from '../../components/passenger/VanSeatPicker';
import { Button, Card, Input, LoadingSkeleton, Stepper } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { GoaTrip, PassengerBooking, TripSeat } from '../../types/passenger';

const steps = [
  { id: 'search', label: 'Search Trip' },
  { id: 'seat', label: 'Select Seat' },
  { id: 'passenger', label: 'Passenger Info' },
  { id: 'review', label: 'Review' },
  { id: 'confirm', label: 'Confirm' },
];

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  return value.toISOString().slice(0, 10);
}

function formatDeparture(value: string) {
  return new Date(value).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PassengerBookingPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const paypalReturnReference = searchParams.get('paypal') === 'success' ? searchParams.get('reference') : null;
  const [step, setStep] = useState(paypalReturnReference ? 5 : 1);
  const [date, setDate] = useState(tomorrow());
  const [passengers, setPassengers] = useState(1);
  const [trips, setTrips] = useState<GoaTrip[]>([]);
  const [trip, setTrip] = useState<GoaTrip | null>(null);
  const [seats, setSeats] = useState<TripSeat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [contact, setContact] = useState(user?.contact ?? '');
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'gcash'>('paypal');
  const [gcashReference, setGcashReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [booking, setBooking] = useState<PassengerBooking | null>(null);
  const [loading, setLoading] = useState(Boolean(paypalReturnReference));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paypalReturnReference) return;
    void apiRequest<{ booking: PassengerBooking }>(`/passenger/reservations/${encodeURIComponent(paypalReturnReference)}/paypal/capture`, { method: 'POST' })
      .then((response) => setBooking(response.booking))
      .catch((caughtError) => setError(caughtError instanceof ApiError ? caughtError.message : 'PayPal capture could not be completed.'))
      .finally(() => setLoading(false));
  }, [paypalReturnReference]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const total = useMemo(() => trip ? trip.fare * selectedSeats.length + trip.serviceFee : 0, [selectedSeats.length, trip]);

  async function searchTrips(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTrip(null);
    try {
      const response = await apiRequest<{ trips: GoaTrip[] }>(`/passenger/trips?date=${encodeURIComponent(date)}&passengers=${passengers}`);
      setTrips(response.trips);
      if (!response.trips.length) setError('No Goa trips are scheduled for this date. Try the next day.');
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Trips could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function continueToSeats() {
    if (!trip) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ trip: Omit<GoaTrip, 'availableSeats' | 'canFitParty'>; seats: TripSeat[] }>(`/passenger/trips/${trip.id}/seats`);
      setSeats(response.seats);
      setSelectedSeats([]);
      setStep(2);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Seat availability could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  function continueFromPassenger() {
    setError(null);
    if (contact.trim().length < 7) {
      setError('Enter a valid mobile or contact number.');
      return;
    }
    if (paymentMethod === 'gcash' && !receipt) {
      setError('Upload your GCash receipt before reviewing the booking.');
      return;
    }
    setStep(4);
  }

  function chooseReceipt(file: File | undefined) {
    setError(null);
    if (!file) return setReceipt(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Receipt must be a JPG, JPEG, PNG, or WEBP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Receipt images must be 5 MB or smaller.');
      return;
    }
    setReceipt(file);
  }

  async function confirmBooking() {
    if (!trip) return;
    setLoading(true);
    setError(null);
    try {
      if (paymentMethod === 'paypal') {
        const order = await apiRequest<{ reference: string; orderId: string; approvalUrl: string | null; demo: boolean }>('/passenger/reservations/paypal', {
          method: 'POST',
          body: JSON.stringify({ tripId: trip.id, seats: selectedSeats, contact }),
        });
        if (order.approvalUrl) {
          window.location.assign(order.approvalUrl);
          return;
        }
        const response = await apiRequest<{ booking: PassengerBooking }>(`/passenger/reservations/${encodeURIComponent(order.reference)}/paypal/capture`, { method: 'POST' });
        setBooking(response.booking);
      } else {
        const body = new FormData();
        body.set('tripId', trip.id);
        body.set('seats', JSON.stringify(selectedSeats));
        body.set('contact', contact);
        body.set('gcashReference', gcashReference);
        body.set('receipt', receipt!);
        const response = await apiRequest<{ booking: PassengerBooking }>('/passenger/reservations/gcash', { method: 'POST', body });
        setBooking(response.booking);
      }
      setStep(5);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'The booking could not be completed.');
      if (caughtError instanceof ApiError && caughtError.code === 'SEAT_UNAVAILABLE') setStep(2);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-background pb-16 pt-5 sm:pt-8" id="booking-flow">
      <div className="mx-auto max-w-[76rem] px-4 sm:px-6 lg:px-8">
        <Stepper steps={steps} currentStep={step} className="mx-auto max-w-4xl" />

        <div className="mt-6">
          {step === 1 ? (
            <div className="mx-auto max-w-4xl">
              <div className="mb-5 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Goa reservations</p>
                <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Find your scheduled ride</h1>
                <p className="mt-2 text-sm text-text-secondary">Advance reservations are available for Goa only.</p>
              </div>
              <Card className="p-5 sm:p-7">
                <form className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end" onSubmit={searchTrips}>
                  <Input label="Route" value="NCEBT → Goa Terminal" disabled leadingIcon={<MapPin className="h-4 w-4" />} />
                  <Input label="Departure date" type="date" min={tomorrow()} value={date} onChange={(event) => setDate(event.target.value)} leadingIcon={<CalendarDays className="h-4 w-4" />} required />
                  <label className="block text-sm font-semibold">Passengers<select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))} className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-white px-3 text-sm"><option value={1}>1 Passenger</option><option value={2}>2 Passengers</option><option value={3}>3 Passengers</option><option value={4}>4 Passengers</option></select></label>
                  <Button type="submit" loading={loading} trailingIcon={<ArrowRight className="h-4 w-4" />}>Search trips</Button>
                </form>
              </Card>
              {error ? <p role="alert" className="mt-4 rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
              {loading ? <Card className="mt-4 p-5"><LoadingSkeleton lines={3} /></Card> : null}
              {trips.length ? <div className="mt-5 space-y-3" aria-label="Available Goa trips">{trips.map((option) => (
                <button key={option.id} type="button" disabled={!option.canFitParty} onClick={() => setTrip(option)} className={cn('flex w-full items-center justify-between gap-4 rounded-card border bg-white p-4 text-left shadow-card transition', trip?.id === option.id ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/50', !option.canFitParty && 'cursor-not-allowed opacity-50')}>
                  <span><span className="flex items-center gap-2 font-extrabold"><Clock3 className="h-4 w-4 text-primary" />{formatDeparture(option.departureTime)}</span><span className="mt-1 block text-xs text-text-secondary">{option.vanId} · Goso scheduled trip</span></span>
                  <span className="text-right"><span className="block font-bold text-primary-dark">₱{option.fare.toFixed(2)}</span><span className="text-xs text-text-secondary">{option.availableSeats} seats left</span></span>
                </button>
              ))}<Button fullWidth size="lg" disabled={!trip} loading={loading} onClick={() => void continueToSeats()} trailingIcon={<ArrowRight className="h-4 w-4" />}>Select seats</Button></div> : null}
            </div>
          ) : null}

          {step === 2 && trip ? (
            <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)_19rem]">
              <BookingSummary trip={trip} seats={selectedSeats} passengerCount={passengers} compact />
              <Card className="p-4 sm:p-6"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Select your seat</p><h1 className="mt-1 text-2xl font-black">Choose {passengers} seat{passengers === 1 ? '' : 's'}</h1></div><VanSeatPicker seats={seats} selected={selectedSeats} limit={passengers} onChange={setSelectedSeats} /></Card>
              <Card className="h-fit p-5"><ShieldCheck className="h-7 w-7 text-primary" /><h2 className="mt-3 text-lg font-extrabold">Travel with confidence</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Seat availability is checked again when you confirm, preventing duplicate reservations.</p><div className="mt-5 space-y-2"><Button fullWidth disabled={selectedSeats.length !== passengers} onClick={() => setStep(3)} trailingIcon={<ArrowRight className="h-4 w-4" />}>Continue</Button><Button fullWidth variant="ghost" onClick={() => setStep(1)} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button></div></Card>
            </div>
          ) : null}

          {step === 3 && trip ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Card className="p-5 sm:p-7"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger information</p><h1 className="mt-1 text-2xl font-black">Who is travelling?</h1><div className="mt-6 grid gap-4 sm:grid-cols-2"><Input label="Full name" value={user?.name ?? ''} disabled /><Input label="Email address" type="email" value={user?.email ?? ''} disabled /><Input label="Mobile number" value={contact} onChange={(event) => setContact(event.target.value)} leadingIcon={<Smartphone className="h-4 w-4" />} className="sm:col-span-2" /></div>
                <fieldset className="mt-7"><legend className="text-sm font-bold">Payment method</legend><div className="mt-3 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setPaymentMethod('paypal')} aria-pressed={paymentMethod === 'paypal'} className={cn('rounded-card border p-4 text-left', paymentMethod === 'paypal' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border')}><CreditCard className="h-6 w-6 text-info" /><span className="mt-3 block font-extrabold">PayPal Sandbox</span><span className="mt-1 block text-xs leading-5 text-text-secondary">Secure approval and capture. Booking confirms after successful payment.</span></button><button type="button" onClick={() => setPaymentMethod('gcash')} aria-pressed={paymentMethod === 'gcash'} className={cn('rounded-card border p-4 text-left', paymentMethod === 'gcash' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border')}><Smartphone className="h-6 w-6 text-primary" /><span className="mt-3 block font-extrabold">GCash — Upload Receipt</span><span className="mt-1 block text-xs leading-5 text-text-secondary">Pay externally, then upload proof for dispatcher verification.</span></button></div></fieldset>
                {paymentMethod === 'gcash' ? <div className="mt-5 rounded-card border border-primary/20 bg-primary-soft/60 p-4"><p className="font-bold text-primary-dark">GCash payment instructions</p><p className="mt-1 text-sm leading-6 text-text-secondary">Send the exact total of ₱{total.toFixed(2)} to the terminal’s configured GCash account, then upload your receipt. UVGo does not process GCash directly.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Input label="Transaction/reference number (optional)" value={gcashReference} onChange={(event) => setGcashReference(event.target.value)} /><label className="block text-sm font-semibold">Receipt image<span className="mt-1.5 flex min-h-touch cursor-pointer items-center gap-2 rounded-control border border-dashed border-primary bg-white px-3 text-sm text-primary-dark"><UploadCloud className="h-4 w-4" />{receipt?.name ?? 'Choose JPG, PNG, or WEBP'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseReceipt(event.target.files?.[0])} /></span><span className="mt-1.5 block text-xs font-normal text-text-secondary">Maximum file size: 5 MB</span></label></div></div> : null}
                {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><Button variant="ghost" onClick={() => setStep(2)} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button><Button onClick={continueFromPassenger} trailingIcon={<ArrowRight className="h-4 w-4" />}>Review booking</Button></div></Card>
              <BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} />
            </div>
          ) : null}

          {step === 4 && trip ? (
            <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"><Card className="p-5 sm:p-7"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Review booking</p><h1 className="mt-1 text-3xl font-black">Everything look right?</h1><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-control bg-cream p-4"><p className="text-xs text-text-secondary">Passenger</p><p className="mt-1 font-bold">{user?.name}</p><p className="text-sm text-text-secondary">{contact}</p></div><div className="rounded-control bg-cream p-4"><p className="text-xs text-text-secondary">Payment</p><p className="mt-1 font-bold">{paymentMethod === 'paypal' ? 'PayPal Sandbox' : 'GCash receipt verification'}</p><p className="text-sm text-text-secondary">{paymentMethod === 'paypal' ? 'Confirmed after capture' : `Receipt: ${receipt?.name}`}</p></div></div><p className="mt-5 rounded-control border border-warning/30 bg-warning-soft p-4 text-sm leading-6 text-text-primary">By reserving, you accept the no-refund policy. You may reschedule until 24 hours before departure. There is no cancellation action in UVGo.</p>{error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><Button variant="ghost" onClick={() => setStep(3)} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button><Button loading={loading} onClick={() => void confirmBooking()} leadingIcon={<ShieldCheck className="h-4 w-4" />}>{paymentMethod === 'paypal' ? 'Continue to PayPal' : 'Submit reservation'}</Button></div></Card><BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} /></div>
          ) : null}

          {step === 5 ? (
            <div className="mx-auto max-w-2xl">{loading ? <Card className="p-7"><LoadingSkeleton lines={5} /></Card> : booking ? <Card className="overflow-hidden"><div className={cn('p-6 text-white sm:p-8', booking.status === 'confirmed' ? 'bg-primary' : 'bg-warning')}><CheckCircle2 className="h-12 w-12" /><p className="mt-4 text-sm font-bold uppercase tracking-[0.12em] text-white/80">{booking.status === 'confirmed' ? 'Seat reserved' : 'Reservation received'}</p><h1 className="mt-1 text-3xl font-black text-white">{booking.status === 'confirmed' ? 'Your Goa ride is confirmed!' : 'Payment verification pending'}</h1></div><div className="p-6 sm:p-8"><p className="text-sm text-text-secondary">Booking reference</p><p className="mt-1 text-2xl font-black tracking-wide text-primary-dark">{booking.reference}</p><div className="mt-6 grid gap-4 rounded-card bg-cream p-4 sm:grid-cols-2"><div><p className="text-xs text-text-secondary">Departure</p><p className="mt-1 font-bold">{formatDeparture(booking.departureTime)}</p></div><div><p className="text-xs text-text-secondary">Seat</p><p className="mt-1 font-bold">{booking.seats.join(', ')}</p></div><div><p className="text-xs text-text-secondary">Payment status</p><p className="mt-1 font-bold capitalize">{booking.payment?.status.replaceAll('_', ' ')}</p></div><div><p className="text-xs text-text-secondary">Reschedule</p><p className="mt-1 font-bold">{booking.canReschedule ? 'Eligible' : 'Window closed'}</p></div></div>{booking.status !== 'confirmed' ? <p className="mt-4 rounded-control bg-warning-soft p-3 text-sm text-text-primary">Your selected seats are held while a dispatcher verifies the uploaded receipt.</p> : null}<div className="mt-6 grid gap-2 sm:grid-cols-2"><Link to={`/passenger/bookings/${booking.reference}`} className="flex min-h-touch items-center justify-center rounded-control border border-primary px-4 text-sm font-bold text-primary-dark">View booking</Link><Link to="/passenger/bookings" className="flex min-h-touch items-center justify-center rounded-control bg-primary px-4 text-sm font-bold text-white">My bookings</Link></div></div></Card> : <Card className="p-6"><p role="alert" className="text-danger">{error ?? 'Booking confirmation could not be loaded.'}</p><Link to="/passenger/book" className="mt-4 inline-flex text-sm font-bold text-primary">Start again</Link></Card>}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
