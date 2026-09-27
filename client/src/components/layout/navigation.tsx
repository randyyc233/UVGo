import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  CalendarClock,
  CircleHelp,
  ClipboardCheck,
  FileClock,
  House,
  LayoutDashboard,
  ListOrdered,
  MapPinned,
  Route,
  Settings,
  TicketCheck,
  UserRound,
  UserRoundCog,
  UsersRound,
  WalletCards,
} from 'lucide-react';

export type AppRole = 'passenger' | 'driver' | 'dispatcher';

export interface NavigationItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export const passengerNavigation: NavigationItem[] = [
  { label: 'Home', href: '/passenger/home', icon: House },
  { label: 'My Bookings', href: '/passenger/bookings', icon: TicketCheck },
  { label: 'Notifications', href: '/passenger/notifications', icon: Bell },
  { label: 'Profile', href: '/passenger/profile', icon: UserRound },
];

export const driverNavigation: NavigationItem[] = [
  { label: 'Dashboard', href: '/driver/dashboard', icon: LayoutDashboard },
  { label: 'Notifications', href: '/driver/notifications', icon: Bell },
  { label: 'Queue', href: '/driver/queue', icon: UsersRound },
  { label: 'Assignments', href: '/driver/assignment', icon: ClipboardCheck },
  { label: 'Trip', href: '/driver/trip', icon: Route },
  { label: 'Driver setup', href: '/driver/setup', icon: Settings },
  { label: 'Profile', href: '/driver/profile', icon: UserRound },
];

export const dispatcherNavigation: NavigationItem[] = [
  { label: 'Dashboard', href: '/dispatcher/dashboard', icon: LayoutDashboard },
  { label: 'Schedules', href: '/dispatcher/schedules', icon: CalendarClock },
  { label: 'Drivers & Vehicles', href: '/dispatcher/drivers', icon: UserRoundCog },
  { label: 'Fleet Map', href: '/dispatcher/fleet', icon: MapPinned },
  { label: 'Queue Management', href: '/dispatcher/queue', icon: ListOrdered },
  { label: 'Payments', href: '/dispatcher/payments', icon: WalletCards },
  { label: 'Alerts', href: '/dispatcher/alerts', icon: BellRing },
  { label: 'Reports & Logs', href: '/dispatcher/logs', icon: FileClock },
  { label: 'Profile', href: '/dispatcher/profile', icon: UserRound },
];

export const roleNavigation: Record<AppRole, NavigationItem[]> = {
  passenger: passengerNavigation,
  driver: driverNavigation,
  dispatcher: dispatcherNavigation,
};

export const supportNavigationItem: NavigationItem = {
  label: 'Need Help?',
  href: '/help',
  icon: CircleHelp,
};
