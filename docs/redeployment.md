# Redeployment of the dashboard and PayPal receipt update

Deploy the `main` branch using the existing root `Dockerfile` and the existing MySQL database. This update includes the dashboard styling and mobile action layout, PayPal receipt upload with an optional transaction reference, dispatcher receipt viewing, and regression coverage. It preserves the daily Taya sequence, absent-follower rotation, Goso schedules, and payment verification workflows.

## Build and startup

The Docker build installs the lockfile dependencies with `npm ci`, builds the React client and TypeScript server, and generates Prisma Client. Startup runs `prisma migrate deploy` before launching the API. There are no new Prisma migrations in this update; the existing migration history remains intact.

For the existing Coolify application, select repository branch `main`, build from the root `Dockerfile`, and keep the application's internal port at `4000`. Its `/api/health` endpoint is used by the Docker health check. Keep the public site on HTTPS for driver browser geolocation and production session cookies.

Frontend build arguments are `VITE_API_BASE_URL=/api`, `VITE_MAPBOX_ACCESS_TOKEN`, and `VITE_GOOGLE_CLIENT_ID` when Google sign-in is enabled. Vite embeds these values at build time. Keep the Google frontend and backend client IDs aligned. Server credentials remain runtime environment variables and must not be put in frontend build arguments or committed to Git.

Keep the existing runtime `DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`, Gmail configuration, and operational geofence settings. For live operations, explicitly use `DEMO_MODE=false`; retain the existing demo setting if this is intentionally a demonstration deployment. The hosted PayPal button keeps its merchant URL and does not require the legacy SDK API credentials.

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

After the deployment reports healthy, check the public homepage and route filters, a direct passenger or dispatcher page refresh, role sign-in, responsive dashboard buttons, and the payment form's required receipt and optional PayPal reference labels. Verify historical receipts still open for the correct dispatcher. Exercise actual booking or payment submissions only with deliberately chosen test data or a real passenger workflow.

Do not run `demo:reset` or seed the database as part of a routine redeployment. Keep the existing database, bookings, accounts, queue plans, and receipt storage. This source update does not substitute for real-device GPS field validation.

## Verification recorded on September 30, 2026

- Full integration suite: 113 passed, zero failed, two non-demo checks skipped in the default run.
- Separate non-demo check run: both checks passed.
- Client and server TypeScript checks and ESLint: passed.
- Fresh checkout with `npm ci` and the complete `npm run build`: passed, including Prisma Client generation and server compilation.
- Compiled production app: homepage and passenger/dispatcher deep links served the SPA; built entry assets loaded; health returned OK; protected APIs returned 401 without a session; unknown API routes returned a JSON 404.

These are local release checks. The Dockerfile was reviewed, but a Docker image build and the remote Coolify redeployment were not executed during these checks. Verify the persistent storage mount and deployment health in the hosting environment.
