import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  BusFront,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Search,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertItem,
  Button,
  Card,
  CardHeader,
  ConfirmationDialog,
  Input,
  MetricCard,
  QueueRow,
  Select,
  StatusBadge,
  Stepper,
  Tabs,
  Toggle,
} from '../../components/ui';
import type { AppRole } from '../../components/layout';

interface RoleFoundationPageProps {
  role: AppRole;
}

const bookingSteps = [
  { id: 'search', label: 'Search Trip' },
  { id: 'seat', label: 'Select Seat' },
  { id: 'passenger', label: 'Passenger Info' },
  { id: 'confirm', label: 'Confirm' },
];

function PassengerPreview() {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
      <Card elevated>
        <CardHeader title="Goa reservation pattern" description="Only Goa is bookable in the UVGo prototype." />
        <Stepper steps={bookingSteps} currentStep={1} />
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <Select label="Route" leadingIcon={<MapPin className="h-4 w-4" />} defaultValue="goa">
            <option value="goa">Naga City → Goa</option>
          </Select>
          <Input label="Departure date" type="date" leadingIcon={<CalendarDays className="h-4 w-4" />} />
        </div>
        <Button className="mt-5" fullWidth trailingIcon={<ArrowRight className="h-4 w-4" />}>Search Goa trips</Button>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard label="Upcoming booking" value="1" icon={<CalendarDays className="h-5 w-5" />} trend={{ direction: 'flat', label: 'Goa route', positive: true }} />
        <MetricCard label="Unread notices" value="2" icon={<BellRing className="h-5 w-5" />} trend={{ direction: 'flat', label: 'In-app only' }} />
        <Card className="sm:col-span-2">
          <CardHeader title="Accessible status treatments" />
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="success" dot>Confirmed</StatusBadge>
            <StatusBadge tone="warning" dot>Payment verification pending</StatusBadge>
            <StatusBadge tone="info" dot>Reallocated</StatusBadge>
            <StatusBadge tone="neutral" dot>Unavailable</StatusBadge>
          </div>
        </Card>
      </div>
    </div>
  );
}

function DriverPreview() {
  const [goOnTrip, setGoOnTrip] = useState(true);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary-dark to-primary p-5 text-text-inverse shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white/75">Current status</p>
              <h2 className="mt-1 text-2xl font-extrabold text-white">Waiting in Queue</h2>
              <p className="mt-4 flex items-center gap-2 text-sm text-white/90"><MapPin className="h-4 w-4" /> Naga → Goa</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/75">Queue position</p>
              <p className="text-5xl font-black">#1</p>
            </div>
          </div>
        </Card>
        <Card><div className="flex items-center justify-between gap-4"><div><p className="font-semibold">Go on Trip</p><p className="mt-1 text-xs text-text-secondary">Stays on until the driver turns it off.</p></div><Toggle checked={goOnTrip} onChange={setGoOnTrip} label="Go on Trip" /></div></Card>
      </div>
      <Card elevated>
        <CardHeader title="Recent alerts" />
        <AlertItem icon={<BellRing className="h-4 w-4" />} title="Be ready for dispatch" message="Your queue assignment is active. Cancel it if you cannot make the trip." timestamp="9:28 AM" tone="warning" />
        <AlertItem icon={<UsersRound className="h-4 w-4" />} title="Passenger count updated" message="Occupancy is now 11 of 11 passenger seats." timestamp="9:15 AM" tone="info" />
        <AlertItem icon={<CheckCircle2 className="h-4 w-4" />} title="Reservation list synced" message="Confirmed passenger manifest is available." timestamp="9:02 AM" tone="success" />
      </Card>
    </div>
  );
}

function DispatcherPreview() {
  const [route, setRoute] = useState('goa');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Vans at Terminal" value="18" icon={<BusFront className="h-5 w-5" />} trend={{ direction: 'up', label: '2 vs yesterday', positive: true }} />
        <MetricCard label="Incoming Vans" value="12" icon={<MapPin className="h-5 w-5" />} trend={{ direction: 'down', label: '1 vs yesterday', positive: false }} />
        <MetricCard label="Active Routes" value="2" icon={<CheckCircle2 className="h-5 w-5" />} trend={{ direction: 'flat', label: 'Goa & Legazpi' }} />
        <MetricCard label="Passengers Waiting" value="147" icon={<UsersRound className="h-5 w-5" />} trend={{ direction: 'up', label: '18 vs yesterday', positive: false }} />
        <MetricCard label="Pending GCash" value="5" icon={<WalletCards className="h-5 w-5" />} trend={{ direction: 'down', label: '5 vs yesterday', positive: true }} />
        <MetricCard label="Trips Dispatched" value="36" icon={<Clock3 className="h-5 w-5" />} trend={{ direction: 'up', label: '6 vs yesterday', positive: true }} />
      </div>
      <Card elevated>
        <CardHeader title="Queue component" description="Rows transform from cards on mobile into a dense operational table on desktop." />
        <Tabs
          label="Queue route"
          items={[{ id: 'goa', label: 'Goa', count: 4 }, { id: 'legazpi', label: 'Legazpi', count: 5 }]}
          activeId={route}
          onChange={setRoute}
        />
        <div className="mt-4 space-y-2">
          <QueueRow position={1} vanId="VAN-033" driver="Rodel Reyes" arrival="9:35 AM" occupancy="11/11" status="Ready" statusTone="success" />
          <QueueRow position={2} vanId="VAN-021" driver="Mario Bautista" arrival="9:40 AM" occupancy="8/11" status="Incoming" statusTone="info" />
          <QueueRow position={3} vanId="VAN-019" driver="Pedro Enriquez" arrival="9:50 AM" occupancy="10/11" status="Delayed" statusTone="danger" />
        </div>
      </Card>
    </div>
  );
}

export function RoleFoundationPage({ role }: RoleFoundationPageProps) {
  const location = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const pageName = useMemo(() => {
    const finalSegment = location.pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';
    return finalSegment.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }, [location.pathname]);

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <StatusBadge tone="success" dot>Authenticated shell active</StatusBadge>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            {pageName} is protected for the signed-in {role}. Feature-specific data and actions arrive in their scheduled phase.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" leadingIcon={<Search className="h-4 w-4" />} onClick={() => setDialogOpen(true)}>Preview dialog</Button>
          <Link to="/" className="inline-flex min-h-touch items-center justify-center rounded-control px-5 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-cream hover:text-text-primary">
            All shells
          </Link>
        </div>
      </div>
      {role === 'passenger' ? <PassengerPreview /> : null}
      {role === 'driver' ? <DriverPreview /> : null}
      {role === 'dispatcher' ? <DispatcherPreview /> : null}
      <div className="mt-5 flex items-start gap-3 rounded-card border border-warning/25 bg-warning-soft p-4 text-sm text-text-primary">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <p><strong>Phase 2 preview:</strong> controls are interactive for visual and accessibility testing, but they do not call business APIs yet.</p>
      </div>
      <ConfirmationDialog
        open={dialogOpen}
        title="UVGo confirmation pattern"
        description="Dialogs use the same rounded, restrained visual language and remain keyboard dismissible."
        confirmLabel="Looks good"
        onClose={() => setDialogOpen(false)}
        onConfirm={() => setDialogOpen(false)}
      />
    </>
  );
}
