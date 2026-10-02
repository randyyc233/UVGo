# Redeployment of the reservation and dispatcher update

Deploy the `main` branch using the existing root `Dockerfile` and the existing MySQL database. This release includes mobile booking, schedule and queue improvements; clickable payment receipts; reviewed-payment list deletion; editable public Goa fares; separate Goso/Taya departure history with daily filtering and per-dispatcher deletion; the prior-day Goso queue admission fix; passenger discounts; and integrated PayPal Sandbox checkout. Reservations and rescheduling close five hours before loading, and each reservation allows three successful passenger reschedules.

The dispatcher follow-up fixes reviewed payments and departure history reappearing after deletion: dashboard alert cleanup now preserves those saved list dismissals. It also puts mobile driver actions in a three-dot menu. This follow-up needs no additional database migration. If a previously removed entry has already reappeared, delete it again after deploying this version; the earlier cleanup erased its dismissal receipt.

## Build and startup

The Docker build installs the lockfile dependencies with `npm ci`, builds the React client and TypeScript server, and generates Prisma Client. Startup runs `prisma migrate deploy` before launching the API. This release adds three migrations:

- `20261001093000_reservation_passenger_discounts`: saved student/senior counts and discount amount.
- `20261001123000_public_route_fare`: public route-card fare settings.
- `20261002020000_reservation_reschedule_limit`: persistent reschedule counts, initialized from retained historical records.

Let startup apply these migrations to the existing database before checking health. No database reset or seed is needed. The reschedule migration cannot reconstruct historical notifications that were already deleted; new counters persist independently of notification deletion.

For the existing Coolify application, select repository branch `main`, build from the root `Dockerfile`, and keep the application's internal port at `4000`. Its `/api/health` endpoint is used by the Docker health check. Keep the public site on HTTPS for driver browser geolocation and production session cookies.

Frontend build arguments are `VITE_API_BASE_URL=/api`, `VITE_MAPBOX_ACCESS_TOKEN`, and `VITE_GOOGLE_CLIENT_ID` when Google sign-in is enabled. Vite embeds these values at build time. Keep the Google frontend and backend client IDs aligned. Server credentials remain runtime environment variables and must not be put in frontend build arguments or committed to Git.

Keep the existing runtime `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, Gmail configuration, and operational geofence settings. For live operations, explicitly use `DEMO_MODE=false`; retain the existing demo setting if this is intentionally a demonstration deployment.

New PayPal checkouts require runtime `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from the same Sandbox REST application, with `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`. The browser receives only the public client ID through the authenticated API. The checkout uses PHP and verifies the stored reservation total server-side. Missing credentials disable PayPal checkout; GCash receipt booking remains available when the Goa dispatcher's mobile number is configured. This integration intentionally supports Sandbox payments only. Historical hosted-button receipts keep their existing dispatcher-verification path, but the hosted button is no longer offered for new bookings.

The production HTML supplies a fresh CSP nonce to the PayPal SDK. Keep the application's CSP headers and HTTPS configuration. No new frontend build argument is needed for PayPal.

## Receipt persistence

Mount persistent storage at `/app/uploads/receipts` and set `UPLOAD_DIR=/app/uploads/receipts`. The container runs as the `node` user, so the mounted directory must be writable by that user. Existing GCash and PayPal receipts must survive container replacement. Confirm the storage mount is present before redeployment; a Docker `VOLUME` declaration alone does not identify a reusable host volume.

PayPal and GCash accept JPG, PNG, or WEBP images up to 5 MB. If a reverse proxy has a request-size limit, allow slightly more than 5 MB for multipart form overhead. Receipts remain private and are served through authenticated dispatcher endpoints scoped to the owning route.

## Verification

Before publishing, run from the repository root:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The test runner uses its own temporary database and receipt directory. It requires a database account with permission to create and drop those test databases. The PayPal receipt integration test creates sessions through the existing authentication service, so unrelated login tests cannot exhaust the shared login throttle. Application login rate limits remain unchanged.

After the deployment reports healthy, check the public homepage and route filters, passenger and dispatcher direct-page refreshes, and role sign-in. Confirm payment photos open when clicked, reviewed payments can be removed from the dispatcher's list and stay removed after dashboard refreshes, public Goa fares can be edited in Profile, and mobile schedule/queue layouts render correctly. Confirm Departure History appears as a separate navigation item for both routes and supports daily filtering and its three-dot deletion menu, with deletions surviving dashboard refreshes. On mobile Drivers & Vehicles, confirm the three-dot menu opens the existing Edit, Reset password, and Delete dialogs.

In passenger booking, confirm schedule cards display the five-hour reservation cutoff. Booking details must show the reschedule deadline and remaining attempts. For 10:00 AM loading, both actions close at 5:00 AM; the fourth successful-reschedule request is rejected. Existing payments remain verifiable after the cutoff. Exercise booking, rescheduling and payment submissions only with deliberately chosen test data or a real passenger workflow. Use Sandbox buyer accounts for PayPal checks.

Do not run `demo:reset` or seed the database as part of a routine redeployment. Keep the existing database, bookings, accounts, queue plans, and receipt storage. This source update does not substitute for real-device GPS field validation.

## Verification recorded on October 2, 2026

- Full integration suite after the dispatcher follow-up: 166 passed, zero failed, two non-demo checks skipped in the default run.
- Separate non-demo check run: both checks passed.
- Client and server TypeScript checks and ESLint: passed.
- Complete `npm run build`: passed, including the React production bundle, Prisma Client generation, and server compilation.
- Compiled production app with demo mode disabled: health returned OK; five public/passenger/dispatcher SPA routes and their entry assets loaded; protected APIs returned 401 without a session; unknown API routes returned a JSON 404. Each HTML response carried a fresh CSP nonce matching its header, with PayPal SDK domains allowed.
- New migration deployed locally and all 28 committed migrations applied successfully in isolated test databases.
- Mobile booking details displayed the five-hour reschedule deadline and remaining attempts. Boundary, concurrency, payment preservation, notification deletion, and automatic reallocation checks passed.
- Payment deletion regressions reproduced the dashboard-cleanup bug before the fix and passed afterward. HTTP deletion followed by a dashboard refresh and payment reload preserves dismissal; departure history also stays removed for both routes. Expired dashboard alerts still clear normally.
- Mobile driver actions were checked at 320px and 390px widths with no horizontal overflow. Each menu option opens its existing dialog; outside taps and Escape close the menu. Desktop action buttons remain available.

These are local release checks. The Dockerfile was reviewed; Docker is unavailable on this host, so a container image build and remote Coolify redeployment were not executed. Verify the persistent storage mount, PayPal runtime credentials, migration completion, and deployment health in the hosting environment.
