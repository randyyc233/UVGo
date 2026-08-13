# Driver operations — Phase 6

Phase 6 replaces the driver foundation preview with the complete authenticated driver workflow shown in the supplied mobile references. The same pages progressively enhance into a compact desktop workspace.

## Driver routes

- `/driver/setup` — assigned driver, van, route, terminal, Active Zone state, and persisted Go on Trip control
- `/driver/dashboard` — vehicle status, queue position, route, occupancy, dispatcher, queue summary, and alerts
- `/driver/assignment` — active assignment details with Accept Trip and Reject Trip
- `/driver/queue` — queue progress, occupancy reporting, and confirmed passenger boarding verification
- `/driver/trip` — operational zone/status timeline, terminal arrival, and validated trip start
- `/driver/more` — links to secondary driver tools

The driver trip page intentionally does not load Mapbox or show a continuous GPS map.

## Driver API

- `GET /api/driver/overview`
- `PATCH /api/driver/setup/go-on-trip`
- `POST /api/driver/assignments/:assignmentId/accept`
- `POST /api/driver/assignments/:assignmentId/reject`
- `POST /api/driver/occupancy`
- `POST /api/driver/location`
- `POST /api/driver/trip/arrive`
- `POST /api/driver/trip/start`

All queries and mutations derive the assigned vehicle from the authenticated driver ID. A driver cannot supply another vehicle or driver ID, and other roles receive `403`.

Location samples are reduced to boundary transitions on the server. UVGo writes an `ENTERED` or `EXITED` event only when the driver's assigned vehicle crosses the fixed NCEBT 5 km boundary; repeated samples on the same side are not retained as continuous history.

## Assignment rules

Accepting an assignment updates the assignment, queue entry, trip, and vehicle inside one database transaction and writes a dispatch log. Rejecting records the response, marks the current queue entry rejected, locates the next eligible FIFO queue entry for the route, creates its pending assignment, notifies the next driver, and writes an audit record.

## Occupancy and boarding

Passenger counts are limited to `0 <= count <= Vehicle.capacity`. Goa/Goso remains schedule-driven regardless of occupancy. Legazpi/Taya remains in loading state below capacity and changes to `READY_FOR_DISPATCH` only at exactly 100% occupancy; this calculation occurs on the server.

The boarding manifest contains only confirmed/rescheduled/reallocated reservation references, passenger names, contact numbers, and seats. Payment records and receipt information are never included.

## Trip transitions

- Go on Trip must be enabled before terminal-arrival actions.
- Terminal arrival requires the vehicle to be inside the seeded 5 km Active Zone.
- A trip requires an accepted assignment before start.
- Goso start remains locked until the scheduled departure time.
- Taya start remains locked until full occupancy.
- A successful start updates the trip, vehicle, queue, notification, and dispatch log transactionally.

`goOnTripEnabled` was added as its own persisted vehicle field in migration `20260809093019_add_driver_go_on_trip`; it is deliberately separate from the location-tracking flag.
