# UVGo demonstration runbook

## Prepare the demo

From the repository root:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run demo:reset
npm test
npm run dev
```

Open `http://localhost:5173`. All accounts use `UVGoDemo123!`.

## Suggested presentation flow

### 1. Public and passenger experience

1. Show the public landing page, supplied Bicol hero image, live departure board, and Goa-only booking call to action.
2. Sign in as `passenger@uvgo.demo`.
3. Search a future Goa departure and show the supplied top-view van asset with available, selected, and unavailable seats.
4. Continue through passenger information and show the two choices: GCash receipt upload or the merchant-supplied PayPal button.
5. For PayPal, explain that this posted button is the only PayPal checkout; the passenger returns with the transaction reference and the booking remains pending until dispatcher verification.
6. Open **My Bookings** and the seeded confirmed booking to show status and rescheduling eligibility.

### 2. Driver workflow

1. Sign in as `driver.rodel@uvgo.demo`.
2. Show assigned `VAN-033`, Go on Trip state, route, dispatcher, and current queue position.
3. Open **Assignment** and show that the scheduled trip is already assigned, with cancellation available if the driver cannot make the trip.
4. Show occupancy validation and the operational trip timeline. Emphasize that the driver does not receive a continuous map.

Reset before showing the dispatcher if the assignment was cancelled or other operational data was changed:

```bash
npm run demo:reset
```

### 3. Dispatcher workflow

1. Sign in as `dispatcher@uvgo.demo` for Goa operations, or `dispatcher.legazpi@uvgo.demo` for Legazpi operations.
2. Show KPI cards, fleet map, live alerts, departures, and activity.
3. Open **Queue** and demonstrate a position override with optional context, or a reason-required move-to-last action.
4. Open **Payments** and approve the seeded pending GCash receipt.
5. Open **Reports & Logs** to show the resulting immutable audit events.
6. Open **More** and select **Simulate entry**. `VAN-005` enters the actual 5 km geofence logic and writes a simulation log.
7. Select **Run dispatch engine** to evaluate Goso, Taya, and expired assignments immediately.

## Restore the baseline

```bash
npm run demo:reset
```

The reset command is destructive only to the local UVGo demo dataset. It is guarded and unavailable when `NODE_ENV=production` or `DEMO_MODE=false`.

## Troubleshooting

- If the application cannot reach the database, confirm that MySQL is running in the XAMPP Control Panel and that `DATABASE_URL` in `server/.env` uses port `3306`.
- If the map is blank, verify `VITE_MAPBOX_ACCESS_TOKEN` in `client/.env` and restart the client.
- If a demo action says the state is no longer eligible, run `npm run demo:reset`.
- Run `npm test` whenever you need to prove the critical domain rules independently of the UI.
