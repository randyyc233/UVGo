# UVGo

UVGo is a polished, mobile-first capstone prototype for UV Express dispatch, queue management, and passenger reservations at the Naga City East Bound Terminal (NCEBT). It supports public departure discovery and three authenticated roles: passenger, driver, and dispatcher.

All ten delivery phases are complete. The implementation follows the supplied mobile and desktop mockups while enforcing the business specification: Goa uses scheduled Goso dispatch and is the only reservable route; Legazpi uses occupancy-triggered Taya dispatch and is visible operationally but cannot be booked online.

## Tech stack

- Client: React 19, TypeScript, Vite, React Router, Tailwind CSS, Lucide icons, Mapbox GL JS
- Server: Node.js, Express 5, TypeScript, Zod, JWT cookie sessions, Helmet, rate limiting, Multer
- Data: MySQL 8.4 and Prisma 6
- Payments: GCash-only passenger checkout using receipt upload and dispatcher verification, with legacy PayPal records retained for compatibility
- Quality: TypeScript, ESLint, Node test runner through `tsx`, production builds, and rendered browser QA

## Architecture

The repository is an npm workspace with independent frontend and backend applications:

```text
Browser
  -> client/ React application
       -> /api requests with secure session cookie
            -> server/ Express API
                 -> service-layer business rules
                      -> Prisma Client
                           -> MySQL
```

Authorization is enforced on both sides. React route guards provide the correct user experience, while Express middleware is the security boundary and returns `401` or `403` for invalid access.

## Folder structure

```text
capstone/
|-- client/                         React frontend
|   |-- public/assets/              Supplied hero and van assets
|   `-- src/
|       |-- auth/                   Session and route guards
|       |-- components/             Shared UI, layouts, and feature components
|       |-- pages/                  Public and role-specific screens
|       `-- types/                  API view models
|-- server/                         Express backend
|   |-- prisma/                     Schema, migrations, seed, and demo reset
|   |-- src/
|   |   |-- controllers/            HTTP request handlers
|   |   |-- middleware/             Authentication, errors, and uploads
|   |   |-- routes/                 Public and protected API routes
|   |   |-- services/               Domain and dispatch automation
|   |   `-- validators/             Zod request schemas
|   `-- tests/                      Critical business-rule integration tests
|-- docs/                           Feature and operations documentation
|-- package.json                    Workspace commands
`-- README.md
```

## Requirements

- Node.js 20.19 or newer
- npm 10 or newer
- MySQL 8 or MariaDB 10.4+ (XAMPP is supported for local development)
- A Mapbox public access token for dispatcher maps

## Environment variables

Copy the committed examples before starting:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

Backend variables:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | Express port; defaults to `4000` |
| `CLIENT_ORIGIN` | Allowed browser origin |
| `DATABASE_URL` | Prisma MySQL connection URL |
| `JWT_SECRET` | Session signing secret of at least 32 characters |
| `JWT_EXPIRES_IN` | Session lifetime |
| `GMAIL_USER` | Gmail or Google Workspace address used to send verification and password-reset codes |
| `GMAIL_APP_PASSWORD` | Google App Password for SMTP; never use the account's normal password |
| `EMAIL_FROM_NAME` | Sender display name; defaults to `UVGo` |
| `EMAIL_CODE_TTL_MINUTES` | Verification/reset code lifetime; defaults to 10 minutes |
| `PAYPAL_CLIENT_ID` | Optional PayPal Sandbox client ID |
| `PAYPAL_CLIENT_SECRET` | Optional PayPal Sandbox secret |
| `PAYPAL_BASE_URL` | PayPal Sandbox API base URL |
| `UPLOAD_DIR` | Private GCash receipt directory |
| `DEMO_MODE` | Enables local payment fallback and simulation controls |
| `DISPATCH_ENGINE_INTERVAL_MS` | Automation evaluation interval |

Frontend variables:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API base; `/api` is used with the Vite proxy |
| `VITE_MAPBOX_ACCESS_TOKEN` | Public Mapbox token used only in the client map |

For Gmail SMTP, enable 2-Step Verification on the sending Google account, open [Google App Passwords](https://myaccount.google.com/apppasswords), and generate a 16-character password for UVGo. Put that generated value in `server/.env` (spaces are optional), restart the server, and request a fresh verification code. Do not use the account's normal password. If Google does not show the App Passwords page, the account may be organization-managed, enrolled in Advanced Protection, or configured for security keys only. Never commit Gmail credentials, real PayPal secrets, JWT secrets, or uploaded receipts.

## MySQL and Prisma setup

Start your locally installed MySQL or MariaDB server. For XAMPP on Windows, start **MySQL** from the XAMPP Control Panel, then create the local database and account:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root
```

```sql
CREATE DATABASE uvgo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'uvgo'@'localhost' IDENTIFIED BY 'uvgo_dev_password';
GRANT ALL PRIVILEGES ON uvgo.* TO 'uvgo'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

The example `DATABASE_URL` connects to the local database on the standard port `3306`. Change its username, password, host, or port if your installation uses different values.

Generate Prisma Client, apply the committed migrations, and seed the demonstration dataset:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

The seed command is idempotent. To remove all runtime demo mutations and restore the exact baseline, use the guarded demo-only reset:

```bash
npm run demo:reset
```

The reset refuses to run when `NODE_ENV=production` or `DEMO_MODE=false`.

## Starting the application

Install dependencies and run both applications:

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- API: `http://localhost:4000`
- Health check: `http://localhost:4000/api/health`

To run each side separately:

```bash
npm run dev --workspace client
npm run dev --workspace server
```

Production build and server startup:

```bash
npm run build
npm run start --workspace server
```

## Demo accounts

All demo accounts use password `UVGoDemo123!`.

| Role | Email |
| --- | --- |
| Goa Dispatcher | `dispatcher@uvgo.demo` |
| Legazpi Dispatcher | `dispatcher.legazpi@uvgo.demo` |
| Driver | `driver.rodel@uvgo.demo` |
| Passenger | `passenger@uvgo.demo` |

Additional seeded people and vehicles support FIFO, reassignment, payment-verification, and occupancy demonstrations.

The seeded `@uvgo.demo` addresses are intentionally non-routable. In development, verification and password-reset codes for those demo accounts are displayed in the app instead of being sent through Gmail. Real Passenger, Driver, and Dispatcher email addresses use the configured Gmail delivery service; production never displays a code.

## Simulation controls

Sign in as either route dispatcher and open **More** to access demo-only operational controls scoped to that dispatcher’s assigned route:

- **Simulate entry** moves seeded `VAN-005` into the NCEBT 5 km Active Zone through the real geofence service.
- **Run dispatch engine** immediately evaluates assignment expiry, Goso timing, and Taya readiness.
- `npm run demo:reset` restores vehicles, queues, assignments, bookings, payments, notifications, and logs.

Every simulation is written to the dispatch audit log. See [docs/demo-runbook.md](docs/demo-runbook.md) for a guided presentation sequence.

## Legacy PayPal compatibility

PayPal is not offered for new passenger bookings. Its service, environment variables, and captured demo record remain for historical compatibility and regression coverage.

If the legacy Sandbox path must be exercised, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `server/.env` using credentials from a PayPal Sandbox application. Keep `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`.

When credentials are configured, UVGo creates and captures real Sandbox orders. With blank credentials and `DEMO_MODE=true`, it creates a local `DEMO-*` order and completes capture locally so the full booking state transition remains demonstrable. Production mode never falls back to demo capture.

## GCash receipt flow

GCash is intentionally a manual verification flow:

1. The passenger uploads an image receipt for the GCash-only checkout.
2. The server validates and stores the file outside the public client directory.
3. The booking and payment enter `PendingVerification`.
4. A dispatcher reviews the receipt under **Payments** and approves or rejects it.
5. Approval confirms the booking; rejection returns it to pending payment and records a reason.

This prototype does not connect to a GCash merchant API.

## Core business rules

- The NCEBT Active Zone has a fixed seeded center and a 5 km radius.
- Goa is Goso: fixed schedule, FIFO vehicle assignment, and no full-occupancy requirement.
- Legazpi is Taya: strict geofenced-arrival FIFO and exactly 100% occupancy before ready-for-dispatch.
- Only Goa trips can be reserved online.
- Seats are unique per trip and checked again inside the reservation transaction.
- Driver rejection or response expiry advances the assignment to the next eligible van.
- Queue-position overrides accept an optional reason and always create a `DispatchLog`; delay, move-to-last, and replacement actions still require a reason.
- Rescheduling closes 24 hours before departure and preserves passenger count.
- An unavailable vehicle reallocates eligible reservations and notifies affected passengers.
- Detailed fleet/geofence visualization is dispatcher-only; drivers receive operational status rather than continuous GPS maps.

## Quality commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run demo:reset
```

`npm test` runs all 21 critical business-rule tests against MySQL and restores the demo baseline afterward. The coverage inventory is documented in [docs/test-and-release.md](docs/test-and-release.md).

## Documentation

- [Mockup mapping](docs/mockup-map.md)
- [Design system](docs/design-system.md)
- [Authentication and data model](docs/auth-and-data.md)
- [Public experience](docs/public-experience.md)
- [Passenger booking](docs/passenger-booking.md)
- [Driver operations](docs/driver-operations.md)
- [Dispatcher operations](docs/dispatcher-operations.md)
- [Dispatch automation](docs/dispatch-automation.md)
- [Accessibility and responsive behavior](docs/accessibility-and-responsive.md)
- [Demo runbook](docs/demo-runbook.md)
- [Testing and release QA](docs/test-and-release.md)

## Known prototype limitations

- This is a single-terminal capstone prototype, not a multi-tenant production dispatch platform.
- Dispatcher maps show the current operational snapshot; permanent detailed location history is intentionally excluded.
- Driver location transitions are submitted events, not continuous background mobile GPS tracking.
- Legacy PayPal regression coverage requires Sandbox credentials for external approval; demo mode supplies a clearly isolated local fallback.
- GCash verification is manual and receipt images use local disk storage.
- Booking and dispatch notifications remain in-app records; email delivery is limited to account verification and password recovery.
- The application uses seeded Philippine routes and fares and does not include an administrator role.
- The dispatcher map chunk is intentionally substantial because Mapbox is loaded for that role; it is lazy-loaded away from public, passenger, and driver routes.
#   U V G o  
 
#   U V G  
 
