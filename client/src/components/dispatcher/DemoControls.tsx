import { useEffect, useState } from 'react';
import { MapPin, Play } from 'lucide-react';
import { apiRequest, ApiError } from '../../api/http';
import { Button, Card, LoadingSkeleton, StatusBadge, useToast } from '../ui';

interface DemoState {
  demoMode: boolean;
  geofenceVehicle: {
    vanId: string;
    status: string;
    insideActiveZone: boolean;
  } | null;
}

export function DemoControls() {
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'geofence' | 'engine' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function loadState() {
    try {
      const response = await apiRequest<{ demo: DemoState }>('/dispatcher/demo');
      setState(response.demo);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Demo controls could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void apiRequest<{ demo: DemoState }>('/dispatcher/demo')
      .then((response) => {
        if (active) {
          setState(response.demo);
          setError(null);
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof ApiError ? caught.message : 'Demo controls could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function runSimulation(kind: 'geofence' | 'engine') {
    setRunning(kind);
    setError(null);
    try {
      await apiRequest(`/dispatcher/demo/${kind === 'geofence' ? 'geofence-entry' : 'dispatch-engine'}`, { method: 'POST' });
      toast.success(kind === 'geofence' ? `${state?.geofenceVehicle?.vanId ?? 'Route vehicle'} geofence entry simulated.` : 'Route dispatch engine evaluation completed.');
      await loadState();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The demo simulation could not be completed.');
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card className="p-5 sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Demo controls</p>
          <h2 className="mt-1 text-lg font-extrabold">Operational simulation</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">Demonstrate geofence entry and dispatch evaluation without adding production-only behavior.</p>
        </div>
        <StatusBadge tone={state?.demoMode ? 'success' : 'neutral'}>{state?.demoMode ? 'Demo mode active' : 'Unavailable'}</StatusBadge>
      </div>

      {loading ? <div className="mt-5"><LoadingSkeleton lines={3} /></div> : (
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="rounded-control border border-border bg-background p-4">
            <p className="text-sm font-bold">Geofence vehicle</p>
            <p className="mt-1 text-sm text-text-secondary">
              {state?.geofenceVehicle ? `${state.geofenceVehicle.vanId} · ${state.geofenceVehicle.insideActiveZone ? 'inside the Active Zone' : 'outside the Active Zone'}` : 'Demo vehicle unavailable'}
            </p>
          </div>
          <div className="dashboard-actions flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" leadingIcon={<MapPin className="h-4 w-4" />} loading={running === 'geofence'} disabled={!state?.demoMode || Boolean(running)} onClick={() => void runSimulation('geofence')}>Simulate entry</Button>
            <Button leadingIcon={<Play className="h-4 w-4" />} loading={running === 'engine'} disabled={!state?.demoMode || Boolean(running)} onClick={() => void runSimulation('engine')}>Run dispatch engine</Button>
          </div>
        </div>
      )}

      {error ? <p role="alert" className="mt-4 rounded-control bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
    </Card>
  );
}
