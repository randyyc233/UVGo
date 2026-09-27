# Dispatcher operations — Phase 7

Phase 7 replaces the dispatcher foundation preview with a responsive command center based on the supplied mobile and desktop mockups. Every dispatcher account owns exactly one route. Goa and Legazpi reads, controls, logs, vehicles, queues, and automation are isolated on the server; cross-route requests receive `403`.

## Dispatcher routes

- `/dispatcher/dashboard` — terminal KPIs, live alerts, departures, fleet overview, and activity feed
- `/dispatcher/fleet` — Mapbox fleet map, NCEBT 5 km Active Zone, current vehicle positions, and recent geofence events
- `/dispatcher/queue` — the signed-in dispatcher’s assigned queue with dispatch, override, move-last, notify, and replace controls
- `/dispatcher/payments` — Goa-only manual GCash verification and read-only PayPal captures
- `/dispatcher/logs` — immutable operational audit feed
- `/dispatcher/drivers` — dispatcher-owned driver accounts, assigned vans, activation, and password reset
- `/dispatcher/schedules` — Goa concrete loading/departure management or a recurring Monday–Sunday, time-free Taya driver sequence for Legazpi
- `/dispatcher/profile` — personal details, password security, and route-scoped backup Dispatcher-account creation
- `/dispatcher/more` — mobile links to reports and secondary dispatcher tools

## Dispatcher API

- `GET /api/dispatcher/dashboard`
- `GET /api/dispatcher/fleet`
- `GET /api/dispatcher/queue`
- `POST /api/dispatcher/queue/:queueEntryId/actions`
- `GET /api/dispatcher/payments`
- `POST /api/dispatcher/payments/:paymentId/decision`
- `GET /api/dispatcher/payments/:paymentId/receipt`
- `POST /api/dispatcher/announcements`
- `POST /api/dispatcher/departures/:tripId/confirm`
- `PATCH /api/dispatcher/profile`
- `POST /api/dispatcher/profile/password`
- `GET /api/dispatcher/logs`
- `GET|POST /api/dispatcher/drivers`
- `PATCH /api/dispatcher/drivers/:driverId`
- `DELETE /api/dispatcher/drivers/:driverId`
- `POST /api/dispatcher/drivers/:driverId/reset-password`
- `GET|POST /api/dispatcher/schedules`
- `PATCH|DELETE /api/dispatcher/schedules/:tripId`
- `GET|PUT /api/dispatcher/taya-schedules`

## Dispatcher profile and security

The signed-in dispatcher can update their own full name, unique sign-in email, and phone number from **Profile**. Their dispatcher role and assigned Goa or Legazpi route are read-only and cannot be changed by this endpoint. Password changes require the current password, increment the account session-token version, clear the current session cookie, and invalidate every other active session before the dispatcher signs in again.

## Backup dispatcher accounts

An authenticated dispatcher can open **Profile**, find the **Dispatcher accounts** section, and create a trusted backup account. The server assigns the new account the creator's route; the request cannot select or override a route. Backup accounts are active, email-verified, and have the same operational permissions for that route, so creation should be limited to trusted personnel. The email must be unique, the temporary password must meet the application password policy, and the recipient can later use the shared **Forgot password?** flow. A Goa dispatcher cannot list or create Legazpi dispatcher accounts, and vice versa.

## Drivers and vehicles

Dispatchers create driver credentials and the assigned van in one transaction. The server derives the route and protocol from the authenticated dispatcher: Goa creates Goso vans and Legazpi creates Taya vans. Driver and vehicle records retain `managedByDispatcherId`, so another dispatcher cannot list, edit, deactivate, delete, or reset that driver. Deactivation increments the session token version and preserves historical operational records.

**Delete driver** is an audited operational deletion. It immediately revokes the driver's sessions, cancels pending or accepted assignments, removes linked queue rows, deletes the assigned van's weekly rules, Taya weekly rules and daily positions, future unbooked departures, and permanently deletes the assigned van. The deleted van's ID and plate number are immediately reusable. A booked or historical departure is retained internally for safe reassignment and reporting by moving it to an anonymized, unmanaged history vehicle; this placeholder cannot appear in Driver Management, Schedule Management, Active vehicles, or the fleet map. Current coordinates, geofence state, and geofence-event history are erased. Personal contact and sign-in details are anonymized so the email address can be reused. Historical trips, bookings, passenger counts, assignments, and dispatch logs remain intact instead of being destructively cascaded.

### Seat capacity

Passenger seat capacity is stored per vehicle (`Vehicle.capacity`) and is editable from the driver form, so it can differ between vans on the same route. The default is 11; the accepted range is 1–30. Capacity is not just a label: seat maps, public availability counts, reservation seat validation, driver occupancy limits, Taya 100%-occupancy readiness and reallocation all read the trip's own vehicle capacity. Lowering a van's capacity does not remove seats that already have reservations — those bookings remain valid, and the seat map simply stops offering the removed numbers to new passengers.

## Goa schedules

Schedule Management creates concrete future Goa trips consumed by passenger search and the Goso engine. Each departure records its creating dispatcher, selected managed van, local date/time, and fare, then immediately activates the assignment and notifies that van's driver. Editing a concrete schedule replaces the previous assignment with a fresh active assignment. A current-day assignment creates or reuses the van's live dispatcher queue row; a future-day assignment remains scheduled-only until that service day. The server rejects Legazpi schedule mutations, duplicate Goa departure timestamps, times less than five minutes in the future, and time/van changes after passenger reservations exist.

The **Driver assignments** section is a rolling Monday–Sunday operational view in Asia/Manila time. It returns active assignments whose departure belongs to the current service week. The schedule page's existing eight-second refresh picks up the new week automatically at Monday 00:00; prior-week assignments disappear from this panel while their trip, assignment, notification, and dispatch-log history remain retained for audit and reporting. There is no acceptance control because every scheduled assignment is active immediately. The dispatcher may use **Cancel assignment** before departure. Cancellation removes any linked row from the active queue, renumbers the remaining queue, returns the van to its applicable non-queue state, flags the departure for replacement, notifies the driver, and writes a dispatcher-authored cancellation log. Departed and otherwise inactive trips cannot be changed through these controls.

### Fixed weekly timetable

The Goa dispatcher can configure permanent Monday–Sunday rules through `POST /api/dispatcher/weekly-schedules`. A rule stores the weekday, same-day loading/departure times, managed van/driver, fare and active state. UVGo materializes a rolling eight-week window of ordinary `Trip` rows and extends that window on scheduler ticks, so passenger search and the dispatch engine continue to consume concrete dated departures rather than special recurrence objects. Re-running materialization is idempotent because each template and Manila occurrence date may produce only one trip.

The timetable uses a horizontally scrollable Monday–Sunday day selector and opens on the current weekday in Asia/Manila. Selecting another day shows that weekday's recurring rules and makes the add action default to the selected day, keeping the mobile view compact. Generated dated trips are intentionally not listed in Schedule Management; they continue to power passenger booking and dispatch automation internally, while reports and audit history remain intact.

Only occurrences within the next seven days receive a pending driver assignment immediately; later trips are assigned as they enter that window. This avoids flooding a driver with eight weeks of notifications while still publishing future trips for booking. A driver may hold multiple distinct schedules on the same Manila calendar day.

Editing, pausing or removing a rule deletes and regenerates only its future **unbooked** occurrences. A trip with any passenger reservation keeps its original date, loading/departure times, vehicle, fare, seats and payments. Pausing stops new generation; resuming refills the rolling horizon. Removing a rule converts any preserved booked occurrence into a standalone trip and removes the remaining unbooked occurrences.

Each Goa schedule is an independent occurrence with its own loading time, departure time and active assignment. A driver may therefore be selected more than once on the same Manila calendar day.

**Two mandatory times.** Every departure carries a passenger loading start time (`Trip.boardingStartTime`) and a departure time (`Trip.scheduledOrTriggeredTime`). Both are required when creating or editing a schedule, and loading must begin strictly before departure — the API rejects a missing loading time with `BOARDING_START_REQUIRED` and an out-of-order pair with `BOARDING_START_AFTER_DEPARTURE`. Loading may open well before departure, so the dispatcher can extend boarding for a popular run.

The form is deliberately minimal — four controls plus one collapsed row — so a departure can be filed quickly:

1. **Loading date + loading time**, side by side, with a **Confirm** button that locks the pair in. Confirming seeds a suggested departure time (loading + 10 minutes) but never constrains it.
2. **Departure time** — **time only**. The date is not offered, so a departure can never be filed against a different day by accident. It stays disabled until the loading pair is confirmed, and editing the loading date or time drops the confirmation so it must be re-confirmed.
3. **Van** — required.
4. **Fare** — collapsed behind a disclosure that shows the current amount in its summary. It is prefilled from the route default, so it stays out of the way unless the dispatcher needs to override it.

Changing the loading selection re-anchors the departure date to it. A departure stored against a different date (only possible for rows that run past midnight) is preserved and labelled as the following day rather than silently shifted.

The loading time drives the driver's passenger-count window. Both times are shown as separately labelled values in Schedule Management, to the driver on their trip assignment, and to passengers throughout trip selection and booking. Trips that are not dispatcher-created (queue dispatch, geofence arrival, reallocation) set loading to the moment the van becomes available, and any row without an explicit value falls back to `departure − 10 minutes`, which was the previous implied rule.

**Removing a departure.** A future departure can be removed with `DELETE /api/dispatcher/schedules/:tripId`, which deletes the trip, cascades its assignment away, notifies the unassigned driver, and writes a `SCHEDULE_DELETED` dispatch-log entry. Only two things block removal: a departure that is already in the past, and one that has passenger reservations. The driver assignment is deliberately *not* a blocker — creating a schedule always assigns a driver, so treating it as one made every schedule permanently undeletable. The list shows the blocking reason on the disabled Remove button.

Concrete departures generated from a weekly rule cannot be removed individually because the scheduler would recreate them. Their row links back to **Edit rule**; the dispatcher manages them by editing, pausing or removing the weekly template.

## Fleet and location privacy

The dispatcher map uses the public Mapbox token from `client/.env` and draws the Active Zone from the server-provided terminal center and radius. Vehicle markers prefer their latest geofence event and use deterministic demo coordinates when no event exists.

The API returns current positions and recent operational geofence events only. It does not expose a permanent location-history endpoint. The driver portal remains map-free.

## Alerts, announcements, and departure review

The Alerts page lets the dispatcher send an in-app announcement to one active managed driver or all active drivers on the dispatcher's route. Recipients and the announcement text are recorded in the dispatch audit log. A dispatcher may delete one alert or use **Delete all** to dismiss every currently active alert from their own account. Bulk deletion is route- and account-scoped: it does not affect another dispatcher and does not delete the underlying payment, trip, vehicle, assignment, or dispatch-log records. Alerts created by later operational changes appear normally.

The same page lists authorized departures waiting for GPS confirmation and unauthorized terminal-exit exceptions. An unauthorized exit cannot be manually converted into a departure from this panel because protocol authorization is still missing. For an already authorized departure with uncertain GPS, the dispatcher can confirm a visually verified exit and must enter a reason. The server then marks the trip and queue row departed, renumbers the remaining FIFO entries, clears the pending state, and writes the actor, reason, and manual-fallback metadata in one transaction.

The **Reports & Logs** page supports deleting one dispatch log or permanently deleting all dispatch logs belonging to the signed-in dispatcher's route. Bulk deletion does not cross route boundaries: deleting Goa logs leaves Legazpi logs intact, and deleting Legazpi logs leaves Goa logs intact. It removes only `DispatchLog` audit rows; the underlying trips, queue entries, payments, assignments, drivers, vehicles, and bookings are not changed.

## Queue mutations

Queue operations are committed on the server after verifying that the target queue entry belongs to the dispatcher’s assigned route. Move-last, delay, and replace actions require an operational reason. Reordering is transactional, preserves active route positions, and writes the old/new positions to `DispatchLog`. Notify-driver creates a queue notification and audit entry. Replace invokes Phase 8 reallocation when the unavailable van has confirmed reservations.

**Dispatch means departed.** On both Goa/Goso and Legazpi/Taya, clicking Dispatch immediately records the actual departure time, marks the trip and queue row `DEPARTED`, marks the vehicle `ON_TRIP`, and renumbers the remaining queue. The dispatcher confirms the departure without waiting for GPS, driver-button authorization, departure time or full occupancy. The active assignment and existing passenger booking times are preserved. When no active trip exists, a departed trip record is created. The entire change uses the route transaction lock, records the dispatcher in the departure log, and notifies the driver. Repeat clicks cannot create duplicate departures.

**Passengers.** Each queued van with an active trip has a Passengers action. Enter the total number currently aboard (0 through the van's capacity), including reserved passengers who have boarded, and optionally add a reason. The server saves an occupancy report attributed to the dispatcher, logs the previous/new totals, and notifies the driver. This does not create passenger accounts, reservations or payments. For the present Taya queue head, reaching capacity automatically records departure and advances the queue. Counts cannot be edited after departure or on another dispatcher's route. A trip and assigned driver are required; the dispatcher can record a visual count without waiting for the driver's GPS.

For Goa/Goso, scheduled loading time is the authoritative automatic order. Early arrival never overtakes an earlier scheduled driver. Override and Move to last remain explicit, audited dispatcher actions; they rebind vans/drivers across the next affected same-day slots while keeping trip IDs, passenger loading/departure times, fares and payments unchanged. Seats are preserved or safely remapped. An edit that cannot accommodate the existing reservations is rejected atomically.

At each driver's own Goso loading time, an accepted driver outside the 100 m terminal geofence is marked **Late** and moves to the last active position exactly once. Drivers behind move up by one, but they are not evaluated early and do not become late until their own loading times. This attendance decision does not cancel the acceptance, transfer the trip, or change passenger times, fares or payments. A driver already inside the geofence at the deadline retains the position and is marked boarding.

The visible Goa dispatcher queue is a current-service-day view in Asia/Manila. It includes only queue rows with a scheduled loading time from today at 00:00 through, but not including, tomorrow at 00:00. Older and future scheduled rows do not appear or affect the displayed position numbers; their underlying assignment, trip, queue and audit records are retained.

For both Goso and Taya, a first queued van with an active trip/assignment leaving the same terminal circle is automatically recorded as dispatched after the configured reliable GPS sequence. No driver-button authorization is needed for this actual queue-head exit. Later-van exits and uncertain GPS still require review. Readiness rules and optional manual authorization are separate from recording a real exit.

For Taya, the dispatcher sets one ordered driver/van sequence for each weekday. The Monday–Sunday rules repeat every week, and no loading or departure time is stored or shown. At the start of each Manila service day, that weekday's rule materializes into a separate operational daily queue. Move controls on the live queue affect the current daily occurrence without changing future weeks; editing Schedule Management updates the recurring rule and, when editing today, the current queue as well. When the queue head reaches the van's passenger capacity at the terminal, the system records departure and advances the remaining positions automatically.

Taya lateness is event-driven rather than time-driven. When a vehicle is dispatched, only its immediate queue follower is evaluated. If that follower is outside the 100 m terminal geofence, the row is marked **Late** and rotated behind the other eligible active drivers; the next available driver moves forward. The current daily Taya sequence stores this rotation, while future weekday sequences remain unchanged.

## Payment decisions

GCash receipts are served only through the authenticated dispatcher route. Approving a receipt changes the payment to `VERIFIED` and the reservation to `CONFIRMED` in one transaction. Rejecting changes the payment to `REJECTED`, moves the reservation to `FORFEITED`, releases its seats, records the required reason, and notifies the passenger.

PayPal captures are visible for reconciliation but deliberately have no dispatcher mutation controls.

## Refresh and demo behavior

The dispatcher queue polls every three seconds; dashboard and fleet data poll every eight seconds. The included GCash record contains demo receipt metadata but no uploaded binary; the interface displays a safe placeholder. Running `npm run prisma:seed` restores queue order, the pending driver assignment, and the pending GCash verification state.
