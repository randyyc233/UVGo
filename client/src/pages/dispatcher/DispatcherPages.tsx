import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  BusFront,
  Check,
  CheckCircle2,
  FileClock,
  ListOrdered,
  MapPin,
  MapPinned,
  Route,
  Send,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../../api/http";
import { DemoControls } from "../../components/dispatcher/DemoControls";
import { FleetMap } from "../../components/dispatcher/FleetMap";
import { MobileFleetSheet } from "../../components/dispatcher/MobileFleetSheet";
import {
  AlertItem,
  Button,
  Card,
  ConfirmationDialog,
  EmptyState,
  Input,
  LoadingSkeleton,
  MetricCard,
  StatusBadge,
  Tabs,
  useToast,
} from "../../components/ui";
import type {
  DispatchLogEntry,
  DispatcherDashboard,
  DispatcherPayment,
  DispatcherQueueEntry,
  FleetSnapshot,
} from "../../types/dispatcher";

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    ].includes(value)
  )
    return "warning";
  if (["delayed", "rejected", "replaced", "unavailable"].includes(value))
    return "danger";
  if (["incoming", "assigning"].includes(value)) return "info";
  return "neutral";
}

function time(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
      label: "Passengers Waiting",
      value: dashboard.metrics.passengersWaiting,
      icon: <UsersRound className="h-5 w-5" />,
    },
    {
      label: "Pending GCash",
      value: dashboard.metrics.pendingGcash,
      icon: <WalletCards className="h-5 w-5" />,
    },
    {
      label: "Trips Dispatched",
      value: dashboard.metrics.tripsDispatchedToday,
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            icon={metric.icon}
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
        <Card className="hidden overflow-hidden p-0 md:block">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-extrabold">Live fleet & Active Zone</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Current operational state · 8-second refresh
              </p>
            </div>
            <Link
              to="/dispatcher/fleet"
              className="text-sm font-bold text-primary"
            >
              Open fleet map
            </Link>
          </div>
          {fleet ? (
            <FleetMap fleet={fleet} compact />
          ) : (
            <LoadingSkeleton lines={5} className="m-5" />
          )}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold">Live alerts</h2>
              <BellRing className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3 divide-y divide-border">
              {dashboard.alerts.length ? (
                dashboard.alerts.map((alert) => (
                  <AlertItem
                    key={alert.id}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    title={alert.title}
                    message={alert.message}
                    timestamp={new Date(alert.timestamp).toLocaleTimeString(
                      "en-PH",
                      { hour: "numeric", minute: "2-digit" },
                    )}
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
              <h2 className="font-extrabold">Next departures</h2>
              <Link
                to="/dispatcher/queue"
                className="text-xs font-bold text-primary"
              >
                View queue
              </Link>
            </div>
            <div className="mt-3 divide-y divide-border">
              {dashboard.departures.slice(0, 4).map((trip) => (
                <div
                  key={trip.id}
                  className="flex items-center justify-between gap-3 py-3"
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
                    {label(trip.status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold">Terminal activity</h2>
          <span className="flex items-center gap-1 text-xs text-success">
            <span className="h-2 w-2 rounded-full bg-success" />
            Live feed
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.activity.map((item) => (
            <div key={item.id} className="rounded-control bg-cream p-3">
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
          <div className="pointer-events-none absolute inset-x-4 top-4 z-10 sm:inset-x-6">
            <div className="inline-flex flex-col rounded-card border border-border/80 bg-surface/95 px-4 py-3 shadow-floating backdrop-blur">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Fleet Map</span>
              <h2 className="mt-1 font-extrabold">NCEBT 5 km Active Zone</h2>
            </div>
          </div>
        <MobileFleetSheet fleet={fleet} />
      </div>
      <Card className="hidden overflow-hidden p-0 lg:block">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-extrabold">NCEBT 5 km Active Zone</h2>
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
                  <StatusBadge tone={tone(vehicle.status)}>
                    {label(vehicle.status)}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  {vehicle.driver} · {vehicle.route} · Queue #
                  {vehicle.queuePosition ?? "—"}
                </p>
                <p className="mt-2 text-xs font-semibold text-primary-dark">
                  {vehicle.insideActiveZone
                    ? "Inside Active Zone"
                    : "Outside Active Zone"}
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
  const [route, setRoute] = useState("goa");
  const [entries, setEntries] = useState<DispatcherQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DispatcherQueueEntry | null>(null);
  const [action, setAction] = useState<QueueAction | null>(null);
  const [reason, setReason] = useState("");
  const [newPosition, setNewPosition] = useState(1);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    void apiRequest<{ queue: { entries: DispatcherQueueEntry[] } }>(
      `/dispatcher/queue?route=${route}`,
    )
      .then((response) => {
        if (active) {
          setEntries(response.queue.entries);
          setError(null);
        }
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiError
              ? caught.message
              : "Queue could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route]);

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
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{
        queue: { entries: DispatcherQueueEntry[] };
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
      toast.success(
        nextAction === "notify_driver"
          ? "Driver notified."
          : "Trip assignment sent.",
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
        queue: { entries: DispatcherQueueEntry[] };
      }>(`/dispatcher/queue/${selected.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, reason, newPosition }),
      });
      setEntries(response.queue.entries);
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

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <Tabs
          label="Queue route"
          items={[
            { id: "goa", label: "Goa" },
            { id: "legazpi", label: "Legazpi" },
          ]}
          activeId={route}
          onChange={setRoute}
        />
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
            <EmptyState
              icon={<ListOrdered className="h-6 w-6" />}
              title="No vans in this queue"
              description={`${label(route)} has no active queue entries right now.`}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-text-secondary">
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">Van / Driver</th>
                    <th className="px-3 py-3">Arrival</th>
                    <th className="px-3 py-3">Occupancy</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Assignment</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <QueueTableRow
                      key={entry.id}
                      entry={entry}
                      loading={loading}
                      runAction={runAction}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-3 lg:hidden">
              {entries.map((entry) => (
                <QueueMobileCard
                  key={entry.id}
                  entry={entry}
                  loading={loading}
                  runAction={runAction}
                />
              ))}
            </div>
          </>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {["Total queue", "At terminal", "Incoming", "Delayed", "Ready"].map(
          (metric, index) => (
            <Card key={metric} className="p-4 text-center">
              <p className="text-2xl font-black text-primary-dark">
                {index === 0
                  ? entries.length
                  : index === 1
                    ? entries.filter(
                        (entry) => entry.vehicleStatus === "at_terminal",
                      ).length
                    : index === 2
                      ? entries.filter(
                          (entry) => entry.vehicleStatus === "incoming",
                        ).length
                      : index === 3
                        ? entries.filter((entry) => entry.status === "delayed")
                            .length
                        : entries.filter(
                            (entry) => entry.status === "ready_for_dispatch",
                          ).length}
              </p>
              <p className="mt-1 text-xs text-text-secondary">{metric}</p>
            </Card>
          ),
        )}
      </div>
      <ConfirmationDialog
        open={Boolean(selected && action)}
        title={`${action ? label(action) : "Queue action"} · ${selected?.vanId ?? ""}`}
        description="Operational overrides are committed on the server and written to the dispatch log."
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
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        size="sm"
        disabled={loading}
        onClick={() => void runAction(entry, "dispatch", true)}
      >
        Dispatch
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => void runAction(entry, "override")}
      >
        Override
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={loading}
        onClick={() => void runAction(entry, "move_to_last")}
      >
        Move last
      </Button>
      <button
        type="button"
        disabled={loading}
        onClick={() => void runAction(entry, "notify_driver", true)}
        className="min-h-touch rounded-control px-3 text-primary"
        aria-label={`Notify ${entry.driver}`}
      >
        <Send className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => void runAction(entry, "replace")}
        className="min-h-touch rounded-control px-3 text-danger"
        aria-label={`Replace ${entry.vanId}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function QueueTableRow({
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
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-3 text-lg font-black">{entry.position}</td>
      <td className="px-3 py-3">
        <p className="font-bold">{entry.vanId}</p>
        <p className="text-xs text-text-secondary">{entry.driver}</p>
      </td>
      <td className="px-3 py-3">{time(entry.arrivalTimestamp)}</td>
      <td className="px-3 py-3 font-bold">
        {entry.occupancy}/{entry.capacity}
      </td>
      <td className="px-3 py-3">
        <StatusBadge tone={tone(entry.status)}>
          {label(entry.status)}
        </StatusBadge>
      </td>
      <td className="px-3 py-3">
        {entry.assignment ? (
          <StatusBadge tone={tone(entry.assignment.status)}>
            {label(entry.assignment.status)}
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
    <article className="rounded-card border border-border p-4">
      <div className="flex items-start justify-between">
        <div className="flex gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-cream font-black">
            {entry.position}
          </span>
          <div>
            <p className="font-extrabold">{entry.vanId}</p>
            <p className="text-xs text-text-secondary">
              {entry.driver} · {entry.occupancy}/{entry.capacity}
            </p>
          </div>
        </div>
        <StatusBadge tone={tone(entry.status)}>
          {label(entry.status)}
        </StatusBadge>
      </div>
      <div className="mt-3 border-t border-border pt-3">
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
      toast.success(
        decision === "approve"
          ? "Payment verified and booking confirmed."
          : "Receipt rejected and passenger notified.",
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

  const visible = active === "gcash" ? gcash : paypal;
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
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
                  reject={() => setRejecting(payment)}
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
      <Card className="p-4 text-sm text-text-secondary">
        <ShieldCheck className="mr-2 inline h-4 w-4 text-primary" />
        PayPal captures are read-only. GCash is external and requires manual
        receipt verification.
      </Card>
      <ConfirmationDialog
        open={Boolean(rejecting)}
        title={`Reject ${rejecting?.reservation.reference ?? "GCash receipt"}?`}
        description="The passenger will receive your reason in an in-app notification."
        confirmLabel="Reject receipt"
        destructive
        loading={loading}
        onClose={() => setRejecting(null)}
        onConfirm={() => rejecting && void decide(rejecting, "reject", reason)}
      >
        <Input
          label="Required rejection reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="For example: amount or receipt is unclear"
        />
      </ConfirmationDialog>
    </div>
  );
}

function PaymentCard({
  payment,
  loading,
  approve,
  reject,
}: {
  payment: DispatcherPayment;
  loading: boolean;
  approve: () => void;
  reject: () => void;
}) {
  return (
    <article className="rounded-card border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-extrabold">{payment.reservation.passengerName}</p>
          <p className="mt-1 text-xs text-text-secondary">
            {payment.reservation.reference} · {payment.reservation.route} · Seat{" "}
            {payment.reservation.seats.join(", ")}
          </p>
        </div>
        <p className="font-black text-primary-dark">
          ₱{payment.amount.toFixed(2)}
        </p>
      </div>
      {payment.method === "gcash" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div className="flex min-h-24 items-center justify-center overflow-hidden rounded-control bg-cream">
            {payment.receiptUrl ? (
              <img
                src={payment.receiptUrl}
                alt={`GCash receipt for ${payment.reservation.reference}`}
                className="h-24 w-full object-cover"
              />
            ) : (
              <span className="px-2 text-center text-xs text-text-secondary">
                Demo receipt metadata
              </span>
            )}
          </div>
          <div className="text-xs text-text-secondary">
            <p>
              <strong className="text-text-primary">Reference:</strong>{" "}
              {payment.gcashReference ?? "Not supplied"}
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
      ) : (
        <div className="mt-4 rounded-control bg-info-soft p-3 text-xs text-info">
          <strong>PayPal order:</strong>{" "}
          {payment.paypalOrderId ?? "Unavailable"} · automatically handled
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <StatusBadge tone={tone(payment.status)}>
          {label(payment.status)}
        </StatusBadge>
        {payment.method === "gcash" &&
        payment.status === "pending_verification" ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={loading}
              onClick={approve}
              leadingIcon={<Check className="h-4 w-4" />}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={loading}
              onClick={reject}
              leadingIcon={<X className="h-4 w-4" />}
            >
              Reject
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function DispatcherLogsPage() {
  const [logs, setLogs] = useState<DispatchLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Audit trail
          </p>
          <h2 className="mt-1 text-xl font-black">Dispatch logs</h2>
        </div>
        <div className="w-full sm:max-w-sm">
          <Input
            label="Filter logs"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Action, actor, target, or reason"
          />
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
                <time className="text-xs text-text-secondary">
                  {time(entry.timestamp)}
                </time>
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
            title="No matching logs"
            description="Adjust the filter to see other audit events."
          />
        )}
      </div>
    </Card>
  );
}

export function DispatcherMorePage() {
  const links = [
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
      to: "/dispatcher/fleet",
      icon: MapPinned,
      title: "Fleet & geofence",
      text: "Monitor the NCEBT 5 km Active Zone.",
    },
    {
      to: "/dispatcher/payments",
      icon: WalletCards,
      title: "Payments",
      text: "Verify GCash and monitor PayPal.",
    },
  ];
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
