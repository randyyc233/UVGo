import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  BellRing,
  BusFront,
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
  { label: 'Bookings', href: '/passenger/bookings', icon: TicketCheck },
  { label: 'Status', href: '/passenger/status', icon: Route },
  { label: 'Notifications', href: '/passenger/notifications', icon: Bell },
  { label: 'Profile', href: '/passenger/profile', icon: UserRound },
];

export const driverNavigation: NavigationItem[] = [
  { label: 'Dashboard', href: '/driver/dashboard', icon: LayoutDashboard },
  { label: 'Queue', href: '/driver/queue', icon: UsersRound },
  { label: 'Assignment', href: '/driver/assignment', icon: ClipboardCheck },
  { label: 'Trip', href: '/driver/trip', icon: Route },
  { label: 'Driver setup', href: '/driver/setup', icon: Settings },
];

export const dispatcherNavigation: NavigationItem[] = [
  { label: 'Dashboard', href: '/dispatcher/dashboard', icon: LayoutDashboard },
  { label: 'Fleet Map', href: '/dispatcher/fleet', icon: MapPinned },
  { label: 'Queue Management', href: '/dispatcher/queue', icon: ListOrdered },
  { label: 'Dispatch Board', href: '/dispatcher/dispatch', icon: BusFront },
  { label: 'Payments', href: '/dispatcher/payments', icon: WalletCards },
  { label: 'Alerts', href: '/dispatcher/alerts', icon: BellRing, badge: 3 },
  { label: 'Reports & Logs', href: '/dispatcher/logs', icon: FileClock },
  { label: 'Settings', href: '/dispatcher/settings', icon: Settings },
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
