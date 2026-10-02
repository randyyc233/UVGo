import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Clock3,
  MapPin,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  WalletCards,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { BookingSummary } from '../../components/passenger/BookingSummary';
import { PayPalCheckout } from '../../components/passenger/PayPalCheckout';
import { VanSeatPicker } from '../../components/passenger/VanSeatPicker';
import { ReservationAction } from '../../components/passenger/ReservationAction';
import { ScheduleTripCard } from '../../components/passenger/ScheduleTripCard';
import { useMobileSectionScroll } from '../../hooks/useMobileSectionScroll';
import { Button, Card, Input, LoadingSkeleton, Stepper } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatTime12 } from '../../lib/dateTime';
import type { GoaTrip, PassengerBooking, ReservationFareQuote, TripSeat } from '../../types/passenger';

const steps = [
  { id: 'search', label: 'Choose trip' },
  { id: 'seat', label: 'Choose seats' },
  { id: 'passenger', label: 'Your details' },
  { id: 'review', label: 'Review & payment' },
  { id: 'confirm', label: 'My Bookings' },
];

function tomorrow() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  const timezoneOffset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function formatTripDate(value: string) {
  return new Date(value).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTripTime(value: string) {
  return formatTime12(value);
}

function paymentStatusLabel(value: string | undefined) {
  if (!value) return 'Not available';
  const labels: Record<string, string> = {
    pending: 'Payment pending',
    pending_verification: 'Awaiting dispatcher verification',
    verified: 'Payment verified',
    captured: 'Payment completed',
    rejected: 'Payment rejected',
    failed: 'Payment failed',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

export function PassengerBookingPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState(1);
  const [date, setDate] = useState(() => {
    const requestedDate = searchParams.get('date');
    return requestedDate && requestedDate >= tomorrow() ? requestedDate : tomorrow();
  });
  const [passengers, setPassengers] = useState(() => {
    const requestedPassengers = Number(searchParams.get('passengers'));
    return Number.isInteger(requestedPassengers) && requestedPassengers >= 1 && requestedPassengers <= 11 ? requestedPassengers : 1;
  });
  const [trips, setTrips] = useState<GoaTrip[]>([]);
  const [trip, setTrip] = useState<GoaTrip | null>(null);
  const [seats, setSeats] = useState<TripSeat[]>([]);
  const [selectedSeats, updateSelectedSeats] = useState<number[]>([]);
  const [contact, setContact] = useState(user?.contact ?? '');
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'gcash'>('gcash');
  const [gcashReference, setGcashReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [paypalBusy, setPaypalBusy] = useState(false);
  const [studentPassengers, setStudentPassengers] = useState(0);
  const [seniorPassengers, setSeniorPassengers] = useState(0);
  const [discountIdAcknowledged, setDiscountIdAcknowledged] = useState(false);
  const [fareQuote, setFareQuote] = useState<{ key: string; quote: ReservationFareQuote } | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [booking, setBooking] = useState<PassengerBooking | null>(null);
  const [confirmationDetailsExpanded, setConfirmationDetailsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedulesSection = useRef<HTMLDivElement>(null);
  const [scheduleScrollRequest, setScheduleScrollRequest] = useState(0);
  useMobileSectionScroll(schedulesSection, scheduleScrollRequest);
  const maxPassengers = trip ? Math.min(11, trip.availableSeats) : 11;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  useEffect(() => {
    const reference = booking?.reference;
    if (!reference || booking.payment?.status !== 'pending_verification') return;

    let active = true;
    const refreshBooking = async () => {
      try {
        const response = await apiRequest<{ booking: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(reference)}`);
        if (active) setBooking(response.booking);
      } catch {
        // Keep the last successful confirmation state during a background refresh.
      }
    };
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshBooking();
    }, 8_000);
    const refreshOnFocus = () => void refreshBooking();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [booking?.payment?.status, booking?.reference]);

  const subtotal = useMemo(() => trip ? trip.fare * selectedSeats.length : 0, [selectedSeats.length, trip]);
  const hasDiscount = studentPassengers + seniorPassengers > 0;
  const quoteKey = JSON.stringify({ tripId: trip?.id, seats: selectedSeats, studentPassengers, seniorPassengers, attempt: quoteAttempt });
  const discountQuote = hasDiscount && fareQuote?.key === quoteKey ? fareQuote.quote : undefined;
  const currentQuoteError = hasDiscount && quoteError?.key === quoteKey ? quoteError.message : null;
  const priceReady = !hasDiscount || Boolean(discountQuote);
  const total = discountQuote?.totalAmount ?? subtotal;

  function resetDiscounts() {
    setStudentPassengers(0); setSeniorPassengers(0); setDiscountIdAcknowledged(false);
    if (hasDiscount) { setReceipt(null); setGcashReference(''); }
  }

  function setSelectedSeats(nextSeats: number[]) {
    updateSelectedSeats(nextSeats);
    resetDiscounts();
  }

  useEffect(() => {
    const request = JSON.parse(quoteKey) as { tripId?: string; seats: number[]; studentPassengers: number; seniorPassengers: number; attempt: number };
    if (!request.tripId || !request.seats.length || !request.studentPassengers && !request.seniorPassengers) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiRequest<{ quote: ReservationFareQuote }>('/passenger/reservations/quote', {
        method: 'POST', body: JSON.stringify(request), signal: controller.signal,
      }).then((result) => {
        if (!controller.signal.aborted) {
          setFareQuote({ key: quoteKey, quote: result.quote });
          setQuoteError((current) => current?.key === quoteKey ? null : current);
        }
      }).catch((caught) => {
        if (!controller.signal.aborted) setQuoteError({ key: quoteKey, message: caught instanceof Error ? caught.message : 'The discounted fare could not be checked.' });
      });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [quoteKey]);

  async function searchTrips(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setTrip(null);
    try {
      const response = await apiRequest<{ trips: GoaTrip[] }>(`/passenger/trips?date=${encodeURIComponent(date)}&passengers=${passengers}`);
      setTrips(response.trips);
      if (!response.trips.length) setError('No Goa trips are open for reservations on this date. Reservations close 5 hours before loading time. Try another date.');
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Trips could not be loaded.');
    } finally {
      setLoading(false);
      setScheduleScrollRequest((current) => current + 1);
    }
  }

  async function continueToSeats() {
    if (!trip) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ trip: Omit<GoaTrip, 'availableSeats' | 'canFitParty'>; seats: TripSeat[] }>(`/passenger/trips/${trip.id}/seats`);
      const availableSeats = response.seats.filter((seat) => seat.available).length;
      if (availableSeats < passengers) {
        setTrips((current) => current.map((option) => option.id === trip.id ? { ...option, availableSeats, canFitParty: false } : option));
        setTrip(null);
        setError(`Only ${availableSeats} seat${availableSeats === 1 ? '' : 's'} remain on that trip. Choose another departure.`);
        return;
      }
      setTrip({ ...trip, ...response.trip, availableSeats, canFitParty: true });
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
    if (!priceReady) { setError(currentQuoteError ?? 'Wait while the discounted fare is checked.'); return; }
    if (hasDiscount && !discountIdAcknowledged) { setError('Confirm that discounted passengers will bring valid IDs to the terminal.'); return; }
    if (contact.trim().length < 7) {
      setError('Enter a valid mobile or contact number.');
      return;
    }
    if (paymentMethod === 'gcash' && !trip?.gcashRecipient) {
      setError('GCash is not configured for this trip. Choose PayPal instead.');
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
    if (!file) {
      setReceipt(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setReceipt(null);
      setError('Receipt must be a JPG, JPEG, PNG, or WEBP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setReceipt(null);
      setError('Receipt images must be 5 MB or smaller.');
      return;
    }
    setReceipt(file);
  }

  async function returnToSeatSelection(message: string) {
    if (!trip) return;
    try {
      const response = await apiRequest<{ seats: TripSeat[] }>(`/passenger/trips/${trip.id}/seats`);
      setSeats(response.seats);
      setSelectedSeats([]);
    } catch {
      // The server's booking error remains the useful next-step message.
    }
    setError(message);
    setStep(2);
  }

  async function confirmGcashBooking(event: FormEvent) {
    event.preventDefault();
    if (!trip || !receipt || loading) return;
    if (selectedSeats.length !== passengers) {
      await returnToSeatSelection(`Choose exactly ${passengers} seat${passengers === 1 ? '' : 's'} before submitting.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set('tripId', trip.id);
      body.set('seats', JSON.stringify(selectedSeats));
      body.set('contact', contact);
      if (hasDiscount) {
        body.set('studentPassengers', String(studentPassengers));
        body.set('seniorPassengers', String(seniorPassengers));
        body.set('discountIdAcknowledged', String(discountIdAcknowledged));
      }
      body.set('gcashReference', gcashReference);
      body.set('receipt', receipt);
      const response = await apiRequest<{ booking: PassengerBooking }>('/passenger/reservations/gcash', { method: 'POST', body });
      setBooking(response.booking);
      setStep(5);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'The booking could not be completed.');
      if (caughtError instanceof ApiError && caughtError.code === 'SEAT_UNAVAILABLE') {
        await returnToSeatSelection('Those seats were just reserved by another passenger. Choose other available seats, then submit the same GCash receipt. Do not pay again.');
      } else if (caughtError instanceof ApiError && caughtError.code === 'TRIP_CLOSED') {
        setError('This departure closed before your GCash receipt was submitted, so no reservation was created. Do not pay again—keep the receipt and contact the terminal for assistance.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="reservation-flow pb-10" id="booking-flow">
      <div className="mx-auto max-w-[76rem]">
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
                <h2 className="mb-4 text-lg font-extrabold">Trip details</h2>
                <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end" onSubmit={searchTrips}>
                  <Input label="Route" value="NCEBT → Goa Terminal" disabled leadingIcon={<MapPin className="h-4 w-4" />} />
                  <Input label="Departure date" type="date" min={tomorrow()} value={date} onChange={(event) => setDate(event.target.value)} leadingIcon={<CalendarDays className="h-4 w-4" />} required />
                  <label className="block text-sm font-semibold">
                    Passengers
                    <select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))} className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-white px-3 text-base">
                      {Array.from({ length: maxPassengers }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} Passenger{count === 1 ? '' : 's'}</option>)}
                    </select>
                  </label>
                  <Button type="submit" loading={loading} trailingIcon={<ArrowRight className="h-4 w-4" />}>Search trips</Button>
                </form>
                <p className="mt-3 text-xs text-text-secondary">Reservations close 5 hours before loading time.</p>
              </Card>
              <div ref={schedulesSection} tabIndex={-1} className="reservation-scroll-target mt-5" aria-label="Available schedules">
                {trips.length ? <div className="mb-4"><h2 className="text-xl font-extrabold">Choose your schedule</h2><p className="mt-1 text-sm text-text-secondary">Tap a card to select your departure, then choose your seats.</p></div> : null}
                {error ? <p role="alert" className="mt-4 rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
                {loading ? <Card className="mt-4 p-5"><LoadingSkeleton lines={3} /></Card> : null}
                {trips.length ? <div className="space-y-3" aria-label="Available Goa trips">
                  {trips.map((option) => <ScheduleTripCard key={option.id} trip={option} selected={trip?.id === option.id} disabled={!option.canFitParty || option.availableSeats < passengers} onSelect={() => setTrip(option)} />)}
                  <ReservationAction><Button fullWidth size="lg" disabled={!trip || passengers > maxPassengers} loading={loading} onClick={() => void continueToSeats()} trailingIcon={<ArrowRight className="h-4 w-4" />}>Select seats</Button></ReservationAction>
                </div> : null}
              </div>
            </div>
          ) : null}

          {step === 2 && trip ? (
            <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)_19rem]">
              <BookingSummary trip={trip} seats={selectedSeats} passengerCount={passengers} total={total} compact />
              <Card className="p-4 sm:p-6"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Select your seat</p><h1 className="mt-1 text-2xl font-black">Choose {passengers} seat{passengers === 1 ? '' : 's'}</h1></div>{error ? <p role="alert" className="mb-4 rounded-control border border-warning/30 bg-warning-soft p-3 text-sm leading-6 text-text-primary">{error}</p> : null}<VanSeatPicker seats={seats} selected={selectedSeats} limit={passengers} onChange={(nextSeats) => { setSelectedSeats(nextSeats); if (error) setError(null); }} /></Card>
              <Card className="h-fit p-5"><ShieldCheck className="h-7 w-7 text-primary" /><h2 className="mt-3 text-lg font-extrabold">Travel with confidence</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Seat availability is checked again when you submit your payment details, preventing duplicate reservations.</p><div className="mt-5 space-y-2"><ReservationAction total={total} caption={`${selectedSeats.length} of ${passengers} seats selected`}><Button fullWidth disabled={selectedSeats.length !== passengers} onClick={() => { setError(null); setStep(3); }} trailingIcon={<ArrowRight className="h-4 w-4" />}>Continue</Button></ReservationAction><Button fullWidth variant="ghost" onClick={() => { setError(null); setStep(1); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button></div></Card>
            </div>
          ) : null}

          {step === 3 && trip ? (
            <div className="reservation-passenger-details grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <details className="group min-w-0 rounded-card border border-border bg-surface lg:hidden">
                <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0"><p className="text-sm font-extrabold text-primary-dark">Your Goa trip · {selectedSeats.length} passenger{selectedSeats.length === 1 ? '' : 's'}</p><p className="mt-1 text-xs text-text-secondary">{formatTripDate(trip.departureTime)} · {formatTripTime(trip.departureTime)} · View summary</p></div>
                  <ChevronDown className="h-5 w-5 shrink-0 text-primary transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="px-3 pb-3"><BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} total={total} discountQuote={discountQuote} compact /></div>
              </details>
              <Card className="min-w-0 p-4 sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger information</p>
                <h1 className="mt-1 text-xl font-black sm:text-2xl">Your contact details</h1>
                <p className="mt-1 text-sm leading-5 text-text-secondary sm:mt-2 sm:leading-6">For booking and payment updates.</p>
                <dl className="mt-4 space-y-2 rounded-control bg-cream p-3 text-sm sm:hidden">
                  <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-text-secondary">Name</dt><dd className="min-w-0 text-right font-bold">{user?.name}</dd></div>
                  <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-text-secondary">Email</dt><dd className="min-w-0 break-all text-right">{user?.email}</dd></div>
                </dl>
                <div className="mt-4 grid gap-4 sm:mt-6 sm:grid-cols-2">
                  <div className="hidden sm:block"><Input label="Full name" value={user?.name ?? ''} disabled /></div>
                  <div className="hidden sm:block"><Input label="Email address" type="email" value={user?.email ?? ''} disabled /></div>
                  <div className="sm:col-span-2"><Input label="Mobile number" type="tel" autoComplete="tel" inputMode="tel" value={contact} onChange={(event) => { setContact(event.target.value); if (error) setError(null); }} leadingIcon={<Smartphone className="h-4 w-4" />} /></div>
                </div>
                <fieldset className="mt-5 min-w-0 rounded-card border border-border p-3 sm:mt-7 sm:p-4">
                  <legend className="px-1 text-sm font-bold sm:text-base">Student & senior discounts</legend>
                  <p className="text-xs leading-5 text-text-secondary sm:text-sm sm:leading-6">Save 20% on each eligible student or senior citizen’s seat. Other passengers pay the regular fare.</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:gap-4">
                    <label className="block min-w-0 text-sm font-semibold"><span className="sm:hidden">Students</span><span className="hidden sm:inline">Student passengers (20% off)</span>
                      <select aria-label="Student passengers (20% off)" value={studentPassengers} onChange={(event) => { setStudentPassengers(Number(event.target.value)); setDiscountIdAcknowledged(false); setReceipt(null); setGcashReference(''); }} className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-white px-3 py-2.5 text-base">
                        {Array.from({ length: selectedSeats.length - seniorPassengers + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                    <label className="block min-w-0 text-sm font-semibold"><span className="sm:hidden">Seniors</span><span className="hidden sm:inline">Senior citizen passengers (20% off)</span>
                      <select aria-label="Senior citizen passengers (20% off)" value={seniorPassengers} onChange={(event) => { setSeniorPassengers(Number(event.target.value)); setDiscountIdAcknowledged(false); setReceipt(null); setGcashReference(''); }} className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-white px-3 py-2.5 text-base">
                        {Array.from({ length: selectedSeats.length - studentPassengers + 1 }, (_, count) => <option key={count} value={count}>{count}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-text-secondary sm:text-sm">Regular passengers: {selectedSeats.length - studentPassengers - seniorPassengers}</p>
                  {hasDiscount ? <label className="mt-3 flex min-h-touch cursor-pointer items-start gap-3 rounded-control bg-primary-soft p-3 text-sm leading-6">
                    <input type="checkbox" checked={discountIdAcknowledged} onChange={(event) => setDiscountIdAcknowledged(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-primary" />
                    <span>I confirm that every discounted passenger will present a valid student or senior citizen ID at the terminal. Eligibility will be checked before boarding.</span>
                  </label> : null}
                  {hasDiscount && !priceReady && !currentQuoteError ? <p role="status" className="mt-3 text-sm">Checking the discounted fare…</p> : null}
                  {currentQuoteError ? <div className="mt-3"><p role="alert" className="text-sm text-danger">{currentQuoteError}</p><Button variant="outline" className="mt-2" onClick={() => setQuoteAttempt((current) => current + 1)}>Retry fare check</Button></div> : null}
                </fieldset>
                <fieldset className="mt-5 min-w-0 sm:mt-7">
                  <legend className="text-sm font-bold">Payment method</legend>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      aria-pressed={paymentMethod === 'gcash'}
                      disabled={!trip.gcashRecipient}
                      onClick={() => { setPaymentMethod('gcash'); setError(null); }}
                      className={cn('relative min-w-0 rounded-card border p-3 text-left transition sm:p-4', paymentMethod === 'gcash' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border hover:border-primary/50', !trip.gcashRecipient && 'cursor-not-allowed opacity-50')}
                    >
                      <Smartphone className="h-5 w-5 text-primary sm:h-6 sm:w-6" aria-hidden="true" />
                      {paymentMethod === 'gcash' ? <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden="true" /> : null}
                      <span className="mt-2 block text-sm font-extrabold sm:mt-3 sm:text-base">GCash</span>
                      <span className="mt-1 hidden text-xs leading-5 text-text-secondary sm:block">Pay the dispatcher, then upload your receipt for verification.</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={paymentMethod === 'paypal'}
                      onClick={() => { setPaymentMethod('paypal'); setError(null); }}
                      className={cn('relative min-w-0 rounded-card border p-3 text-left transition sm:p-4', paymentMethod === 'paypal' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border hover:border-primary/50')}
                    >
                      <WalletCards className="h-5 w-5 text-info sm:h-6 sm:w-6" aria-hidden="true" />
                      {paymentMethod === 'paypal' ? <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden="true" /> : null}
                      <span className="mt-2 block text-sm font-extrabold sm:mt-3 sm:text-base">PayPal</span>
                      <span className="mt-1 hidden text-xs leading-5 text-text-secondary sm:block">Pay securely in the next step. Verified payments confirm your reservation automatically.</span>
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-text-secondary sm:hidden">{paymentMethod === 'gcash' ? 'Upload your receipt for dispatcher verification.' : 'Pay securely in the next step. Verified payments confirm your booking automatically.'}</p>
                </fieldset>
                {paymentMethod === 'gcash' ? (
                  <div className="mt-4 rounded-control border border-primary/15 bg-primary-soft/40 p-3 sm:mt-5 sm:border-0 sm:bg-transparent sm:p-0">
                    <p className="text-sm font-bold text-primary-dark sm:text-base">GCash payment instructions</p>
                    {!priceReady ? <p role="status" className="mt-1 text-sm leading-6 text-text-secondary">Wait for the discounted fare to be confirmed before sending your GCash payment.</p> : trip.gcashRecipient ? (
                      <p className="mt-1 text-sm leading-6 text-text-secondary">
                        Send exactly <strong className="text-text-primary">₱{total.toFixed(2)}</strong> to <strong className="select-all text-text-primary">{trip.gcashRecipient.mobileNumber}</strong> ({trip.gcashRecipient.dispatcherName}, Goa dispatcher), then upload the receipt.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm leading-6 text-danger">GCash is not configured for this trip. Choose PayPal.</p>
                    )}
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Input label="GCash transaction reference (optional)" maxLength={100} value={gcashReference} onChange={(event) => { setGcashReference(event.target.value); if (error) setError(null); }} placeholder="From your GCash receipt" />
                      <label className="block text-sm font-semibold">
                        Receipt image
                        <span className="mt-1.5 flex min-h-[3.25rem] cursor-pointer items-center gap-2 rounded-control border border-dashed border-primary bg-white px-3 text-sm text-primary-dark focus-within:ring-2 focus-within:ring-primary/20">
                          <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{receipt?.name ?? 'Choose JPG, PNG, or WEBP'}</span>
                          <input key={`${studentPassengers}-${seniorPassengers}`} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseReceipt(event.target.files?.[0])} />
                        </span>
                        <span className="mt-1.5 block text-xs font-normal text-text-secondary">Maximum file size: 5 MB</span>
                      </label>
                    </div>
                  </div>
                ) : null}
                {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
                <div className="mt-6 dashboard-form-actions flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-between">
                  <Button variant="ghost" onClick={() => { setError(null); setStep(2); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to seats</Button>
                  <ReservationAction total={total} caption={hasDiscount && !priceReady ? 'Checking discounted fare' : undefined}><Button disabled={!priceReady || hasDiscount && !discountIdAcknowledged} onClick={continueFromPassenger} trailingIcon={<ArrowRight className="h-4 w-4" />}>Review trip and payment</Button></ReservationAction>
                </div>
              </Card>
              <aside className="hidden lg:block"><BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} total={total} discountQuote={discountQuote} /></aside>
            </div>
          ) : null}

          {step === 4 && trip ? (
            <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="lg:order-2"><BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} total={total} discountQuote={discountQuote} /></div>
              <Card className="p-5 sm:p-7 lg:order-1">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Review and payment</p>
                <h1 className="mt-1 text-3xl font-black">Check before you submit</h1>
                <p className="mt-2 text-sm leading-6 text-text-secondary">Confirm your contact, seats, schedule, and total in the booking summary.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-control bg-cream p-4">
                    <p className="text-xs font-semibold text-text-secondary">Passenger</p>
                    <p className="mt-1 font-bold">{user?.name}</p>
                    <p className="break-words text-sm text-text-secondary">{contact}</p>
                  </div>
                  <div className="rounded-control bg-cream p-4">
                    <p className="text-xs font-semibold text-text-secondary">Payment method</p>
                    <p className="mt-1 font-bold">{paymentMethod === 'paypal' ? 'PayPal — integrated checkout' : 'GCash — receipt upload'}</p>
                    <p className="text-sm text-text-secondary">{paymentMethod === 'paypal' ? 'Automatically confirmed after PayPal verifies payment' : 'Dispatcher verification required before confirmation'}</p>
                  </div>
                </div>
                {error ? <p role="alert" className="mt-4 rounded-control border border-danger/25 bg-danger-soft p-3 text-sm leading-6 text-danger">{error}</p> : null}

                {paymentMethod === 'paypal' ? <section className="mt-6 border-t border-border pt-5" aria-labelledby="paypal-pay-heading">
                    <div className="flex items-start gap-3">
                      <WalletCards className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                      <div>
                        <h2 id="paypal-pay-heading" className="font-extrabold text-primary-dark">Pay with PayPal</h2>
                        <p className="mt-1 text-sm leading-6 text-text-secondary">Pay exactly <strong className="text-text-primary">₱{total.toFixed(2)}</strong>. On PayPal, confirm the currency is PHP and the final total matches before paying.</p>
                      </div>
                    </div>
                    <p className="my-4 rounded-control bg-primary-soft p-3 text-sm leading-6 text-text-primary">Your seats are held when checkout starts. After PayPal verifies the completed payment, your reservation is confirmed automatically.</p>
                    <ReservationAction total={total}>
                      <PayPalCheckout tripId={trip.id} seats={selectedSeats} contact={contact}
                        studentPassengers={studentPassengers} seniorPassengers={seniorPassengers} discountIdAcknowledged={discountIdAcknowledged}
                        onConfirmed={(confirmed) => { setError(null); setBooking(confirmed); setStep(5); }}
                        onSeatUnavailable={returnToSeatSelection} onBusyChange={setPaypalBusy} />
                    </ReservationAction>
                    <Button className="mt-5" variant="ghost" disabled={paypalBusy} onClick={() => { setError(null); setStep(3); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to details</Button>
                </section> : null}
                {paymentMethod === 'gcash' ? (
                  <section className="mt-6 border-t border-border pt-5" aria-labelledby="gcash-submit-heading">
                    <div className="flex items-start gap-3">
                      <Smartphone className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                      <div>
                        <h2 id="gcash-submit-heading" className="font-extrabold text-primary-dark">Submit your GCash receipt</h2>
                        <p className="mt-1 text-sm leading-6 text-text-secondary">Confirm that you sent exactly <strong className="text-text-primary">₱{total.toFixed(2)}</strong>{trip.gcashRecipient ? <> to <strong className="select-all text-text-primary">{trip.gcashRecipient.mobileNumber}</strong></> : null}. The dispatcher will verify the receipt before confirming the booking.</p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-control bg-cream p-4 text-sm">
                      <p className="text-xs font-semibold text-text-secondary">Receipt</p>
                      <p className="mt-1 break-all font-bold">{receipt?.name}</p>
                      <p className="mt-2 text-xs text-text-secondary">GCash transaction reference: <strong className="break-all text-text-primary">{gcashReference.trim() || 'Not supplied'}</strong></p>
                    </div>
                    <form onSubmit={(event) => void confirmGcashBooking(event)} className="mt-5">
                      <div className="dashboard-form-actions flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-between">
                        <Button type="button" variant="ghost" onClick={() => { setError(null); setStep(3); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to details</Button>
                        <ReservationAction total={total}><Button type="submit" loading={loading} leadingIcon={<ShieldCheck className="h-4 w-4" />}>Submit GCash receipt</Button></ReservationAction>
                      </div>
                    </form>
                  </section>
                ) : null}
              </Card>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="mx-auto min-w-0 max-w-2xl">
              {loading ? <Card className="p-7"><LoadingSkeleton lines={5} /></Card> : null}
              {!loading && booking ? (
                <Card padded={false} className="min-w-0 overflow-hidden">
                  <div className={cn('flex items-start gap-3 p-4 sm:block sm:p-8', booking.status === 'confirmed' ? 'bg-primary text-white' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'bg-danger text-white' : 'bg-warning-soft text-[#854D0E]')}>
                    {booking.status === 'confirmed' ? <CheckCircle2 className="h-9 w-9 shrink-0 sm:h-12 sm:w-12" aria-hidden="true" /> : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? <CircleX className="h-9 w-9 shrink-0 sm:h-12 sm:w-12" aria-hidden="true" /> : <Clock3 className="h-9 w-9 shrink-0 sm:h-12 sm:w-12" aria-hidden="true" />}
                    <div className="min-w-0">
                      <p className="text-[0.65rem] font-bold uppercase tracking-[0.1em] opacity-90 sm:mt-4 sm:text-sm">{booking.status === 'confirmed' ? 'Seat reserved' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'Payment unsuccessful' : 'Payment report received'}</p>
                      <h1 className="mt-1 text-xl font-black leading-tight text-inherit sm:text-3xl">{booking.status === 'confirmed' ? 'Your Goa ride is confirmed!' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'Your payment was not completed' : 'Payment verification pending'}</h1>
                    </div>
                  </div>
                  <div className="space-y-4 p-4 sm:space-y-5 sm:p-8">
                    <div className="rounded-control border border-primary/25 bg-primary-soft p-3 sm:p-5">
                      <p className="text-xs font-bold text-primary-dark sm:text-sm">Reservation reference</p>
                      <p className="mt-1 select-all break-all text-lg font-black tracking-wide text-primary-dark sm:text-2xl">{booking.reference}</p>
                      <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-text-primary sm:text-sm sm:leading-6">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        Save this reference. Present it with a valid ID matching the passenger name at the terminal.
                      </p>
                    </div>
                    <div className="rounded-control border border-border p-3 sm:p-4">
                      <div className="flex items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <div><p className="text-xs text-text-secondary">Travel date</p><p className="mt-0.5 text-sm font-bold sm:text-base">{formatTripDate(booking.departureTime)}</p></div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 rounded-control bg-cream p-3 text-sm">
                        <div><dt className="text-xs text-text-secondary">Loading time</dt><dd className="mt-0.5 font-bold">{formatTripTime(booking.boardingStartTime)}</dd></div>
                        <div><dt className="text-xs text-text-secondary">Departure time</dt><dd className="mt-0.5 font-bold">{formatTripTime(booking.departureTime)}</dd></div>
                      </dl>
                      <p className="mt-3 text-xs text-text-secondary">Selected seats</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">{booking.seats.length ? booking.seats.map((seat) => <span key={seat} className="rounded-lg border border-primary/20 bg-primary-soft px-2.5 py-1 text-sm font-bold text-primary-dark">Seat #{seat}</span>) : <p className="text-sm text-text-secondary">No seats currently reserved</p>}</div>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-control bg-cream p-3 sm:p-4">
                      <div className="min-w-0"><p className="text-xs text-text-secondary">Payment status</p><p className="mt-1 text-sm font-bold">{paymentStatusLabel(booking.payment?.status)}</p></div>
                      <div className="text-right text-primary-dark"><p className="text-xs font-semibold">Total Price</p><p className="mt-1 text-lg font-black sm:text-xl">₱{booking.totalAmount.toFixed(2)}</p></div>
                    </div>
                    {(booking.discountAmount ?? 0) > 0 ? <div className="rounded-control bg-cream p-3 text-xs leading-5 sm:p-4 sm:text-sm"><p className="font-bold">20% passenger discount: −₱{booking.discountAmount!.toFixed(2)}</p><p className="mt-1">{booking.studentPassengers} student(s) · {booking.seniorPassengers} senior citizen(s)</p><p className="mt-2">Bring valid student/senior IDs for all discounted passengers. Eligibility is checked at the terminal.</p></div> : null}
                    {booking.payment?.status === 'pending_verification' ? <p role="status" className="rounded-control bg-warning-soft p-3 text-xs leading-5 text-text-primary sm:text-sm sm:leading-6">Your seats are held while the dispatcher verifies payment. No need to submit or pay again. Check My Bookings for updates.</p> : null}
                    {booking.payment?.status === 'rejected' ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">Reason: {booking.payment.rejectionReason ?? 'The dispatcher rejected the payment report. Check your notifications for details.'}</p> : null}
                    <Link to="/passenger/bookings" className="flex min-h-touch w-full items-center justify-center gap-2 rounded-control bg-primary px-4 py-3 text-sm font-bold text-white">My Bookings<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                    <div className="border-t border-border pt-1 sm:pt-4">
                      <button type="button" aria-expanded={confirmationDetailsExpanded} aria-controls="reservation-confirmation-details" onClick={() => setConfirmationDetailsExpanded((expanded) => !expanded)} className="flex min-h-touch w-full items-center justify-between gap-3 text-left text-sm font-bold text-primary sm:hidden">
                        {confirmationDetailsExpanded ? 'Hide payment & booking details' : 'View payment & booking details'}
                        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', confirmationDetailsExpanded && 'rotate-180')} aria-hidden="true" />
                      </button>
                      <dl id="reservation-confirmation-details" className={cn('gap-4 text-sm sm:grid sm:grid-cols-2', confirmationDetailsExpanded ? 'grid pt-3 sm:pt-0' : 'hidden')}>
                        {booking.payment?.method === 'gcash' && booking.gcashRecipient ? <div className="sm:col-span-2"><dt className="text-xs text-text-secondary">GCash paid to</dt><dd className="mt-1 select-all font-bold">{booking.gcashRecipient.mobileNumber}</dd><dd className="text-text-secondary">{booking.gcashRecipient.dispatcherName} · Goa dispatcher</dd></div> : null}
                        <div className="sm:col-span-2"><dt className="text-xs text-text-secondary">Payment transaction ID/reference</dt><dd className="mt-1 break-all font-bold">{booking.payment?.transactionReference ?? 'Not supplied'}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-xs text-text-secondary">Reschedule</dt><dd className="mt-1 font-bold">{booking.canReschedule ? 'Eligible' : booking.rescheduleMessage}</dd></div>
                      </dl>
                    </div>
                  </div>
                </Card>
              ) : null}
              {!loading && !booking ? <Card className="p-6"><p role="alert" className="text-danger">{error ?? 'Booking status could not be loaded.'}</p><Link to="/passenger/book" className="mt-4 inline-flex text-sm font-bold text-primary">Start again</Link></Card> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
