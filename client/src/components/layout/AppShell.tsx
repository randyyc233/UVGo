import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DesktopSidebar } from './DesktopSidebar';
import { TopNavigation } from './TopNavigation';
import { roleNavigation, type AppRole } from './navigation';
import { useAuth } from '../../auth/authContext';
import { MobileNavigationDrawer } from './MobileNavigationDrawer';
import { apiRequest } from '../../api/http';
import type { DispatcherDashboard } from '../../types/dispatcher';
import type { DriverOverview } from '../../types/driver';
import type { PassengerNotification } from '../../types/passenger';

interface AppShellProps {
  role: AppRole;
  title: string;
  userName: string;
  children: ReactNode;
  hideMobileHeading?: boolean;
}

const roleLabels: Record<AppRole, string> = {
  passenger: 'Passenger portal',
  driver: 'Driver operations',
  dispatcher: 'Dispatcher operations',
};

export function AppShell({ role, title, userName, children, hideMobileHeading = false }: AppShellProps) {
  const { logout, user } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [pendingPaymentCount, setPendingPaymentCount] = useState(0);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const dispatcherRoute = user?.dispatcherRoute === 'legazpi' ? 'Legazpi' : 'Goa';
  const roleLabel = role === 'dispatcher' ? `${dispatcherRoute} dispatcher operations` : roleLabels[role];
  const availableNavigationItems = role === 'dispatcher' && user?.dispatcherRoute === 'legazpi'
    ? roleNavigation[role].filter((item) => item.href !== '/dispatcher/payments')
    : roleNavigation[role];
  const notificationHref = role === 'dispatcher'
    ? '/dispatcher/alerts'
    : role === 'driver'
      ? '/driver/notifications'
      : '/passenger/notifications';
  const navigationItems = availableNavigationItems.map((item) => {
    if (item.href === notificationHref) return { ...item, badge: notificationCount || undefined };
    if (role === 'dispatcher' && item.href === '/dispatcher/payments') {
      return { ...item, badge: pendingPaymentCount || undefined };
    }
    return item;
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  useEffect(() => {
    let active = true;
    async function loadNavigationCounts() {
      try {
        if (role === 'dispatcher') {
          const response = await apiRequest<{ dashboard: DispatcherDashboard }>('/dispatcher/dashboard');
          if (active) {
            setNotificationCount(response.dashboard.alerts.filter((alert) => !alert.isRead).length);
            setPendingPaymentCount(response.dashboard.metrics.pendingPayments);
          }
          return;
        }

        if (role === 'driver') {
          const response = await apiRequest<{ notifications: DriverOverview['notifications'] }>('/driver/notifications');
          if (active) setNotificationCount(response.notifications.filter((item) => !item.isRead).length);
          return;
        }

        const response = await apiRequest<{ notifications: PassengerNotification[] }>('/passenger/notifications');
        if (active) setNotificationCount(response.notifications.filter((item) => !item.isRead).length);
      } catch {
        if (active) {
          setNotificationCount(0);
          if (role === 'dispatcher') setPendingPaymentCount(0);
        }
      }
    }

    void loadNavigationCounts();
    const timer = window.setInterval(() => void loadNavigationCounts(), 8_000);
    window.addEventListener('focus', loadNavigationCounts);
    window.addEventListener('uvgo:passenger-notifications-changed', loadNavigationCounts);
    window.addEventListener('uvgo:driver-notifications-changed', loadNavigationCounts);
    window.addEventListener('uvgo:dispatcher-alerts-changed', loadNavigationCounts);
    window.addEventListener('uvgo:dispatcher-payments-changed', loadNavigationCounts);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', loadNavigationCounts);
      window.removeEventListener('uvgo:passenger-notifications-changed', loadNavigationCounts);
      window.removeEventListener('uvgo:driver-notifications-changed', loadNavigationCounts);
      window.removeEventListener('uvgo:dispatcher-alerts-changed', loadNavigationCounts);
      window.removeEventListener('uvgo:dispatcher-payments-changed', loadNavigationCounts);
    };
  }, [role]);

  return (
    <div className="dashboard-shell min-h-screen bg-background text-text-primary">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <DesktopSidebar items={navigationItems} roleLabel={roleLabel} onLogout={() => void logout()} />
      <div className="min-h-screen min-w-0 lg:pl-64">
        <TopNavigation
          title={title}
          role={role}
          userName={userName}
          terminal={role !== 'passenger' ? 'Naga City East Bound Terminal' : undefined}
          notifications={notificationCount}
          menuOpen={menuOpen}
          onMenuClick={() => setMenuOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className={`dashboard-content mx-auto w-full max-w-app px-4 pb-8 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8 ${hideMobileHeading ? 'pt-0' : 'pt-5'}`}>
          {hideMobileHeading ? null : (
            <div className="mb-5 lg:hidden">
              {role === 'dispatcher' ? null : <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{roleLabel}</p>}
              <h1 className={role === 'dispatcher' ? 'text-2xl font-bold tracking-tight' : 'mt-1 text-2xl font-bold tracking-tight'}>{title}</h1>
            </div>
          )}
          {children}
        </main>
      </div>
      <MobileNavigationDrawer open={menuOpen} items={navigationItems} label={roleLabel} onClose={closeMenu} onLogout={() => void logout()} />
    </div>
  );
}
