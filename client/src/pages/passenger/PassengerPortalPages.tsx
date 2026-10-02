import { useRef, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  MapPin,
  Plus,
  RefreshCw,
  TicketCheck,
  Trash2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { VanSeatPicker } from '../../components/passenger/VanSeatPicker';
import { ReservationAction } from '../../components/passenger/ReservationAction';
import { PayPalCheckout } from '../../components/passenger/PayPalCheckout';
import { ScheduleTripCard } from '../../components/passenger/ScheduleTripCard';
import { useMobileSectionScroll } from '../../hooks/useMobileSectionScroll';
import { Button, Card, ConfirmationDialog, EmptyState, LoadingSkeleton, StatusBadge, useToast } from '../../components/ui';
import { usePassengerBooking, usePassengerBookings, usePassengerNotifications } from '../../hooks/usePassengerData';
import { formatDateTime12, formatTime12 } from '../../lib/dateTime';
import { cn } from '../../lib/cn';
import type { GoaTrip, PassengerBooking, PassengerNotification, TripSeat } from '../../types/passenger';

function bookingDate(value: string) {
  return new Date(value).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function bookingTime(value: string) {
  return formatTime12(value);
}

function statusTone(status: string): 'success' | 'warning' | 'info' | 'danger' | 'neutral' {
  if (status === 'confirmed' || status === 'verified' || status === 'captured') return 'success';
  if (status === 'payment_rejected' || status === 'payment_failed' || status === 'rejected' || status === 'failed' || status === 'forfeited') return 'danger';
  if (status === 'pending_verification' || status === 'pending_payment' || status === 'pending') return 'warning';
  if (status === 'rescheduled' || status === 'reallocated') return 'info';
  return 'neutral';
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function bookingDisplayStatus(booking: PassengerBooking) {
  if (booking.payment?.status === 'rejected') return 'payment_rejected';
  if (booking.payment?.status === 'failed') return 'payment_failed';
  return booking.status;
}

function paymentMethodLabel(method: 'paypal' | 'gcash' | 'legacy' | undefined) {
  if (method === 'paypal') return 'PayPal';
  if (method === 'legacy') return 'Legacy payment';
  return 'GCash receipt';
}

function BookingCard({ booking }: { booking: PassengerBooking }) {
  const displayStatus = bookingDisplayStatus(booking);
  return (
    <Link to={`/passenger/bookings/${booking.reference}`} className="block rounded-card border border-border bg-white p-4 shadow-card transition hover:border-primary/50">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-all text-xs font-bold uppercase tracking-[0.1em] text-primary">Goa · {booking.vanId}</p>
        <StatusBadge tone={statusTone(displayStatus)}>{statusLabel(displayStatus)}</StatusBadge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <div><dt className="text-xs font-semibold text-text-secondary">Travel date</dt><dd className="font-bold">{bookingDate(booking.departureTime)}</dd></div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs sm:justify-start sm:gap-x-6 sm:text-sm">
          <div className="flex items-baseline gap-1.5"><dt className="font-semibold text-text-secondary">Loading<span className="hidden sm:inline"> time</span></dt><dd className="whitespace-nowrap font-bold">{bookingTime(booking.boardingStartTime)}</dd></div>
          <div className="flex items-baseline gap-1.5"><dt className="font-semibold text-text-secondary">Departure<span className="hidden sm:inline"> time</span></dt><dd className="whitespace-nowrap font-bold">{bookingTime(booking.departureTime)}</dd></div>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm"><span className="min-w-0 break-words text-text-secondary">Seats {booking.seats.map((seat) => `#${seat}`).join(', ')} · {booking.reference}</span><ChevronRight className="h-4 w-4 shrink-0 text-primary" /></div>
    </Link>
  );
}

export function PassengerHomePage() {
  const bookingQuery = usePassengerBookings();
  const notificationQuery = usePassengerNotifications();
  const bookings = bookingQuery.bookings;
  const notifications = notificationQuery.notifications;
  const loading = bookingQuery.loading || notificationQuery.loading;
  const error = bookingQuery.error ?? notificationQuery.error;

  const nextBooking = bookings.find((booking) => new Date(booking.departureTime) > new Date());
  if (!loading && error) return <EmptyState icon={<RefreshCw className="h-6 w-6" />} title="Passenger home unavailable" description={error} action={<Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>} />;
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-card bg-gradient-to-br from-primary-deeper via-primary-dark to-primary p-6 text-white shadow-card sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Passenger portal</p><h2 className="mt-2 text-3xl font-black text-white">Your next Bicol ride, made simple.</h2><Link to="/passenger/book" className="dashboard-primary-action mt-5 inline-flex min-h-touch items-center justify-center gap-2 rounded-control bg-white px-5 text-sm font-extrabold text-primary-dark"><Plus className="h-4 w-4" />Book a ride</Link>
      </section>
      {loading ? <Card className="p-5"><LoadingSkeleton lines={4} /></Card> : <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold">Next booking</h2><Link to="/passenger/bookings" className="text-sm font-bold text-primary">View all</Link></div>{nextBooking ? <BookingCard booking={nextBooking} /> : <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="No upcoming booking" description="" action={<Link to="/passenger/book" className="font-bold text-primary">Reserve now</Link>} />}</section><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold">Latest updates</h2><Link to="/passenger/notifications" className="text-sm font-bold text-primary">View all</Link></div><Card className="divide-y divide-border">{notifications.slice(0, 3).map((item) => <div key={item.id} className="flex gap-3 p-4"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">{item.message}</p><p className="mt-1 text-xs text-text-secondary">{formatDateTime12(item.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })}</p></div></div>)}</Card></section></div>}
    </div>
  );
}

export function MyBookingsPage() {
  const { bookings, loading, error } = usePassengerBookings();
  if (loading) return <Card className="p-5"><LoadingSkeleton lines={6} /></Card>;
  return <div><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:justify-between"><div className="hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger</p><h2 className="mt-1 text-2xl font-black">My bookings</h2></div><Link to="/passenger/book" className="inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-white sm:w-auto"><Plus className="h-4 w-4" />New booking</Link></div>{error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-danger">{error}</p> : bookings.length ? <div className="grid gap-4 xl:grid-cols-2">{bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)}</div> : <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="No bookings yet" description="Your Goa reservations will appear here." />}</div>;
}

export function BookingDetailsPage() {
  const navigate = useNavigate();
  const { reference = '' } = useParams();
  const { booking, setBooking, loading, error, setError } = usePassengerBooking(reference);
  const [rescheduling, setRescheduling] = useState(false);
  const [paymentDetailsExpanded, setPaymentDetailsExpanded] = useState(false);
  const [date, setDate] = useState(() => { const value = new Date(); value.setDate(value.getDate() + 2); return value.toISOString().slice(0, 10); });
  const [trips, setTrips] = useState<GoaTrip[]>([]);
  const [targetTrip, setTargetTrip] = useState<GoaTrip | null>(null);
  const [seats, setSeats] = useState<TripSeat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const dateSection = useRef<HTMLDivElement>(null);
  const schedulesSection = useRef<HTMLDivElement>(null);
  const [dateScrollRequest, setDateScrollRequest] = useState(0);
  const [scheduleScrollRequest, setScheduleScrollRequest] = useState(0);
  useMobileSectionScroll(dateSection, dateScrollRequest);
  useMobileSectionScroll(schedulesSection, scheduleScrollRequest);
  const toast = useToast();

  async function findTrips() {
    if (!booking) return;
    setActionLoading(true); setError(null); setTargetTrip(null); setSelectedSeats([]);
    try { const data = await apiRequest<{ trips: GoaTrip[] }>(`/passenger/trips?date=${date}&passengers=${booking.seatCount}`); const alternatives = data.trips.filter((trip) => trip.id !== booking.tripId); setTrips(alternatives); if (!alternatives.length) setError('No alternative Goa trips are available for this date.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Trips could not be loaded.'); } finally { setActionLoading(false); setScheduleScrollRequest((current) => current + 1); }
  }

  async function chooseTrip(trip: GoaTrip) {
    setTargetTrip(trip); setSelectedSeats([]); setActionLoading(true);
    try { const data = await apiRequest<{ seats: TripSeat[] }>(`/passenger/trips/${trip.id}/seats`); setSeats(data.seats); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Seats could not be loaded.'); } finally { setActionLoading(false); }
  }

  async function submitReschedule() {
    if (!booking || !targetTrip) return;
    setActionLoading(true); setError(null);
    try { const data = await apiRequest<{ booking: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(booking.reference)}/reschedule`, { method: 'POST', body: JSON.stringify({ tripId: targetTrip.id, seats: selectedSeats }) }); setBooking(data.booking); setRescheduling(false); toast.success('Reservation rescheduled successfully.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Booking could not be rescheduled.'); } finally { setActionLoading(false); }
  }

  if (loading && !booking) return <Card className="p-5"><LoadingSkeleton lines={7} /></Card>;
  if (!booking) return <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="Booking not found" description={error ?? 'This booking is unavailable.'} />;
  const displayStatus = bookingDisplayStatus(booking);
  return <div className="reservation-flow mx-auto min-w-0 max-w-5xl">
    <Link to="/passenger/bookings" className="mb-3 inline-flex min-h-touch items-center gap-2 text-sm font-bold text-primary sm:mb-4"><ChevronRight className="h-4 w-4 rotate-180" aria-hidden="true" />Back to bookings</Link>
    {booking.payment?.status === 'rejected' ? <div role="alert" className="mb-4 rounded-card border border-danger/25 bg-danger-soft p-3 text-danger sm:mb-5 sm:p-4"><p className="text-sm font-extrabold sm:text-base">Payment rejected</p><p className="mt-1 text-sm leading-5">{booking.payment.rejectionReason ?? 'The dispatcher rejected the payment report. Check Notifications for details.'}</p></div> : null}
    <div className="grid min-w-0 gap-4 sm:gap-5 lg:grid-cols-[1.25fr_0.75fr] lg:items-start">
      <Card className="min-w-0 p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Booking details</p>
          <StatusBadge tone={statusTone(displayStatus)}>{statusLabel(displayStatus)}</StatusBadge>
        </div>
        <h2 className="mt-2 select-all break-all text-lg font-black tracking-wide sm:text-2xl">{booking.reference}</h2>
        <div className="mt-4 space-y-3 sm:mt-6">
          <div className="flex items-start gap-3 rounded-control bg-cream p-3 sm:p-4">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" aria-hidden="true" />
            <div className="min-w-0"><p className="text-sm font-bold sm:text-base">{booking.origin}</p><p className="mt-0.5 text-sm text-text-secondary">to {booking.destination}</p></div>
          </div>
          <div className="rounded-control border border-border p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary sm:h-5 sm:w-5" aria-hidden="true" />
              <div className="min-w-0"><p className="text-xs text-text-secondary">Travel date</p><p className="mt-0.5 text-sm font-bold sm:text-base">{bookingDate(booking.departureTime)}</p></div>
            </div>
            <dl className="mt-3 flex flex-wrap items-baseline justify-between gap-x-1 gap-y-2 border-t border-border pt-3 text-xs sm:justify-start sm:gap-x-6 sm:rounded-control sm:border-0 sm:bg-cream sm:p-3 sm:text-sm">
              <div className="flex items-baseline gap-0.5 sm:gap-1.5"><dt className="text-text-secondary">Loading<span className="hidden sm:inline"> time</span></dt><dd className="whitespace-nowrap font-bold">{bookingTime(booking.boardingStartTime)}</dd></div>
              <div className="flex items-baseline gap-0.5 sm:gap-1.5"><dt className="text-text-secondary">Departure<span className="hidden sm:inline"> time</span></dt><dd className="whitespace-nowrap font-bold">{bookingTime(booking.departureTime)}</dd></div>
            </dl>
            <p className="mt-2 break-all text-xs text-text-secondary">Van · {booking.vanId}</p>
          </div>
          <div className="rounded-control bg-cream p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-bold"><TicketCheck className="h-4 w-4 text-primary" aria-hidden="true" />Selected seats</p><p className="text-xs text-text-secondary">{booking.seatCount} passenger{booking.seatCount === 1 ? '' : 's'}</p></div>
            <div className="mt-2 flex flex-wrap gap-1.5">{booking.seats.length ? booking.seats.map((seat) => <span key={seat} className="rounded-lg border border-primary/20 bg-primary-soft px-2.5 py-1 text-sm font-bold text-primary-dark">Seat #{seat}</span>) : <p className="text-sm text-text-secondary">No seats currently reserved</p>}</div>
          </div>
        </div>
      </Card>
      <Card className="min-w-0 p-4 sm:p-5 lg:row-span-2">
        <h2 className="text-sm font-extrabold sm:text-base">Payment summary</h2>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-text-secondary">{paymentMethodLabel(booking.payment?.method)}</span><StatusBadge tone={statusTone(booking.payment?.status ?? '')}>{booking.payment ? statusLabel(booking.payment.status) : 'Not available'}</StatusBadge></div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-control border border-primary/20 bg-primary-soft p-3 text-primary-dark sm:p-4"><p className="text-sm font-bold">Total Price</p><p className="text-xl font-black">₱{booking.totalAmount.toFixed(2)}</p></div>
        <button type="button" aria-expanded={paymentDetailsExpanded} aria-controls="passenger-booking-payment-details" onClick={() => setPaymentDetailsExpanded((expanded) => !expanded)} className="mt-2 flex min-h-touch w-full items-center justify-between gap-3 text-left text-sm font-bold text-primary sm:hidden">
          {paymentDetailsExpanded ? 'Hide payment details' : 'View payment details'}<ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', paymentDetailsExpanded && 'rotate-180')} aria-hidden="true" />
        </button>
        <dl id="passenger-booking-payment-details" className={cn('space-y-3 border-t border-border pt-3 text-sm sm:mt-4 sm:block sm:pt-4', paymentDetailsExpanded ? 'block' : 'hidden')}>
          <div><dt className="text-xs text-text-secondary">Transaction ID/reference</dt><dd className="mt-1 break-all font-bold">{booking.payment?.transactionReference ?? 'Not supplied'}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-text-secondary">Fare</dt><dd className="font-semibold">₱{booking.fareAmount.toFixed(2)}</dd></div>
        </dl>
      </Card>
      <Card className="p-4 sm:p-5 lg:col-start-1">
        <h2 className="text-sm font-extrabold sm:text-base">Reschedule policy</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:text-sm">
          <div><dt className="text-text-secondary">Reschedule before</dt><dd className="mt-1 font-bold">{formatDateTime12(booking.rescheduleCutoffTime)}</dd></div>
          <div><dt className="text-text-secondary">Attempts remaining</dt><dd className="mt-1 font-bold">{booking.reschedulesRemaining} of {booking.rescheduleLimit}</dd></div>
        </dl>
        <p className="mt-1 text-xs leading-5 text-text-secondary sm:text-sm">{booking.rescheduleMessage}</p>
        <Button className="dashboard-primary-action mt-3 w-full sm:mt-4 sm:w-auto" variant="outline" disabled={!booking.canReschedule} onClick={() => { setRescheduling(true); setDateScrollRequest((current) => current + 1); }} leadingIcon={<RefreshCw className="h-4 w-4" />}>Reschedule</Button>
        <p className="mt-2 text-xs text-text-muted sm:mt-3">No cancellation or refund action is available.</p>
      </Card>
    </div>
    {(booking.discountAmount ?? 0) > 0 ? <Card className="mt-4 p-4 sm:mt-5 sm:p-5">
      <h2 className="text-base font-extrabold sm:text-lg">Student & senior discount</h2>
      <p className="mt-2 text-xs leading-5 sm:text-sm">{booking.studentPassengers} student(s) · {booking.seniorPassengers} senior citizen(s) · 20% off each eligible seat</p>
      <p className="mt-2 text-sm font-bold text-primary-dark sm:text-base">Discount saved: ₱{booking.discountAmount!.toFixed(2)}</p>
      <p className="mt-2 text-xs leading-5 text-text-secondary sm:text-sm sm:leading-6">Every discounted passenger must bring a valid student or senior citizen ID. Eligibility is checked at the terminal before boarding.</p>
    </Card> : null}
    {booking.status === 'pending_payment' && booking.payment?.method === 'paypal' && booking.payment.transactionReference ? <Card className="mt-4 p-4 sm:mt-5 sm:p-7">
      <h2 className="text-lg font-extrabold sm:text-xl">Complete your PayPal payment</h2>
      <p className="mt-2 text-sm leading-6 text-text-secondary">Your seats are held for this checkout. If you already approved payment, check its status before paying again.</p>
      <div className="mt-5"><ReservationAction total={booking.totalAmount}>
        <PayPalCheckout tripId={booking.tripId} seats={booking.seats} contact=""
          existingOrder={{ reference: booking.reference, orderId: booking.payment.transactionReference }}
          onConfirmed={setBooking} onReleased={() => navigate('/passenger/bookings')}
          onSeatUnavailable={async (message) => { setError(message); }} />
      </ReservationAction></div>
    </Card> : null}
    {rescheduling && booking.canReschedule ? <Card className="mt-4 p-4 sm:mt-5 sm:p-7">
      <div ref={dateSection} tabIndex={-1} className="reservation-scroll-target" aria-label="Reschedule date selection">
        <h2 className="text-lg font-black sm:text-xl">Reschedule Goa booking</h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">Choose another scheduled trip and exactly {booking.seatCount} seat{booking.seatCount === 1 ? '' : 's'}.</p>
        <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); void findTrips(); }}>
          <label className="block min-w-0 text-sm font-semibold">New departure date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 min-h-touch w-full min-w-0 rounded-control border border-border-strong px-3 py-2.5 text-base" />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:contents">
            <Button type="submit" loading={actionLoading}>Search Trips</Button>
            <Button type="button" variant="ghost" onClick={() => setRescheduling(false)}>Close</Button>
          </div>
        </form>
      </div>
      <div ref={schedulesSection} tabIndex={-1} className="reservation-scroll-target mt-5" aria-label="Available reschedule schedules">
        {trips.length ? <div className="mb-4"><h3 className="text-lg font-extrabold">Choose your new schedule</h3><p className="mt-1 text-sm text-text-secondary">Tap a departure to select it.</p></div> : null}
        {error ? <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        {actionLoading ? <LoadingSkeleton lines={3} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">{trips.map((trip) => <ScheduleTripCard key={trip.id} trip={trip} selected={targetTrip?.id === trip.id} disabled={!trip.canFitParty || actionLoading} onSelect={() => void chooseTrip(trip)} />)}</div>
      </div>
      {targetTrip && !actionLoading ? <div className="mx-auto mt-6 max-w-lg border-t border-border pt-5">
        <h3 className="text-xl font-extrabold">Seat selection</h3>
        <p className="mb-4 mt-2 text-sm text-text-secondary">Choose exactly {booking.seatCount} seat{booking.seatCount === 1 ? '' : 's'} for your new departure.</p>
        <VanSeatPicker seats={seats} selected={selectedSeats} limit={booking.seatCount} onChange={setSelectedSeats} />
        <div className="mt-5 rounded-control bg-cream p-4"><p className="text-sm font-bold">Selected seats</p><p className="mt-1 font-semibold" aria-live="polite">{selectedSeats.length ? `Seats ${selectedSeats.map((seat) => `#${seat}`).join(', ')}` : 'No seats selected yet'}</p></div>
      </div> : null}
      {targetTrip ? <ReservationAction total={booking.totalAmount} caption={`${selectedSeats.length} of ${booking.seatCount} seats selected`}><Button fullWidth className="mt-4" disabled={selectedSeats.length !== booking.seatCount} loading={actionLoading} onClick={() => void submitReschedule()}>Confirm reschedule</Button></ReservationAction> : null}
    </Card> : null}</div>;
}

export function PassengerNotificationsPage() {
  const { notifications: items, setData, loading, error, refresh } = usePassengerNotifications();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [deleting, setDeleting] = useState<PassengerNotification | null>(null);
  const toast = useToast();
  const unreadCount = items.filter((item) => !item.isRead).length;

  function updateItems(update: (current: PassengerNotification[]) => PassengerNotification[]) {
    setData((current) => ({ notifications: update(current?.notifications ?? items) }));
  }

  function notificationStateChanged() {
    window.dispatchEvent(new Event('uvgo:passenger-notifications-changed'));
  }

  async function markRead(item: PassengerNotification) {
    if (item.isRead || workingId) return;
    setWorkingId(item.id);
    try {
      await apiRequest<{ message: string }>(`/passenger/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' });
      updateItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry));
      notificationStateChanged();
      toast.success('Notification marked as read.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'The notification could not be updated.');
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  async function markAllRead() {
    if (!unreadCount || markingAll) return;
    setMarkingAll(true);
    try {
      await apiRequest<{ message: string; updated: number }>('/passenger/notifications/read-all', { method: 'PATCH' });
      updateItems((current) => current.map((item) => ({ ...item, isRead: true })));
      notificationStateChanged();
      toast.success('All notifications marked as read.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Notifications could not be updated.');
      await refresh();
    } finally {
      setMarkingAll(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || workingId) return;
    const notification = deleting;
    setWorkingId(notification.id);
    try {
      await apiRequest<void>(`/passenger/notifications/${encodeURIComponent(notification.id)}`, { method: 'DELETE' });
      updateItems((current) => current.filter((item) => item.id !== notification.id));
      setDeleting(null);
      notificationStateChanged();
      toast.success('Notification deleted.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'The notification could not be deleted.');
      setDeleting(null);
      await refresh();
    } finally {
      setWorkingId(null);
    }
  }

  if (loading) return <Card className="p-5"><LoadingSkeleton lines={6} /></Card>;
  if (error) return <EmptyState icon={<Bell className="h-6 w-6" />} title="Notifications unavailable" description={error} />;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger</p><h2 className="mt-1 text-2xl font-black">Notifications</h2><p className="mt-1 text-sm text-text-secondary">{unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up.'}</p></div>
        {items.length ? <Button className="w-full sm:ml-auto sm:w-auto" variant="outline" disabled={!unreadCount} loading={markingAll} onClick={() => void markAllRead()} leadingIcon={<CheckCheck className="h-4 w-4" />}>Mark all as read</Button> : null}
      </div>
      {items.length ? (
        <Card padded={false} className="divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <article key={item.id} className={`flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-start sm:p-5 ${item.isRead ? 'bg-surface' : 'bg-primary-soft/45'}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.isRead ? 'bg-cream text-text-secondary' : 'bg-primary text-white'}`}><Bell className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className={item.isRead ? 'font-medium text-text-secondary' : 'font-bold'}>{item.message}</p>{!item.isRead ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}</div>
                <p className="mt-1 text-xs text-text-secondary">{formatDateTime12(item.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })} · {statusLabel(item.type)} · {item.isRead ? 'Read' : 'Unread'}</p>
              </div>
              <div className="dashboard-actions dashboard-actions-end sm:shrink-0">
                {!item.isRead ? <Button className="flex-auto sm:flex-none" variant="ghost" size="sm" loading={workingId === item.id} disabled={Boolean(workingId && workingId !== item.id)} onClick={() => void markRead(item)} leadingIcon={<CheckCheck className="h-4 w-4" />}>Mark as read</Button> : null}
                <Button className="flex-auto sm:flex-none" variant="danger" size="sm" disabled={Boolean(workingId)} onClick={() => setDeleting(item)} leadingIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>
              </div>
            </article>
          ))}
        </Card>
      ) : <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Booking and payment updates will appear here." />}
      <ConfirmationDialog open={Boolean(deleting)} title="Delete this notification?" description="This removes the notification permanently from your account." confirmLabel="Delete notification" destructive loading={Boolean(deleting && workingId === deleting.id)} onClose={() => { if (!workingId) setDeleting(null); }} onConfirm={() => void confirmDelete()} />
    </div>
  );
}
