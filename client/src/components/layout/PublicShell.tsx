import { useState, type ReactNode } from 'react';
import { Bell, Menu, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Logo } from '../brand/Logo';
import { IconButton } from '../ui/IconButton';
import { cn } from '../../lib/cn';

interface PublicShellProps {
  children: ReactNode;
}

const links = [
  { label: 'Home', href: '#top' },
  { label: 'Routes', href: '#routes' },
  { label: 'Book', href: '/passenger/book' },
  { label: 'Departures', href: '#departures' },
  { label: 'Help', href: '#why-uvgo' },
];

export function PublicShell({ children }: PublicShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <a href="#public-main" className="skip-link">Skip to main content</a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-[4.75rem] max-w-app items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="lg:hidden">
            <IconButton
              label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              icon={<Menu className="h-6 w-6" />}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-public-navigation"
              onClick={() => setMobileMenuOpen((open) => !open)}
            />
          </div>
          <a href="#top" className="absolute left-1/2 -translate-x-1/2 lg:static lg:translate-x-0" aria-label="UVGo home"><Logo /></a>
          <nav className="hidden items-stretch self-stretch lg:flex" aria-label="Public navigation">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cn('relative flex min-h-touch items-center px-5 text-sm font-medium text-text-secondary hover:text-primary-dark')}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <NavLink to="/login" aria-label="Sign in to view notifications" className="hidden min-h-touch min-w-touch items-center justify-center rounded-full text-text-secondary hover:bg-cream hover:text-text-primary sm:inline-flex"><Bell className="h-5 w-5" /></NavLink>
            <NavLink to="/login" aria-label="Account" className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-full text-text-secondary hover:bg-cream hover:text-text-primary"><UserRound className="h-5 w-5" /></NavLink>
            <NavLink to="/passenger/book" className="hidden min-h-touch items-center rounded-control bg-primary px-4 text-sm font-semibold text-text-inverse hover:bg-primary-dark lg:inline-flex">Book a Ride</NavLink>
          </div>
        </div>
        <nav
          id="mobile-public-navigation"
          className={cn(
            'border-t border-border bg-surface px-4 py-3 shadow-card lg:hidden',
            mobileMenuOpen ? 'block' : 'hidden',
          )}
          aria-label="Mobile public navigation"
        >
          <div className="mx-auto grid max-w-app gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex min-h-touch items-center rounded-control px-4 text-sm font-semibold text-text-secondary hover:bg-primary-soft hover:text-primary-dark"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </div>
        </nav>
      </header>
      <main id="public-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
