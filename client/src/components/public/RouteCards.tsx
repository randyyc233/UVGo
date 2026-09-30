import { useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, MapPin, Route, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api/http';
import { formatDateTime12 } from '../../lib/dateTime';
import type { PublicRoutesResponse } from '../../types/public';
import { Card, LoadingSkeleton, StatusBadge } from '../ui';

function formatNextDeparture(value: string | null) {
  if (!value) return 'No van in queue';
  return formatDateTime12(value, { weekday: 'short' });
}

export function RouteCards() {
  const [data, setData] = useState<PublicRoutesResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<PublicRoutesResponse>('/public/routes')
      .then((response) => {
        if (active) setData(response);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!data && !error) {
    return <div className="grid gap-4 lg:grid-cols-2"><Card elevated><LoadingSkeleton lines={5} /></Card><Card elevated><LoadingSkeleton lines={5} /></Card></div>;
  }

  if (!data) {
    return <Card className="text-sm text-text-secondary">Route information is temporarily unavailable. The departure board may still have current operational data.</Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.routes.map((routeItem) => (
        <Card key={routeItem.code} elevated padded={false} className="group overflow-hidden">
          <div className={`h-2 ${routeItem.reservable ? 'bg-primary' : 'bg-info'}`} />
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <span className={`flex h-12 w-12 items-center justify-center rounded-card ${routeItem.reservable ? 'bg-primary-soft text-primary' : 'bg-info-soft text-info'}`}>
                {routeItem.reservable ? <Route className="h-6 w-6" /> : <UsersRound className="h-6 w-6" />}
              </span>
              <StatusBadge tone={routeItem.reservable ? 'success' : 'info'}>{routeItem.reservable ? 'Reservable' : 'No online booking'}</StatusBadge>
            </div>
            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-secondary">Naga →</p>
                <h3 className="mt-1 text-2xl font-black">{routeItem.name}</h3>
              </div>
              {routeItem.fare ? <p className="text-right text-sm text-text-secondary">from <strong className="block text-2xl text-primary-dark">₱{routeItem.fare}</strong></p> : null}
            </div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">{routeItem.summary}</p>
            <div className={`mt-5 grid gap-3 rounded-control bg-background p-3 text-xs ${routeItem.protocol === 'Goso' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <p className="flex items-start gap-2 text-text-secondary"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Destination<strong className="mt-1 block text-text-primary">{routeItem.destination}</strong></span></p>
              {routeItem.protocol === 'Goso' ? <p className="flex items-start gap-2 text-text-secondary"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{routeItem.nextDeparture ? 'Next departure' : 'Queue status'}<strong className="mt-1 block text-text-primary">{formatNextDeparture(routeItem.nextDeparture)}</strong></span></p> : null}
            </div>
            <Link
              to={`/?route=${routeItem.code}#departures`}
              className={`mt-5 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-control px-5 text-sm font-semibold transition-colors ${routeItem.reservable ? 'bg-primary text-text-inverse hover:bg-primary-dark' : 'border border-info text-info hover:bg-info-soft'}`}
            >
              {routeItem.reservable ? 'View Goa departures' : 'View Legazpi status'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

