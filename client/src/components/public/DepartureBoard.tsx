import { useCallback, useEffect, useMemo, useState } from 'react';
import { BusFront, Clock3, RefreshCw, Route, TicketCheck, UsersRound } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../api/http';
import { formatDateTime12, formatTime12 } from '../../lib/dateTime';
import type { PublicDeparture, PublicDeparturesResponse } from '../../types/public';
import { Button, Card, EmptyState, IconButton, LoadingSkeleton } from '../ui';

function formatDepartureTime(value: string | null) {
  if (!value) return 'Schedule pending';
  return formatDateTime12(value);
}

type RouteFilter = 'all' | 'goa' | 'legazpi';

function getRouteFilter(value: string | null): RouteFilter {
  return value === 'goa' || value === 'legazpi' ? value : 'all';
}

function DepartureMobileCard({ departure }: { departure: PublicDeparture }) {
  const hasScheduledDeparture = departure.protocol === 'Goso';
  return (
    <Card elevated padded={false} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
            <BusFront className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-extrabold">{departure.route}</p>
            <p className="truncate text-xs text-text-secondary">{departure.vanId} · {departure.protocol}</p>
          </div>
        </div>
      </div>
      <div className={`mt-4 grid gap-3 rounded-control bg-background p-3 text-xs ${hasScheduledDeparture ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {hasScheduledDeparture ? <p className="text-text-secondary">Departure<strong className="mt-1 block text-sm text-text-primary">{formatDepartureTime(departure.departureTime)}</strong></p> : null}
        <p className={`${hasScheduledDeparture ? 'text-right' : ''} text-text-secondary`}>Queue position<strong className="mt-1 block text-sm text-text-primary">#{departure.queuePosition}</strong></p>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-text-secondary">Occupancy</span>
          <strong>{departure.occupancy.count}/{departure.occupancy.capacity}</strong>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-pill bg-border"
          role="progressbar"
          aria-label="Seats occupied"
          aria-valuenow={departure.occupancy.count}
          aria-valuemin={0}
          aria-valuemax={departure.occupancy.capacity}
        >
          <div className="h-full rounded-pill bg-primary" style={{ width: `${departure.occupancy.percent}%` }} />
        </div>
      </div>
      {departure.reservable ? (
        <Link to="/passenger/book" className="mt-4 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-text-inverse transition-colors hover:bg-primary-dark">
          <TicketCheck className="h-4 w-4" aria-hidden="true" />
          {departure.availableSeats} seats available · Reserve
        </Link>
      ) : (
        <p className="mt-4 rounded-control border border-border bg-cream p-3 text-center text-xs font-medium text-text-secondary">
          Legazpi does not accept online reservations
        </p>
      )}
    </Card>
  );
}

export function DepartureBoard() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<PublicDeparturesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routeFilter = getRouteFilter(searchParams.get('route'));

  const loadDepartures = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    try {
      const response = await apiRequest<PublicDeparturesResponse>('/public/departures');
      setData(response);
      setError(null);
    } catch {
      setError('Departure information is temporarily unavailable. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // The first request intentionally initializes this external API-backed view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDepartures();
    const interval = window.setInterval(() => void loadDepartures(true), 8_000);
    return () => window.clearInterval(interval);
  }, [loadDepartures]);

  useEffect(() => {
    if (location.hash !== '#departures') return;
    document.getElementById('departures')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, location.search]);

  function changeRouteFilter(filter: RouteFilter) {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (filter === 'all') nextSearchParams.delete('route');
    else nextSearchParams.set('route', filter);
    setSearchParams(nextSearchParams, { replace: true });
  }

  const filteredDepartures = useMemo(
    () => data?.departures.filter((departure) => routeFilter === 'all' || departure.routeCode === routeFilter) ?? [],
    [data, routeFilter],
  );
  const showsGosoDeparture = filteredDepartures.some((departure) => departure.protocol === 'Goso');
  const desktopGridColumns = showsGosoDeparture
    ? 'grid-cols-[1fr_0.8fr_1.2fr_0.7fr_1fr_auto]'
    : 'grid-cols-[1fr_0.8fr_0.7fr_1fr_auto]';

  return (
    <section id="departures" className="py-14 sm:py-16 lg:py-20">
      <div className="mx-auto max-w-app px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Public departure board</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Know before you go</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-base">
              Vans currently in the Goa and Legazpi queues at Naga City East Bound Terminal. No login required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data ? <p className="text-xs text-text-muted">Updated {formatTime12(data.updatedAt, true)}</p> : null}
            <IconButton label="Refresh departure board" icon={<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />} onClick={() => void loadDepartures(true)} />
          </div>
        </div>

        <div className="mt-6 flex gap-2" role="group" aria-label="Filter departures by route">
          {(['all', 'goa', 'legazpi'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={routeFilter === filter}
              className={`min-h-touch rounded-pill border px-4 text-sm font-semibold capitalize transition-colors ${routeFilter === filter ? 'border-primary bg-primary text-text-inverse' : 'border-border bg-surface text-text-secondary hover:border-primary'}`}
              onClick={() => changeRouteFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>

        {error && data ? <p role="status" className="mt-4 rounded-control border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-text-primary">Showing the last successful update. Live refresh is temporarily unavailable.</p> : null}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card elevated><LoadingSkeleton lines={5} /></Card>
            <Card elevated><LoadingSkeleton lines={5} /></Card>
          </div>
        ) : null}

        {error && !data ? (
          <Card className="mt-6 border-danger/20 bg-danger-soft">
            <p className="font-semibold text-danger">{error}</p>
            <Button className="mt-4" variant="danger" onClick={() => void loadDepartures()}>Try again</Button>
          </Card>
        ) : null}

        {!loading && !error && filteredDepartures.length === 0 ? (
          <EmptyState className="mt-6" icon={<Route className="h-5 w-5" />} title="No vans in queue" description="There are no vans in this queue right now. Check again shortly." />
        ) : null}

        {filteredDepartures.length > 0 ? (
          <>
            <div className="mt-6 grid gap-4 md:hidden">
              {filteredDepartures.map((departure) => <DepartureMobileCard key={departure.id} departure={departure} />)}
            </div>
            <Card elevated padded={false} className="mt-6 hidden overflow-hidden md:block">
              <div className={`grid ${desktopGridColumns} gap-4 border-b border-border bg-background px-5 py-3 text-xs font-bold uppercase tracking-wide text-text-secondary`}>
                <span>Route / Van</span><span>Protocol</span>{showsGosoDeparture ? <span>Goso departure</span> : null}<span>Queue</span><span>Occupancy</span><span>Availability</span>
              </div>
              {filteredDepartures.map((departure) => (
                <article key={departure.id} className={`grid ${desktopGridColumns} items-center gap-4 border-b border-border px-5 py-4 last:border-b-0`}>
                  <div><p className="font-bold">{departure.route}</p><p className="text-xs text-text-secondary">{departure.vanId}</p></div>
                  <p className="text-sm font-semibold">{departure.protocol}</p>
                  {showsGosoDeparture ? (departure.protocol === 'Goso'
                    ? <p className="text-sm">{formatDepartureTime(departure.departureTime)}</p>
                    : <span aria-hidden="true" />) : null}
                  <p className="text-sm font-bold">#{departure.queuePosition}</p>
                  <div>
                    <p className="text-xs font-semibold">{departure.occupancy.count}/{departure.occupancy.capacity}</p>
                    <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-pill bg-border"><div className="h-full bg-primary" style={{ width: `${departure.occupancy.percent}%` }} /></div>
                  </div>
                  {departure.reservable ? (
                    <Link to="/passenger/book" className="inline-flex min-h-touch items-center rounded-control bg-primary px-4 text-sm font-semibold text-text-inverse transition-colors hover:bg-primary-dark">Reserve</Link>
                  ) : (
                    <span className="text-xs font-medium text-text-secondary">No online reservations</span>
                  )}
                </article>
              ))}
            </Card>
          </>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 rounded-control border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
          <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" /> Goso: scheduled departure</span>
          <span className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-primary" /> Taya: departs at full occupancy</span>
          <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 text-primary" /> Refreshes every 8 seconds</span>
        </div>
      </div>
    </section>
  );
}
