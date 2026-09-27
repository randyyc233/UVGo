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
- `POST /api/passenger/reservations/paypal/hosted` (dashboard-button payment, dispatcher-verified)
- `POST /api/passenger/reservations/gcash` using `multipart/form-data`
- `POST /api/passenger/reservations/paymongo/qrph` (dynamic QR Ph checkout)
- `GET /api/passenger/bookings`
- `GET /api/passenger/bookings/:reference`
- `GET /api/passenger/bookings/:reference/paymongo/qrph` (QR/status recovery)
- `POST /api/passenger/bookings/:reference/reschedule`
- `GET /api/passenger/notifications`

All endpoints require an authenticated Passenger role. Attempts by another role receive `403`, and attempts to reserve a Legazpi trip receive `422 GOA_ONLY`.

Passenger trip and booking responses include both `boardingStartTime` (shown as
**Loading**) and `departureTime`. The trip search results, booking summaries,
confirmation screen, booking cards, booking details, and reschedule choices all
display both local date/times so passengers know when boarding opens as well as
when the van leaves. Rows without an explicit loading time use the established
fallback of ten minutes before departure.

Reservation details expose a consistent `payment.transactionReference`: the
PayPal transaction/order ID or the passenger-supplied GCash receipt reference.
The same value is shown in the dispatcher payment-verification card. The UVGo
reservation reference remains a separate value used to find the reservation at
the terminal. Passengers are reminded to bring a valid ID matching the passenger
name and present it with the reservation reference.

## Fares

Default fares live in `server/src/config/fare.ts`. Individual departures carry their own
`Trip.fareAmount`, and a dispatcher can override the value when scheduling, so the config values
are the fallbacks used by the public route summary, the queue-dispatch path, and geofence trip
creation.

`Trip.fareAmount` is the full per-seat price the passenger pays — there is **no separate service
fee** added on top. The payable total is therefore `trip.fareAmount * seatCount`, always computed
on the server. The dispatcher schedule form prefills its fare from the server-provided
`defaultFare`, so the create form cannot drift from the configured default.

## Seat integrity

Seat availability comes from the database rather than client state. `ReservationSeat` has a unique `(tripId, seatNumber)` constraint, and booking creation runs inside a Prisma transaction. A concurrent uniqueness conflict is normalized to `409 SEAT_UNAVAILABLE`, prompting the passenger to choose again.

The selected trip is revalidated when its seat map is opened and again inside the reservation transaction. A departure that has passed or moved to a non-bookable operational status returns `409 TRIP_CLOSED`, so a trip that closes after search cannot accept a stale submission. The reservation, payment record, seat rows, passenger contact update, and passenger notification commit together.

Seat capacity is **per van and dispatcher-adjustable**, defaulting to 11 passenger seats (plus the driver). It is stored on `Vehicle.capacity`, set in the dispatcher's Drivers & Vehicles screen, and constrained to 1–30. Every seat map, availability count, occupancy check and fare total derives from the trip's own vehicle capacity, so changing a van's capacity changes what passengers can book on that van's departures. Seat 1 is the only passenger seat beside the driver.

The selector uses the supplied `top view of van for seat selection overlay.png` asset. Available, selected, and unavailable states have text-based accessible labels in addition to color and disabled state.

## Payment choices

New passenger bookings offer GCash receipt verification, the merchant-supplied PayPal button,
and PayMongo dynamic QR Ph. There is no PayPal SDK, Orders-v2, card-button, or alternate PayPal
checkout in the public booking flow.

### PayMongo QR Ph

The server calculates the reservation total from `Trip.fareAmount × seat count`, creates the
reservation as `PENDING_PAYMENT`, and creates one PayMongo Payment Intent per reservation. It then
creates and attaches a single-use `qrph` Payment Method and returns the Base64 QR image. The QR is
amount-specific and expires after 30 minutes by default. The PayMongo secret key and webhook
signing secret never reach the browser.

The public webhook endpoint is `POST /api/webhooks/paymongo`. Configure separate test/live
PayMongo webhook endpoints for `payment.paid`, `payment.failed`, and `qrph.expired`, and save the
endpoint signing secret as `PAYMONGO_WEBHOOK_SECRET`. The handler verifies `Paymongo-Signature`
against the exact raw body before touching the database. Successful events confirm the booking
and captured payment atomically and idempotently. Failed or expired attempts forfeit the unpaid
reservation and release its seats. The authenticated status endpoint retrieves the Payment Intent
as a webhook-delay recovery path; neither the displayed QR nor a browser response is proof of
payment.

### GCash

The selected trip supplies the Goa dispatcher's configured GCash name and mobile number. The
passenger sends the exact booking total, optionally enters the GCash reference, and uploads a JPG,
PNG, or WEBP receipt (maximum 5 MB). `POST /api/passenger/reservations/gcash` creates a
`PENDING_VERIFICATION` reservation. The dispatcher must approve or reject the receipt.

### Posted PayPal button

The only PayPal integration exposed by UVGo is the merchant-supplied **single-button form**:

```html
<form action="https://www.paypal.com/ncp/payment/GSVS6T37CPCJG" method="post" target="_blank">
  <input type="submit" value="Pay Now" />
</form>
```

The React component is `client/src/components/passenger/PayPalHostedButton.tsx`. It posts directly
to PayPal in a new tab and therefore needs **no SDK script, client ID, secret, iframe, or JavaScript
load event**. The component renders only this posted button; it does not add card logos, funding
buttons, fallback payment links, or another PayPal method.

This external checkout does not return an authenticated order or capture id to UVGo. The booking
flow is therefore intentionally two steps:

1. The passenger opens PayPal, checks that PayPal's final PHP price and quantity equal the UVGo
   booking total, and completes payment.
2. The passenger returns to UVGo, enters the completed transaction reference, and submits it to
   `POST /api/passenger/reservations/paypal/hosted`.

The server creates a `PAYPAL` payment and a `PENDING_VERIFICATION` reservation. A reference is
required but is **not proof of payment**. The Goa dispatcher must verify the completed transaction,
recipient, currency, full amount, and that it has not funded another booking before approving. A
rejected report moves the reservation to `FORFEITED`, releasing the seat hold. A reported PayPal
transaction reference cannot be submitted twice. This is enforced by a normalized, database-unique
payment-reference key as well as the friendly pre-submission check, so concurrent requests cannot
reuse the same external transaction.

The PayPal dashboard button currently offers Regular, Student and PWD values, while UVGo has one
server-authoritative fare (`trip.fareAmount × seat count`) and no concession-type field. UVGo does
not silently accept a discounted dashboard choice: the passenger is explicitly told not to pay if
PayPal's final total does not match the booking total. A future student/senior/PWD flow requires an
eligibility model and dispatcher verification before those prices can be integrated safely.

The older Orders-v2 helpers remain only for historical service-level compatibility tests. Their
create, capture, and cancel routes are not registered, so they cannot be used as a second public
PayPal payment method.

## Rescheduling

The server, not only the interface, enforces the 24-hour rule. Only a confirmed, rescheduled, or reallocated booking can be moved, and its current departure must be at least 24 hours away. The passenger must select another open future Goa trip and the same number of available seats. No cancellation or refund action exists.

## Phase smoke test

For legacy compatibility testing, the GCash multipart path can still be checked with:

```bash
npx tsx server/scripts/phase5-smoke.ts
```

The script signs in using a seeded passenger, selects an available future Goa seat, uploads a small PNG fixture, and verifies the pending-verification response.
