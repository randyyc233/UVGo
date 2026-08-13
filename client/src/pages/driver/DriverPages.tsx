import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  BusFront,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  MapPin,
  Navigation,
  Play,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useDriverOverview } from '../../hooks/useDriverOverview';
import { cn } from '../../lib/cn';
import { AlertItem, Button, Card, ConfirmationDialog, EmptyState, Input, LoadingSkeleton, StatusBadge, Toggle, useToast } from '../../components/ui';

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function departure(value: string) {
  return new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function tone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['accepted', 'ready_for_dispatch', 'at_terminal', 'confirmed'].includes(status)) return 'success';
  if (['pending', 'loading', 'waiting'].includes(status)) return 'warning';
  if (['rejected', 'delayed'].includes(status)) return 'danger';
  if (['incoming', 'assigned'].includes(status)) return 'info';
  return 'neutral';
}

function DriverLoading() {
  return <Card className="p-5"><LoadingSkeleton lines={7} /></Card>;
}

function DriverError({ message, retry }: { message: string; retry: () => void }) {
  return <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Driver data unavailable" description={message} action={<Button variant="outline" onClick={retry} leadingIcon={<RefreshCw className="h-4 w-4" />}>Try again</Button>} />;
}

export function DriverSetupPage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  const navigate = useNavigate();
  const toast = useToast();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'No assigned vehicle was found.'} retry={() => void refresh()} />;

  async function setEnabled(enabled: boolean) {
    const updated = await mutate('/driver/setup/go-on-trip', { method: 'PATCH', body: JSON.stringify({ enabled }) });
    if (updated) toast.success(`Go on Trip ${enabled ? 'enabled' : 'disabled'}.`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-control border border-border p-4"><p className="text-xs text-text-secondary">Driver name</p><p className="mt-1 font-extrabold">{overview.driver.name}</p></div>
          <div className="rounded-control border border-border p-4"><p className="text-xs text-text-secondary">Assigned van</p><p className="mt-1 font-extrabold">{overview.vehicle.vanId}</p><p className="text-xs text-text-secondary">{overview.vehicle.plateNo}</p></div>
          <div className="rounded-control border border-border p-4"><p className="text-xs text-text-secondary">Route</p><p className="mt-1 font-extrabold">Naga → {overview.vehicle.route}</p><p className="text-xs text-text-secondary">{overview.vehicle.protocol} protocol</p></div>
          <div className="rounded-control border border-border p-4"><p className="text-xs text-text-secondary">Dispatcher</p><p className="mt-1 font-extrabold">{overview.dispatcher?.name ?? 'On-duty dispatcher'}</p><p className="text-xs text-text-secondary">Naga City East Bound Terminal</p></div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-control border border-primary/20 bg-primary-soft p-4">
          <div><p className="font-extrabold text-primary-dark">Go on Trip</p><p className="mt-1 text-xs leading-5 text-text-secondary">Enable queue participation and terminal arrival actions for this van.</p></div>
          <Toggle checked={overview.vehicle.goOnTripEnabled} onChange={(enabled) => void setEnabled(enabled)} label="Go on Trip" />
        </div>
        {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        <Button className="mt-5" fullWidth size="lg" disabled={!overview.vehicle.goOnTripEnabled} onClick={() => navigate('/driver/dashboard')} leadingIcon={<CheckCircle2 className="h-5 w-5" />}>Confirm setup</Button>
      </Card>
      <Card className="flex items-center gap-4 bg-primary-soft/50 p-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary"><MapPin className="h-6 w-6" /></span><div><p className="font-bold">Active Zone status</p><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.insideActiveZone ? 'Inside the terminal’s 5 km Active Zone.' : 'Outside the terminal Active Zone.'}</p></div></Card>
    </div>
  );
}

export function DriverDashboardPage() {
  const { overview, loading, error, refresh } = useDriverOverview();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'No driver overview was found.'} retry={() => void refresh()} />;
  const occupancyPercent = overview.trip ? Math.round((overview.trip.occupancy / overview.vehicle.capacity) * 100) : 0;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary-dark to-primary p-5 text-white shadow-floating sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs text-white/70">Current status</p><h2 className="mt-1 text-2xl font-black text-white">{formatStatus(overview.vehicle.status)}</h2><div className="mt-5 space-y-2 text-sm text-white/90"><p className="flex items-center gap-2"><Route className="h-4 w-4" />Naga → {overview.vehicle.route}</p><p className="flex items-center gap-2"><UsersRound className="h-4 w-4" />{overview.trip?.occupancy ?? 0} / {overview.vehicle.capacity} passengers</p><p className="flex items-center gap-2"><UserRound className="h-4 w-4" />Dispatcher: {overview.dispatcher?.name ?? 'On duty'}</p></div></div><div className="text-right"><p className="text-xs text-white/70">Queue position</p><p className="text-5xl font-black">#{overview.queue?.position ?? '—'}</p><div className="mt-5 flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-primary-dark"><BusFront className="h-10 w-10" /></div></div></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4"><Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Trip readiness</p><p className="mt-1 text-xs text-text-secondary">{overview.assignment ? `Assignment ${formatStatus(overview.assignment.status)}` : 'No active assignment'}</p></div>{overview.assignment ? <StatusBadge tone={tone(overview.assignment.status)}>{formatStatus(overview.assignment.status)}</StatusBadge> : null}</div><div className="mt-4 h-2 overflow-hidden rounded-pill bg-border"><div className="h-full rounded-pill bg-primary" style={{ width: `${occupancyPercent}%` }} /></div><div className="mt-2 flex justify-between text-xs text-text-secondary"><span>{occupancyPercent}% occupied</span><span>{overview.trip?.reservations ?? 0} reservations verified</span></div></Card>
          <Card className="p-5"><h2 className="font-extrabold">Queue summary</h2><div className="mt-4 grid grid-cols-4 divide-x divide-border text-center"><div><p className="text-2xl font-black text-primary-dark">{overview.queueSummary.total}</p><p className="text-[0.65rem] text-text-secondary">Total</p></div><div><p className="text-2xl font-black text-success">{overview.queueSummary.atTerminal}</p><p className="text-[0.65rem] text-text-secondary">At terminal</p></div><div><p className="text-2xl font-black text-info">{overview.queueSummary.incoming}</p><p className="text-[0.65rem] text-text-secondary">Incoming</p></div><div><p className="text-2xl font-black text-warning">{overview.queueSummary.ready}</p><p className="text-[0.65rem] text-text-secondary">Ready</p></div></div></Card>
        </div>
        <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-extrabold">Recent alerts</h2><BellRing className="h-5 w-5 text-primary" /></div><div className="mt-3 divide-y divide-border">{overview.notifications.length ? overview.notifications.slice(0, 4).map((item) => <AlertItem key={item.id} icon={<BellRing className="h-4 w-4" />} title={formatStatus(item.type)} message={item.message} timestamp={new Date(item.createdAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })} tone="info" />) : <p className="py-8 text-center text-sm text-text-secondary">No recent driver alerts.</p>}</div></Card>
      </div>
      <Link to={overview.assignment?.status === 'pending' ? '/driver/assignment' : '/driver/queue'} className="flex min-h-touch items-center justify-center rounded-control bg-primary px-5 text-sm font-extrabold text-white">{overview.assignment?.status === 'pending' ? 'View assignment' : 'View queue & occupancy'}</Link>
    </div>
  );
}

export function DriverAssignmentPage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  const [rejectOpen, setRejectOpen] = useState(false);
  const toast = useToast();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'No driver assignment was found.'} retry={() => void refresh()} />;
  if (!overview.assignment || !overview.trip) return <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No active assignment" description="New trip assignments will appear here." />;
  const assignmentId = overview.assignment.id;

  async function respond(accept: boolean) {
    const updated = await mutate(`/driver/assignments/${assignmentId}/${accept ? 'accept' : 'reject'}`, { method: 'POST' });
    if (updated) { setRejectOpen(false); toast.success(accept ? 'Assignment accepted.' : 'Assignment rejected and advanced.'); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Trip assignment</p><h2 className="mt-1 text-2xl font-black">Naga → {overview.vehicle.route}</h2></div><StatusBadge tone={tone(overview.assignment.status)}>{formatStatus(overview.assignment.status)}</StatusBadge></div><dl className="mt-6 divide-y divide-border text-sm"><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Van ID</dt><dd className="font-bold">{overview.vehicle.vanId}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Assigned departure</dt><dd className="text-right font-bold">{departure(overview.trip.departureTime)}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Boarding terminal</dt><dd className="text-right font-bold">Naga City East Bound Terminal</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Seats filled</dt><dd className="font-bold">{overview.trip.occupancy} / {overview.vehicle.capacity}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Estimated travel time</dt><dd className="font-bold">{Math.floor(overview.trip.estimatedTravelMinutes / 60)}h {overview.trip.estimatedTravelMinutes % 60}m</dd></div></dl>{overview.assignment.status === 'pending' ? <div className="mt-5 grid grid-cols-2 gap-3"><Button loading={loading} onClick={() => void respond(true)} leadingIcon={<Check className="h-5 w-5" />}>Accept trip</Button><Button variant="danger" onClick={() => setRejectOpen(true)} leadingIcon={<X className="h-5 w-5" />}>Reject trip</Button></div> : <Link to="/driver/queue" className="mt-5 flex min-h-touch items-center justify-center rounded-control bg-primary px-4 text-sm font-extrabold text-white">Continue to queue</Link>}</Card>
      <Card className="flex gap-3 border-warning/30 bg-warning-soft p-4"><Clock3 className="h-5 w-5 shrink-0 text-warning" /><p className="text-sm leading-6"><strong>Response deadline:</strong> {new Date(overview.assignment.responseDeadline).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}. Rejecting automatically advances the assignment to the next eligible van.</p></Card>
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <ConfirmationDialog open={rejectOpen} title="Reject this assignment?" description="UVGo will advance the trip to the next eligible vehicle in the queue." confirmLabel="Reject trip" destructive onClose={() => setRejectOpen(false)} onConfirm={() => void respond(false)}><p className="text-sm text-text-secondary">This response is recorded in the dispatch log and cannot be changed from the driver app.</p></ConfirmationDialog>
    </div>
  );
}

export function DriverQueuePage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  const [count, setCount] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const toast = useToast();
  const manifest = useMemo(() => overview?.trip?.manifest.filter((entry) => `${entry.reference} ${entry.passengerName} ${entry.seats.join(' ')}`.toLowerCase().includes(search.toLowerCase())) ?? [], [overview?.trip?.manifest, search]);
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'Queue data was not found.'} retry={() => void refresh()} />;
  const currentOccupancy = overview.trip?.occupancy ?? 0;

  async function saveOccupancy() {
    const submittedCount = count === '' ? currentOccupancy : count;
    const updated = await mutate('/driver/occupancy', { method: 'POST', body: JSON.stringify({ count: submittedCount }) });
    if (updated) toast.success(`Passenger occupancy updated to ${submittedCount}.`);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-4"><Card className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs text-text-secondary">Current route</p><h2 className="mt-1 text-2xl font-black">Naga → {overview.vehicle.route}</h2><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.protocol} protocol</p></div><div className="text-right"><p className="text-xs text-text-secondary">Queue</p><p className="text-4xl font-black text-primary-dark">#{overview.queue?.position ?? '—'}</p></div></div><div className="mt-5 grid grid-cols-4 gap-1" aria-label="Queue progress"><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span><p className="mt-1 text-[0.65rem]">Queued</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span><p className="mt-1 text-[0.65rem]">Terminal</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-bold">3</span><p className="mt-1 text-[0.65rem]">Ready</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-bold">4</span><p className="mt-1 text-[0.65rem]">Departed</p></div></div></Card>
        <Card className="p-5"><h2 className="font-extrabold">Passenger occupancy</h2><p className="mt-1 text-sm text-text-secondary">Submit the actual onboard count. Maximum: {overview.vehicle.capacity}.</p><div className="mt-4 flex items-end gap-3"><Input label="Passengers onboard" type="number" min={0} max={overview.vehicle.capacity} value={count === '' ? overview.trip?.occupancy ?? 0 : count} onChange={(event) => setCount(event.target.value === '' ? '' : Number(event.target.value))} /><Button loading={loading} disabled={count !== '' && (count < 0 || count > overview.vehicle.capacity)} onClick={() => void saveOccupancy()}>Update</Button></div><div className="mt-4 h-2 overflow-hidden rounded-pill bg-border"><div className="h-full rounded-pill bg-primary" style={{ width: `${Math.min(100, (((count === '' ? overview.trip?.occupancy ?? 0 : count) / overview.vehicle.capacity) * 100))}%` }} /></div><p className="mt-2 text-xs text-text-secondary">{overview.vehicle.protocol === 'Taya' ? 'Taya becomes ready only at 100% occupancy.' : 'Goso departure remains schedule-based regardless of occupancy.'}</p>{error ? <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}</Card>
      </div>
      <Card className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Boarding verification</p><h2 className="mt-1 text-xl font-black">Confirmed passenger manifest</h2></div><div className="w-full sm:max-w-xs"><Input label="Find passenger, seat, or reference" value={search} onChange={(event) => setSearch(event.target.value)} leadingIcon={<Search className="h-4 w-4" />} /></div></div><div className="mt-4 space-y-2">{manifest.length ? manifest.map((entry) => <div key={entry.reference} className="flex items-center justify-between gap-3 rounded-control border border-border p-3"><div><p className="font-bold">{entry.passengerName}</p><p className="mt-1 text-xs text-text-secondary">{entry.reference} · Seat {entry.seats.join(', ')}</p></div><StatusBadge tone="success">Verified</StatusBadge></div>) : <p className="rounded-control bg-cream px-4 py-10 text-center text-sm text-text-secondary">No confirmed passenger matches this search.</p>}</div><p className="mt-4 flex gap-2 text-xs leading-5 text-text-secondary"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />Payment details are hidden from the driver manifest.</p></Card>
    </div>
  );
}

export function DriverTripPage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'Trip progress was not found.'} retry={() => void refresh()} />;
  const arrived = ['at_terminal', 'waiting', 'loading', 'ready_for_dispatch'].includes(overview.vehicle.status);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      <Card className="overflow-hidden"><div className="bg-gradient-to-br from-primary-soft to-white p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Operational zone</p><h2 className="mt-1 text-2xl font-black">NCEBT Active Zone</h2><p className="mt-2 text-sm text-text-secondary">Status-only driver view · no continuous GPS map</p></div><span className={cn('rounded-pill px-3 py-1 text-xs font-bold', overview.vehicle.insideActiveZone ? 'bg-success text-white' : 'bg-cream text-text-secondary')}>{overview.vehicle.insideActiveZone ? 'INSIDE' : 'OUTSIDE'}</span></div><div className="mt-6 flex items-center gap-4 rounded-card border border-primary/20 bg-white p-4"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white"><Navigation className="h-6 w-6" /></span><div><p className="font-extrabold">{overview.vehicle.insideActiveZone ? 'Inside 5 km radius' : 'Outside Active Zone'}</p><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.vanId} · Naga → {overview.vehicle.route}</p></div></div></div><div className="p-5 sm:p-6"><h3 className="font-extrabold">Trip progress</h3><div className="mt-4 space-y-0"><TimelineItem complete={overview.vehicle.goOnTripEnabled} label="Go on Trip enabled" /><TimelineItem complete={overview.vehicle.insideActiveZone} label="Entered Active Zone" /><TimelineItem complete={arrived} label="Arrived at terminal" current={overview.vehicle.insideActiveZone && !arrived} /><TimelineItem complete={overview.startEligibility.allowed} label="Ready to start" current={arrived && !overview.startEligibility.allowed} /><TimelineItem complete={overview.vehicle.status === 'on_trip'} label="Trip started" /></div></div></Card>
      <div className="space-y-4"><Card className="p-5"><h2 className="text-xl font-black">Departure controls</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Every transition is rechecked by the server before the trip state changes.</p><div className="mt-5 space-y-3"><Button fullWidth disabled={!overview.vehicle.goOnTripEnabled || !overview.vehicle.insideActiveZone} loading={loading} onClick={() => void mutate('/driver/trip/arrive', { method: 'POST' })} leadingIcon={<MapPin className="h-5 w-5" />}>Arrived at terminal</Button><Button fullWidth variant="outline" disabled={!overview.startEligibility.allowed} loading={loading} onClick={() => void mutate('/driver/trip/start', { method: 'POST' })} leadingIcon={<Play className="h-5 w-5" />}>Start trip</Button></div><p className={cn('mt-4 rounded-control p-3 text-sm leading-5', overview.startEligibility.allowed ? 'bg-success-soft text-success' : 'bg-info-soft text-info')}>{overview.startEligibility.reason}</p>{error ? <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}</Card><Card className="p-5"><h3 className="font-extrabold">Trip details</h3><dl className="mt-3 divide-y divide-border text-sm"><div className="flex justify-between py-3"><dt className="text-text-secondary">Departure</dt><dd className="font-bold">{overview.trip ? departure(overview.trip.departureTime) : 'Not assigned'}</dd></div><div className="flex justify-between py-3"><dt className="text-text-secondary">Occupancy</dt><dd className="font-bold">{overview.trip?.occupancy ?? 0} / {overview.vehicle.capacity}</dd></div><div className="flex justify-between py-3"><dt className="text-text-secondary">Protocol</dt><dd className="font-bold">{overview.vehicle.protocol}</dd></div></dl></Card></div>
    </div>
  );
}

function TimelineItem({ label, complete, current = false }: { label: string; complete: boolean; current?: boolean }) {
  return <div className="relative flex min-h-12 gap-3 pl-1"><span className={cn('relative z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-white', complete ? 'border-success text-success' : current ? 'border-primary text-primary' : 'border-border-strong text-text-muted')}>{complete ? <Check className="h-3 w-3" /> : current ? <CircleDot className="h-3 w-3" /> : null}</span><span className={cn('pb-5 text-sm font-semibold', complete ? 'text-success' : current ? 'text-primary-dark' : 'text-text-secondary')}>{label}</span></div>;
}

export function DriverMorePage() {
  return <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2"><Link to="/driver/setup" className="rounded-card border border-border bg-white p-5 shadow-card"><MapPin className="h-6 w-6 text-primary" /><h2 className="mt-3 font-extrabold">Driver setup</h2><p className="mt-1 text-sm text-text-secondary">Vehicle, route, terminal, and Go on Trip.</p></Link><Link to="/driver/queue" className="rounded-card border border-border bg-white p-5 shadow-card"><UsersRound className="h-6 w-6 text-primary" /><h2 className="mt-3 font-extrabold">Occupancy & manifest</h2><p className="mt-1 text-sm text-text-secondary">Update passenger count and verify boarding.</p></Link></div>;
}
