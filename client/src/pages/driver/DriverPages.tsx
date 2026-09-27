import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  BusFront,
  CalendarClock,
  Check,
  CheckCircle2,
  CheckCheck,
  CircleDot,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useDriverNotifications, useDriverOverview } from '../../hooks/useDriverOverview';
import { setDriverLocationTracking } from '../../hooks/useDriverLocationTracking';
import type { DriverNotification, DriverOverview, DriverScheduleAssignment } from '../../types/driver';
import { cn } from '../../lib/cn';
import { AlertItem, Button, Card, ConfirmationDialog, EmptyState, Input, LoadingSkeleton, StatusBadge, Toggle, useToast } from '../../components/ui';
import { ApiError, apiRequest } from '../../api/http';
import { formatDateTime12, formatTime12 } from '../../lib/dateTime';

function formatStatus(status: string) {
  if (status === 'accepted') return 'Assigned';
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function departure(value: string) {
  return formatDateTime12(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

function tone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (['accepted', 'ready_for_dispatch', 'at_terminal', 'confirmed'].includes(status)) return 'success';
  if (['pending', 'loading', 'waiting', 'departure_pending'].includes(status)) return 'warning';
  if (['rejected', 'cancelled', 'delayed', 'departure_review'].includes(status)) return 'danger';
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
    if (updated) {
      setDriverLocationTracking(enabled);
      toast.success(`Go on Trip ${enabled ? 'enabled' : 'disabled'}.`);
    }
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
        <div className="mt-4 flex items-center justify-between gap-4 rounded-control border border-border p-4">
          <p className="font-extrabold text-primary-dark">Go on Trip</p>
          <Toggle checked={overview.vehicle.goOnTripEnabled} onChange={(enabled) => void setEnabled(enabled)} label="Go on Trip" />
        </div>
        {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        <Button className="mt-5" fullWidth size="lg" disabled={!overview.vehicle.goOnTripEnabled} onClick={() => navigate('/driver/dashboard')} leadingIcon={<CheckCircle2 className="h-5 w-5" />}>Confirm setup</Button>
      </Card>
      <Card className="flex items-center gap-4 bg-primary-soft/50 p-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary"><MapPin className="h-6 w-6" /></span><div><p className="font-bold">Location confirmation</p><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.insideTerminalZone ? overview.vehicle.protocol === 'Taya' ? 'Terminal arrival confirmed. Your planned Taya queue position is unchanged.' : 'Terminal arrival confirmed and queue timestamp recorded.' : overview.vehicle.insideActiveZone ? `Incoming · terminal confirmation ${overview.departureConfirmation.terminalEntrySamples}/${overview.departureConfirmation.requiredSamples}.` : 'Outside the terminal’s 5 km Active Zone.'}</p></div></Card>
    </div>
  );
}

export function DriverDashboardPage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  const [deletingNotification, setDeletingNotification] = useState<DriverOverview['notifications'][number] | null>(null);
  const toast = useToast();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'No driver overview was found.'} retry={() => void refresh()} />;
  const occupancyPercent = overview.trip ? Math.round((overview.trip.occupancy / overview.vehicle.capacity) * 100) : 0;
  const hasVisibleAssignment = overview.assignments.length > 0;

  async function confirmDeleteNotification() {
    if (!deletingNotification || loading) return;
    const notification = deletingNotification;
    const updated = await mutate(`/driver/notifications/${encodeURIComponent(notification.id)}`, { method: 'DELETE' });
    if (updated) {
      setDeletingNotification(null);
      window.dispatchEvent(new Event('uvgo:driver-notifications-changed'));
      toast.success('Notification deleted.');
    }
  }

  return (
    <div className="space-y-4">
      {overview.departureConfirmation.authorized ? <Card className="flex items-start gap-3 border-warning/30 bg-warning-soft p-4"><Navigation className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><p className="font-extrabold">Departure authorized</p><p className="mt-1 text-sm text-text-secondary">Keep GPS active while leaving through the terminal exit. Confirmation progress: {overview.departureConfirmation.terminalExitSamples}/{overview.departureConfirmation.requiredSamples} reliable outward samples.</p></div></Card> : null}
      {overview.departureConfirmation.reviewRequired ? <Card className="flex items-start gap-3 border-danger/30 bg-danger-soft p-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" /><div><p className="font-extrabold text-danger">Dispatcher review required</p><p className="mt-1 text-sm text-text-secondary">{overview.departureConfirmation.reviewReason ?? 'The location transition could not safely confirm departure.'}</p></div></Card> : null}
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Today's Queue Status</p><h2 className="mt-1 text-xl font-black">{overview.todayQueueStatus.policy} policy</h2></div><StatusBadge tone={tone(overview.todayQueueStatus.status)}>{formatStatus(overview.todayQueueStatus.status)}</StatusBadge></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-control bg-cream p-3"><dt className="text-xs text-text-secondary">Queue position</dt><dd className="mt-1 text-lg font-black">{overview.todayQueueStatus.queuePosition ? `#${overview.todayQueueStatus.queuePosition}` : '—'}</dd></div>
          {overview.todayQueueStatus.policy === 'GOSO' ? <div className="rounded-control bg-cream p-3"><dt className="text-xs text-text-secondary">Loading / Departure</dt><dd className="mt-1 font-bold">{overview.todayQueueStatus.scheduledLoadingTime ? formatTime12(overview.todayQueueStatus.scheduledLoadingTime) : '—'} / {overview.todayQueueStatus.scheduledDepartureTime ? formatTime12(overview.todayQueueStatus.scheduledDepartureTime) : '—'}</dd></div> : null}
          <div className="rounded-control bg-cream p-3"><dt className="text-xs text-text-secondary">Terminal status</dt><dd className="mt-1 font-bold">{overview.todayQueueStatus.terminalStatus === 'inside_100m_geofence' ? 'Inside 100-meter geofence' : 'Outside 100-meter geofence'}</dd></div>
          <div className="rounded-control bg-cream p-3"><dt className="text-xs text-text-secondary">Passengers</dt><dd className="mt-1 font-bold">{overview.todayQueueStatus.passengerCount} / {overview.todayQueueStatus.capacity}</dd></div>
        </dl>
      </Card>
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary-dark to-primary p-5 text-white shadow-floating sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs text-white/70">Current status</p><h2 className="mt-1 text-2xl font-black text-white">{formatStatus(overview.vehicle.status)}</h2><div className="mt-5 space-y-2 text-sm text-white/90"><p className="flex items-center gap-2"><Route className="h-4 w-4" />Naga → {overview.vehicle.route}</p><p className="flex items-center gap-2"><UsersRound className="h-4 w-4" />{overview.trip?.occupancy ?? 0} / {overview.vehicle.capacity} passengers</p><p className="flex items-center gap-2"><UserRound className="h-4 w-4" />Dispatcher: {overview.dispatcher?.name ?? 'On duty'}</p></div></div><div className="text-right"><p className="text-xs text-white/70">Queue position</p><p className="text-5xl font-black">#{overview.queue?.position ?? '—'}</p><div className="mt-5 flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-primary-dark"><BusFront className="h-10 w-10" /></div></div></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4"><Card className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-bold">Trip readiness</p><p className="mt-1 text-xs text-text-secondary">{overview.assignment ? `Assignment ${formatStatus(overview.assignment.status)}` : 'No active assignment'}</p></div>{overview.assignment ? <StatusBadge tone={tone(overview.assignment.status)}>{formatStatus(overview.assignment.status)}</StatusBadge> : null}</div><div className="mt-4 h-2 overflow-hidden rounded-pill bg-border"><div className="h-full rounded-pill bg-primary" style={{ width: `${occupancyPercent}%` }} /></div><div className="mt-2 flex justify-between text-xs text-text-secondary"><span>{occupancyPercent}% occupied</span><span>{overview.trip?.reservations ?? 0} reservations verified</span></div></Card>
          <Card className="p-5"><h2 className="font-extrabold">Queue summary</h2><div className="mt-4 grid grid-cols-4 divide-x divide-border text-center"><div><p className="text-2xl font-black text-primary-dark">{overview.queueSummary.total}</p><p className="text-[0.65rem] text-text-secondary">Total</p></div><div><p className="text-2xl font-black text-success">{overview.queueSummary.atTerminal}</p><p className="text-[0.65rem] text-text-secondary">At terminal</p></div><div><p className="text-2xl font-black text-info">{overview.queueSummary.incoming}</p><p className="text-[0.65rem] text-text-secondary">Incoming</p></div><div><p className="text-2xl font-black text-warning">{overview.queueSummary.ready}</p><p className="text-[0.65rem] text-text-secondary">Ready</p></div></div></Card>
        </div>
        <Card className="p-5"><div className="flex items-center justify-between"><h2 className="font-extrabold">Recent alerts</h2><BellRing className="h-5 w-5 text-primary" /></div><div className="mt-3 divide-y divide-border">{overview.notifications.length ? overview.notifications.slice(0, 4).map((item) => <AlertItem key={item.id} icon={<BellRing className="h-4 w-4" />} title={item.type === 'system' ? 'Dispatcher announcement' : formatStatus(item.type)} message={item.message} timestamp={formatTime12(item.createdAt)} tone={item.type === 'system' ? 'warning' : 'info'} action={<Button variant="ghost" size="sm" disabled={loading} onClick={() => setDeletingNotification(item)} leadingIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>} />) : <p className="py-8 text-center text-sm text-text-secondary">No recent driver alerts.</p>}</div></Card>
      </div>
      <Link to={hasVisibleAssignment ? '/driver/assignment' : '/driver/queue'} className="flex min-h-touch items-center justify-center rounded-control bg-primary px-5 text-sm font-extrabold text-white">{hasVisibleAssignment ? 'View all assignments' : 'View queue & occupancy'}</Link>
      <ConfirmationDialog open={Boolean(deletingNotification)} title="Delete this notification?" description="This removes the notification permanently from your driver account." confirmLabel="Delete notification" destructive loading={Boolean(deletingNotification && loading)} onClose={() => { if (!loading) setDeletingNotification(null); }} onConfirm={() => void confirmDeleteNotification()} />
    </div>
  );
}

export function DriverNotificationsPage() {
  const { notifications, setNotifications, loading, error, refresh } = useDriverNotifications();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [deleting, setDeleting] = useState<DriverNotification | null>(null);
  const toast = useToast();
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  function notificationStateChanged() {
    window.dispatchEvent(new Event('uvgo:driver-notifications-changed'));
  }

  async function markRead(item: DriverNotification) {
    if (item.isRead || workingId) return;
    setWorkingId(item.id);
    try {
      await apiRequest(`/driver/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' });
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry));
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
      await apiRequest('/driver/notifications/read-all', { method: 'PATCH' });
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
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
      await apiRequest(`/driver/notifications/${encodeURIComponent(notification.id)}`, { method: 'DELETE' });
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
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

  if (loading && !notifications.length) return <DriverLoading />;
  if (error && !notifications.length) return <DriverError message={error} retry={() => void refresh()} />;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="hidden lg:block"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Driver</p><h2 className="mt-1 text-2xl font-black">Notifications</h2><p className="mt-1 text-sm text-text-secondary">{unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'You are all caught up.'}</p></div>
        {notifications.length ? <Button className="ml-auto" variant="outline" disabled={!unreadCount} loading={markingAll} onClick={() => void markAllRead()} leadingIcon={<CheckCheck className="h-4 w-4" />}>Mark all as read</Button> : null}
      </div>
      {error ? <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      {notifications.length ? (
        <Card padded={false} className="divide-y divide-border overflow-hidden">
          {notifications.map((item) => (
            <article key={item.id} className={`flex flex-col gap-4 p-4 transition-colors sm:flex-row sm:items-start sm:p-5 ${item.isRead ? 'bg-surface' : 'bg-primary-soft/45'}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.isRead ? 'bg-cream text-text-secondary' : 'bg-primary text-white'}`}><Bell className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><p className={item.isRead ? 'font-medium text-text-secondary' : 'font-bold'}>{item.message}</p>{!item.isRead ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}</div>
                <p className="mt-1 text-xs text-text-secondary">{formatDateTime12(item.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })} · {formatStatus(item.type)} · {item.isRead ? 'Read' : 'Unread'}</p>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-1">
                {!item.isRead ? <Button variant="ghost" size="sm" loading={workingId === item.id} disabled={Boolean(workingId && workingId !== item.id)} onClick={() => void markRead(item)} leadingIcon={<CheckCheck className="h-4 w-4" />}>Mark as read</Button> : null}
                <Button variant="danger" size="sm" disabled={Boolean(workingId)} onClick={() => setDeleting(item)} leadingIcon={<Trash2 className="h-4 w-4" />}>Delete</Button>
              </div>
            </article>
          ))}
        </Card>
      ) : <EmptyState icon={<Bell className="h-6 w-6" />} title="No notifications" description="Trip assignments, dispatcher announcements, and operational updates will appear here." />}
      <ConfirmationDialog open={Boolean(deleting)} title="Delete this notification?" description="This removes the notification permanently from your driver account." confirmLabel="Delete notification" destructive loading={Boolean(deleting && workingId === deleting.id)} onClose={() => { if (!workingId) setDeleting(null); }} onConfirm={() => void confirmDelete()} />
    </div>
  );
}

export function DriverAssignmentPage() {
  const { overview, loading, error, refresh, mutate } = useDriverOverview();
  const [cancelAssignment, setCancelAssignment] = useState<DriverScheduleAssignment | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const toast = useToast();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'No driver assignment was found.'} retry={() => void refresh()} />;
  if (!overview.assignments.length) return <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No active assignments" description="All of your upcoming trip schedules will appear here." />;
  const acceptedCount = overview.assignments.filter((assignment) => assignment.status === 'accepted').length;

  async function cancelSchedule() {
    if (!cancelAssignment) return;
    const updated = await mutate(`/driver/assignments/${cancelAssignment.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancelReason }) });
    if (updated) {
      setCancelAssignment(null);
      setCancelReason('');
      toast.success('Assignment cancelled. The dispatcher will handle any required replacement.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">My assignments</p><h1 className="mt-1 text-2xl font-black">All trip schedules</h1></div>
          <span className="rounded-pill bg-success-soft px-3 py-1 text-xs font-bold text-success">{acceptedCount} assigned</span>
        </div>
      </Card>
      {overview.assignments.map((item, index) => {
        const isCurrent = item.id === overview.assignment?.id;
        return (
          <Card key={item.id} className={cn('p-5 sm:p-6', isCurrent && 'border-primary/40 shadow-floating')}>
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Schedule {index + 1}</p>{isCurrent ? <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-[0.65rem] font-extrabold uppercase tracking-wide text-primary-dark">Current</span> : null}</div><h2 className="mt-1 text-xl font-black sm:text-2xl">Naga → {overview.vehicle.route}</h2><p className="mt-1 text-xs text-text-secondary">{overview.vehicle.vanId} · {overview.vehicle.plateNo}</p></div>
              <StatusBadge tone={tone(item.status)}>{formatStatus(item.status)}</StatusBadge>
            </div>
            <dl className="mt-5 divide-y divide-border text-sm">
              {overview.vehicle.protocol === 'Goso' ? <><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Passenger loading</dt><dd className="text-right font-bold">{departure(item.trip.boardingStartTime)}{item.trip.loadingOpen ? <span className="ml-2 rounded-pill bg-success-soft px-2 py-0.5 text-xs font-bold text-success">Open</span> : null}</dd></div><div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Departure</dt><dd className="text-right font-bold">{departure(item.trip.departureTime)}</dd></div></> : null}
              <div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Boarding terminal</dt><dd className="text-right font-bold">Naga City East Bound Terminal</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Passenger seats</dt><dd className="font-bold">{item.trip.occupancy} / {overview.vehicle.capacity}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-text-secondary">Trip status</dt><dd className="font-bold">{formatStatus(item.trip.status)}</dd></div>
            </dl>
            <div className={cn('mt-4 grid gap-3', isCurrent && 'sm:grid-cols-2')}>{isCurrent ? <Link to="/driver/queue" className="flex min-h-touch items-center justify-center rounded-control bg-primary px-4 text-sm font-extrabold text-white">Continue to queue</Link> : null}<Button variant="danger" loading={loading} onClick={() => setCancelAssignment(item)} leadingIcon={<X className="h-5 w-5" />}>Cancel assignment</Button></div>
          </Card>
        );
      })}
      {error ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
      <ConfirmationDialog open={Boolean(cancelAssignment)} title="Cancel this assignment?" description={cancelAssignment ? `${overview.vehicle.protocol === 'Goso' ? `The ${departure(cancelAssignment.trip.departureTime)} schedule` : 'This Taya queue assignment'} will be removed from your active queue. UVGo will transfer it when another eligible driver is available.` : ''} confirmLabel="Cancel assignment" destructive loading={loading} onClose={() => { setCancelAssignment(null); setCancelReason(''); }} onConfirm={() => void cancelSchedule()}><Input label="Reason (optional)" value={cancelReason} maxLength={500} onChange={(event) => setCancelReason(event.target.value)} placeholder="For example: vehicle issue or personal emergency" hint="The dispatcher will see this reason in the audit log." /></ConfirmationDialog>
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
  const canUpdateOccupancy = overview.occupancyEligibility.allowed;

  async function saveOccupancy() {
    const submittedCount = count === '' ? currentOccupancy : count;
    const updated = await mutate('/driver/occupancy', { method: 'POST', body: JSON.stringify({ count: submittedCount }) });
    if (updated) toast.success(`Passenger occupancy updated to ${submittedCount}.`);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-4"><Card className="p-5"><div className="flex items-start justify-between"><div><p className="text-xs text-text-secondary">Current route</p><h2 className="mt-1 text-2xl font-black">Naga → {overview.vehicle.route}</h2><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.protocol} protocol</p></div><div className="text-right"><p className="text-xs text-text-secondary">Queue</p><p className="text-4xl font-black text-primary-dark">#{overview.queue?.position ?? '—'}</p></div></div><div className="mt-5 grid grid-cols-4 gap-1" aria-label="Queue progress"><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span><p className="mt-1 text-[0.65rem]">Queued</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span><p className="mt-1 text-[0.65rem]">Terminal</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-bold">3</span><p className="mt-1 text-[0.65rem]">Ready</p></div><div className="text-center"><span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-border text-xs font-bold">4</span><p className="mt-1 text-[0.65rem]">Departed</p></div></div></Card>
        <Card className="p-5"><h2 className="font-extrabold">Passenger occupancy</h2><div className="mt-4 flex items-end gap-3"><Input label="Passengers onboard" type="number" min={0} max={overview.vehicle.capacity} disabled={!canUpdateOccupancy} value={count === '' ? overview.trip?.occupancy ?? 0 : count} onChange={(event) => setCount(event.target.value === '' ? '' : Number(event.target.value))} /><Button loading={loading} disabled={!canUpdateOccupancy || (count !== '' && (count < 0 || count > overview.vehicle.capacity))} onClick={() => void saveOccupancy()}>Update</Button></div><p className={cn('mt-3 rounded-control p-3 text-sm', canUpdateOccupancy ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>{overview.occupancyEligibility.reason}</p><div className="mt-4 h-2 overflow-hidden rounded-pill bg-border"><div className="h-full rounded-pill bg-primary" style={{ width: `${Math.min(100, (((count === '' ? overview.trip?.occupancy ?? 0 : count) / overview.vehicle.capacity) * 100))}%` }} /></div>{error ? <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}</Card>
      </div>
      <Card className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Boarding verification</p><h2 className="mt-1 text-xl font-black">Confirmed passenger manifest</h2></div><div className="w-full sm:max-w-xs"><Input label="Find passenger, seat, or reference" value={search} onChange={(event) => setSearch(event.target.value)} leadingIcon={<Search className="h-4 w-4" />} /></div></div><div className="mt-4 space-y-2">{manifest.length ? manifest.map((entry) => <div key={entry.reference} className="flex items-center justify-between gap-3 rounded-control border border-border p-3"><div><p className="font-bold">{entry.passengerName}</p><p className="mt-1 text-xs text-text-secondary">{entry.reference} · Seat {entry.seats.join(', ')}</p></div><StatusBadge tone="success">Verified</StatusBadge></div>) : <p className="rounded-control bg-cream px-4 py-10 text-center text-sm text-text-secondary">No confirmed passenger matches this search.</p>}</div></Card>
    </div>
  );
}

export function DriverTripPage() {
  const { overview, loading, error, refresh } = useDriverOverview();
  if (loading && !overview) return <DriverLoading />;
  if (!overview) return <DriverError message={error ?? 'Trip progress was not found.'} retry={() => void refresh()} />;
  const arrived = overview.vehicle.insideTerminalZone;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      {overview.departureConfirmation.reviewRequired ? <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm leading-5 text-danger lg:col-span-2">{overview.departureConfirmation.reviewReason}</p> : null}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary-soft to-white p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Operational zones</p><h2 className="mt-1 text-2xl font-black">NCEBT geofence</h2><p className="mt-2 text-sm text-text-secondary">5 km incoming zone and a shared terminal circle for arrival, loading attendance and exit confirmation.</p></div><span className={cn('rounded-pill px-3 py-1 text-xs font-bold', overview.vehicle.insideActiveZone ? 'bg-success text-white' : 'bg-cream text-text-secondary')}>{overview.vehicle.insideActiveZone ? 'ACTIVE' : 'OUTSIDE'}</span></div>
          <div className="mt-6 flex items-center gap-4 rounded-card border border-primary/20 bg-white p-4"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white"><Navigation className="h-6 w-6" /></span><div><p className="font-extrabold">{arrived ? 'Terminal presence confirmed' : overview.vehicle.insideActiveZone ? 'Incoming to terminal' : 'Outside Active Zone'}</p><p className="mt-1 text-sm text-text-secondary">{overview.vehicle.vanId} · Naga → {overview.vehicle.route}</p>{overview.departureConfirmation.latestAccuracyMeters !== null ? <p className="mt-1 text-xs text-text-muted">Latest GPS accuracy ±{Math.round(overview.departureConfirmation.latestAccuracyMeters)} m</p> : null}</div></div>
        </div>
        <div className="p-5 sm:p-6"><h3 className="font-extrabold">Trip progress</h3><div className="mt-4 space-y-0"><TimelineItem complete={overview.vehicle.insideActiveZone} label="Entered 5 km Active Zone" /><TimelineItem complete={arrived} label={`Terminal arrival confirmed (${overview.departureConfirmation.requiredSamples} samples)`} current={overview.vehicle.insideActiveZone && !arrived} /><TimelineItem complete={overview.vehicle.status === 'on_trip'} label="Terminal exit confirmed" current={arrived && overview.vehicle.status !== 'on_trip'} /></div></div>
      </Card>
      <div className="space-y-4">
        <Card className="p-5"><h3 className="font-extrabold">Trip details</h3><dl className="mt-3 divide-y divide-border text-sm"><div className="flex justify-between py-3"><dt className="text-text-secondary">Departure</dt><dd className="font-bold">{overview.trip ? departure(overview.trip.departureTime) : 'Not assigned'}</dd></div><div className="flex justify-between py-3"><dt className="text-text-secondary">Occupancy</dt><dd className="font-bold">{overview.trip?.occupancy ?? 0} / {overview.vehicle.capacity}</dd></div><div className="flex justify-between py-3"><dt className="text-text-secondary">Protocol</dt><dd className="font-bold">{overview.vehicle.protocol}</dd></div><div className="flex justify-between py-3"><dt className="text-text-secondary">Exit samples</dt><dd className="font-bold">{overview.departureConfirmation.terminalExitSamples} / {overview.departureConfirmation.requiredSamples}</dd></div></dl></Card>
      </div>
    </div>
  );
}

function TimelineItem({ label, complete, current = false }: { label: string; complete: boolean; current?: boolean }) {
  return <div className="relative flex min-h-12 gap-3 pl-1"><span className={cn('relative z-10 mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-white', complete ? 'border-success text-success' : current ? 'border-primary text-primary' : 'border-border-strong text-text-muted')}>{complete ? <Check className="h-3 w-3" /> : current ? <CircleDot className="h-3 w-3" /> : null}</span><span className={cn('pb-5 text-sm font-semibold', complete ? 'text-success' : current ? 'text-primary-dark' : 'text-text-secondary')}>{label}</span></div>;
}

export function DriverMorePage() {
  return <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2"><Link to="/driver/profile" className="rounded-card border border-border bg-white p-5 shadow-card"><UserRound className="h-6 w-6 text-primary" /><h2 className="mt-3 font-extrabold">My profile</h2><p className="mt-1 text-sm text-text-secondary">Update your name, email, phone number, or password.</p></Link><Link to="/driver/setup" className="rounded-card border border-border bg-white p-5 shadow-card"><MapPin className="h-6 w-6 text-primary" /><h2 className="mt-3 font-extrabold">Driver setup</h2><p className="mt-1 text-sm text-text-secondary">Vehicle, route, terminal, and Go on Trip.</p></Link><Link to="/driver/queue" className="rounded-card border border-border bg-white p-5 shadow-card"><UsersRound className="h-6 w-6 text-primary" /><h2 className="mt-3 font-extrabold">Occupancy & manifest</h2><p className="mt-1 text-sm text-text-secondary">Update passenger count and verify boarding.</p></Link></div>;
}
