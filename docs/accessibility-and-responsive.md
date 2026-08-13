# Phase 9: responsive and accessible experience

Phase 9 applies shared accessibility, responsive-layout, and user-feedback behavior across the public, passenger, driver, and dispatcher experiences.

## Responsive behavior

- The supported layout begins at 320 CSS pixels with no page-level horizontal overflow.
- Mobile navigation uses a real modal drawer, while authenticated desktop layouts retain their role-specific sidebars.
- Booking progress uses a compact numeric stepper and a current-step summary on narrow screens; full labels return at the `sm` breakpoint.
- Tables become task-focused cards on smaller screens. Wide operational tables retain local horizontal scrolling on desktop rather than widening the page.
- Inputs and primary controls use a minimum 44-pixel interaction target. The Go on Trip switch and footer links follow the same rule.
- Public booking, passenger booking, driver setup, and dispatcher queue layouts were rendered at narrow mobile and desktop viewports during QA.

## Keyboard and screen-reader behavior

- A skip link is the first keyboard target in public and authenticated shells.
- Focus indicators are globally visible and use the UVGo primary color.
- Modal dialogs and the mobile navigation drawer move focus inside when opened, contain Tab and Shift+Tab navigation, close with Escape, and restore focus to the trigger.
- Tabs support Left Arrow, Right Arrow, Home, and End with roving `tabIndex` behavior.
- Icon-only controls have accessible names, inputs retain programmatic labels, and status badges always include text rather than communicating with color alone.
- Reduced-motion preferences disable nonessential transitions, animations, and smooth scrolling.

## Loading, empty, error, and success states

- API-first screens use skeletons or explicit progress messaging during initial loading.
- Passenger trips, notifications, dispatcher queues, payments, logs, and other collections expose dedicated empty states.
- Failed requests appear as visible alerts. Polling views retain their last successful data and identify a failed background refresh when appropriate.
- Mutating actions provide inline failure messages and non-blocking success toasts. Toasts use `status` for normal feedback and `alert` for failures, can be dismissed, and disappear automatically.
- Booking, driver availability, trip transitions, queue actions, assignment responses, rescheduling, and payment decisions no longer complete silently.

## Verification performed

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Browser QA at 320, 390, and 1440 pixels
- Horizontal-overflow and minimum-target audits on passenger, driver, and dispatcher screens
- Keyboard verification for skip links, tabs, dialogs, and the mobile drawer
- Browser console inspection with no application errors

