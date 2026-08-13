import { NavLink } from 'react-router-dom';
import { Headphones, LogOut, Phone } from 'lucide-react';
import { Logo } from '../brand/Logo';
import { cn } from '../../lib/cn';
import type { NavigationItem } from './navigation';

interface DesktopSidebarProps {
  items: NavigationItem[];
  roleLabel: string;
  onLogout: () => void;
}

export function DesktopSidebar({ items, roleLabel, onLogout }: DesktopSidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
      <div className="px-2">
        <Logo />
        <p className="mt-3 text-xs font-medium text-text-secondary">{roleLabel}</p>
      </div>
      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label={`${roleLabel} navigation`}>
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-dark text-text-inverse shadow-sm'
                    : 'text-text-secondary hover:bg-primary-soft hover:text-primary-dark',
                )
              }
            >
              <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-pill bg-danger-soft px-1 text-[0.625rem] font-bold text-danger">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onLogout}
          className="mt-1 flex min-h-touch w-full items-center gap-3 rounded-control border border-transparent px-3 py-2 text-left text-sm font-semibold text-danger transition-colors hover:border-danger/20 hover:bg-danger-soft"
        >
          <LogOut className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </nav>
      <div className="rounded-card border border-border bg-background p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Headphones className="h-4 w-4 text-primary" aria-hidden="true" />
          Need help?
        </div>
        <p className="mt-1 text-xs leading-5 text-text-secondary">Contact terminal support anytime.</p>
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-primary-dark">
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          0917 555 8884
        </p>
      </div>
      <div className="mt-4 flex items-center gap-2 px-2 text-[0.6875rem] text-text-secondary">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
        All systems operational
      </div>
    </aside>
  );
}
