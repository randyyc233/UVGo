# UVGo demonstration runbook

## Prepare the demo

From the repository root:

```bash
docker compose up -d mysql
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
4. Continue through passenger information and show both PayPal and GCash choices.
5. Explain that PayPal uses Sandbox credentials when configured and a demo-only capture fallback otherwise.
6. Open **My Bookings** and the seeded confirmed booking to show status and rescheduling eligibility.

### 2. Driver workflow

1. Sign in as `driver.rodel@uvgo.demo`.
2. Show assigned `VAN-033`, Go on Trip state, route, dispatcher, and current queue position.
3. Open **Assignment** and demonstrate the accept/reject response window.
4. Show occupancy validation and the operational trip timeline. Emphasize that the driver does not receive a continuous map.

Reset before showing the dispatcher if an assignment was accepted or rejected:

```bash
npm run demo:reset
```

### 3. Dispatcher workflow

1. Sign in as `dispatcher@uvgo.demo`.
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

- If the application cannot reach MySQL, confirm `docker compose ps` reports `uvgo-mysql` as healthy.
- If the map is blank, verify `VITE_MAPBOX_ACCESS_TOKEN` in `client/.env` and restart the client.
- If a demo action says the state is no longer eligible, run `npm run demo:reset`.
- If PayPal redirects are unavailable, either configure Sandbox credentials or keep `DEMO_MODE=true` for the local capture path.
- Run `npm test` whenever you need to prove the critical domain rules independently of the UI.
