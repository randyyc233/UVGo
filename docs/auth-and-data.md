# UVGo data and authentication — Phase 3

## Data model

The MySQL schema is defined in `server/prisma/schema.prisma`, with an initial migration committed under `server/prisma/migrations`.

Core models:

- `User`: exactly Dispatcher, Driver, or Passenger; password hash, active state, and session token version
- `Vehicle`: route/protocol assignment, driver relation, status, geofence tracking state
- `GeofenceEvent`: entry/exit events only, with optional event coordinates and computed distance
- `QueueEntry`: route position and immutable arrival timestamp for FIFO sequencing
- `Trip` and `TripAssignment`: trip lifecycle and explicit driver response windows
- `Reservation` and `ReservationSeat`: Goa booking records with normalized, trip-unique seats and reservation lineage
- `Payment`: PayPal or GCash receipt metadata and manual-verification relations
- `PassengerCount`, `Notification`, and `DispatchLog`

All known states use Prisma enums. Operational lookup paths have indexes, destructive cascades are limited to dependent records, and user/vehicle/trip references use restrictive or nullifying deletion behavior where audit continuity matters.

## Seed data

Run:

```bash
npm run prisma:seed
```

The seed is repeatable and creates:

- one dispatcher
- four assigned drivers and four vans
- three passengers
- Goa/Goso and Legazpi/Taya queues and trips
- Goa-only reservations and seat allocations
- PayPal captured and GCash pending-verification examples
- geofence, occupancy, notification, assignment, and dispatch-log records

All demo accounts use the development-only password `UVGoDemo123!`:

| Role | Email |
| --- | --- |
| Dispatcher | `dispatcher@uvgo.demo` |
| Driver | `driver.rodel@uvgo.demo` |
| Passenger | `passenger@uvgo.demo` |

## Authentication flow

1. The single `/login` form posts email and password to `POST /api/auth/login`.
2. The backend validates the request, compares the bcrypt hash, and checks that the user is active.
3. The backend issues a signed JWT in an HTTP-only, same-site session cookie.
4. The response includes the backend-selected role and destination.
5. React redirects to the matching dashboard.
6. Every protected API request verifies the signature and then reloads the user from MySQL to enforce active state, current role, and token version.

Authentication endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

The login route is rate-limited. Production cookies require HTTPS. Passwords, JWT secrets, and database credentials are never placed in browser storage.

## Authorization

Frontend route guards improve navigation, but security is enforced by Express middleware:

- `/api/passenger/*` → Passenger only
- `/api/driver/*` → Driver only
- `/api/dispatcher/*` → Dispatcher only

Cross-role API requests return HTTP `403`; missing or expired sessions return `401`. The current `/session` endpoints are Phase 3 authorization probes and will be joined by feature routes in later phases.

## NCEBT constant

`server/src/config/terminal.ts` contains the seeded terminal name, Barangay Triangulo/Anciano Street address, prototype map center, and fixed 5 km radius. There is no administrator interface for changing the geofence.

