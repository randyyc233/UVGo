export const ASSIGNMENT_RESPONSE_WINDOW_MS = 5 * 60_000;
export const GOSO_BOARDING_WINDOW_MS = 10 * 60_000;
/** Concrete departures kept available for passenger search from a weekly template. */
export const WEEKLY_SCHEDULE_HORIZON_WEEKS = 8;
/** Recurring departures receive a driver assignment only when this close. */
export const WEEKLY_ASSIGNMENT_LOOKAHEAD_MS = 7 * 24 * 60 * 60_000;

/**
 * Passenger loading start for a departure.
 *
 * Goso schedules store this explicitly so a dispatcher can open loading earlier
 * or later than the default. Queue- and geofence-created trips, and rows that
 * predate the column, fall back to the historical rule: departure minus the
 * boarding window.
 */
export function boardingStartFor(departure: Date, explicit?: Date | null) {
  return explicit ?? new Date(departure.getTime() - GOSO_BOARDING_WINDOW_MS);
}

/** True when passenger loading should already be open for this departure. */
export function boardingIsOpen(departure: Date, explicit: Date | null | undefined, now = new Date()) {
  return boardingStartFor(departure, explicit).getTime() <= now.getTime();
}
