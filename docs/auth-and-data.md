# UVGo data and authentication — Phase 3

## Data model

The MySQL schema is defined in `server/prisma/schema.prisma`, with an initial migration committed under `server/prisma/migrations`.

Core models:

- `User`: exactly Dispatcher, Driver, or Passenger; route ownership for dispatchers, dispatcher ownership for managed drivers, password hash, active state, and session token version
- `Vehicle`: dispatcher ownership, route/protocol assignment, driver relation, status, and geofence tracking state
- `GeofenceEvent`: entry/exit events only, with optional event coordinates and computed distance
- `QueueEntry`: route position and immutable arrival timestamp for FIFO sequencing
- `Trip` and `TripAssignment`: trip lifecycle, automatic driver activation, and pre-departure cancellation history
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

- separate Goa and Legazpi dispatchers
- four assigned drivers and four vans
- three passengers
- Goa/Goso and Legazpi/Taya queues and trips
- Goa-only reservations and seat allocations
- PayPal captured and GCash pending-verification examples
- geofence, occupancy, notification, assignment, and dispatch-log records

All demo accounts use the development-only password `UVGoDemo123!`:

| Role | Email |
| --- | --- |
| Goa Dispatcher | `dispatcher@uvgo.demo` |
| Legazpi Dispatcher | `dispatcher.legazpi@uvgo.demo` |
| Driver | `driver.rodel@uvgo.demo` |
| Passenger | `passenger@uvgo.demo` |

## Authentication flow

1. Existing users sign in through `/login`, which posts email and password to `POST /api/auth/login`.
2. New passengers register through `/signup`, which posts their name, email, contact number, and password to `POST /api/auth/register`.
3. The backend validates the request, hashes new passwords with bcrypt, enforces unique emails, and assigns the Passenger role itself. A browser cannot choose a Driver or Dispatcher role.
4. Registration sends a six-digit email-verification code but does not create a session by itself. Verification remains available through `POST /api/auth/verification/confirm`.
5. Login compares the bcrypt hash and checks that the user is active. Email verification is not required for sign-in.
6. Successful login or email verification issues a signed JWT in an HTTP-only, same-site session cookie.
7. The response includes the backend-selected role and destination, and React redirects to the matching dashboard.
8. Every protected API request verifies the signature and then reloads the user from MySQL to enforce active state, current role, and token version. Unverified active accounts may use a valid password-authenticated session.

Passenger accounts may be self-registered. Driver accounts are created by their route dispatcher from Drivers & Vehicles. An authenticated dispatcher may create a trusted backup Dispatcher account, but only for their own server-assigned route; clients cannot select another route. Every active Passenger, Driver, and Dispatcher account can use the shared **Forgot password?** flow from the login page. A successful reset increments `tokenVersion`, invalidating all existing sessions without changing the account's role, route assignment, trip history, or dispatch history.

Authentication endpoints:

- `POST /api/auth/login`
- `POST /api/auth/register` (Passenger signup only)
- `POST /api/auth/verification/resend`
- `POST /api/auth/verification/confirm`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/logout`
- `GET /api/auth/me`

The login, registration, verification, and password-reset routes are rate-limited. Verification/reset codes expire after 10 minutes, allow at most five code checks, and are stored only as keyed SHA-256 hashes. Issuing a new code invalidates the previous code. Password reset increments `tokenVersion`, invalidating every existing session for the account. Forgot-password requests return the same public response for existing and unknown addresses so the endpoint cannot be used to enumerate UVGo accounts.

Email is delivered through Gmail SMTP using `GMAIL_USER` and a Google App Password in `GMAIL_APP_PASSWORD`. Development and test environments may omit those values; the generated code is then logged and returned in the explicitly labelled development-only response. Production never exposes a code and returns a service-unavailable error if Gmail delivery is not configured. Production cookies require HTTPS. Passwords, email codes, Gmail credentials, JWT secrets, and database credentials are never placed in browser storage.

## Authorization

Frontend route guards improve navigation, but security is enforced by Express middleware:

- `/api/passenger/*` → Passenger only
- `/api/driver/*` → Driver only
- `/api/dispatcher/*` → Dispatcher only, with every read and mutation restricted to the account’s assigned Goa or Legazpi route

Cross-role and cross-route dispatcher API requests return HTTP `403`; missing or expired sessions return `401`.

## NCEBT constant

`server/src/config/terminal.ts` contains the seeded terminal name, Barangay Triangulo/Anciano Street address, prototype map center, and fixed 5 km radius. There is no administrator interface for changing the geofence.

