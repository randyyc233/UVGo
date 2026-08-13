import { useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Plus,
  RefreshCw,
  TicketCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest, ApiError } from '../../api/http';
import { VanSeatPicker } from '../../components/passenger/VanSeatPicker';
import { Button, Card, EmptyState, LoadingSkeleton, StatusBadge, useToast } from '../../components/ui';
import type { GoaTrip, PassengerBooking, PassengerNotification, TripSeat } from '../../types/passenger';

function departure(value: string) {
  return new Date(value).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusTone(status: string): 'success' | 'warning' | 'info' | 'neutral' {
  if (status === 'confirmed') return 'success';
  if (status === 'pending_verification' || status === 'pending_payment') return 'warning';
  if (status === 'rescheduled' || status === 'reallocated') return 'info';
  return 'neutral';
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function BookingCard({ booking }: { booking: PassengerBooking }) {
  return (
    <Link to={`/passenger/bookings/${booking.reference}`} className="block rounded-card border border-border bg-white p-4 shadow-card transition hover:border-primary/50">
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.1em] text-primary">Goa · {booking.vanId}</p><h3 className="mt-1 font-extrabold">{departure(booking.departureTime)}</h3></div><StatusBadge tone={statusTone(booking.status)}>{statusLabel(booking.status)}</StatusBadge></div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm"><span className="text-text-secondary">Seat {booking.seats.join(', ')} · {booking.reference}</span><ChevronRight className="h-4 w-4 text-primary" /></div>
    </Link>
  );
}

export function PassengerHomePage() {
  const [bookings, setBookings] = useState<PassengerBooking[]>([]);
  const [notifications, setNotifications] = useState<PassengerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<{ bookings: PassengerBooking[] }>('/passenger/bookings'),
      apiRequest<{ notifications: PassengerNotification[] }>('/passenger/notifications'),
    ]).then(([bookingData, notificationData]) => {
      if (active) { setBookings(bookingData.bookings); setNotifications(notificationData.notifications); }
    }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : 'Passenger home could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const nextBooking = bookings.find((booking) => new Date(booking.departureTime) > new Date());
  if (!loading && error) return <EmptyState icon={<RefreshCw className="h-6 w-6" />} title="Passenger home unavailable" description={error} action={<Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>} />;
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-card bg-gradient-to-br from-primary-deeper via-primary-dark to-primary p-6 text-white shadow-card sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Passenger portal</p><h2 className="mt-2 text-3xl font-black text-white">Your next Bicol ride, made simple.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Reserve a scheduled Goa seat, track payment status, and keep your booking reference close.</p><Link to="/passenger/book" className="mt-5 inline-flex min-h-touch items-center gap-2 rounded-control bg-white px-5 text-sm font-extrabold text-primary-dark"><Plus className="h-4 w-4" />Book a Goa ride</Link>
      </section>
      {loading ? <Card className="p-5"><LoadingSkeleton lines={4} /></Card> : <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold">Next booking</h2><Link to="/passenger/bookings" className="text-sm font-bold text-primary">View all</Link></div>{nextBooking ? <BookingCard booking={nextBooking} /> : <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="No upcoming booking" description="Book a Goa trip to see it here." action={<Link to="/passenger/book" className="font-bold text-primary">Reserve now</Link>} />}</section><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold">Latest updates</h2><Link to="/passenger/notifications" className="text-sm font-bold text-primary">View all</Link></div><Card className="divide-y divide-border">{notifications.slice(0, 3).map((item) => <div key={item.id} className="flex gap-3 p-4"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">{item.message}</p><p className="mt-1 text-xs text-text-secondary">{new Date(item.createdAt).toLocaleString('en-PH')}</p></div></div>)}</Card></section></div>}
    </div>
  );
}

export function MyBookingsPage() {
  const [bookings, setBookings] = useState<PassengerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void apiRequest<{ bookings: PassengerBooking[] }>('/passenger/bookings').then((data) => setBookings(data.bookings)).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Bookings could not be loaded.')).finally(() => setLoading(false)); }, []);
  if (loading) return <Card className="p-5"><LoadingSkeleton lines={6} /></Card>;
  return <div><div className="mb-5 flex items-center justify-end gap-4 lg:justify-between"><div className="hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger</p><h2 className="mt-1 text-2xl font-black">My bookings</h2></div><Link to="/passenger/book" className="inline-flex min-h-touch items-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />New booking</Link></div>{error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-danger">{error}</p> : bookings.length ? <div className="grid gap-4 xl:grid-cols-2">{bookings.map((booking) => <BookingCard key={booking.id} booking={booking} />)}</div> : <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="No bookings yet" description="Your Goa reservations will appear here." />}</div>;
}

export function BookingDetailsPage() {
  const { reference = '' } = useParams();
  const [booking, setBooking] = useState<PassengerBooking | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(() => { const value = new Date(); value.setDate(value.getDate() + 2); return value.toISOString().slice(0, 10); });
  const [trips, setTrips] = useState<GoaTrip[]>([]);
  const [targetTrip, setTargetTrip] = useState<GoaTrip | null>(null);
  const [seats, setSeats] = useState<TripSeat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { void apiRequest<{ booking: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(reference)}`).then((data) => setBooking(data.booking)).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Booking could not be loaded.')).finally(() => setLoading(false)); }, [reference]);

  async function findTrips() {
    if (!booking) return;
    setLoading(true); setError(null); setTargetTrip(null); setSelectedSeats([]);
    try { const data = await apiRequest<{ trips: GoaTrip[] }>(`/passenger/trips?date=${date}&passengers=${booking.seatCount}`); const alternatives = data.trips.filter((trip) => trip.id !== booking.tripId); setTrips(alternatives); if (!alternatives.length) setError('No alternative Goa trips are available for this date.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Trips could not be loaded.'); } finally { setLoading(false); }
  }

  async function chooseTrip(trip: GoaTrip) {
    setTargetTrip(trip); setSelectedSeats([]); setLoading(true);
    try { const data = await apiRequest<{ seats: TripSeat[] }>(`/passenger/trips/${trip.id}/seats`); setSeats(data.seats); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Seats could not be loaded.'); } finally { setLoading(false); }
  }

  async function submitReschedule() {
    if (!booking || !targetTrip) return;
    setLoading(true); setError(null);
    try { const data = await apiRequest<{ booking: PassengerBooking }>(`/passenger/bookings/${encodeURIComponent(booking.reference)}/reschedule`, { method: 'POST', body: JSON.stringify({ tripId: targetTrip.id, seats: selectedSeats }) }); setBooking(data.booking); setRescheduling(false); toast.success('Reservation rescheduled successfully.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Booking could not be rescheduled.'); } finally { setLoading(false); }
  }

  if (loading && !booking) return <Card className="p-5"><LoadingSkeleton lines={7} /></Card>;
  if (!booking) return <EmptyState icon={<TicketCheck className="h-6 w-6" />} title="Booking not found" description={error ?? 'This booking is unavailable.'} />;
  return <div className="mx-auto max-w-5xl"><Link to="/passenger/bookings" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-primary"><ChevronRight className="h-4 w-4 rotate-180" />Back to bookings</Link><div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]"><Card className="p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Booking details</p><h2 className="mt-1 text-2xl font-black">{booking.reference}</h2></div><StatusBadge tone={statusTone(booking.status)}>{statusLabel(booking.status)}</StatusBadge></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><div className="rounded-control bg-cream p-4"><MapPin className="h-5 w-5 text-primary" /><p className="mt-2 font-bold">{booking.origin}</p><p className="text-sm text-text-secondary">to {booking.destination}</p></div><div className="rounded-control bg-cream p-4"><CalendarClock className="h-5 w-5 text-primary" /><p className="mt-2 font-bold">{departure(booking.departureTime)}</p><p className="text-sm text-text-secondary">{booking.vanId}</p></div><div className="rounded-control bg-cream p-4"><TicketCheck className="h-5 w-5 text-primary" /><p className="mt-2 font-bold">Seat {booking.seats.join(', ')}</p><p className="text-sm text-text-secondary">{booking.seatCount} passenger(s)</p></div><div className="rounded-control bg-cream p-4"><CheckCircle2 className="h-5 w-5 text-primary" /><p className="mt-2 font-bold capitalize">{booking.payment?.status.replaceAll('_', ' ')}</p><p className="text-sm text-text-secondary">{booking.payment?.method === 'paypal' ? 'PayPal' : 'GCash receipt'}</p></div></div><div className="mt-5 border-t border-border pt-5"><p className="text-sm font-bold">Reschedule policy</p><p className="mt-1 text-sm text-text-secondary">{booking.rescheduleMessage}</p><Button className="mt-4" variant="outline" disabled={!booking.canReschedule} onClick={() => setRescheduling(true)} leadingIcon={<RefreshCw className="h-4 w-4" />}>Reschedule</Button><p className="mt-3 text-xs text-text-muted">No cancellation or refund action is available.</p></div></Card><Card className="h-fit p-5"><p className="text-sm font-bold">Payment summary</p><div className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-text-secondary">Fare</span><span>₱{booking.fareAmount.toFixed(2)}</span></div><div className="flex justify-between"><span className="text-text-secondary">Service fee</span><span>₱{booking.serviceFee.toFixed(2)}</span></div><div className="flex justify-between border-t border-border pt-3 text-lg font-black text-primary-dark"><span>Total</span><span>₱{booking.totalAmount.toFixed(2)}</span></div></div></Card></div>
    {rescheduling ? <Card className="mt-5 p-5 sm:p-7"><h2 className="text-xl font-black">Reschedule Goa booking</h2><p className="mt-1 text-sm text-text-secondary">Choose another scheduled trip and exactly {booking.seatCount} seat(s).</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="New departure date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="min-h-touch flex-1 rounded-control border border-border-strong px-3" /><Button onClick={() => void findTrips()} loading={loading}>Find trips</Button><Button variant="ghost" onClick={() => setRescheduling(false)}>Close</Button></div>{error ? <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}<div className="mt-4 grid gap-3 sm:grid-cols-2">{trips.map((trip) => <button key={trip.id} type="button" onClick={() => void chooseTrip(trip)} className="rounded-control border border-border p-3 text-left hover:border-primary"><span className="font-bold">{departure(trip.departureTime)}</span><span className="mt-1 block text-xs text-text-secondary">{trip.availableSeats} seats left</span></button>)}</div>{targetTrip ? <div className="mx-auto mt-5 max-w-lg"><VanSeatPicker seats={seats} selected={selectedSeats} limit={booking.seatCount} onChange={setSelectedSeats} /><Button fullWidth className="mt-4" disabled={selectedSeats.length !== booking.seatCount} loading={loading} onClick={() => void submitReschedule()}>Confirm reschedule</Button></div> : null}</Card> : null}</div>;
}

export function PassengerNotificationsPage() {
  const [items, setItems] = useState<PassengerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void apiRequest<{ notifications: PassengerNotification[] }>('/passenger/notifications').then((data) => setItems(data.notifications)).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Notifications could not be loaded.')).finally(() => setLoading(false)); }, []);
  if (loading) return <Card className="p-5"><LoadingSkeleton lines={6} /></Card>;
  if (error) return <EmptyState icon={<Bell className="h-6 w-6" />} title="Notifications unavailable" description={error} />;
  return <div className="mx-auto max-w-3xl"><div className="mb-5 hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Passenger</p><h2 className="mt-1 text-2xl font-black">Notifications</h2></div>{items.length ? <Card className="divide-y divide-border">{items.map((item) => <article key={item.id} className="flex gap-4 p-4 sm:p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Bell className="h-5 w-5" /></span><div><p className="font-semibold">{item.message}</p><p className="mt-1 text-xs text-text-secondary">{new Date(item.createdAt).toLocaleString('en-PH')} · {statusLabel(item.type)}</p></div></article>)}</Card> : <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Booking and payment updates will appear here." />}</div>;
}

export function PassengerStatusPage() {
  return <MyBookingsPage />;
}
