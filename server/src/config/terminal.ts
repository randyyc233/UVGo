import { env } from './env.js';

export const NCEBT = {
  name: 'Naga City East Bound Terminal',
  address: 'Anciano Street, Barangay Triangulo, Naga City, Camarines Sur',
  // Surveyed terminal position, stored at 7 decimal places to match the
  // Decimal(10, 7) precision used for vehicle coordinates (~1 cm).
  latitude: 13.6187557,
  longitude: 123.1934993,
  activeZoneRadiusKm: 5,
} as const;

export const TERMINAL_GEOFENCE = {
  arrivalRadiusKm: env.TERMINAL_ARRIVAL_RADIUS_M / 1_000,
  // Arrival, loading attendance, map and departure use the same circle.
  departureRadiusKm: env.TERMINAL_ARRIVAL_RADIUS_M / 1_000,
  requiredSamples: env.GEOFENCE_REQUIRED_SAMPLES,
  maxAccuracyMeters: env.GEOFENCE_MAX_ACCURACY_M,
  sampleMinIntervalMs: env.GEOFENCE_SAMPLE_MIN_INTERVAL_MS,
  sampleMaxAgeMs: env.GEOFENCE_SAMPLE_MAX_AGE_MS,
  minOutwardProgressKm: env.GEOFENCE_MIN_OUTWARD_PROGRESS_M / 1_000,
} as const;
