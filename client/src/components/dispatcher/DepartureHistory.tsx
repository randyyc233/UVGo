import { useEffect, useId, useState } from 'react';
import { BusFront, ChevronLeft, ChevronRight, Ellipsis, RefreshCw, Trash2 } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/http';
import { formatDateTime12, formatTime12 } from '../../lib/dateTime';
import type { DepartureHistoryEntry } from '../../types/dispatcher';
import { Button, Card, ConfirmationDialog, LoadingSkeleton, useToast } from '../ui';

function todayInManila() {
  return new Date(Date.now() + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

function moveDay(date: string, change: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + change);
  return next.toISOString().slice(0, 10);
}

export function DepartureHistoryCard({ entry, onDelete }: { entry: DepartureHistoryEntry; onDelete: (entry: DepartureHistoryEntry) => void }) {
  return (
    <article className="min-w-0 rounded-control border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary"><BusFront className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-bold">{entry.vanId}</h3>
          <p className="mt-0.5 break-words text-xs text-text-secondary">{entry.driver}</p>
        </div>
        <details className="relative shrink-0">
          <summary aria-label={`More actions for departure ${entry.vanId} at ${formatTime12(entry.departedAt)}`} className="flex min-h-touch w-11 cursor-pointer list-none items-center justify-center rounded-control border border-border text-text-secondary hover:bg-background [&::-webkit-details-marker]:hidden"><Ellipsis className="h-4 w-4" aria-hidden="true" /></summary>
          <div className="absolute right-0 z-30 mt-1 w-44 rounded-control border border-border bg-surface p-1 shadow-floating">
            <button type="button" className="flex min-h-touch w-full items-center gap-2 rounded-control px-3 text-left text-sm font-semibold text-danger hover:bg-danger-soft" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onDelete(entry); }}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete history</button>
          </div>
        </details>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div className="min-w-0"><dt className="text-text-muted">Departed</dt><dd className="mt-1 font-bold text-primary-dark">{formatTime12(entry.departedAt)}</dd></div>
        <div className="min-w-0"><dt className="text-text-muted">Passengers</dt><dd className="mt-1 font-bold">{entry.passengerCount ?? 'Not recorded'}</dd></div>
        {entry.scheduledDepartureTime ? <div className="col-span-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-text-secondary"><dt>Scheduled departure</dt><dd>{formatDateTime12(entry.scheduledDepartureTime)}</dd></div> : null}
      </dl>
    </article>
  );
}

export function DepartureHistory({ route }: { route: string }) {
  const [date, setDate] = useState(todayInManila);
  const [data, setData] = useState<{ date: string; departures: DepartureHistoryEntry[] } | null>(null);
  const [error, setError] = useState<{ date: string; message: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<DepartureHistoryEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const filterId = useId();
  const toast = useToast();

  useEffect(() => {
    let active = true;
    let fetching = false;
    const controller = new AbortController();
    async function load() {
      if (fetching) return;
      fetching = true;
      try {
        const result = await apiRequest<{ date: string; departures: DepartureHistoryEntry[] }>(`/dispatcher/departures/history?date=${date}`, { signal: controller.signal });
        if (active) { setData(result); setError(null); }
      } catch (caught) {
        if (active) setError({ date, message: caught instanceof ApiError ? caught.message : 'Departure history could not be loaded.' });
      } finally { fetching = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 10_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { active = false; controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [route, date, refresh]);

  async function remove() {
    if (!deleting || saving) return;
    setSaving(true);
    try {
      await apiRequest<void>(`/dispatcher/departures/history/${deleting.id}`, { method: 'DELETE' });
      setHiddenIds((ids) => [...ids, deleting.id]);
      setDeleting(null);
      setRefresh((value) => value + 1);
      toast.success('Departure removed from your history.');
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Departure history could not be deleted.');
    } finally { setSaving(false); }
  }

  const entries = data?.date === date ? data.departures.filter((entry) => !hiddenIds.includes(entry.id)) : [];
  const message = error?.date === date ? error.message : null;
  const loading = data?.date !== date && !message;

  return (
    <Card className="p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><h2 className="text-base font-bold sm:text-lg">Confirmed departures</h2><p className="mt-0.5 text-xs leading-5 text-text-secondary">{route === 'goa' ? 'Goso · Goa' : 'Taya · Legazpi'}</p></div>
        <Button variant="ghost" size="sm" className="w-11 shrink-0 px-0" aria-label="Refresh departure history" onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
      </div>
      <div className="mt-3 sm:flex sm:items-end sm:gap-3">
        <div className="min-w-0 sm:w-80">
          <label htmlFor={filterId} className="mb-1.5 block text-xs font-semibold text-text-secondary">Departure day (Philippine time)</label>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] gap-2">
            <Button variant="outline" className="px-0" aria-label="Previous departure day" onClick={() => setDate(moveDay(date, -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <input id={filterId} type="date" value={date} className="min-h-touch min-w-0 w-full rounded-control border border-border-strong bg-surface px-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" onChange={(event) => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value); }} />
            <Button variant="outline" className="px-0" aria-label="Next departure day" onClick={() => setDate(moveDay(date, 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </div>
        <div className="mt-2 flex min-h-touch items-center justify-between gap-3 sm:mt-0 sm:flex-1">
          <p className="text-xs text-text-secondary" aria-live="polite">{loading ? 'Loading departures…' : `${entries.length} departure${entries.length === 1 ? '' : 's'}`}</p>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayInManila())}>Today</Button>
        </div>
      </div>
      {message ? <p role="alert" className="mt-3 rounded-control bg-danger-soft p-3 text-sm text-danger">{message}</p> : null}
      {loading ? <div className="mt-3"><LoadingSkeleton lines={4} /></div> : entries.length ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => <DepartureHistoryCard key={entry.id} entry={entry} onDelete={setDeleting} />)}</div>
      ) : !message ? <p className="mt-3 rounded-control border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-text-secondary">No departures in your history for this day.</p> : null}
      <ConfirmationDialog open={Boolean(deleting)} title={`Delete departure history · ${deleting?.vanId ?? ''}`} description={`Remove the departure${deleting ? ` on ${formatDateTime12(deleting.departedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''} from your history? The trip, queue records, bookings, payments, and dispatch logs will be kept.`} confirmLabel="Delete history" destructive loading={saving} onClose={() => { if (!saving) setDeleting(null); }} onConfirm={() => void remove()} />
    </Card>
  );
}
