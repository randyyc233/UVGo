# Phase 10: tests and release QA

## Automated critical coverage

`npm test` runs sequential MySQL-backed tests and restores the seeded baseline after completion. The suite verifies:

1. 5 km geofence detection.
2. Goso FIFO queue sequencing.
3. Taya FIFO sequencing.
4. Taya remains not ready below 100% occupancy.
5. Driver rejection advances assignment.
6. Dispatcher override creates a dispatch log.
7. Legazpi reservation rejection.
8. Goa reservation creation.
9. PayPal demo capture confirmation.
10. GCash receipt pending-verification state.
11. Dispatcher GCash approval and booking confirmation.
12. Reschedule rejection inside 24 hours.
13. Reservation reallocation to an eligible vehicle.
14. Server-side role authorization.

The suite uses the same services and Prisma/MySQL database path as the application. It does not replace business rules with test-only copies.

## Release gate

Run from the repository root:

```bash
npm run demo:reset
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

