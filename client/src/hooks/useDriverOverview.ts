import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../api/http';
import type { DriverNotification, DriverOverview } from '../types/driver';
import { useToast } from '../components/ui';

// Dispatcher actions (accept, cancel, queue changes) update the same server
// records used by the driver portal. Poll often enough that a driver does not
// continue seeing actionable Pending controls after a dispatcher responds.
const DRIVER_REFRESH_INTERVAL_MS = 3_000;

export function useDriverOverview() {
  const toast = useToast();
  const [overview, setOverview] = useState<DriverOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ overview: DriverOverview }>('/driver/overview', { cache: 'no-store' });
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
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, DRIVER_REFRESH_INTERVAL_MS);
    const refreshOnFocus = () => void refresh(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(poll);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  const mutate = useCallback(async (path: string, init: RequestInit = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ overview: DriverOverview }>(path, init);
      setOverview(response.overview);
      if (path === '/driver/trip/arrive') toast.success('Terminal arrival recorded.');
      if (path === '/driver/trip/start') toast.success('Departure authorized. GPS will confirm when the van clears the terminal boundary.');
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

export function useDriverNotifications() {
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const response = await apiRequest<{ notifications: DriverNotification[] }>('/driver/notifications');
      setNotifications(response.notifications);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Driver notifications could not be loaded.');
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, DRIVER_REFRESH_INTERVAL_MS);
    const refreshOnFocus = () => void refresh(true);
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(poll);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [refresh]);

  return { notifications, setNotifications, loading, error, refresh };
}
