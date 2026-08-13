# Public experience — Phase 4

Phase 4 turns the shared design system into UVGo's responsive public homepage. It follows the supplied desktop and mobile references while preserving the product rule that only Goa trips can be reserved online.

## Experience

- The hero uses the supplied `Public Home hero background.png` asset with responsive crop and contrast treatment.
- The booking search teaser is fixed to Naga City East Bound Terminal → Goa Terminal and links into the protected passenger booking flow.
- Public route cards clearly separate Goa reservations from Legazpi status tracking.
- The departure board supports All, Goa, and Legazpi filters and refreshes automatically every eight seconds.
- Mobile navigation is keyboard-accessible, reports its expanded state, and closes after selection.
- Desktop departures use a table; smaller screens use touch-friendly cards without horizontal overflow.

## Public API

### `GET /api/public/departures`

Returns public-safe queue and trip information: route, van identifier, queue position, departure time, status, dispatch method, occupancy, and reservable seat count. Driver identity and passenger information are deliberately excluded.

### `GET /api/public/routes`

Returns the two public route summaries. Goa is marked reservable and includes live availability; Legazpi is explicitly status-only and does not expose a booking action.

## Reservation boundary

Only Goa entries render `Reserve` links. Legazpi entries show operational status and occupancy but never expose a reservation action or availability value. The server calculates and returns this distinction, and the client reflects it without trying to infer business rules.

The linked `/passenger/book` workflow is scheduled for Phase 5. Authentication already preserves the requested destination so passengers can sign in before continuing.
