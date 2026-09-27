# NCEBT geofence field-validation plan

The current implementation uses a 5 km incoming zone and one 100 m terminal circle for arrival, Goso loading attendance and automatic first-van departure. These are configurable engineering defaults. They must not be described in the manuscript as final NCEBT measurements until this field test is completed.

## Objective

Choose arrival and departure boundaries that recognize real terminal movement while resisting phone GPS drift. The result should preserve fair FIFO ordering, avoid false departure, and work across the phones and mobile networks drivers actually use.

## Equipment and participants

- At least three different driver phones, preferably a mix of Android models and age ranges.
- Location permission set to precise/high accuracy and battery optimization disabled for the test session.
- One dispatcher or observer at the terminal entrance/exit who records actual events and timestamps.
- At least two drivers or vehicles so FIFO behavior can be observed rather than inferred from one device.
- A simple test sheet containing phone, weather, time, observed GPS accuracy, actual position, server transition, and pass/fail notes.

Do not test while carrying passengers. Follow terminal traffic rules, use a passenger to operate the phone if the screen must be observed, and never ask a driver to interact with the device while moving.

## Map the operational geometry first

Record the actual terminal polygon, legal entrance, legal exit, waiting/queue area, nearby roads, and any places where a vehicle can pass close to the terminal without arriving. If the legal exit forms a distinct corridor, production calibration should use that mapped polygon/corridor rather than relying only on a circle around one point.

Confirm that:

- The arrival zone contains the real queue/waiting area.
- Nearby public roads are outside the arrival zone whenever possible.
- The departure boundary lies beyond ordinary parking or queue repositioning.
- The exit corridor covers the legal outward route and excludes inward/opposite-direction traffic.

## Test scenarios

Run every scenario on each phone at least five times and repeat during a second time period. Capture the server timestamps and the observer's actual timestamps.

1. Approach from outside 5 km and verify that the van becomes incoming without receiving a FIFO timestamp.
2. Pass near NCEBT without entering and verify that no terminal arrival is recorded.
3. Enter and stop in the real waiting area; verify that arrival requires the configured reliable sample count and that the FIFO timestamp matches the confirmed arrival within an acceptable delay.
4. Reposition within the terminal, including near the perimeter, and verify that no departure is recorded.
5. As a later queued van (or without an accepted assignment), leave the circle and verify that the system creates an exception while the trip and queue position remain intact.
6. Return after an early-exit exception and verify that terminal presence can be re-established without creating an unfair new FIFO time.
7. As the first queued van with an accepted assignment, leave the 100 m circle without pressing Authorize departure. Verify repeated reliable outward samples confirm departure and atomically advance the next queue entry, for both Goso and Taya. Check that crossing the circle merely to reposition would also count as departure under this rule; report any conflict with the real terminal layout.
8. Repeat the first-van exit with weak GPS or poor network service and verify that no automatic departure occurs from unreliable samples. Separately exercise the existing authorized-departure manual fallback with a written reason.
9. Simulate stationary GPS drift near both boundaries for at least five minutes and verify that isolated jumps do not change operational state.
10. Exit the 5 km Active Zone after confirmed departure and verify that location tracking shuts down.
11. Before Goso loading time, place a later-scheduled van inside 100 m while the earlier driver remains outside. Verify the original loading-time order does not change.
12. At the earlier driver's loading time, keep that driver outside 100 m and verify the row becomes Late and moves to the last active position exactly once. Verify later drivers are not marked late before their own loading times and that assignment, passenger loading/departure times, fares and payments remain unchanged. Keep another driver inside at their own loading time and verify attendance/boarding confirmation.

## Acceptance criteria

Set the exact thresholds with the research adviser and terminal stakeholders before the trial. At minimum, the dataset should demonstrate:

- Zero FIFO admissions from vehicles that merely enter the 5 km Active Zone.
- Zero departures caused by a single GPS point.
- Zero automatic departures for a later queued van or a van without an accepted active trip.
- Automatic departure and queue advancement for the accepted queue head without requiring a button, with reliable boundary confirmation.
- Confirmed arrivals and queue-head departures across every test phone with an operationally acceptable delay.
- An auditable manual path for cases where GPS cannot satisfy the reliability rules.

Investigate any false positive before accepting the circle. Propose changes to the shared radius, a mapped corridor, sample count or accuracy limit based on evidence—not on one successful phone run. Any policy change from the requested 100 m circle must be agreed with terminal stakeholders and reflected consistently in the map, loading attendance and departure rules.

## Finalization

Export the test observations, selected boundary coordinates, device list, trial dates, and rationale for every final threshold. Update the environment configuration and manuscript together so the documented method matches the deployed system. Keep the 5 km incoming radius conceptually separate from the terminal arrival polygon and exit corridor throughout the methodology and results sections.
