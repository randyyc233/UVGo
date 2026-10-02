# Phase 10: tests and release QA

## Automated critical coverage

`npm test` creates a unique `test_uvgo_<timestamp>_<pid>` MySQL database, applies the real migrations, runs sequential MySQL-backed tests there, and drops only that run's temporary database. It does not seed or reset the application's database. The database account needs create/drop permission for the `test_%` namespace (or run with a dedicated test-capable database URL). Direct execution of the fixture-resetting test file is guarded against the application database. The suite verifies:

1. 5 km geofence detection.
2. Goso scheduled-loading-time queue sequencing, with early-arrival overtake prevention.
3. Dispatcher-defined Taya weekly sequencing that materializes a time-free daily queue independent of terminal arrival order.
4. Taya remains not ready below 100% occupancy.
5. Scheduled assignments are active without driver approval.
6. Passenger-count rejection before the scheduled boarding window or for an inactive assignment.
7. Dispatcher override creates a dispatch log.
8. Legazpi reservation rejection.
9. Goa reservation creation.
10. Eleven selectable passenger seats plus one driver position.
11. PayPal demo capture confirmation.
12. GCash receipt pending-verification state.
13. Dispatcher GCash approval and booking confirmation.
14. Reschedule rejection at five hours before loading and after three successful changes, including concurrent submissions.
15. Confirmed and pending reservation reallocation to an eligible vehicle.
16. Accepted driver cancellation, FIFO replacement assignment, optional reason logging, and automatic seat-conflict resolution.
17. Server-side role authorization.
18. Dispatcher route isolation.
19. Dispatcher-owned driver and vehicle creation.
20. Goa schedule creation with immediate driver assignment and notification.
21. Legazpi fixed-schedule rejection.
22. Booked schedule locking.
23. Automatic materialization of today's Taya sequence into trips and assignments, with terminal arrival preserving the planned order.
24. Prior-day Taya departure state rolls into a fresh saved daily queue, without re-adding a van that already departed today.
25. Passenger-visible GCash rejection status, reason, and notification.
26. Goso loading-time no-show demotion, persistent Late state, present-driver retention, and no early assessment of later schedules.
27. Unchanged assignments, passenger times/payments, and idempotent simultaneous attendance ticks.
28. Persistent manual queue order and cross-route rejection.
29. Automatic first-van exit at 100 m for both protocols without the start button, later-van protection, duplicate/stale/poor GPS safeguards and one-time departure logging.
30. Multiple independent Goa schedules for the same driver on one Manila calendar day.
31. Dispatcher assignment views are scoped to the current Monday–Sunday Manila service week and roll over automatically without deleting audit history.
32. Idempotent Monday–Sunday weekly schedule generation, edits, pause/resume, booked-occurrence preservation, and duplicate-driver/day rejection.

The suite uses the same services and Prisma/MySQL database path as the application. It does not replace business rules with test-only copies.

## Release gate

Receipt upload tests use a separate temporary directory that is removed after the run. The PayPal receipt integration test authenticates its fixtures through the real authentication service, leaving the application login throttle unchanged and avoiding interference from earlier login tests.

Run from the repository root:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The rendered QA pass additionally covers:

- public, passenger, driver, and dispatcher sign-in and role redirects;
- unauthorized role routing and API rejection;
- mobile and desktop navigation;
- responsive widths at 320, 390, and 1440 CSS pixels;
- Goa trip search and seat-map rendering;
- driver assignment and queue visibility;
- dispatcher dashboard, queue, payment, logs, and demo controls;
- Mapbox rendering with the configured public token;
- keyboard focus handling for tabs, dialogs, drawer, and skip links;
- application console and API terminal errors.

## Demo-data safety

`npm run demo:reset` clears only UVGo domain tables and recreates the fixed demo identities and record IDs. It refuses to run in production or when demo mode is disabled. Runtime GCash receipt files are not broadly deleted by this command; uploaded files remain private and should be managed separately according to the deployment environment's retention policy.

