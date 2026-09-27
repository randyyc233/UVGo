import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '../api/http';
import type { PassengerBooking, PassengerNotification } from '../types/passenger';

const PASSENGER_REFRESH_INTERVAL_MS = 8_000;

function usePassengerQuery<T>(path: string | null, fallbackError: string) {
  const mounted = useRef(false);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!path) return null;
    try {
      const response = await apiRequest<T>(path);
      if (mounted.current) {
        setData(response);
        setError(null);
      }
      return response;
    } catch (caught) {
      if (mounted.current) setError(caught instanceof ApiError ? caught.message : fallbackError);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [fallbackError, path]);

  useEffect(() => {
    if (!path) return;

    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, PASSENGER_REFRESH_INTERVAL_MS);
    const refreshOnFocus = () => void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(poll);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [path, refresh]);

  return { data, setData, loading, error, setError, refresh };
}

export function usePassengerBookings() {
  const query = usePassengerQuery<{ bookings: PassengerBooking[] }>('/passenger/bookings', 'Bookings could not be loaded.');
  return { ...query, bookings: query.data?.bookings ?? [] };
}

export function usePassengerBooking(reference: string) {
  const query = usePassengerQuery<{ booking: PassengerBooking }>(reference ? `/passenger/bookings/${encodeURIComponent(reference)}` : null, 'Booking could not be loaded.');
  const { setData } = query;
  const setBooking = useCallback((booking: PassengerBooking) => setData({ booking }), [setData]);
  return { ...query, booking: query.data?.booking ?? null, setBooking };
}

export function usePassengerNotifications() {
  const query = usePassengerQuery<{ notifications: PassengerNotification[] }>('/passenger/notifications', 'Notifications could not be loaded.');
  return { ...query, notifications: query.data?.notifications ?? [] };
}
