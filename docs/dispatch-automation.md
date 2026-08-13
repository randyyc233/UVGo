# Dispatch automation — Phase 8

Phase 8 implements the business-rule engine behind the existing passenger, driver, public, and dispatcher interfaces. It does not add demo-only mutation buttons; those remain part of Phase 10.

## Geofence transitions

`POST /api/driver/location` accepts a latitude, longitude, and optional ISO observation time for the authenticated driver's assigned vehicle. The server calculates Haversine distance from the seeded NCEBT center.

- Crossing into `<= 5 km` creates one `ENTERED` event, records the arrival time, marks the van incoming, admits or refreshes its route queue entry, and normalizes active positions by arrival time.
- Repeated samples on the same side create no database event.
- Crossing outside creates one `EXITED` event.
- Location tracking is disabled after a departed van exits the Active Zone.
- Only boundary events are retained; continuous GPS samples are not stored.

Both transitions create driver notifications and auditable dispatch-log records. Other authenticated roles cannot submit driver locations.

## Queue and assignment engine

The engine runs immediately on server start and then every `DISPATCH_ENGINE_INTERVAL_MS` milliseconds, defaulting to 10 seconds. Overlapping ticks are prevented.

Active queue positions are normalized using `arrivalTimestamp`, followed by creation time as a deterministic tie-breaker. Rejected, replaced, and departed rows are retained for auditability but excluded from operational queue views.

Pending assignments whose five-minute response window expires are marked expired. The trip advances to the next eligible FIFO vehicle, that driver receives a pending assignment and notification, and both the expiry and new assignment are logged.

## Goso — Goa

- Scheduled Goa trips enter assignment processing ten minutes before departure.
- The first eligible FIFO van receives the assignment.
- An accepted trip becomes ready when its scheduled departure time arrives.
- Occupancy is displayed but never blocks readiness.

## Taya — Legazpi

- Readiness is recalculated on every occupancy submission and scheduler tick.
- Only exactly 100% occupancy qualifies.
- Only the FIFO head can become `READY_FOR_DISPATCH`; a full later van remains loading until earlier eligible entries depart or are operationally removed.
- A dispatcher-delayed queue entry is not silently reset by automation.

## Dynamic reallocation

The dispatcher Replace action runs one database transaction:

1. Select the next eligible FIFO van on the same route.
2. Reuse or create its trip for the same departure time.
3. Move confirmed, rescheduled, or previously reallocated reservations.
4. Preserve seat numbers when available and allocate the next free seats otherwise.
5. Mark reservations `REALLOCATED` and the source trip `UNABLE_TO_DEPART`.
6. Mark the source vehicle unavailable and remove its queue entry from active operations.
7. Assign and notify the replacement driver.
8. Notify every affected passenger and create vehicle-replacement and reservation-reallocation logs.

If affected reservations cannot fit on an eligible replacement van, the transaction fails without partially changing operational data.
