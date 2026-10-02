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
- `POST /api/passenger/reservations/quote` (server-calculated fare and eligible passenger discounts; no seat hold)
- `GET /api/passenger/paypal/config` (public Sandbox client ID, authenticated passenger only)
- `POST /api/passenger/reservations/paypal` (server-priced order and seat hold)
- `POST /api/passenger/bookings/:reference/paypal/capture` (verified capture and automatic confirmation)
- `POST /api/passenger/bookings/:reference/paypal/release` (verified unpaid checkout only)
- `POST /api/passenger/reservations/paypal/hosted` (historical receipt compatibility)
- `POST /api/passenger/reservations/gcash` using `multipart/form-data`
- `GET /api/passenger/bookings`
- `GET /api/passenger/bookings/:reference`
- `POST /api/passenger/bookings/:reference/reschedule`
- `GET /api/passenger/notifications`

All endpoints require an authenticated Passenger role. Attempts by another role receive `403`, and attempts to reserve a Legazpi trip receive `422 GOA_ONLY`.

Passenger trip and booking responses include both `boardingStartTime` (shown as
**Loading**) and `departureTime`. The trip search results, booking summaries,
confirmation screen, booking cards, booking details, and reschedule choices all
display both local date/times so passengers know when boarding opens as well as
when the van leaves. Rows without an explicit loading time use the established
fallback of ten minutes before departure.

New reservations close **five hours before loading starts**, using the trip's
explicit loading time or the same ten-minute-before-departure fallback. At the
cutoff instant, the trip disappears from reservation search and seat selection,
fare quotes, and every reservation-creation payment path reject stale requests
with `409 TRIP_CLOSED`. Search and seat-map responses expose
`reservationCutoffTime`, shown on schedule cards and booking summaries. Early
morning loading can have a cutoff on the previous day.

Existing bookings, dispatcher payment verification, and capture of a PayPal
checkout created before the cutoff continue normally. Passenger rescheduling
closes five hours before the currently booked trip's loading time, and the destination
trip must also remain before its reservation cutoff. Operational loading,
queue, and departure times do not change.

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
fee** added on top. The subtotal is `trip.fareAmount * seatCount`; the payable total subtracts
the server-calculated student/senior discount when claimed. Regular bookings keep the same
subtotal and total. The dispatcher schedule form prefills its fare from the server-provided
`defaultFare`, so the create form cannot drift from the configured default.

## Student and senior passenger discounts

Passengers select the number of students and senior citizens in the contact-details step.
Each eligible passenger receives 20% off one seat; regular passengers pay the full fare.
The combined discounted count cannot exceed the selected seats, so a passenger cannot
receive both discounts. Every claimed discounted passenger must bring a valid ID to
the terminal; the booking requires acknowledgement of this condition. No ID uploads
or advance approval workflow is added.

`POST /api/passenger/reservations/quote` returns the server-calculated subtotal,
discount amount and total without creating a reservation or holding seats. Each
eligible seat's 20% discount is rounded to two decimal places before adding the group
discount. Reservation creation recalculates using the stored trip fare, records the
student/senior counts and discount, and stores the net payable amount on Payment.
PayPal orders and capture verification use that stored amount. GCash instructions,
booking summaries and the mobile action area show the quoted discounted total.

Reservation discount fields default to zero, leaving historical bookings and payments
unchanged. Rescheduling and reallocation retain the original saved discount and payment
amount. The dispatcher payment card exposes claimed counts for terminal ID checking.

The selected 20% policy is consistent with the fare-discount provisions in
[RA 11314](https://lawphil.net/statutes/repacts/ra2019/ra_11314_2019.html) and
[RA 9994](https://lawphil.net/statutes/repacts/ra2010/ra_9994_2010.html).

## Seat integrity

A reservation can contain up to **11 passengers**, limited to the selected trip's
remaining available seats: `min(11, available seats)`. The public search and booking
selectors support 1–11 passengers; search and reservation request validation enforce
the same ceiling. Fully booked departures cannot be selected. Existing seat availability
checks and fare calculations continue to apply to every selected seat.

Seat availability comes from the database rather than client state. `ReservationSeat` has a unique `(tripId, seatNumber)` constraint, and booking creation runs inside a Prisma transaction. A concurrent uniqueness conflict is normalized to `409 SEAT_UNAVAILABLE`, prompting the passenger to choose again.

The selected trip is revalidated when its seat map is opened and again inside the reservation transaction. A departure that has passed or moved to a non-bookable operational status returns `409 TRIP_CLOSED`, so a trip that closes after search cannot accept a stale submission. The reservation, payment record, seat rows, passenger contact update, and passenger notification commit together.

Seat capacity is **per van and dispatcher-adjustable**, defaulting to 11 passenger seats (plus the driver). It is stored on `Vehicle.capacity`, set in the dispatcher's Drivers & Vehicles screen, and constrained to 1–30. Every seat map, availability count, occupancy check and fare total derives from the trip's own vehicle capacity, so changing a van's capacity changes what passengers can book on that van's departures. Seat 1 is the only passenger seat beside the driver.

The selector uses the supplied `top view of van for seat selection overlay.png` asset. Available, selected, and unavailable states have text-based accessible labels in addition to color and disabled state.

## Payment choices

New passenger bookings offer GCash receipt verification and integrated PayPal Sandbox checkout.
The PayPal JavaScript SDK renders one PayPal payment button inside the mobile action area.
The server retains the secret and calculates the amount using the existing fare and seat count.

### GCash

The selected trip supplies the Goa dispatcher's configured GCash name and mobile number. The
passenger sends the exact booking total, optionally enters the GCash reference, and uploads a JPG,
PNG, or WEBP receipt (maximum 5 MB). `POST /api/passenger/reservations/gcash` creates a
`PENDING_VERIFICATION` reservation. The dispatcher must approve or reject the receipt.

### Integrated PayPal Sandbox checkout

Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` privately on the server using the same
Sandbox REST application, with `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`. The
checkout config endpoint exposes only the client ID, PHP currency, intent, and Sandbox label.
The HTTP checkout refuses missing credentials even when demo mode is enabled, and refuses a
live API base URL. No secret is put into the frontend bundle.

1. Starting checkout calls the existing reservation creation transaction to validate the
   departure and hold the selected seats. Its stored payment amount prices the PayPal order.
2. The passenger approves payment through PayPal's secure Sandbox checkout.
3. The server retrieves its stored order using merchant credentials, checks the order ID,
   reservation reference, PHP amount and merchant, then captures with a deterministic request ID.
4. Only one completed, final capture for the exact stored amount confirms the reservation.
   Its capture ID is stored through the existing unique external-reference field. The payment,
   reservation and booking notification update in one transaction, with no dispatcher approval.

Repeated capture requests retrieve/reconcile the existing order instead of charging again.
Capture and release lock the same payment row. Cancellation checks PayPal and only deletes an
unpaid hold; approved orders and pending payments remain held. If payment completed but the
response was lost, verification/cancellation recovers and confirms that payment instead.

The checkout offers retry/check controls. An interrupted checkout can also be reopened in
My Bookings, where the passenger can resume the same order, check payment, or release a verified
unpaid checkout. Closing the browser alone does not automatically release its hold.

This initial Sandbox integration reconciles through the capture/check endpoints; it does not
install a public webhook. If the browser closes after payment, use My Bookings to check and
reconcile. A future webhook requires a deployed HTTPS listener and verified PayPal events.

Historical hosted-button receipts and existing records retain their dispatcher-verification
API for compatibility. The hosted button and receipt form are no longer shown for new PayPal
checkouts. GCash receipt verification and all existing rescheduling rules are unchanged.

## Rescheduling

The server enforces a cutoff **five hours before the currently booked trip's
loading time**, replacing the former 24-hour-before-departure rule. For example,
10:00 AM loading requires a reschedule before 5:00 AM. At the cutoff instant,
`canReschedule` is false and stale requests return `409 RESCHEDULE_WINDOW_CLOSED`.
Legacy trips without an explicit loading time use the standard loading fallback.

Only confirmed, rescheduled, or reallocated bookings can be moved. Each reservation
allows **three successful passenger reschedules**. `Reservation.rescheduleCount`
persists the number of changes, and the API supplies `rescheduleCutoffTime`,
`rescheduleCount`, `rescheduleLimit`, and `reschedulesRemaining` for booking details.
The third success disables further rescheduling; a fourth request returns
`409 RESCHEDULE_LIMIT_REACHED`. The reservation row is locked during the transaction
so concurrent submissions cannot exceed the limit. Failed requests and submissions
that leave the trip and seats unchanged do not consume a change. Automatic
dispatcher reallocations retain the counter without consuming an attempt.

The migration initializes historical counts from retained reschedule notifications
and records with `RESCHEDULED` status. Previously deleted historical notifications
cannot be reconstructed; new counts remain independent of notification deletion.
The passenger must choose an open Goa trip before its reservation cutoff with the
same number of available seats. Seats, payment amounts, and discounts retain their
existing rules. No cancellation or refund action exists.

## Phase smoke test

For legacy compatibility testing, the GCash multipart path can still be checked with:

```bash
npx tsx server/scripts/phase5-smoke.ts
```

The script signs in using a seeded passenger, selects an available future Goa seat, uploads a small PNG fixture, and verifies the pending-verification response.
