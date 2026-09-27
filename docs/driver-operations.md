# Driver operations — Phase 6

Phase 6 replaces the driver foundation preview with the complete authenticated driver workflow shown in the supplied mobile references. The same pages progressively enhance into a compact desktop workspace.

## Driver routes

- `/driver/setup` — assigned driver, van, route, terminal, Active Zone state, and persistent Go on Trip switch
- `/driver/dashboard` — vehicle status, queue position, route, occupancy, dispatcher, queue summary, and alerts
- `/driver/notifications` — trip assignments, dispatcher announcements, and operational updates with unread state, mark-all-read, and deletion
- `/driver/assignment` — automatically active assignment details with pre-departure cancellation
- `/driver/queue` — queue progress, occupancy reporting, and confirmed passenger boarding verification
- `/driver/trip` — operational zone/status timeline and automatic terminal arrival/departure
- `/driver/profile` — personal name, sign-in email, phone number, and password management
- `/driver/more` — links to secondary driver tools

The driver trip page intentionally does not load Mapbox or show a continuous GPS map.

## Driver API

- `GET /api/driver/overview`
- `PATCH /api/driver/profile`
- `POST /api/driver/profile/password`
- `PATCH /api/driver/setup/go-on-trip`
- `POST /api/driver/assignments/:assignmentId/cancel`
- `POST /api/driver/occupancy`
- `POST /api/driver/location`
- `POST /api/driver/trip/arrive`
- `POST /api/driver/trip/start`

All queries and mutations derive the assigned vehicle from the authenticated driver ID. A driver cannot supply another vehicle or driver ID, and other roles receive `403`.

## Driver profile and security

The signed-in driver can update their own full name, unique sign-in email, and phone number from **Profile**. Their driver role, assigned vehicle, route, and managing dispatcher are read-only and cannot be changed by the profile endpoints. Password changes require the current password, increment the account session-token version, clear the current session cookie, and invalidate every other active session before the driver signs in again.

While Go on Trip is enabled, the driver portal is open, and browser location permission is granted, it sends accuracy, observation time, and optional motion data with each location sample. Closing the portal stops browser tracking but does not turn off the persisted switch. The server uses the latest operational sample and boundary events without exposing continuous location history. Entering the NCEBT 5 km Active Zone means incoming/tracking only; it does not change the planned queue order.

## Assignment rules

Creating or editing a dispatcher-managed Goa schedule immediately activates the selected van's driver assignment; no driver or dispatcher approval step is required. Current-day assignments create or reuse the van's live queue row automatically, while future-day assignments remain scheduled-only until their Manila service day. Every Goa schedule also carries a passenger loading start time, which the driver sees alongside the departure time. Taya assignments use the recurring weekday order and intentionally have no fixed loading or departure time.

The route dispatcher can cancel an active assignment before departure. Its linked queue row is removed, the remaining active positions are normalized, the departure is flagged for replacement when necessary, the driver is notified, and the dispatch log identifies the dispatcher who performed the cancellation.

A driver can hold multiple active Goa schedule occurrences on the same Manila calendar day. Each assignment remains tied to its exact loading/departure occurrence.

An assigned driver can cancel before departure and may provide an optional reason of up to 500 characters. When an eligible FIFO replacement exists, cancellation transfers all active confirmed or pending reservations, preserves existing seats when possible, and automatically assigns free alternatives when a transferred seat is occupied. The replacement assignment is active immediately. The cancelled driver, replacement driver, and every affected passenger receive notifications. If no replacement is available, cancellation still succeeds: the queue row is removed, the trip is flagged as awaiting replacement, and the dispatcher can assign another van later. The reason and all changes are retained in dispatch logs.

Driver overview and notification data refresh every three seconds while the page is visible and immediately when the window regains focus. New assignments and queue-position changes therefore appear without requiring a manual reload. The header bell and sidebar badge link to the dedicated Notifications page; marking or deleting an item updates the unread badge immediately.

For Goso, the original queue order follows scheduled **loading time**, not arrival time. Arriving early never allows a later schedule to overtake an earlier one. At each driver's own loading time, the system checks the latest reliable location against the 100 m terminal geofence. A driver who is outside is marked **Late** and moved to the last active position; drivers behind move up by one. Later drivers are not assessed before their own loading times. The accepted assignment and passenger booking details remain intact, and returning later does not silently restore the original position. A present driver is marked boarding. The dispatcher can still make an explicit audited queue adjustment.

Taya does not use a loading-time deadline. A Taya driver is checked for lateness only when the vehicle immediately ahead is dispatched. If the follower is outside the 100 m terminal geofence at that event, the driver is marked **Late** and moved behind the other eligible active drivers; an inside driver behind them advances. A scheduler tick or arbitrary clock time alone cannot make a Taya driver late.

## Occupancy and boarding

Passenger counts are limited to `0 <= count <= Vehicle.capacity`. Goa/Goso remains schedule-driven regardless of occupancy. Legazpi/Taya remains in loading below capacity; when the present queue head reaches capacity, the server records departure and advances the saved daily queue automatically.

Passenger-count submission is authorized against the exact authenticated driver's active assignment. A canceled, inactive, or other driver's schedule cannot receive a count from that driver. For Goa, the passenger-count window opens at that departure's passenger loading start time, which the dispatcher sets per schedule; both the API and driver controls remain locked before then. Taya counting is available on its active assignment because it has no fixed departure time.

The boarding manifest contains only confirmed/rescheduled/reallocated reservation references, passenger names, contact numbers, and seats. Payment records and receipt information are never included.

Both routes require confirmed terminal presence for passenger-count updates. A stale, inaccurate or outside latest GPS point cannot enable loading merely because an earlier entry was confirmed. Reassignment resets the new trip/van's count so a previous manifest's onboard total is not carried over.

## Trip transitions

- Go on Trip must be enabled for location-based arrival and departure processing. It stays enabled after departure and Active Zone exit until the driver turns it off.
- Terminal arrival is automatic after one reliable sample inside the provisional terminal zone. For Taya it confirms presence without changing the dispatcher-planned position.
- The legacy manual authorization endpoint retains Goso's scheduled-time and Taya's planned-order/occupancy checks, but the driver trip screen does not require that action for automatic departure.
- The first queued van with an active trip/assignment is automatically dispatched after one reliable sample outside the same terminal circle (default 100 m). It does not require a departure button, departure time or full occupancy to record an actual exit. Trip, vehicle, queue entry and remaining positions change atomically.
- A later van, or one without an active trip/assignment, leaving the circle becomes a dispatcher-review exception and does not advance the queue.
- If GPS cannot produce reliable confirmation after authorization, the dispatcher can record a visually verified exit with a required reason.

`goOnTripEnabled` is the persisted driver-controlled GPS switch. Automatic departure and geofence transitions never change it.
