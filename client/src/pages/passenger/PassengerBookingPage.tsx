import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleX,
  Clock3,
  MapPin,
  QrCode,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  WalletCards,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { useAuth } from '../../auth/authContext';
import { BookingSummary } from '../../components/passenger/BookingSummary';
import { PayPalHostedButton } from '../../components/passenger/PayPalHostedButton';
import { PaymongoQrphPanel } from '../../components/passenger/PaymongoQrphPanel';
import { VanSeatPicker } from '../../components/passenger/VanSeatPicker';
import { Button, Card, Input, LoadingSkeleton, Stepper } from '../../components/ui';
import { cn } from '../../lib/cn';
import { formatTime12 } from '../../lib/dateTime';
import type { GoaTrip, PassengerBooking, PaymongoQrphCheckout, TripSeat } from '../../types/passenger';

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

function isSameCalendarDay(firstValue: string, secondValue: string) {
  const first = new Date(firstValue);
  const second = new Date(secondValue);
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
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
    return Number.isInteger(requestedPassengers) && requestedPassengers >= 1 && requestedPassengers <= 4 ? requestedPassengers : 1;
  });
  const [trips, setTrips] = useState<GoaTrip[]>([]);
  const [trip, setTrip] = useState<GoaTrip | null>(null);
  const [seats, setSeats] = useState<TripSeat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [contact, setContact] = useState(user?.contact ?? '');
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'gcash' | 'paymongo_qrph'>('gcash');
  const [gcashReference, setGcashReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [paypalReference, setPaypalReference] = useState('');
  const [booking, setBooking] = useState<PassengerBooking | null>(null);
  const [paymongoCheckout, setPaymongoCheckout] = useState<PaymongoQrphCheckout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const total = useMemo(() => trip ? trip.fare * selectedSeats.length : 0, [selectedSeats.length, trip]);

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
    if (contact.trim().length < 7) {
      setError('Enter a valid mobile or contact number.');
      return;
    }
    if (paymentMethod === 'gcash' && !trip?.gcashRecipient) {
      setError('GCash is not configured for this trip. Choose the posted PayPal button instead.');
      return;
    }
    if (paymentMethod === 'gcash' && !receipt) {
      setError('Upload your GCash receipt before reviewing the booking.');
      return;
    }
    if (paymentMethod === 'paymongo_qrph' && !trip?.paymongoQrphAvailable) {
      setError('QR Ph is temporarily unavailable. Choose GCash receipt or PayPal instead.');
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

  /**
   * Records a passenger-reported payment from PayPal's external single-button
   * checkout. UVGo receives no authenticated order or capture id, so the
   * booking stays PENDING_VERIFICATION until a dispatcher checks the merchant
   * account. The reference is required but is not treated as proof of payment.
   */
  async function confirmPaypalHostedBooking(event: FormEvent) {
    event.preventDefault();
    if (!trip || loading) return;
    if (selectedSeats.length !== passengers) {
      await returnToSeatSelection(`Choose exactly ${passengers} seat${passengers === 1 ? '' : 's'} before submitting.`);
      return;
    }
    if (!paypalReference.trim()) {
      setError('Enter the transaction reference from your completed PayPal payment.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ booking: PassengerBooking }>('/passenger/reservations/paypal/hosted', {
        method: 'POST',
        body: JSON.stringify({
          tripId: trip.id,
          seats: selectedSeats,
          contact,
          paypalTransactionReference: paypalReference,
        }),
      });
      setBooking(response.booking);
      setStep(5);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'The booking could not be completed.');
      if (caughtError instanceof ApiError && caughtError.code === 'SEAT_UNAVAILABLE') {
        await returnToSeatSelection('Those seats were just reserved by another passenger. Your reservation was not submitted. Do not pay again—choose other available seats and reuse the same PayPal reference, or contact the terminal.');
      } else if (caughtError instanceof ApiError && caughtError.code === 'TRIP_CLOSED') {
        setError('This departure closed before your payment report was submitted, so no reservation was created. Do not pay again—keep the PayPal receipt and contact the terminal for assistance.');
      }
    } finally {
      setLoading(false);
    }
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

  async function startPaymongoQrphBooking() {
    if (!trip || loading) return;
    if (selectedSeats.length !== passengers) {
      await returnToSeatSelection(`Choose exactly ${passengers} seat${passengers === 1 ? '' : 's'} before submitting.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ booking: PassengerBooking; checkout: PaymongoQrphCheckout }>('/passenger/reservations/paymongo/qrph', {
        method: 'POST',
        body: JSON.stringify({ tripId: trip.id, seats: selectedSeats, contact }),
      });
      setBooking(response.booking);
      setPaymongoCheckout(response.checkout);
      setStep(5);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'The QR Ph payment could not be prepared.');
      if (caughtError instanceof ApiError && caughtError.code === 'SEAT_UNAVAILABLE') {
        await returnToSeatSelection('Those seats were just reserved by another passenger. Choose other available seats and try QR Ph again.');
      } else if (caughtError instanceof ApiError && caughtError.code === 'TRIP_CLOSED') {
        setError('This departure closed before the QR Ph payment was prepared. No reservation or payment was created.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pb-10" id="booking-flow">
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
                <form className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end" onSubmit={searchTrips}>
                  <Input label="Route" value="NCEBT → Goa Terminal" disabled leadingIcon={<MapPin className="h-4 w-4" />} />
                  <Input label="Departure date" type="date" min={tomorrow()} value={date} onChange={(event) => setDate(event.target.value)} leadingIcon={<CalendarDays className="h-4 w-4" />} required />
                  <label className="block text-sm font-semibold">Passengers<select value={passengers} onChange={(event) => setPassengers(Number(event.target.value))} className="mt-1.5 min-h-touch w-full rounded-control border border-border-strong bg-white px-3 text-sm"><option value={1}>1 Passenger</option><option value={2}>2 Passengers</option><option value={3}>3 Passengers</option><option value={4}>4 Passengers</option></select></label>
                  <Button type="submit" loading={loading} trailingIcon={<ArrowRight className="h-4 w-4" />}>Search trips</Button>
                </form>
              </Card>
              {error ? <p role="alert" className="mt-4 rounded-control border border-danger/20 bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
              {loading ? <Card className="mt-4 p-5"><LoadingSkeleton lines={3} /></Card> : null}
              {trips.length ? <div className="mt-5 space-y-3" aria-label="Available Goa trips">{trips.map((option) => {
                const loadingStartsOnDepartureDay = isSameCalendarDay(option.boardingStartTime, option.departureTime);
                return (
                  <button key={option.id} type="button" disabled={!option.canFitParty} onClick={() => setTrip(option)} className={cn('flex w-full items-center justify-between gap-4 rounded-card border bg-white p-4 text-left shadow-card transition', trip?.id === option.id ? 'border-primary ring-2 ring-primary/15' : 'border-border hover:border-primary/50', !option.canFitParty && 'cursor-not-allowed opacity-50')}>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-extrabold"><Clock3 className="h-4 w-4 shrink-0 text-primary" />{formatTripDate(option.departureTime)}</span>
                      <span className="mt-2 grid grid-cols-2 gap-x-6 pl-6">
                        <span><span className="block text-xs font-semibold text-text-secondary">Loading time</span><span className="font-extrabold">{formatTripTime(option.boardingStartTime)}</span>{!loadingStartsOnDepartureDay ? <span className="block text-[0.7rem] font-semibold text-warning-dark">Previous day</span> : null}</span>
                        <span><span className="block text-xs font-semibold text-text-secondary">Departure time</span><span className="font-extrabold">{formatTripTime(option.departureTime)}</span></span>
                      </span>
                      <span className="mt-1 block truncate pl-6 text-xs text-text-secondary">{option.vanId} · Goso scheduled trip</span>
                    </span>
                    <span className="shrink-0 text-right"><span className="block font-bold text-primary-dark">₱{option.fare.toFixed(2)}</span><span className="text-xs text-text-secondary">{option.availableSeats} seats left</span></span>
                  </button>
                );
              })}<Button fullWidth size="lg" disabled={!trip} loading={loading} onClick={() => void continueToSeats()} trailingIcon={<ArrowRight className="h-4 w-4" />}>Select seats</Button></div> : null}
            </div>
          ) : null}

          {step === 2 && trip ? (
            <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)_19rem]">
              <BookingSummary trip={trip} seats={selectedSeats} passengerCount={passengers} compact />
              <Card className="p-4 sm:p-6"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Select your seat</p><h1 className="mt-1 text-2xl font-black">Choose {passengers} seat{passengers === 1 ? '' : 's'}</h1></div>{error ? <p role="alert" className="mb-4 rounded-control border border-warning/30 bg-warning-soft p-3 text-sm leading-6 text-text-primary">{error}</p> : null}<VanSeatPicker seats={seats} selected={selectedSeats} limit={passengers} onChange={(nextSeats) => { setSelectedSeats(nextSeats); if (error) setError(null); }} /></Card>
              <Card className="h-fit p-5"><ShieldCheck className="h-7 w-7 text-primary" /><h2 className="mt-3 text-lg font-extrabold">Travel with confidence</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Seat availability is checked again when you submit your payment details, preventing duplicate reservations.</p><div className="mt-5 space-y-2"><Button fullWidth disabled={selectedSeats.length !== passengers} onClick={() => { setError(null); setStep(3); }} trailingIcon={<ArrowRight className="h-4 w-4" />}>Continue</Button><Button fullWidth variant="ghost" onClick={() => { setError(null); setStep(1); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button></div></Card>
            </div>
          ) : null}

          {step === 3 && trip ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Card className="p-5 sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger information</p>
                <h1 className="mt-1 text-2xl font-black">Your contact details</h1>
                <p className="mt-2 text-sm leading-6 text-text-secondary">We use these details for booking and payment updates.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Input label="Full name" value={user?.name ?? ''} disabled />
                  <Input label="Email address" type="email" value={user?.email ?? ''} disabled />
                  <Input label="Mobile number" value={contact} onChange={(event) => { setContact(event.target.value); if (error) setError(null); }} leadingIcon={<Smartphone className="h-4 w-4" />} className="sm:col-span-2" />
                </div>
                <fieldset className="mt-7">
                  <legend className="text-sm font-bold">Payment method</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      aria-pressed={paymentMethod === 'paymongo_qrph'}
                      disabled={!trip.paymongoQrphAvailable}
                      onClick={() => { setPaymentMethod('paymongo_qrph'); setError(null); }}
                      className={cn('rounded-card border p-4 text-left transition', paymentMethod === 'paymongo_qrph' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border hover:border-primary/50', !trip.paymongoQrphAvailable && 'cursor-not-allowed opacity-50')}
                    >
                      <QrCode className="h-6 w-6 text-primary" aria-hidden="true" />
                      <span className="mt-3 block font-extrabold">QR Ph</span>
                      <span className="mt-1 block text-xs leading-5 text-text-secondary">Scan a secure, amount-specific PayMongo QR code.</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={paymentMethod === 'gcash'}
                      disabled={!trip.gcashRecipient}
                      onClick={() => { setPaymentMethod('gcash'); setError(null); }}
                      className={cn('rounded-card border p-4 text-left transition', paymentMethod === 'gcash' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border hover:border-primary/50', !trip.gcashRecipient && 'cursor-not-allowed opacity-50')}
                    >
                      <Smartphone className="h-6 w-6 text-primary" aria-hidden="true" />
                      <span className="mt-3 block font-extrabold">GCash</span>
                      <span className="mt-1 block text-xs leading-5 text-text-secondary">Pay the dispatcher, then upload your receipt for verification.</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={paymentMethod === 'paypal'}
                      onClick={() => { setPaymentMethod('paypal'); setError(null); }}
                      className={cn('rounded-card border p-4 text-left transition', paymentMethod === 'paypal' ? 'border-primary bg-primary-soft ring-2 ring-primary/10' : 'border-border hover:border-primary/50')}
                    >
                      <WalletCards className="h-6 w-6 text-info" aria-hidden="true" />
                      <span className="mt-3 block font-extrabold">PayPal</span>
                      <span className="mt-1 block text-xs leading-5 text-text-secondary">Use only the merchant-supplied Pay Now button in the next step.</span>
                    </button>
                  </div>
                </fieldset>
                {paymentMethod === 'gcash' ? (
                  <div className="mt-5">
                    <p className="font-bold text-primary-dark">GCash payment instructions</p>
                    {trip.gcashRecipient ? (
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
                        <span className="mt-1.5 flex min-h-touch cursor-pointer items-center gap-2 rounded-control border border-dashed border-primary bg-white px-3 text-sm text-primary-dark">
                          <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{receipt?.name ?? 'Choose JPG, PNG, or WEBP'}</span>
                          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => chooseReceipt(event.target.files?.[0])} />
                        </span>
                        <span className="mt-1.5 block text-xs font-normal text-text-secondary">Maximum file size: 5 MB</span>
                      </label>
                    </div>
                  </div>
                ) : null}
                {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={() => { setError(null); setStep(2); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to seats</Button>
                  <Button onClick={continueFromPassenger} trailingIcon={<ArrowRight className="h-4 w-4" />}>Review trip and payment</Button>
                </div>
              </Card>
              <BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} />
            </div>
          ) : null}

          {step === 4 && trip ? (
            <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Card className="p-5 sm:p-7">
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
                    <p className="mt-1 font-bold">{paymentMethod === 'paypal' ? 'PayPal — merchant Pay Now button' : paymentMethod === 'paymongo_qrph' ? 'QR Ph — PayMongo' : 'GCash — receipt upload'}</p>
                    <p className="text-sm text-text-secondary">{paymentMethod === 'paymongo_qrph' ? 'Automatically confirmed after PayMongo verifies payment' : 'Dispatcher verification required before confirmation'}</p>
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
                    <p className="my-4 rounded-control bg-warning-soft p-3 text-sm leading-6 text-text-primary">If you already paid, do not pay again. Skip the button and enter the transaction reference from your PayPal receipt below.</p>
                    <PayPalHostedButton />
                    <form onSubmit={(event) => void confirmPaypalHostedBooking(event)} className="mt-5 space-y-4 border-t border-border pt-5">
                      <div>
                        <h3 className="font-bold text-primary-dark">Submit the completed payment</h3>
                        <p className="mt-1 text-sm leading-6 text-text-secondary">Opening PayPal does not submit a booking. Return here after payment and enter the transaction reference so the dispatcher can verify it.</p>
                      </div>
                      <Input label="PayPal transaction reference" required maxLength={100} value={paypalReference} onChange={(event) => { setPaypalReference(event.target.value); if (error) setError(null); }} placeholder="From your completed PayPal receipt" />
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <Button type="button" variant="ghost" onClick={() => { setError(null); setStep(3); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to details</Button>
                        <Button type="submit" loading={loading} leadingIcon={<ShieldCheck className="h-4 w-4" />}>Submit payment for verification</Button>
                      </div>
                    </form>
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
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <Button type="button" variant="ghost" onClick={() => { setError(null); setStep(3); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to details</Button>
                        <Button type="submit" loading={loading} leadingIcon={<ShieldCheck className="h-4 w-4" />}>Submit GCash receipt</Button>
                      </div>
                    </form>
                  </section>
                ) : null}
                {paymentMethod === 'paymongo_qrph' ? (
                  <section className="mt-6 border-t border-border pt-5" aria-labelledby="qrph-create-heading">
                    <div className="flex items-start gap-3">
                      <QrCode className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                      <div>
                        <h2 id="qrph-create-heading" className="font-extrabold text-primary-dark">Generate your QR Ph payment</h2>
                        <p className="mt-1 text-sm leading-6 text-text-secondary">UVGo will hold the selected seats and generate a single-use QR code for exactly <strong className="text-text-primary">₱{total.toFixed(2)}</strong>. The reservation is confirmed only after PayMongo verifies payment.</p>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                      <Button type="button" variant="ghost" onClick={() => { setError(null); setStep(3); }} leadingIcon={<ArrowLeft className="h-4 w-4" />}>Back to details</Button>
                      <Button type="button" loading={loading} onClick={() => void startPaymongoQrphBooking()} leadingIcon={<QrCode className="h-4 w-4" />}>Generate QR and reserve seats</Button>
                    </div>
                  </section>
                ) : null}

              </Card>
              <BookingSummary trip={trip} seats={selectedSeats} paymentMethod={paymentMethod} />
            </div>
          ) : null}

          {step === 5 ? (
            <div className="mx-auto max-w-2xl">
              {loading ? <Card className="p-7"><LoadingSkeleton lines={5} /></Card> : null}
              {!loading && booking ? (
                <Card className="overflow-hidden">
                  <div className={cn('p-6 text-white sm:p-8', booking.status === 'confirmed' ? 'bg-primary' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'bg-danger' : booking.payment?.method === 'paymongo_qrph' ? 'bg-info' : 'bg-warning')}>
                    {booking.status === 'confirmed' ? <CheckCircle2 className="h-12 w-12" aria-hidden="true" /> : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? <CircleX className="h-12 w-12" aria-hidden="true" /> : booking.payment?.method === 'paymongo_qrph' ? <QrCode className="h-12 w-12" aria-hidden="true" /> : <Clock3 className="h-12 w-12" aria-hidden="true" />}
                    <p className="mt-4 text-sm font-bold uppercase tracking-[0.12em] text-white/80">{booking.status === 'confirmed' ? 'Seat reserved' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'Payment unsuccessful' : booking.payment?.method === 'paymongo_qrph' ? 'Secure payment' : 'Payment report received'}</p>
                    <h1 className="mt-1 text-3xl font-black text-white">{booking.status === 'confirmed' ? 'Your Goa ride is confirmed!' : ['rejected', 'failed'].includes(booking.payment?.status ?? '') ? 'Your payment was not completed' : booking.payment?.method === 'paymongo_qrph' ? 'Scan the QR code to pay' : 'Payment verification pending'}</h1>
                  </div>
                  <div className="p-6 sm:p-8">
                    <div className="rounded-card border-2 border-primary/25 bg-success-soft p-4 sm:p-5">
                      <p className="text-sm font-bold text-primary-dark">Reservation reference</p>
                      <p className="mt-1 break-all text-2xl font-black tracking-wide text-primary-dark">{booking.reference}</p>
                      <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-text-primary">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        Save or screenshot this reference. Bring a valid ID matching the passenger name and present both at the terminal for reservation verification.
                      </p>
                    </div>
                    {booking.payment?.method === 'paymongo_qrph' ? <div className="mt-6"><PaymongoQrphPanel booking={booking} initialCheckout={paymongoCheckout} onBookingChange={setBooking} /></div> : null}
                    <div className="mt-6 grid gap-4 rounded-card bg-cream p-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <p className="text-xs text-text-secondary">Travel date</p>
                        <p className="mt-1 font-bold">{formatTripDate(booking.departureTime)}</p>
                        <div className="mt-2 grid grid-cols-2 gap-4">
                          <div><p className="text-xs text-text-secondary">Loading time</p><p className="font-bold">{formatTripTime(booking.boardingStartTime)}</p></div>
                          <div><p className="text-xs text-text-secondary">Departure time</p><p className="font-bold">{formatTripTime(booking.departureTime)}</p></div>
                        </div>
                      </div>
                      <div><p className="text-xs text-text-secondary">Seat</p><p className="mt-1 font-bold">{booking.seats.join(', ')}</p></div>
                      <div><p className="text-xs text-text-secondary">Payment status</p><p className="mt-1 font-bold">{paymentStatusLabel(booking.payment?.status)}</p></div>
                      {booking.payment?.method === 'gcash' && booking.gcashRecipient ? <div className="sm:col-span-2"><p className="text-xs text-text-secondary">GCash paid to</p><p className="mt-1 select-all font-bold">{booking.gcashRecipient.mobileNumber}</p><p className="text-sm text-text-secondary">{booking.gcashRecipient.dispatcherName} · Goa dispatcher</p></div> : null}
                      <div className="sm:col-span-2"><p className="text-xs text-text-secondary">Payment transaction ID/reference</p><p className="mt-1 break-all font-bold">{booking.payment?.transactionReference ?? 'Not supplied'}</p></div>
                      <div className="sm:col-span-2"><p className="text-xs text-text-secondary">Reschedule</p><p className="mt-1 font-bold">{booking.canReschedule ? 'Eligible' : booking.rescheduleMessage}</p></div>
                    </div>
                    {booking.payment?.status === 'pending_verification' ? <p className="mt-4 rounded-control bg-warning-soft p-3 text-sm leading-6 text-text-primary">Your selected seats are being held while a dispatcher verifies the payment. You do not need to submit or pay again. Check My Bookings for updates.</p> : null}
                    {booking.payment?.status === 'rejected' ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">Reason: {booking.payment.rejectionReason ?? 'The dispatcher rejected the payment report. Check your notifications for details.'}</p> : null}
                    <Link to="/passenger/bookings" className="mt-6 flex min-h-touch w-full items-center justify-center rounded-control bg-primary px-4 text-sm font-bold text-white">My Bookings</Link>
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
