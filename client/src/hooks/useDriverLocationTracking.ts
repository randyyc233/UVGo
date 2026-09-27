import { useEffect } from 'react';
import { apiRequest } from '../api/http';
import type { DriverOverview } from '../types/driver';

const TRACKING_EVENT = 'uvgo:driver-location-tracking';
const LOCATION_SEND_INTERVAL_MS = 15_000;
const LOCATION_HEARTBEAT_INTERVAL_MS = 20_000;
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 };
const HEARTBEAT_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };

export function setDriverLocationTracking(enabled: boolean) {
  window.dispatchEvent(new CustomEvent<boolean>(TRACKING_EVENT, { detail: enabled }));
}

export function useDriverLocationTracking() {
  useEffect(() => {
    let watchId: number | null = null;
    let heartbeatId: number | null = null;
    let heartbeatPending = false;
    let disposed = false;
    let lastSentAt = 0;
    let manuallySelected: boolean | null = null;

    function stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      watchId = null;
      heartbeatId = null;
      heartbeatPending = false;
    }

    function send(position: GeolocationPosition) {
      if (disposed || watchId === null) return;
      const now = Date.now();
      if (now - lastSentAt < LOCATION_SEND_INTERVAL_MS) return;
      lastSentAt = now;
      void apiRequest<{ geofence: { trackingActive: boolean } }>('/driver/location', {
        method: 'POST',
        // The API records receipt time. Chromium can reuse position.timestamp
        // for an unchanged Sensors override, which would make fresh heartbeats
        // look out of order and eventually stale.
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          speedMps: position.coords.speed,
          headingDegrees: position.coords.heading,
        }),
      })
        .then((response) => {
          if (!response.geofence.trackingActive) stop();
        })
        .catch(() => undefined);
    }

    function requestFreshPosition() {
      if (disposed || watchId === null || heartbeatPending) return;
      heartbeatPending = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          heartbeatPending = false;
          send(position);
        },
        () => {
          heartbeatPending = false;
        },
        HEARTBEAT_OPTIONS,
      );
    }

    function start() {
      if (disposed || watchId !== null || !('geolocation' in navigator)) return;
      watchId = navigator.geolocation.watchPosition(
        send,
        () => undefined,
        WATCH_OPTIONS,
      );
      requestFreshPosition();
      heartbeatId = window.setInterval(requestFreshPosition, LOCATION_HEARTBEAT_INTERVAL_MS);
    }

    function handleTracking(event: Event) {
      manuallySelected = (event as CustomEvent<boolean>).detail;
      if (manuallySelected) start(); else stop();
    }

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') requestFreshPosition();
    }

    window.addEventListener(TRACKING_EVENT, handleTracking);
    window.addEventListener('focus', requestFreshPosition);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    void apiRequest<{ overview: DriverOverview }>('/driver/overview')
      .then((response) => {
        if (manuallySelected === null && response.overview.vehicle.goOnTripEnabled) start();
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      stop();
      window.removeEventListener(TRACKING_EVENT, handleTracking);
      window.removeEventListener('focus', requestFreshPosition);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
}
