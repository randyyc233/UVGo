import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  BusFront,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Eye,
  FileClock,
  ListOrdered,
  MapPin,
  MapPinned,
  Maximize2,
  Minus,
  Plus,
  Route,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  UserRoundCog,
  WalletCards,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../../api/http";
import { useAuth } from "../../auth/authContext";
import { DemoControls } from "../../components/dispatcher/DemoControls";
import { DepartureHistory } from "../../components/dispatcher/DepartureHistory";
import { FleetMap } from "../../components/dispatcher/FleetMap";
import { MobileFleetSheet } from "../../components/dispatcher/MobileFleetSheet";
import { formatDateTime12, formatTime12 } from "../../lib/dateTime";
import {
  AlertItem,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  Input,
  LoadingSkeleton,
  Modal,
  Select,
  StatusBadge,
  Tabs,
  useToast,
} from "../../components/ui";
import type {
  DispatchLogEntry,
  DriverAnnouncementResult,
  DriverManagement,
  DispatcherDashboard,
  DispatcherPayment,
  DispatcherPendingArrival,
  DispatcherQueueEntry,
  FleetSnapshot,
} from "../../types/dispatcher";

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function queueStatusLabel(status: string) {
  const labels: Record<string, string> = {
    waiting: "Waiting in queue",
    assigned: "Assignment sent",
    accepted: "In queue",
    ready_for_dispatch: "Ready to dispatch",
    delayed: "Delayed",
  };
  return labels[status] ?? label(status);
}

function assignmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Awaiting driver",
    accepted: "Assigned",
    rejected: "Declined by driver",
    expired: "Response expired",
    cancelled: "Cancelled by driver",
  };
  return labels[status] ?? label(status);
}

function tone(
  value: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (
    [
      "ready_for_dispatch",
      "accepted",
      "verified",
      "captured",
      "confirmed",
      "at_terminal",
    ].includes(value)
  )
    return "success";
  if (
    [
      "pending",
      "pending_verification",
      "waiting",
      "loading",
      "assigned",
      "departure_pending",
    ].includes(value)
  )
    return "warning";
  if (["cancelled", "delayed", "rejected", "replaced", "unavailable", "departure_review"].includes(value))
    return "danger";
  if (["incoming", "assigning"].includes(value)) return "info";
  return "neutral";
}

function time(value: string) {
  return formatDateTime12(value);
}

function fleetLocationLabel(vehicle: FleetSnapshot["vehicles"][number]) {
  if (vehicle.insideTerminalZone) return "Ready for departure";
  if (vehicle.insideActiveZone) return "Within 5 km Active Zone";
  return "Outside 5 km Active Zone";
}

function fleetLocationTone(vehicle: FleetSnapshot["vehicles"][number]): "success" | "info" | "neutral" {
  if (vehicle.insideTerminalZone) return "success";
  if (vehicle.insideActiveZone) return "info";
  return "neutral";
}

function LoadingPanel() {
  return (
    <Card className="p-5">
      <LoadingSkeleton lines={8} />
    </Card>
  );
}

export function DispatcherDashboardPage() {
  const [dashboard, setDashboard] = useState<DispatcherDashboard | null>(null);
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [dashboardResponse, fleetResponse] = await Promise.all([
          apiRequest<{ dashboard: DispatcherDashboard }>(
            "/dispatcher/dashboard",
          ),
          apiRequest<{ fleet: FleetSnapshot }>("/dispatcher/fleet"),
        ]);
        if (active) {
          setDashboard(dashboardResponse.dashboard);
          setFleet(fleetResponse.fleet);
          setError(null);
        }
      } catch (caughtError) {
        if (active)
          setError(
            caughtError instanceof ApiError
              ? caughtError.message
              : "Dispatcher dashboard could not be loaded.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (loading && !dashboard) return <LoadingPanel />;
  if (!dashboard)
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Dashboard unavailable"
        description={error ?? "Try again shortly."}
      />
    );
  const metrics = [
    {
      label: "Vans at Terminal",
      value: dashboard.metrics.vansAtTerminal,
      icon: <BusFront className="h-5 w-5" />,
    },
    {
      label: "Incoming Vans",
      value: dashboard.metrics.incomingVans,
      icon: <MapPin className="h-5 w-5" />,
    },
    {
      label: "Active Routes",
      value: dashboard.metrics.activeRoutes,
      icon: <Route className="h-5 w-5" />,
    },
    {
      label: "Pending payments",
      value: dashboard.metrics.pendingPayments,
      icon: <WalletCards className="h-5 w-5" />,
    },
    {
      label: "Trips Dispatched",
      value: dashboard.metrics.tripsDispatchedToday,
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
  ];
  return (
    <div className="dispatcher-dashboard space-y-5 lg:space-y-6">
      <div className="dashboard-summary" aria-label="Current terminal status">
        {metrics.map((metric) => (
          <div key={metric.label} className="dashboard-summary-item">
            <span className="dashboard-summary-icon" aria-hidden="true">{metric.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-5 text-text-secondary">{metric.label}</p>
              <p className="text-xl font-bold tabular-nums tracking-tight">{metric.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)] lg:gap-6">
        <Card padded={false} className="hidden min-h-[34rem] overflow-hidden md:flex md:flex-col">
          <div className="dashboard-panel-heading flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
            <div>
              <h2 className="text-base font-semibold">Live fleet & Active Zone</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Current operational state · 8-second refresh
              </p>
            </div>
            <Link
              to="/dispatcher/fleet"
              className="dashboard-text-link text-sm font-semibold text-primary"
            >
              Open fleet map
            </Link>
          </div>
          {fleet ? (
            <FleetMap fleet={fleet} compact />
          ) : (
            <LoadingSkeleton lines={5} className="m-5 flex-1" />
          )}
        </Card>
        <div className="min-w-0 space-y-5 lg:space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Live alerts</h2>
              <BellRing className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Replacement alerts cover today’s departures. A departure can need a van even when the queue is empty.
            </p>
            <div className="mt-3 divide-y divide-border">
              {dashboard.alerts.length ? (
                dashboard.alerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    title={alert.title}
                    message={alert.message}
                    timestamp={formatTime12(alert.timestamp)}
                    tone={
                      alert.tone === "danger"
                        ? "danger"
                        : alert.tone === "warning"
                          ? "warning"
                          : "info"
                    }
                  />
                ))
              ) : (
                <p className="py-8 text-center text-sm text-text-secondary">
                  No active alerts.
                </p>
              )}
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Next departures</h2>
              <Link
                to="/dispatcher/queue"
                className="dashboard-text-link text-xs font-semibold text-primary"
              >
                View queue
              </Link>
            </div>
            <p className="mt-1 text-xs text-text-secondary">Today’s queue, in queue order</p>
            <div className="mt-3 divide-y divide-border">
              {!dashboard.departures.length && (
                <p className="py-8 text-center text-sm text-text-secondary">
                  No departures in today’s queue.
                </p>
              )}
              {dashboard.departures.slice(0, 4).map((trip) => (
                <div
                  key={trip.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div>
                    <p className="text-sm font-bold">
                      {trip.route} · {trip.vanId}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {time(trip.departureTime)}
                    </p>
                  </div>
                  <StatusBadge tone={tone(trip.status)}>
                    {queueStatusLabel(trip.status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Terminal activity</h2>
          <span className="flex items-center gap-1 text-xs text-success">
            <span className="h-2 w-2 rounded-full bg-success" />
            Live feed
          </span>
        </div>
        <div className="dashboard-activity mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.activity.map((item) => (
            <div key={item.id} className="rounded-control border border-border bg-background p-4">
              <p className="text-sm font-bold">{label(item.title)}</p>
              <p className="mt-1 text-xs text-text-secondary">{item.detail}</p>
              <p className="mt-2 text-[0.65rem] text-text-muted">
                {time(item.timestamp)}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function DispatcherFleetPage() {
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await apiRequest<{ fleet: FleetSnapshot }>(
          "/dispatcher/fleet",
        );
        if (active) {
          setFleet(response.fleet);
          setError(null);
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof ApiError
              ? caught.message
              : "Fleet status could not be loaded.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  if (loading && !fleet) return <LoadingPanel />;
  if (!fleet)
    return (
      <EmptyState
        icon={<MapPinned className="h-6 w-6" />}
        title="Fleet map unavailable"
        description={error ?? "Try again shortly."}
      />
    );
  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="relative -mx-4 sm:-mx-6 lg:hidden">
        <FleetMap fleet={fleet} fullPage />
        <MobileFleetSheet fleet={fleet} />
      </div>
      <Card padded={false} className="hidden overflow-hidden lg:block">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-extrabold">NCEBT terminal &amp; Active Zones</h2>
        </div>
        <FleetMap fleet={fleet} />
      </Card>
      <div className="hidden space-y-4 lg:block">
        <Card className="p-4">
          <h2 className="font-extrabold">
            Active vehicles ({fleet.vehicles.length})
          </h2>
          <div className="mt-3 space-y-2">
            {fleet.vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                className="rounded-control border border-border p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="font-bold">{vehicle.vanId}</p>
                  <StatusBadge tone={fleetLocationTone(vehicle)}>
                    {fleetLocationLabel(vehicle)}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {vehicle.driver} · {vehicle.route} · Queue #
                  {vehicle.queuePosition ?? "—"}
                </p>
                <p className="mt-2 text-xs font-semibold text-primary-dark">
                  {vehicle.insideTerminalZone
                    ? "Inside 100-meter terminal zone · departure ready"
                    : vehicle.insideActiveZone
                      ? "Inside 5 km Active Zone · approaching terminal"
                      : "Outside 5 km Active Zone"}
                </p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-extrabold">Recent geofence events</h2>
          <div className="mt-3 divide-y divide-border">
            {fleet.events.length ? (
              fleet.events.map((event) => (
                <div key={event.id} className="py-3">
                  <p className="text-sm font-bold">
                    {event.vanId} {label(event.eventType)}
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {event.route} · {time(event.timestamp)}
                    {event.distanceKm !== null
                      ? ` · ${event.distanceKm} km`
                      : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-text-secondary">
                No recent events.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

type QueueAction =
  | "dispatch"
  | "override"
  | "move_to_last"
  | "mark_delayed"
  | "replace"
  | "notify_driver";

export function DispatcherQueuePage() {
  const { user } = useAuth();
  const route = user?.dispatcherRoute ?? "goa";
  const [entries, setEntries] = useState<DispatcherQueueEntry[]>([]);
  const [pendingArrivals, setPendingArrivals] = useState<DispatcherPendingArrival[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DispatcherQueueEntry | null>(null);
  const [action, setAction] = useState<QueueAction | null>(null);
  const [reason, setReason] = useState("");
  const [newPosition, setNewPosition] = useState(1);
  const [updatingPassengersId, setUpdatingPassengersId] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshRequested, setRefreshRequested] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    async function loadQueue() {
      try {
        const response = await apiRequest<{ queue: { entries: DispatcherQueueEntry[]; pendingArrivals: DispatcherPendingArrival[]; updatedAt: string } }>("/dispatcher/queue");
        if (active) {
          setEntries(response.queue.entries);
          setPendingArrivals(response.queue.pendingArrivals);
          setLastUpdatedAt(response.queue.updatedAt);
          setError(null);
        }
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught.message : "Queue could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadQueue();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue();
    }, 3_000);
    const refreshOnFocus = () => void loadQueue();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [route, refreshRequested]);

  async function runAction(
    entry: DispatcherQueueEntry,
    nextAction: QueueAction,
    direct = false,
  ) {
    if (!direct) {
      setSelected(entry);
      setAction(nextAction);
      setReason("");
      setNewPosition(entry.position);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{
        queue: { entries: DispatcherQueueEntry[]; pendingArrivals: DispatcherPendingArrival[] };
      }>(`/dispatcher/queue/${entry.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: nextAction,
          reason:
            nextAction === "notify_driver"
              ? "Please review your current queue assignment."
              : "",
        }),
      });
      setEntries(response.queue.entries);
      setPendingArrivals(response.queue.pendingArrivals);
      toast.success(
        nextAction === "notify_driver"
          ? "Driver notified."
          : "Departure recorded. The queue has advanced.",
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Queue action failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction() {
    if (!selected || !action) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{
        queue: { entries: DispatcherQueueEntry[]; pendingArrivals: DispatcherPendingArrival[] };
      }>(`/dispatcher/queue/${selected.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, reason, newPosition }),
      });
      setEntries(response.queue.entries);
      setPendingArrivals(response.queue.pendingArrivals);
      setSelected(null);
      setAction(null);
      toast.success(
        action === "move_to_last"
          ? "Van moved to last position."
          : action === "replace"
            ? "Vehicle replaced and affected reservations reallocated."
            : `${label(action)} completed.`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Queue action failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function adjustPassengerCount(entry: DispatcherQueueEntry, change: -1 | 1) {
    if (entry.position !== 1 || !entry.tripId) return;
    const passengerCount = Math.max(0, Math.min(entry.capacity, entry.occupancy + change));
    if (passengerCount === entry.occupancy) return;

    setUpdatingPassengersId(entry.id);
    setError(null);
    try {
      const response = await apiRequest<{
        queue: { entries: DispatcherQueueEntry[]; pendingArrivals: DispatcherPendingArrival[] };
      }>(`/dispatcher/queue/${entry.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "update_passengers", reason: "", passengerCount }),
      });
      setEntries(response.queue.entries);
      setPendingArrivals(response.queue.pendingArrivals);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Passenger count could not be updated.");
    } finally {
      setUpdatingPassengersId(null);
    }
  }

  const queueMetrics = [
    {
      label: "Total queue",
      value: entries.length,
      accent: "border-primary/15 bg-primary-soft/55",
      valueClass: "text-primary-dark",
      mobileLabel: "Total",
    },
    {
      label: "At terminal",
      value: entries.filter((entry) => entry.vehicleStatus === "at_terminal").length,
      accent: "border-success/15 bg-success-soft/70",
      valueClass: "text-success",
      mobileLabel: "Terminal",
    },
    {
      label: "Incoming",
      value: entries.filter((entry) => entry.vehicleStatus === "incoming").length,
      accent: "border-info/15 bg-info-soft/70",
      valueClass: "text-info",
      mobileLabel: "Incoming",
    },
    {
      label: route === "goa" ? "Late" : "Delayed",
      value: route === "goa"
        ? entries.filter((entry) => entry.isLate).length
        : entries.filter((entry) => entry.status === "delayed").length,
      accent: "border-danger/15 bg-danger-soft/65",
      valueClass: "text-danger",
      mobileLabel: route === "goa" ? "Late" : "Delayed",
    },
    {
      label: "Ready",
      value: entries.filter((entry) => entry.status === "ready_for_dispatch").length,
      accent: "border-success/15 bg-success-soft/70",
      valueClass: "text-success",
      mobileLabel: "Ready",
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-5">
        <div className="hidden sm:block">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Assigned route</p>
          <h2 className="mt-1 text-xl font-black">{label(route)} queue</h2>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-text-muted sm:mt-2 sm:justify-start sm:text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-success"><span className="h-2 w-2 rounded-full bg-success" />Live queue</span>
          <span>{lastUpdatedAt ? `Last checked ${time(lastUpdatedAt)}` : "Checking for updates…"}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1.5 sm:mt-4 sm:gap-2" aria-label="Queue status summary">
          {queueMetrics.map((metric) => (
            <div key={metric.label} aria-label={`${metric.label}: ${metric.value}`} className={`min-w-0 rounded-control border px-0.5 py-2 text-center min-[360px]:px-1 sm:px-3 sm:py-3 ${metric.accent}`}>
              <p className={`text-lg font-black leading-none sm:text-2xl ${metric.valueClass}`}>{metric.value}</p>
              <p className="mt-1 whitespace-nowrap text-[9px] font-semibold leading-4 text-text-secondary min-[360px]:text-[10px] sm:text-xs"><span className="sm:hidden">{metric.mobileLabel}</span><span className="hidden sm:inline">{metric.label}</span></p>
            </div>
          ))}
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
        {loading && !entries.length ? (
          <div className="mt-4">
            <LoadingSkeleton lines={7} />
          </div>
        ) : !entries.length ? (
          <div className="mt-4">
            <div className="rounded-control border border-dashed border-border-strong bg-background/45 p-4 sm:p-5">
              <div className="flex flex-col items-center text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary"><ListOrdered className="h-5 w-5" /></span>
                <h3 className="mt-3 text-base font-bold">Queue is clear</h3>
                <p className="mt-1 max-w-lg text-sm leading-5 text-text-secondary">No active {label(route)} vans are waiting for loading or departure.</p>
              </div>
              {pendingArrivals.length ? (
                <div className="mt-5 rounded-control border border-warning/30 bg-warning-soft p-4 text-left">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-bold text-text-primary">Arrival waiting for GPS confirmation</p>
                      <div className="mt-2 space-y-1 text-sm leading-6 text-text-secondary">
                        {pendingArrivals.map((arrival) => <p key={arrival.vanId}>{arrival.message}</p>)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="mt-4 rounded-control border border-border bg-surface p-3 text-left sm:p-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Quick actions</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary sm:text-sm">Monitor arrivals or prepare the next departure while the queue is empty.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Link to="/dispatcher/fleet" className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm font-semibold text-text-inverse transition-colors hover:bg-primary-dark"><MapPinned className="h-4 w-4 shrink-0" />Fleet map</Link>
                  <Link to="/dispatcher/schedules" className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-primary px-3 py-2 text-sm font-semibold text-primary-dark transition-colors hover:bg-primary-soft"><CalendarClock className="h-4 w-4 shrink-0" />Schedules</Link>
                  <button type="button" onClick={() => setRefreshRequested((value) => value + 1)} className="col-span-2 inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-border-strong px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-cream sm:col-span-1"><RefreshCw className="h-4 w-4 shrink-0" />Refresh</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-secondary">
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">Van / Driver</th>
                    {route === "goa" ? <th className="px-3 py-3">Loading / Departure</th> : null}
                    <th className="px-3 py-3">Occupancy</th>
                    <th className="px-3 py-3">Queue status</th>
                    <th className="px-3 py-3">Driver assignment</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <QueueTableRow
                      key={entry.id}
                      entry={entry}
                      loading={loading}
                      updatingPassengers={updatingPassengersId === entry.id}
                      adjustPassengerCount={adjustPassengerCount}
                      runAction={runAction}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3 xl:hidden">
              {entries.map((entry) => (
                <QueueMobileCard
                  key={entry.id}
                  entry={entry}
                  loading={loading}
                  updatingPassengers={updatingPassengersId === entry.id}
                  adjustPassengerCount={adjustPassengerCount}
                  runAction={runAction}
                />
              ))}
            </div>
          </>
        )}
      </Card>
      <ConfirmationDialog
        open={Boolean(selected && action)}
        title={`${action ? label(action) : "Queue action"} · ${selected?.vanId ?? ""}`}
        description={route === "goa" && (action === "override" || action === "move_to_last") ? "This updates the queue and affected driver assignments. Driver loading times follow the new queue positions; passenger departure times and payments stay unchanged. Every change is recorded in the dispatch log." : "Operational overrides are committed on the server and written to the dispatch log."}
        confirmLabel="Apply action"
        destructive={action === "replace" || action === "mark_delayed"}
        loading={loading}
        onClose={() => {
          setSelected(null);
          setAction(null);
        }}
        onConfirm={() => void confirmAction()}
      >
        <div className="space-y-4">
          {action === "override" ? (
            <Input
              label="New queue position"
              type="number"
              min={1}
              max={entries.length}
              value={newPosition}
              onChange={(event) => setNewPosition(Number(event.target.value))}
            />
          ) : null}
          <Input
            label={action === "override" ? "Reason (optional)" : "Required reason"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={action === "override" ? "Add context if needed" : "Describe the operational reason"}
            required={action !== "override"}
          />
        </div>
      </ConfirmationDialog>
    </div>
  );
}

export function DispatcherDepartureHistoryPage() {
  const { user } = useAuth();
  const route = user?.dispatcherRoute ?? "goa";
  return <DepartureHistory key={route} route={route} />;
}

function QueueActions({
  entry,
  loading,
  runAction,
}: {
  entry: DispatcherQueueEntry;
  loading: boolean;
  runAction: (
    entry: DispatcherQueueEntry,
    action: QueueAction,
    direct?: boolean,
  ) => void;
}) {
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_2.75rem] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end sm:gap-1">
      <Button
        size="sm"
        className="min-w-0 px-2 sm:px-4"
        disabled={loading}
        onClick={() => void runAction(entry, "dispatch", true)}
        title="Record this van's departure now and advance the queue"
      >
        Dispatch
      </Button>
      <details className="relative">
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-center rounded-control border border-border-strong px-3 text-text-secondary hover:bg-cream [&::-webkit-details-marker]:hidden" aria-label={`More actions for ${entry.vanId}`}>
          <Ellipsis className="h-4 w-4" aria-hidden="true" />
        </summary>
        <div className="absolute right-0 z-30 mt-1 min-w-44 overflow-hidden rounded-control border border-border bg-surface p-1 shadow-floating">
          <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void runAction(entry, "override"); }} className="block min-h-touch w-full rounded px-3 py-2 text-left text-sm font-semibold text-text-primary hover:bg-cream">Change position</button>
          <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void runAction(entry, "move_to_last"); }} className="block min-h-touch w-full rounded px-3 py-2 text-left text-sm font-semibold text-text-primary hover:bg-cream">Move to last</button>
          <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void runAction(entry, "notify_driver", true); }} className="flex min-h-touch w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary-soft"><Send className="h-4 w-4" />Notify driver</button>
          <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void runAction(entry, "replace"); }} className="flex min-h-touch w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger-soft"><X className="h-4 w-4" />Replace vehicle</button>
        </div>
      </details>
    </div>
  );
}

function PassengerStepper({
  entry,
  loading,
  onChange,
}: {
  entry: DispatcherQueueEntry;
  loading: boolean;
  onChange: (entry: DispatcherQueueEntry, change: -1 | 1) => void;
}) {
  if (entry.position !== 1) return <span className="font-bold">{entry.occupancy}/{entry.capacity}</span>;

  const disabled = loading || !entry.tripId;
  return (
    <div className="inline-flex items-center gap-1.5" aria-label={`Passengers aboard ${entry.vanId}`}>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-border-strong bg-surface text-primary-dark transition-colors hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || entry.occupancy <= 0}
        onClick={() => onChange(entry, -1)}
        aria-label={`Remove one passenger from ${entry.vanId}`}
        title="Remove one passenger"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <strong className="min-w-12 text-center text-sm" aria-live="polite">{entry.occupancy}/{entry.capacity}</strong>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-primary bg-primary text-text-inverse transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled || entry.occupancy >= entry.capacity}
        onClick={() => onChange(entry, 1)}
        aria-label={`Add one passenger to ${entry.vanId}`}
        title="Add one passenger"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function QueueTableRow({
  entry,
  loading,
  updatingPassengers,
  adjustPassengerCount,
  runAction,
}: {
  entry: DispatcherQueueEntry;
  loading: boolean;
  updatingPassengers: boolean;
  adjustPassengerCount: (entry: DispatcherQueueEntry, change: -1 | 1) => void;
  runAction: (
    entry: DispatcherQueueEntry,
    action: QueueAction,
    direct?: boolean,
  ) => void;
}) {
  const isGoa = entry.routeCode === "goa";
  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-background/70">
      <td className="px-3 py-3 text-lg font-black">{entry.position}</td>
      <td className="px-3 py-3">
        <p className="font-bold">{entry.vanId}</p>
        <p className="text-xs text-text-secondary">{entry.driver}</p>
      </td>
      {isGoa ? (
        <td className="px-3 py-3">
          <p className="font-semibold">Loading {entry.scheduledLoadingTime ? formatTime12(entry.scheduledLoadingTime) : "not scheduled"}</p>
          <p className="text-xs text-text-muted">Departure {entry.departureTime ? formatTime12(entry.departureTime) : "not scheduled"}</p>
        </td>
      ) : null}
      <td className="px-3 py-3">
        <PassengerStepper entry={entry} loading={loading || updatingPassengers} onChange={adjustPassengerCount} />
      </td>
      <td className="px-3 py-3">
        <StatusBadge tone={entry.isLate ? "danger" : tone(entry.status)}>
          {entry.isLate ? "Late" : queueStatusLabel(entry.status)}
        </StatusBadge>
      </td>
      <td className="px-3 py-3">
        {entry.assignment ? (
          <StatusBadge tone={tone(entry.assignment.status)}>
            {assignmentStatusLabel(entry.assignment.status)}
          </StatusBadge>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <QueueActions entry={entry} loading={loading} runAction={runAction} />
      </td>
    </tr>
  );
}

function QueueMobileCard({
  entry,
  loading,
  updatingPassengers,
  adjustPassengerCount,
  runAction,
}: {
  entry: DispatcherQueueEntry;
  loading: boolean;
  updatingPassengers: boolean;
  adjustPassengerCount: (entry: DispatcherQueueEntry, change: -1 | 1) => void;
  runAction: (
    entry: DispatcherQueueEntry,
    action: QueueAction,
    direct?: boolean,
  ) => void;
}) {
  const isGoa = entry.routeCode === "goa";
  const occupancyPercent = entry.capacity > 0
    ? Math.min(100, Math.round((entry.occupancy / entry.capacity) * 100))
    : 0;

  return (
    <article className="rounded-card border border-border bg-surface p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-2.5">
        <span aria-label={`Queue position ${entry.position}`} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control font-black ${entry.position === 1 ? "bg-primary text-white" : "bg-primary-soft text-primary-dark"}`}>
          {entry.position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-extrabold sm:text-base">{entry.vanId}</p>
          <p className="break-words text-xs text-text-secondary">{entry.driver}</p>
        </div>
        <BusFront className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {entry.position === 1 ? <span className="text-[11px] font-bold text-primary-dark">First in queue</span> : null}
        <StatusBadge tone={entry.isLate ? "danger" : tone(entry.status)}>{entry.isLate ? "Late" : queueStatusLabel(entry.status)}</StatusBadge>
      </div>
      {isGoa ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 rounded-control bg-background px-2.5 py-2 text-xs">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <dt className="text-text-muted">Loading</dt>
            <dd className="font-bold text-text-primary">{entry.scheduledLoadingTime ? formatTime12(entry.scheduledLoadingTime) : "Not scheduled"}</dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <dt className="text-text-muted">Departure</dt>
            <dd className="font-bold text-text-primary">{entry.departureTime ? formatTime12(entry.departureTime) : "Not scheduled"}</dd>
          </div>
        </dl>
      ) : null}
      <div className="mt-2 flex min-h-[2.75rem] items-center justify-between gap-2 text-xs">
        <p className="font-semibold text-text-secondary">Passengers aboard</p>
        <PassengerStepper entry={entry} loading={loading || updatingPassengers} onChange={adjustPassengerCount} />
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-pill bg-border"
        role="progressbar"
        aria-label={`${entry.vanId} occupancy`}
        aria-valuemin={0}
        aria-valuemax={entry.capacity}
        aria-valuenow={entry.occupancy}
      >
        <div className="h-full rounded-pill bg-primary transition-[width]" style={{ width: `${occupancyPercent}%` }} />
      </div>
      <details className="group mt-2 border-t border-border text-xs">
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">
          Driver assignment
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <p className="min-w-0 break-words font-semibold text-text-primary">{entry.assignment?.driver ?? "No active assignment"}</p>
          {entry.assignment ? (
            <StatusBadge tone={tone(entry.assignment.status)}>{assignmentStatusLabel(entry.assignment.status)}</StatusBadge>
          ) : null}
        </div>
      </details>
      <div className="border-t border-border pt-2">
        <QueueActions entry={entry} loading={loading} runAction={runAction} />
      </div>
    </article>
  );
}

export function DispatcherPaymentsPage() {
  const [active, setActive] = useState("gcash");
  const [gcash, setGcash] = useState<DispatcherPayment[]>([]);
  const [paypal, setPaypal] = useState<DispatcherPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DispatcherPayment | null>(null);
  const [deleting, setDeleting] = useState<DispatcherPayment | null>(null);
  const [reason, setReason] = useState("");
  const toast = useToast();
  useEffect(() => {
    void apiRequest<{
      payments: { gcash: DispatcherPayment[]; paypal: DispatcherPayment[] };
    }>("/dispatcher/payments")
      .then((response) => {
        setGcash(response.payments.gcash);
        setPaypal(response.payments.paypal);
      })
      .catch((caught) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Payments could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function decide(
    payment: DispatcherPayment,
    decision: "approve" | "reject",
    rejectionReason = "",
  ) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{
        payments: { gcash: DispatcherPayment[]; paypal: DispatcherPayment[] };
      }>(`/dispatcher/payments/${payment.id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: rejectionReason }),
      });
      setGcash(response.payments.gcash);
      setPaypal(response.payments.paypal);
      setRejecting(null);
      setReason("");
      window.dispatchEvent(new Event("uvgo:dispatcher-payments-changed"));
      toast.success(
        decision === "approve"
          ? "Payment verified and booking confirmed."
          : "Payment rejected and passenger notified.",
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Payment decision failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(payment: DispatcherPayment) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{
        payments: { gcash: DispatcherPayment[]; paypal: DispatcherPayment[] };
      }>(`/dispatcher/payments/${encodeURIComponent(payment.id)}`, { method: "DELETE" });
      setGcash(response.payments.gcash);
      setPaypal(response.payments.paypal);
      setDeleting(null);
      toast.success("Payment entry removed from your list.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Payment entry could not be removed.");
    } finally {
      setLoading(false);
    }
  }

  const visible = active === "gcash" ? gcash : paypal;
  return (
    <div className="space-y-4">
      <Card className="min-w-0 p-3 sm:p-5">
        <Tabs
          label="Payment method"
          items={[
            {
              id: "gcash",
              label: "GCash",
              count: gcash.filter(
                (payment) => payment.status === "pending_verification",
              ).length,
            },
            { id: "paypal", label: "PayPal", count: paypal.length },
          ]}
          activeId={active}
          onChange={setActive}
        />
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
        {loading && !visible.length ? (
          <div className="mt-4">
            <LoadingSkeleton lines={7} />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {visible.length ? (
              visible.map((payment) => (
                <PaymentCard
                  key={payment.id}
                  payment={payment}
                  loading={loading}
                  approve={() => void decide(payment, "approve")}
                  reject={() => { setReason(""); setRejecting(payment); }}
                  deleteEntry={() => setDeleting(payment)}
                />
              ))
            ) : (
              <EmptyState
                icon={<WalletCards className="h-6 w-6" />}
                title="No payments"
                description={`No ${active} payments are available.`}
              />
            )}
          </div>
        )}
      </Card>
      <Card className="flex items-start gap-3 p-4 text-sm leading-6 text-text-secondary">
        <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-primary" />
        <p>Verify GCash receipts and reported PayPal payments before approving. For PayPal, check the transaction, recipient, PHP amount, completed status, and that the transaction has not already been used. Checkout payments are confirmed automatically after capture. Delete clears reviewed payments and pending or failed PayPal checkouts from your list while keeping the passenger’s booking and payment history. A removed checkout appears again if its payment completes.</p>
      </Card>
      <ConfirmationDialog
        open={Boolean(rejecting)}
        title={`Reject ${rejecting?.reservation.reference ?? "payment"}?`}
        description="The passenger will receive your reason in an in-app notification."
        confirmLabel="Reject payment"
        destructive
        loading={loading}
        onClose={() => { if (!loading) { setReason(""); setRejecting(null); } }}
        onConfirm={() => { if (!rejecting) return; if (!reason.trim()) { setError("Enter a rejection reason."); return; } void decide(rejecting, "reject", reason.trim()); }}
      >
        <Input
          label="Required rejection reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="For example: transaction was not found or the amount is incorrect"
          required
        />
      </ConfirmationDialog>
      <ConfirmationDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.reservation.reference ?? "reservation entry"}?`}
        description={deleting?.method === "paypal" && deleting.paypalOrderId && ["pending", "failed"].includes(deleting.status)
          ? "Remove this checkout from your dispatcher list? Its booking and reserved seats are kept. This does not cancel the PayPal checkout. If the payment completes later, the entry will appear again with its completed status."
          : "This removes the reviewed entry from your dispatcher list. The passenger’s booking, reserved seats, payment history, and dispatch logs are kept."}
        confirmLabel="Delete entry"
        destructive
        loading={loading}
        onClose={() => { if (!loading) setDeleting(null); }}
        onConfirm={() => { if (deleting && !loading) void deleteEntry(deleting); }}
      />
    </div>
  );
}

function PaymentReceipt({ payment, imageClassName }: { payment: DispatcherPayment; imageClassName: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  if (!payment.receiptUrl) return null;
  const receiptLabel = `${payment.method === "gcash" ? "GCash" : "PayPal"} receipt for ${payment.reservation.reference}`;

  return (
    <>
      <button
        type="button"
        className="group block w-full overflow-hidden rounded-control bg-white text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`View ${receiptLabel}`}
        aria-haspopup="dialog"
        onClick={() => { setImageLoading(true); setImageFailed(false); setPreviewOpen(true); }}
      >
        <img src={payment.receiptUrl} alt={receiptLabel} className={imageClassName} />
        <span className="flex items-center justify-center gap-1.5 bg-primary-soft px-2 py-2 text-xs font-bold group-hover:bg-accent">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          Click to view receipt
        </span>
      </button>
      <Modal
        open={previewOpen}
        title="Payment receipt"
        description={`${payment.reservation.reference} · ${payment.reservation.passengerName}`}
        className="max-w-4xl"
        onClose={() => setPreviewOpen(false)}
        footer={<a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-bold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><Maximize2 className="h-4 w-4" aria-hidden="true" />Open full-size image</a>}
      >
        {imageLoading ? <p role="status" className="mb-3 text-sm text-text-secondary">Loading receipt…</p> : null}
        {imageFailed ? (
          <p role="alert" className="rounded-control bg-danger-soft p-4 text-sm text-danger">The receipt could not be loaded. Close this preview and try again.</p>
        ) : (
          <img
            src={payment.receiptUrl}
            alt={receiptLabel}
            className="max-h-[65dvh] w-full rounded-control bg-cream object-contain"
            onLoad={() => setImageLoading(false)}
            onError={() => { setImageLoading(false); setImageFailed(true); }}
          />
        )}
      </Modal>
    </>
  );
}

function PaymentCard({
  payment,
  loading,
  approve,
  reject,
  deleteEntry,
}: {
  payment: DispatcherPayment;
  loading: boolean;
  approve: () => void;
  reject: () => void;
  deleteEntry: () => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsId = useId();
  return (
    <article className="min-w-0 rounded-card border border-border p-3 sm:p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="font-extrabold">{payment.reservation.passengerName}</p>
          <p className="mt-1 break-words text-xs leading-5 text-text-secondary">
            {payment.reservation.reference} · {payment.reservation.route}
          </p>
        </div>
        <p className="whitespace-nowrap font-black text-primary-dark">
          ₱{payment.amount.toFixed(2)}
        </p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 sm:hidden">
        <StatusBadge tone={tone(payment.status)}>{label(payment.status)}</StatusBadge>
        <button
          type="button"
          className="inline-flex min-h-touch shrink-0 items-center justify-center gap-1.5 rounded-control px-2 text-sm font-bold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-expanded={detailsExpanded}
          aria-controls={detailsId}
          aria-label={`${detailsExpanded ? "Hide" : "View"} details for ${payment.reservation.passengerName}, ${payment.reservation.reference}`}
          onClick={() => setDetailsExpanded((expanded) => !expanded)}
        >
          {detailsExpanded ? "Hide details" : "View details"}
          {detailsExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div id={detailsId} className={detailsExpanded ? "block" : "hidden sm:block"}>
      {(payment.reservation.discountAmount ?? 0) > 0 ? <p className="mt-3 rounded-control bg-primary-soft p-3 text-sm leading-6">
        20% discount: {payment.reservation.studentPassengers} student(s), {payment.reservation.seniorPassengers} senior citizen(s) · ₱{payment.reservation.discountAmount!.toFixed(2)} saved. Check valid passenger IDs at the terminal.
      </p> : null}
      <section className="mt-4 rounded-control bg-cream p-3" aria-label={`Reservation details for ${payment.reservation.reference}`}>
        <h3 className="text-sm font-extrabold">Reservation details</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-text-secondary">Selected seats</dt>
            <dd className="mt-1.5">
              {payment.reservation.seats.length ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="Selected seat numbers">
                  {payment.reservation.seats.map((seat) => (
                    <li key={seat} className="rounded-control border border-primary/20 bg-primary-soft px-3 py-1.5 text-sm font-extrabold text-primary-dark">Seat #{seat}</li>
                  ))}
                </ul>
              ) : <span className="text-sm text-text-secondary">No seats currently assigned</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-text-secondary">Departure</dt>
            <dd className="mt-1.5 text-sm font-semibold">{time(payment.reservation.departureTime)}</dd>
          </div>
        </dl>
      </section>
      {payment.method === "gcash" ? (
        <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-control bg-cream">
            {payment.receiptUrl ? (
              <PaymentReceipt payment={payment} imageClassName="h-24 w-full object-cover" />
            ) : (
              <span className="px-2 text-center text-xs text-text-secondary">
                Demo receipt metadata
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary">
            <p>
              <strong className="text-text-primary">Transaction ID/reference:</strong>{" "}
              <span className="break-all">{payment.transactionReference ?? "Not supplied"}</span>
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Uploaded:</strong>{" "}
              {time(payment.uploadedAt)}
            </p>
            <p className="mt-2">
              <strong className="text-text-primary">Contact:</strong>{" "}
              {payment.reservation.contact ?? "Not supplied"}
            </p>
          </div>
        </div>
      ) : payment.paypalOrderId ? (
        <div className="mt-4 space-y-2 rounded-control bg-info-soft p-3 text-xs text-info">
          <p><strong>PayPal order ID:</strong>{" "}<span className="break-all">{payment.paypalOrderId}</span></p>
          {payment.status === "captured" && payment.transactionReference !== payment.paypalOrderId ? <p><strong>Transaction ID:</strong>{" "}<span className="break-all">{payment.transactionReference}</span></p> : null}
          {payment.receiptUrl ? <PaymentReceipt payment={payment} imageClassName="max-h-64 w-full object-contain" /> : <p>No receipt image attached. View payment details below.</p>}
        </div>
      ) : (
        <div className="mt-4 space-y-2 rounded-control bg-cream p-3 text-sm text-text-secondary">
          <PaymentReceipt payment={payment} imageClassName="max-h-64 w-full object-contain" />
          <p className="break-all"><strong className="text-text-primary">Transaction ID/reference:</strong>{" "}{payment.transactionReference || "Not supplied"}</p>
          <p><strong className="text-text-primary">Contact:</strong>{" "}{payment.reservation.contact ?? "Not supplied"}</p>
          <p>Manually check this payment in the merchant’s PayPal account. A passenger-supplied reference alone is not proof of payment.</p>
        </div>
      )}
      <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="hidden self-start sm:inline-block">
          <StatusBadge tone={tone(payment.status)}>
            {label(payment.status)}
          </StatusBadge>
        </span>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        {payment.method === "paypal" ? <PaypalPaymentDetails payment={payment} /> : null}
        {(payment.method === "gcash" || !payment.paypalOrderId) &&
        payment.status === "pending_verification" ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button
              size="sm"
              className="w-full sm:w-auto"
              disabled={loading}
              onClick={approve}
              leadingIcon={<Check className="h-4 w-4" />}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="w-full sm:w-auto"
              disabled={loading}
              onClick={reject}
              leadingIcon={<X className="h-4 w-4" />}
            >
              Reject
            </Button>
          </div>
        ) : payment.canDelete ? (
          <Button
            size="sm"
            variant="danger"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={deleteEntry}
            leadingIcon={<Trash2 className="h-4 w-4" />}
          >
            Delete
          </Button>
        ) : null}
        </div>
      </div>
      </div>
    </article>
  );
}

function PaypalPaymentDetails({ payment }: { payment: DispatcherPayment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="w-full sm:w-auto" leadingIcon={<Eye className="h-4 w-4" />} aria-label={`View PayPal payment ${payment.reservation.reference}`} onClick={() => setOpen(true)}>View payment details</Button>
      <Modal open={open} title="PayPal payment details" description={`${payment.reservation.reference} · ${payment.reservation.passengerName}`} onClose={() => setOpen(false)} footer={<Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
        <div className="flex items-center justify-between gap-3 rounded-control bg-cream p-3"><StatusBadge tone={tone(payment.status)}>{label(payment.status)}</StatusBadge><strong className="text-lg text-primary-dark">₱{payment.amount.toFixed(2)}</strong></div>
        <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold text-text-secondary">Booking status</dt><dd className="mt-1 font-semibold">{label(payment.reservation.status)}</dd></div>
          <div><dt className="text-xs font-semibold text-text-secondary">Contact</dt><dd className="mt-1 font-semibold">{payment.reservation.contact ?? "Not supplied"}</dd></div>
          {payment.paypalOrderId ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-secondary">PayPal order ID</dt><dd className="mt-1 break-all font-semibold">{payment.paypalOrderId}</dd></div> : null}
          {(!payment.paypalOrderId || payment.transactionReference !== payment.paypalOrderId) ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-secondary">Transaction ID/reference</dt><dd className="mt-1 break-all font-semibold">{payment.transactionReference ?? "Not supplied"}</dd></div> : null}
          <div><dt className="text-xs font-semibold text-text-secondary">Created</dt><dd className="mt-1 font-semibold">{time(payment.uploadedAt)}</dd></div>
          {payment.paypalOrderId ? <div><dt className="text-xs font-semibold text-text-secondary">Paid</dt><dd className="mt-1 font-semibold">{payment.paidAt ? time(payment.paidAt) : "No completed payment recorded"}</dd></div> : null}
          <div><dt className="text-xs font-semibold text-text-secondary">Selected seats</dt><dd className="mt-1 font-semibold">{payment.reservation.seats.length ? payment.reservation.seats.map((seat) => `#${seat}`).join(", ") : "No seats currently assigned"}</dd></div>
          <div><dt className="text-xs font-semibold text-text-secondary">Departure</dt><dd className="mt-1 font-semibold">{time(payment.reservation.departureTime)}</dd></div>
          {payment.verifiedAt ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-secondary">Reviewed</dt><dd className="mt-1 font-semibold">{time(payment.verifiedAt)}{payment.verifiedBy ? ` · ${payment.verifiedBy}` : ""}</dd></div> : null}
          {payment.rejectionReason ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-secondary">Rejection reason</dt><dd className="mt-1 break-words">{payment.rejectionReason}</dd></div> : null}
        </dl>
        {payment.receiptUrl ? <div className="mt-4"><PaymentReceipt payment={payment} imageClassName="max-h-64 w-full object-contain" /></div> : <p className="mt-4 rounded-control bg-cream p-3 text-sm leading-6 text-text-secondary">No receipt image was uploaded for this payment.{payment.paypalOrderId ? " This booking uses PayPal checkout; payment completion is recorded automatically after capture." : ""}</p>}
        {payment.status === "pending" ? <p className="mt-3 text-sm leading-6 text-text-secondary">This checkout is awaiting payment completion. An order ID alone does not confirm payment.</p> : null}
      </Modal>
    </>
  );
}

export function DispatcherAlertsPage() {
  const [dashboard, setDashboard] = useState<DispatcherDashboard | null>(null);
  const [drivers, setDrivers] = useState<DriverManagement["drivers"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState("all");
  const [announcement, setAnnouncement] = useState("");
  const [sending, setSending] = useState(false);
  const [markingAlertId, setMarkingAlertId] = useState<string | null>(null);
  const [deletingAlert, setDeletingAlert] = useState<DispatcherDashboard["alerts"][number] | null>(null);
  const [deleteAllAlertsOpen, setDeleteAllAlertsOpen] = useState(false);
  const [deletingAllAlerts, setDeletingAllAlerts] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await apiRequest<{ dashboard: DispatcherDashboard }>("/dispatcher/dashboard");
        if (active) {
          setDashboard(response.dashboard);
          setError(null);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof ApiError ? caught.message : "Alerts could not be loaded.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    async function loadDrivers() {
      try {
        const response = await apiRequest<{ management: DriverManagement }>("/dispatcher/drivers");
        if (active) {
          const activeDrivers = response.management.drivers.filter((driver) => driver.isActive);
          setDrivers(activeDrivers);
          setRecipientId((current) => current === "all" || activeDrivers.some((driver) => driver.id === current) ? current : "all");
          setAnnouncementError(null);
        }
      } catch (caught) {
        if (active) {
          setAnnouncementError(caught instanceof ApiError ? caught.message : "Drivers could not be loaded for announcements.");
        }
      }
    }

    void load();
    void loadDrivers();
    const timer = window.setInterval(() => void load(), 8_000);
    const refreshOnFocus = () => {
      void load();
      void loadDrivers();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  async function sendAnnouncement() {
    const message = announcement.trim();
    if (message.length < 3) {
      setAnnouncementError("Write an announcement with at least 3 characters.");
      return;
    }
    if (!drivers.length) {
      setAnnouncementError("There are no active drivers available for this announcement.");
      return;
    }

    setSending(true);
    setAnnouncementError(null);
    try {
      const response = await apiRequest<{ announcement: DriverAnnouncementResult }>("/dispatcher/announcements", {
        method: "POST",
        body: JSON.stringify({ driverId: recipientId, message }),
      });
      setAnnouncement("");
      toast.success(`Announcement sent to ${response.announcement.recipientCount} driver${response.announcement.recipientCount === 1 ? "" : "s"}.`);
    } catch (caught) {
      setAnnouncementError(caught instanceof ApiError ? caught.message : "The announcement could not be sent.");
    } finally {
      setSending(false);
    }
  }

  async function markAlertRead(alertId: string) {
    setMarkingAlertId(alertId);
    try {
      const response = await apiRequest<{ dashboard: DispatcherDashboard }>(`/dispatcher/alerts/${encodeURIComponent(alertId)}/read`, {
        method: "PATCH",
      });
      setDashboard(response.dashboard);
      window.dispatchEvent(new Event("uvgo:dispatcher-alerts-changed"));
      toast.success("Alert marked as read.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The alert could not be marked as read.");
    } finally {
      setMarkingAlertId(null);
    }
  }

  async function confirmDeleteAlert() {
    if (!deletingAlert) return;
    setMarkingAlertId(deletingAlert.id);
    try {
      const response = await apiRequest<{ dashboard: DispatcherDashboard }>(`/dispatcher/alerts/${encodeURIComponent(deletingAlert.id)}`, { method: "DELETE" });
      setDashboard(response.dashboard);
      setDeletingAlert(null);
      window.dispatchEvent(new Event("uvgo:dispatcher-alerts-changed"));
      toast.success("Notification deleted.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The notification could not be deleted.");
    } finally {
      setMarkingAlertId(null);
    }
  }

  async function confirmDeleteAllAlerts() {
    setDeletingAllAlerts(true);
    setError(null);
    try {
      const response = await apiRequest<{ dashboard: DispatcherDashboard }>("/dispatcher/alerts", { method: "DELETE" });
      setDashboard(response.dashboard);
      setDeleteAllAlertsOpen(false);
      window.dispatchEvent(new Event("uvgo:dispatcher-alerts-changed"));
      toast.success("All notifications deleted.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The notifications could not be deleted.");
    } finally {
      setDeletingAllAlerts(false);
    }
  }

  if (loading && !dashboard) return <LoadingPanel />;
  if (!dashboard) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Alerts unavailable"
        description={error ?? "Try again shortly."}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Card className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-extrabold">Send a driver announcement</h2>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              Create an alert for one driver or everyone you manage. It will appear on their dashboard automatically.
            </p>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Send className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void sendAnnouncement(); }}>
          <Select
            label="Send to"
            value={recipientId}
            disabled={!drivers.length || sending}
            onChange={(event) => setRecipientId(event.target.value)}
            hint={drivers.length ? `${drivers.length} active driver${drivers.length === 1 ? "" : "s"} available on this route.` : "No active managed drivers are available."}
          >
            <option value="all">All active drivers ({drivers.length})</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}{driver.vehicle ? ` · ${driver.vehicle.vanId}` : ""}
              </option>
            ))}
          </Select>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="driver-announcement" className="text-sm font-semibold text-text-primary">Announcement</label>
              <span className="text-xs text-text-muted">{announcement.length}/500</span>
            </div>
            <textarea
              id="driver-announcement"
              rows={4}
              maxLength={500}
              value={announcement}
              disabled={sending}
              onChange={(event) => {
                setAnnouncement(event.target.value);
                if (announcementError) setAnnouncementError(null);
              }}
              placeholder="Example: Please return to the terminal by 3:00 PM for the dispatch briefing."
              className={`w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-sm text-text-primary shadow-sm placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-cream ${announcementError ? "border-danger" : "border-border-strong hover:border-text-muted"}`}
              aria-invalid={Boolean(announcementError)}
              aria-describedby={announcementError ? "driver-announcement-error" : undefined}
            />
            {announcementError ? <p id="driver-announcement-error" role="alert" className="mt-1.5 text-xs text-danger">{announcementError}</p> : null}
          </div>
          <div className="dashboard-actions dashboard-actions-end">
            <Button
              type="submit"
              loading={sending}
              disabled={!drivers.length || announcement.trim().length < 3}
              leadingIcon={<Send className="h-4 w-4" />}
            >
              Send announcement
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="font-extrabold">Live operational alerts</h2>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              Payment, vehicle, and driver-response items for the {dashboard.route} route. Updated every 8 seconds.
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {dashboard.alerts.length ? (
              <Button
                className="flex-1 sm:flex-none"
                size="sm"
                variant="danger"
                disabled={Boolean(markingAlertId) || deletingAllAlerts}
                onClick={() => setDeleteAllAlertsOpen(true)}
                leadingIcon={<Trash2 className="h-4 w-4" />}
              >
                Delete all
              </Button>
            ) : null}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <BellRing className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>
        {dashboard.alerts.length ? (
          <div className="divide-y divide-border">
            {dashboard.alerts.map((alert) => (
              <AlertItem
                key={alert.id}
                className="py-4"
                icon={<AlertTriangle className="h-4 w-4" />}
                title={alert.title}
                message={alert.message}
                timestamp={formatTime12(alert.timestamp)}
                tone={alert.tone === "danger" ? "danger" : alert.tone === "warning" ? "warning" : "info"}
                read={alert.isRead}
                action={(
                  <div className="dashboard-actions">
                    {alert.isRead ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted"><Check className="h-3.5 w-3.5" aria-hidden="true" />Read</span>
                    ) : (
                      <Button size="sm" variant="ghost" loading={markingAlertId === alert.id} disabled={deletingAllAlerts || Boolean(markingAlertId && markingAlertId !== alert.id)} onClick={() => void markAlertRead(alert.id)} leadingIcon={<CheckCheck className="h-4 w-4" />}>
                        Mark as read
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" loading={Boolean(markingAlertId === alert.id && deletingAlert?.id === alert.id)} disabled={deletingAllAlerts || Boolean(markingAlertId && markingAlertId !== alert.id)} onClick={() => setDeletingAlert(alert)} leadingIcon={<Trash2 className="h-4 w-4" />}>
                      Delete
                    </Button>
                  </div>
                )}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BellRing className="h-6 w-6" />}
            title="No active alerts"
            description="New payment, vehicle, and driver-response alerts will appear here."
          />
        )}
      </Card>
      <ConfirmationDialog
        open={Boolean(deletingAlert)}
        title="Delete this notification?"
        description="This removes the alert from your dispatcher account. The underlying operational record remains available in the dispatch log."
        confirmLabel="Delete notification"
        destructive
        loading={Boolean(deletingAlert && markingAlertId === deletingAlert.id)}
        onClose={() => { if (!markingAlertId) setDeletingAlert(null); }}
        onConfirm={() => void confirmDeleteAlert()}
      />
      <ConfirmationDialog
        open={deleteAllAlertsOpen}
        title="Delete all notifications?"
        description="This removes every currently active alert from your dispatcher account. Trips, payments, assignments, vehicle records, and dispatch logs will not be deleted. New operational alerts can still appear later."
        confirmLabel="Delete all notifications"
        destructive
        loading={deletingAllAlerts}
        onClose={() => { if (!deletingAllAlerts) setDeleteAllAlertsOpen(false); }}
        onConfirm={() => void confirmDeleteAllAlerts()}
      />
    </div>
  );
}

export function DispatcherLogsPage() {
  const [logs, setLogs] = useState<DispatchLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingLog, setDeletingLog] = useState<DispatchLogEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteAllLogsOpen, setDeleteAllLogsOpen] = useState(false);
  const [deletingAllLogs, setDeletingAllLogs] = useState(false);
  const toast = useToast();
  useEffect(() => {
    void apiRequest<{ logs: DispatchLogEntry[] }>("/dispatcher/logs")
      .then((response) => setLogs(response.logs))
      .catch((caught) =>
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Dispatch logs could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(
    () =>
      logs.filter((entry) =>
        `${entry.action} ${entry.actor} ${entry.targetId} ${entry.reason ?? ""}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      ),
    [filter, logs],
  );

  async function confirmDeleteLog() {
    if (!deletingLog) return;
    setDeleting(true);
    try {
      const response = await apiRequest<{ logs: DispatchLogEntry[] }>(`/dispatcher/logs/${deletingLog.id}`, { method: "DELETE" });
      setLogs(response.logs);
      setDeletingLog(null);
      toast.success("Dispatch log deleted.");
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The dispatch log could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteAllLogs() {
    setDeletingAllLogs(true);
    try {
      const response = await apiRequest<{ logs: DispatchLogEntry[]; deleted: number }>("/dispatcher/logs", { method: "DELETE" });
      setLogs(response.logs);
      setDeleteAllLogsOpen(false);
      toast.success(`${response.deleted} dispatch log${response.deleted === 1 ? "" : "s"} deleted.`);
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : "The dispatch logs could not be deleted.");
    } finally {
      setDeletingAllLogs(false);
    }
  }

  if (loading) return <LoadingPanel />;
  if (error)
    return (
      <EmptyState
        icon={<FileClock className="h-6 w-6" />}
        title="Dispatch logs unavailable"
        description={error}
      />
    );
  return (
    <Card className="p-4 sm:p-5">
      <div className="dashboard-page-toolbar flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Audit trail
          </p>
          <h2 className="mt-1 text-xl font-black">Dispatch logs</h2>
        </div>
        <div className="dashboard-inline-form flex w-full flex-col gap-2 sm:max-w-lg sm:flex-row sm:items-end sm:justify-end">
          <div className="w-full sm:max-w-sm">
            <Input
              label="Filter logs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Action, actor, target, or reason"
            />
          </div>
          {logs.length ? (
            <Button
              variant="danger"
              disabled={deleting || deletingAllLogs}
              onClick={() => setDeleteAllLogsOpen(true)}
              leadingIcon={<Trash2 className="h-4 w-4" />}
            >
              Delete all
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {visible.length ? (
          visible.map((entry) => (
            <article
              key={entry.id}
              className="rounded-control border border-border p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{label(entry.action)}</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    {entry.actor} · {label(entry.actorRole)} · {entry.targetId}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <time className="text-xs text-text-secondary">{time(entry.timestamp)}</time>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2 text-danger hover:bg-danger-soft hover:text-danger"
                    leadingIcon={<Trash2 className="h-4 w-4" />}
                    disabled={deleting || deletingAllLogs}
                    onClick={() => setDeletingLog(entry)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {entry.reason ? (
                <p className="mt-2 rounded-control bg-cream p-2 text-sm">
                  <strong>Reason:</strong> {entry.reason}
                </p>
              ) : null}
            </article>
          ))
        ) : (
          <EmptyState
            icon={<FileClock className="h-6 w-6" />}
            title={logs.length ? "No matching logs" : "No dispatch logs"}
            description={logs.length ? "Adjust the filter to see other audit events." : "New route activity will appear here when it is recorded."}
          />
        )}
      </div>
      <ConfirmationDialog
        open={Boolean(deletingLog)}
        title="Delete this dispatch log?"
        description="This permanently removes the selected entry from Reports & Logs. The underlying trip, queue, payment, or driver record is not changed."
        confirmLabel="Delete log"
        destructive
        loading={deleting}
        onClose={() => { if (!deleting) setDeletingLog(null); }}
        onConfirm={() => void confirmDeleteLog()}
      />
      <ConfirmationDialog
        open={deleteAllLogsOpen}
        title="Delete all dispatch logs?"
        description="This permanently deletes every dispatch log for your assigned route, including logs not currently shown by the filter. Trips, queue entries, payments, assignments, drivers, vehicles, and bookings will not be changed. This action cannot be undone."
        confirmLabel="Delete all logs"
        destructive
        loading={deletingAllLogs}
        onClose={() => { if (!deletingAllLogs) setDeleteAllLogsOpen(false); }}
        onConfirm={() => void confirmDeleteAllLogs()}
      />
    </Card>
  );
}

export function DispatcherMorePage() {
  const { user } = useAuth();
  const links = [
    {
      to: "/dispatcher/profile",
      icon: UserRound,
      title: "My profile",
      text: "Update your name, email, phone number, or password.",
    },
    {
      to: "/dispatcher/drivers",
      icon: UserRoundCog,
      title: "Drivers & vehicles",
      text: "Create accounts and manage assigned vans.",
    },
    {
      to: "/dispatcher/schedules",
      icon: CalendarClock,
      title: "Schedule management",
      text: "Create and maintain Goa departure times.",
    },
    {
      to: "/dispatcher/logs",
      icon: FileClock,
      title: "Reports & logs",
      text: "Review the operational audit trail.",
    },
    {
      to: "/dispatcher/queue",
      icon: ListOrdered,
      title: "Queue management",
      text: "Dispatch, reorder, delay, or replace vehicles.",
    },
    {
      to: "/dispatcher/departure-history",
      icon: FileClock,
      title: "Departure history",
      text: "View confirmed departures by day and manage your history.",
    },
    {
      to: "/dispatcher/fleet",
      icon: MapPinned,
      title: "Fleet & geofence",
      text: "Monitor the NCEBT 5 km Active Zone.",
    },
    {
      to: "/dispatcher/payments",
      icon: WalletCards,
      title: "Payments",
      text: "Verify GCash receipts and PayPal payment reports.",
    },
  ].map((item) => item.to === '/dispatcher/schedules' && user?.dispatcherRoute === 'legazpi' ? { ...item, text: 'Set the recurring Taya driver order for each weekday.' } : item)
    .filter((item) => user?.dispatcherRoute !== 'legazpi' || item.to !== '/dispatcher/payments');
  return (
    <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
      {links.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-card border border-border bg-white p-5 shadow-card"
          >
            <Icon className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-extrabold">{item.title}</h2>
            <p className="mt-1 text-sm text-text-secondary">{item.text}</p>
          </Link>
        );
      })}
      <DemoControls />
    </div>
  );
}
