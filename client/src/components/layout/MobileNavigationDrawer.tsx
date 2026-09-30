import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { Logo } from '../brand/Logo';
import { IconButton } from '../ui';
import { cn } from '../../lib/cn';
import type { NavigationItem } from './navigation';

interface MobileNavigationDrawerProps {
  open: boolean;
  items: NavigationItem[];
  label: string;
  onClose: () => void;
  onLogout: () => void;
}

export function MobileNavigationDrawer({ open, items, label, onClose, onLogout }: MobileNavigationDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="dashboard-shell fixed inset-0 z-[60] lg:hidden">
      <button type="button" className="absolute inset-0 bg-text-primary/45" aria-label="Close navigation" onClick={onClose} />
      <aside ref={drawerRef} id="mobile-app-navigation" role="dialog" aria-modal="true" aria-label={label} className="relative flex h-full w-[min(20rem,88vw)] flex-col overflow-y-auto bg-surface p-5 shadow-floating">
        <div className="flex items-center justify-between">
          <Logo />
          <IconButton ref={closeRef} label="Close navigation menu" icon={<X className="h-5 w-5" />} onClick={onClose} />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-primary">{label}</p>
        <nav className="mt-5 flex flex-col gap-1" aria-label={`${label} full navigation`}>
          {items.map((item) => {
            const Icon = item.icon;
            return <NavLink key={item.href} to={item.href} onClick={onClose} className={({ isActive }) => cn('dashboard-nav-link flex min-h-touch items-center gap-3 rounded-control px-4 py-2.5 text-sm font-semibold', isActive ? 'bg-primary-soft text-primary-dark' : 'text-text-secondary hover:bg-primary-soft hover:text-primary-dark')}><Icon className="h-5 w-5" aria-hidden="true" /><span className="flex-1">{item.label}</span>{item.badge ? <span className="rounded-pill bg-danger-soft px-2 py-1 text-xs text-danger">{item.badge}</span> : null}</NavLink>;
          })}
        </nav>
        <button
          type="button"
          className="mt-2 flex min-h-touch items-center gap-3 rounded-control border border-danger/20 px-4 text-sm font-semibold text-danger hover:bg-danger-soft"
          onClick={() => {
            onClose();
            onLogout();
          }}
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </aside>
    </div>,
    document.body,
  );
}
