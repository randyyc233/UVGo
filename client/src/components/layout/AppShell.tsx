import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DesktopSidebar } from './DesktopSidebar';
import { TopNavigation } from './TopNavigation';
import { roleNavigation, type AppRole } from './navigation';
import { useAuth } from '../../auth/authContext';
import { MobileNavigationDrawer } from './MobileNavigationDrawer';

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
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <DesktopSidebar items={roleNavigation[role]} roleLabel={roleLabels[role]} onLogout={() => void logout()} />
      <div className="min-h-screen lg:pl-60">
        <TopNavigation
          title={title}
          role={role}
          userName={userName}
          terminal={role !== 'passenger' ? 'Naga City East Bound Terminal' : undefined}
          notifications={role === 'dispatcher' ? 3 : role === 'passenger' ? 1 : 0}
          menuOpen={menuOpen}
          onMenuClick={() => setMenuOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className={`mx-auto w-full max-w-app px-4 pb-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-7 ${hideMobileHeading ? 'pt-0' : 'pt-5'}`}>
          {hideMobileHeading ? null : (
            <div className="mb-5 lg:hidden">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{roleLabels[role]}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{title}</h1>
            </div>
          )}
          {children}
        </main>
      </div>
      <MobileNavigationDrawer open={menuOpen} items={roleNavigation[role]} label={roleLabels[role]} onClose={closeMenu} onLogout={() => void logout()} />
    </div>
  );
}
