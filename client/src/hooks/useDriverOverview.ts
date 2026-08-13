import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/http';
import type { DriverOverview } from '../types/driver';
import { useToast } from '../components/ui';

export function useDriverOverview() {
  const toast = useToast();
  const [overview, setOverview] = useState<DriverOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ overview: DriverOverview }>('/driver/overview');
      setOverview(response.overview);
      return response.overview;
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Driver information could not be loaded.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<{ overview: DriverOverview }>('/driver/overview')
      .then((response) => { if (active) setOverview(response.overview); })
      .catch((caughtError) => { if (active) setError(caughtError instanceof ApiError ? caughtError.message : 'Driver information could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const mutate = useCallback(async (path: string, init: RequestInit = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ overview: DriverOverview }>(path, init);
      setOverview(response.overview);
      if (path === '/driver/trip/arrive') toast.success('Terminal arrival recorded.');
      if (path === '/driver/trip/start') toast.success('Trip started. Location tracking has stopped.');
      return response.overview;
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'The driver action could not be completed.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return { overview, loading, error, setError, refresh, mutate };
}
