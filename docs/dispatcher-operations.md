# Dispatcher operations — Phase 7

Phase 7 replaces the dispatcher foundation preview with a responsive command center based on the supplied mobile and desktop mockups. All dispatcher routes require an authenticated dispatcher session; passenger and driver accounts receive `403`.

## Dispatcher routes

- `/dispatcher/dashboard` — terminal KPIs, live alerts, departures, fleet overview, and activity feed
- `/dispatcher/fleet` — Mapbox fleet map, NCEBT 5 km Active Zone, current vehicle positions, and recent geofence events
- `/dispatcher/queue` — Goa and Legazpi queue tabs with dispatch, override, move-last, notify, and replace controls
- `/dispatcher/payments` — manual GCash verification and read-only PayPal captures
- `/dispatcher/logs` — immutable operational audit feed
- `/dispatcher/more` — mobile links to reports and secondary dispatcher tools

## Dispatcher API

- `GET /api/dispatcher/dashboard`
- `GET /api/dispatcher/fleet`
- `GET /api/dispatcher/queue?route=goa|legazpi`
- `POST /api/dispatcher/queue/:queueEntryId/actions`
- `GET /api/dispatcher/payments`
- `POST /api/dispatcher/payments/:paymentId/decision`
- `GET /api/dispatcher/payments/:paymentId/receipt`
- `GET /api/dispatcher/logs`

## Fleet and location privacy

The dispatcher map uses the public Mapbox token from `client/.env` and draws the Active Zone from the server-provided terminal center and radius. Vehicle markers prefer their latest geofence event and use deterministic demo coordinates when no event exists.

The API returns current positions and recent operational geofence events only. It does not expose a permanent location-history endpoint. The driver portal remains map-free.

## Queue mutations

Queue operations are committed on the server. Override, move-last, delay, and replace actions require an operational reason. Reordering is transactional, preserves active route positions, and writes the old/new positions to `DispatchLog`. Dispatch creates or refreshes the trip assignment and notifies the assigned driver; notify-driver creates a queue notification and audit entry. Replace invokes Phase 8 reallocation when the unavailable van has confirmed reservations.

## Payment decisions

GCash receipts are served only through the authenticated dispatcher route. Approving a receipt changes the payment to `VERIFIED` and the reservation to `CONFIRMED` in one transaction. Rejecting changes the payment to `REJECTED`, returns the reservation to `PENDING_PAYMENT`, records the required reason, and notifies the passenger.

PayPal captures are visible for reconciliation but deliberately have no dispatcher mutation controls.

## Refresh and demo behavior

Dashboard and fleet data poll every eight seconds. The included GCash record contains demo receipt metadata but no uploaded binary; the interface displays a safe placeholder. Running `npm run prisma:seed` restores queue order, the pending driver assignment, and the pending GCash verification state.
