# UVGo mockup and asset map

This inventory is the visual contract for implementation. The supplied mockups control layout, hierarchy, spacing, typography, color, radius, shadow, navigation, and responsive composition. The product specification controls routes, data, permissions, and business behavior where sample mockup content conflicts.

## Screen references

| Source file | Primary reference for | Implementation notes |
| --- | --- | --- |
| `mockup to be follow for design.png` | Driver mobile | Driver Setup, Dashboard, Trip Assignment, and Trip Progress; bottom navigation; compact rounded cards; do not reproduce the sample driver's continuous map. |
| `mockup to be follow for design (2).png` | Dispatcher mobile | Dashboard, Fleet visualization, Queue Management, Payments; dense operational cards and mobile bottom navigation. |
| `mockup to be follow for design (3).png` | Dispatcher desktop | Sidebar shell, dashboard grid, large fleet/geofence panel, desktop queue table, payment verification rail, logs/activity patterns. |
| `mockup to be follow for design (4).png` | Passenger mobile | Search Trip, Select Seat, Passenger Information, Review/Confirm, Booking Confirmation; stepped flow and touch-first controls. Only Goa will be reservable. |
| `mockup to be follow for design (5).png` | Passenger/public desktop | Public hero and booking search, route/service highlights, desktop booking workspace, seat map, passenger form, and booking summary. Only Goa will have a booking action; Legazpi will remain status-only. |

## Purpose-named assets

| Asset | Stored location | Required usage |
| --- | --- | --- |
| `Public Home hero background.png` | `client/public/assets/hero/Public Home hero background.png` | Public landing hero background, preserving aspect ratio and the van/Mayon composition. |
| `top view of van for seat selection overlay.png` | `client/public/assets/vehicles/top view of van for seat selection overlay.png` | Passenger Select Seat view, centered beneath accessible interactive seat controls. |

## Shared visual language observed

- Deep forest green brand color on warm white/cream backgrounds.
- White surfaces with subtle neutral borders, soft shadows, and rounded card corners.
- Strong, dark-green headings with compact muted supporting text.
- Solid green primary buttons, outlined secondary actions, and pill-shaped status treatments.
- Green success, blue incoming/information, amber warning, red delay/error, and gray unavailable states, always paired with text or an icon.
- Mobile experiences use a lightweight top bar and persistent bottom navigation; controls remain at least approximately 44 px tall.
- Dispatcher desktop uses a fixed left sidebar, slim top utility bar, high-density content grid, and table-forward queue views.
- Passenger desktop uses broad horizontal compositions; passenger mobile separates the flow into distinct screens rather than compressing the desktop workspace.

## Business-rule substitutions

- Passenger booking is Goa only, even where the reference mockups show Legazpi booking content.
- Legazpi appears in public departure status and dispatcher/driver operations, but never has a reservation CTA.
- Passenger views have no internal fleet GPS map.
- Driver Trip Progress uses status/geofence milestones, not the continuous map depicted in the older sample.
- Payment choices include PayPal, “GCash — Upload Receipt for Verification,” and PayMongo dynamic QR Ph.
- Dispatcher maps represent the fixed NCEBT 5 km Active Zone and current/recent operational state, not permanent location history.

