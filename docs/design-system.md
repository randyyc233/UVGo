# UVGo design system — Phase 2

The UVGo interface foundation is derived from the supplied passenger, driver, and dispatcher mockups. Components are implemented from scratch rather than inheriting another product's component library defaults.

## Theme tokens

Tokens live in `client/tailwind.config.ts` and should be preferred over arbitrary values in application JSX.

### Core colors

- `primary`, `primary-dark`, `primary-deeper`: brand actions, selected navigation, major operational panels
- `primary-soft`, `accent`: subtle selected, icon, and assurance surfaces
- `background`: warm off-white application canvas
- `surface`: cards, forms, headers, and navigation
- `cream`: neutral inset panels
- `text-primary`, `text-secondary`, `text-muted`, `text-inverse`
- `border`, `border-strong`

### Semantic colors

- `success`: confirmed, ready, at terminal
- `info`: incoming, reallocated, informational
- `warning`: pending verification, awaiting response
- `danger`: rejected, delayed, failed
- `unavailable`: disabled seats and neutral unavailable states

Status is always represented by text and may additionally use a dot or icon. Color is never the only signal.

### Shape and elevation

- `rounded-card`: primary cards and panels
- `rounded-control`: inputs, buttons, compact table rows
- `rounded-pill`: status badges, counters, toggles
- `shadow-card`: restrained surface elevation
- `shadow-floating`: dialogs and prominent floating panels
- `shadow-nav`: mobile bottom navigation

## Shared primitives

Reusable controls are exported from `client/src/components/ui/index.ts`:

- `Button`, `IconButton`, `Toggle`
- `Card`, `CardHeader`, `MetricCard`
- `StatusBadge`, `AlertItem`, `QueueRow`
- `Input`, `Select`, `Tabs`, `Stepper`
- `Modal`, `ConfirmationDialog`
- `EmptyState`, `LoadingSkeleton`

All mobile controls target a minimum interactive size of approximately 44 × 44 px. Inputs have explicit labels, errors and hints are associated through ARIA attributes, icon-only controls require accessible labels, dialogs support Escape dismissal, and keyboard focus is visibly indicated.

## Responsive shells

- `PublicShell`: compact mobile header and desktop horizontal navigation matching the public/passenger desktop reference.
- `AppShell`: shared authenticated canvas with role-aware utilities.
- `DesktopSidebar`: dispatcher-style navigation at `lg` and above, also used as progressive enhancement for authenticated driver and passenger views.
- `BottomNavigation`: the exact five primary destinations for passenger, driver, and dispatcher mobile experiences.
- `TopNavigation`: mobile centered branding with notifications/profile controls; desktop title, terminal context, and user utility area.

## Mapbox configuration

The dispatcher fleet map will consume `VITE_MAPBOX_ACCESS_TOKEN` in its scheduled feature phase. The actual public token is stored only in ignored `client/.env`; `.env.example` contains a placeholder. Passenger and driver shells do not load Mapbox.

## Phase boundary

The Phase 2 foundation is now consumed by Phase 3 authentication and the Phase 4 public experience. Role-specific operational workflows continue in their scheduled feature phases.
