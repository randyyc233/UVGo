/**
 * Pricing configuration.
 *
 * Default fares are the fallbacks applied when a trip is created without an
 * explicit amount. Individual departures carry their own `Trip.fareAmount`, and
 * a dispatcher can override the value when scheduling, so the defaults live in
 * exactly one place here.
 *
 * `Trip.fareAmount` is the full per-seat price the passenger pays — there is no
 * separate service fee on top of it. The payable total is therefore
 * `trip.fareAmount * seatCount`, computed on the server.
 */
export const DEFAULT_GOA_FARE = 108;
export const DEFAULT_LEGAZPI_FARE = 250;
