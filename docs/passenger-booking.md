# Passenger booking — Phase 5

Phase 5 implements the authenticated Goa reservation journey shown in the supplied mobile and desktop passenger mockups. The flow uses five separate steps: trip search, seat selection, passenger/payment information, review, and confirmation.

## Passenger routes

- `/passenger/home` — passenger overview, next booking, and recent updates
- `/passenger/book` — five-step Goa reservation flow
- `/passenger/bookings` — complete booking history
- `/passenger/bookings/:reference` — booking, payment, and reschedule details
- `/passenger/status` — booking-status view
- `/passenger/notifications` — in-app booking and payment notifications

Protected-route login preserves the requested passenger URL, so a signed-out passenger who starts a booking returns to the booking flow after authentication.

## Reservation API

- `GET /api/passenger/trips?date=YYYY-MM-DD&passengers=1`
- `GET /api/passenger/trips/:tripId/seats`
- `POST /api/passenger/reservations/paypal`
- `POST /api/passenger/reservations/:reference/paypal/capture`
- `POST /api/passenger/reservations/gcash` using `multipart/form-data`
- `GET /api/passenger/bookings`
- `GET /api/passenger/bookings/:reference`
- `POST /api/passenger/bookings/:reference/reschedule`
- `GET /api/passenger/notifications`

All endpoints require an authenticated Passenger role. Attempts by another role receive `403`, and attempts to reserve a Legazpi trip receive `422 GOA_ONLY`.

## Seat integrity

Seat availability comes from the database rather than client state. `ReservationSeat` has a unique `(tripId, seatNumber)` constraint, and booking creation runs inside a Prisma transaction. A concurrent uniqueness conflict is normalized to `409 SEAT_UNAVAILABLE`, prompting the passenger to choose again.

The selector uses the supplied `top view of van for seat selection overlay.png` asset. Available, selected, and unavailable states have text-based accessible labels in addition to color and disabled state.

## PayPal

When `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are configured, the backend obtains a sandbox access token, creates a PHP order, sends the passenger to PayPal approval, and captures the order after return. Only a completed capture changes the reservation to `CONFIRMED` and the payment to `CAPTURED`.

When credentials are absent and `DEMO_MODE=true`, the same create/capture state transition is exercised with an explicitly identified local demo order. This keeps local capstone demonstrations reproducible without pretending that an external PayPal payment occurred.

## GCash receipt verification

UVGo does not process GCash directly. Passengers pay externally and upload a JPG, JPEG, PNG, or WEBP receipt up to 5 MB, with an optional reference number. Files are stored under the ignored server upload directory. The resulting payment and reservation remain `PENDING_VERIFICATION`; dispatcher approval is scheduled for Phase 7.

## Rescheduling

The server, not only the interface, enforces the 24-hour rule. A booking can be moved only when its current departure is at least 24 hours away. The passenger must select another future Goa trip and the same number of available seats. No cancellation or refund action exists.

## Phase smoke test

With the development servers and seeded database running, the GCash multipart path can be checked with:

```bash
npx tsx server/scripts/phase5-smoke.ts
```

The script signs in using a seeded passenger, selects an available future Goa seat, uploads a small PNG fixture, and verifies the pending-verification response.
