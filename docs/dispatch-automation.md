# Dispatch automation — Phase 8

Phase 8 implements the business-rule engine behind the existing passenger, driver, public, and dispatcher interfaces. It does not add demo-only mutation buttons; those remain part of Phase 10.

## Hybrid geofence transitions

The dispatcher's queue **Dispatch** action independently confirms actual departure immediately for either route. It commits the trip departure, van status, queue removal, queue renumbering, audit log and driver notification together; GPS exit confirmation is not required. An existing trip keeps its published booking times, and its active assignment remains as historical evidence after departure. The **Passengers** queue action records a dispatcher-authored total aboard, enforces vehicle capacity and recalculates Taya readiness without changing bookings or payments.

`POST /api/driver/location` accepts latitude, longitude, GPS accuracy, and optional speed/heading for the authenticated driver's assigned vehicle. The server records the authenticated report's receipt time rather than trusting a device timestamp; this keeps stationary browser and real-device heartbeats fresh despite clock skew or a reused browser timestamp. The server calculates Haversine distance from the configured NCEBT center and separates three operational decisions:

1. Entering the `<= 5 km` Active Zone marks the van `INCOMING` and starts operational tracking. It does **not** change the planned queue order.
2. Terminal arrival is confirmed only after the configured number of reliable, time-separated samples inside the provisional terminal zone (100 m by default). Goa can use this observation for an unscheduled queue timestamp; Taya keeps the dispatcher-defined daily position and uses the sample only to confirm terminal presence. The dispatcher fleet map draws this same operational radius as an amber circle centered on NCEBT.
3. For both Goa/Goso and Legazpi/Taya, the first queued van with an active trip/assignment is automatically dispatched after one reliable sample outside that same 100 m circle. The driver does not need to press Authorize departure. Trip departure, queue removal, and queue renumbering commit together. This records an actual exit even before the planned departure time or before Taya reaches capacity; readiness remains a separate operational signal.

A sample is reliable only when it satisfies the configured accuracy and freshness limits. Samples that arrive too quickly cannot increment a confirmation sequence. Out-of-order samples are ignored for state changes. The server retains the latest operational point and boundary events; it does not expose a continuous location-history endpoint.

An exit by a later queued van, or a van without an active trip/assignment, changes the vehicle to `DEPARTURE_REVIEW` without marking its trip departed or advancing the queue. Unreliable GPS never confirms departure. The existing manual confirmation path remains available for an authorized departure needing GPS review, with a required audit reason. A departed van leaves the operational tracking state after exiting the 5 km Active Zone, but Go on Trip remains enabled until the driver turns it off. The driver portal continues sending GPS while open and the switch is on.

The circle is configured through `TERMINAL_ARRIVAL_RADIUS_M` (default 100); arrival, map, attendance and exit share it. The old `TERMINAL_DEPARTURE_RADIUS_M` setting is no longer used. Reliability remains configurable through `GEOFENCE_REQUIRED_SAMPLES`, `GEOFENCE_MAX_ACCURACY_M`, `GEOFENCE_SAMPLE_MIN_INTERVAL_MS`, `GEOFENCE_SAMPLE_MAX_AGE_MS`, and `GEOFENCE_MIN_OUTWARD_PROGRESS_M` (defaults: 1 sample, accuracy at most 50 m, at most 60 seconds old; the 8-second spacing and 5 m outward-progress settings apply when multiple samples are required). These are engineering defaults—not field-validated NCEBT boundaries. Use `geofence-field-validation.md` before citing fixed distances in the manuscript.

## Queue and assignment engine

The engine runs immediately on server start and then every `DISPATCH_ENGINE_INTERVAL_MS` milliseconds, defaulting to 10 seconds. Overlapping ticks are prevented.

For Goa/Goso, active queue normalization orders non-late scheduled drivers by loading time, regardless of terminal arrival time. Early arrival never overtakes an earlier scheduled driver. A separate late marker keeps missed loading slots behind all non-late active entries; late drivers retain the order in which they became late. Unscheduled rows use their saved position and arrival details only after scheduled, non-late rows. Legazpi/Taya materializes the matching weekday from the recurring weekly sequence into an operational daily queue and never reorders it from arrival timestamps. Replaced and departed rows remain for auditability but are excluded from operational queue views. Attendance, reordering, assignment activation, occupancy and departure completion use a route-scoped serializable transaction lock so competing operations cannot duplicate a late decision.

Scheduled assignments are active immediately. Legacy pending rows are promoted to active assignments on an engine tick; they do not expire or wait for a driver response.

When a driver cancels an accepted scheduled assignment, the promotion and notification path assigns the next eligible driver. Driver and dispatcher queue views poll every three seconds while visible and refresh on focus, so affected queue positions converge without a manual reload.

## Goso — Goa

- Active Monday–Sunday timetable rules continuously materialize an idempotent rolling eight weeks of concrete Goa trips. Only the nearest seven days are assigned immediately; later occurrences receive assignments as the scheduler advances.
- Weekly-rule edits, pauses and removal replace future unbooked occurrences while preserving every booked occurrence unchanged. Multiple concrete schedules for one driver on the same Manila service day are supported.
- A dispatcher-created Goa schedule immediately creates an active assignment for the driver of its selected van and sends the driver a dated notification.
- A driver may hold multiple Goa schedules on the same Manila calendar day. Each occurrence retains its own assignment, loading/departure times and queue linkage.
- Direct scheduled assignments for a future Manila calendar day do not create a live queue entry. When that service day begins, the server creates or reuses the van's queue row and links it to the already active assignment.
- Editing today's weekly rule replaces an obsolete, unbooked occurrence even when its former time has already passed. If that occurrence already departed, UVGo preserves the departed trip as history and creates the edited later occurrence as a new active schedule instead of reviving the old row.
- Creating or editing a current-day schedule immediately admits its accepted occurrence to the live queue; it does not wait for a later polling or scheduler cycle. Each accepted occurrence receives its own queue row, including another upcoming occurrence for a van that already has an earlier schedule that day.
- Editing a current-day loading time updates the linked queue row and re-sorts non-late Goso entries by loading time, with the earliest active loading schedule in position 1.
- Existing managed schedules that predate this behavior are reconciled automatically on a dispatch-engine tick when they have never had an assignment.
- Unmanaged Goa trips enter FIFO assignment processing ten minutes before departure, and the first eligible queued van receives that assignment.
- At the scheduled **loading** time (not the later departure time), an accepted driver's terminal attendance is checked on the first due scheduler tick. With no explicit loading time, the fallback is departure minus ten minutes.
- At each driver's scheduled loading time, the engine checks that driver's latest reliable terminal state against the 100 m geofence. If the driver is outside, the row is marked `Late` and moved to the last active position. Drivers behind move up once and adopt the earlier loading slots in chronological order; the late driver adopts the former last active loading slot.
- A late rotation changes the vans/drivers assigned to the affected slots, not the passenger schedules themselves. Each trip ID, stored loading/departure time, reservation reference, fare and payment stays fixed while the replacement van and driver inherit that trip.
- A successor is not penalized before the loading slot currently assigned to that driver. Early terminal arrival still cannot overtake an earlier scheduled slot.
- A present accepted driver is marked `BOARDING`, with attendance recorded for that trip and van. Passenger counting requires a confirmed terminal entry and no stale, inaccurate or outside latest location. Legacy records with confirmed entry but no telemetry retain that confirmation until real samples arrive.
- Queue adjustment changes the vans/drivers assigned to the next affected same-day slots, not the passenger times. Each trip ID, loading/departure time, reservation reference, fare and payment remains fixed. Seats are retained where valid and remapped without collisions for a smaller van. Onboard counts are reset for changed manifests. Passengers and affected drivers are notified.
- If no suitable present replacement can cover the bookings, the departure is flagged `awaitingQueueReplacement`, bookings remain intact, and the dispatcher receives an alert. The engine retries without repeating the same penalty. The published time is retained, but an actual departure can be late if no van is available.
- An accepted trip becomes ready at departure time only while terminal presence is valid. Dispatcher-delayed vans are not silently restored by the attendance engine.
- Occupancy is displayed but never blocks readiness.
- Passenger-count reporting requires the authenticated driver's accepted assignment, terminal presence, and the schedule's loading time to have opened.
- Override and Move to last remain available to the route's dispatcher. They transactionally update the affected queue/schedule assignments while retaining passenger times and payments; an impossible capacity allocation is rejected without a partial edit. Logs record the actor, reason and position changes.

## Taya — Legazpi

- The dispatcher saves a recurring Monday–Sunday sequence of managed Taya drivers/vans. It contains positions only—no loading or departure times.
- Today's weekday sequence materializes into active queue rows and active assignments even before terminal arrival; GPS arrival confirms presence without changing order.
- A stale `ON_TRIP` state from an earlier Manila service day cannot block today's saved sequence. The new daily occurrence clears the old operational state and creates a fresh queue row, while a van that actually departed today remains excluded until a later service day.
- Readiness is recalculated on every occupancy submission and scheduler tick. Reaching the van's capacity at the terminal automatically dispatches the current queue head.
- Only the saved queue head, while present in the terminal, can qualify for capacity dispatch; a full later van cannot bypass earlier positions.
- Manual Dispatch and a reliable queue-head exit beyond the shared 100 m terminal geofence are the other departure paths.
- Taya has no clock-based late check. Only the dispatch of the vehicle immediately ahead triggers attendance evaluation for its follower. If that follower is still outside the 100 m terminal geofence, the follower is marked **Late**, moved behind the other eligible active drivers, and the following driver advances. The rotation is persisted in the current daily Taya sequence so a later synchronization cannot restore the old order.
- A dispatcher-delayed queue entry is not silently reset by automation.

## Dynamic reallocation

The dispatcher Replace action runs one database transaction:

1. Select the next eligible FIFO van on the same route.
2. Reuse or create its trip for the same departure time.
3. Move confirmed, rescheduled, previously reallocated, and still-active pending-payment or pending-verification reservations.
4. Preserve seat numbers when available and allocate the next free seats otherwise.
5. Mark confirmed reservations `REALLOCATED`, preserve pending-payment states, and mark the source trip `UNABLE_TO_DEPART`.
6. Mark the source vehicle unavailable and remove its queue entry from active operations.
7. Assign and notify the replacement driver.
8. Notify every affected passenger and create vehicle-replacement and reservation-reallocation logs.

If affected reservations cannot fit on an eligible replacement van, the transaction fails without partially changing operational data.

Driver cancellation uses the same conflict-safe seat allocation in one transaction. It additionally marks the old assignment `CANCELLED`, records the optional reason, immediately activates the promoted driver's assignment, and gives each passenger a message stating whether their seat stayed the same or changed. If no replacement van is currently eligible, cancellation still succeeds and marks the original departure as awaiting dispatcher replacement.
