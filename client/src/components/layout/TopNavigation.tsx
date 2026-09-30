import { Bell, MapPin, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '../brand/Logo';
import { IconButton } from '../ui/IconButton';

interface TopNavigationProps {
  title: string;
  role: string;
  userName: string;
  terminal?: string;
  notifications?: number;
  menuOpen?: boolean;
  onMenuClick?: () => void;
}

export function TopNavigation({ title, role, userName, terminal, notifications = 0, menuOpen = false, onMenuClick }: TopNavigationProps) {
  const initials = userName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
  const notificationsHref = role === 'passenger' ? '/passenger/notifications' : role === 'driver' ? '/driver/notifications' : '/dispatcher/alerts';
  const profileHref = role === 'passenger' ? '/passenger/profile' : role === 'driver' ? '/driver/profile' : '/dispatcher/profile';

  return (
    <header className="dashboard-topbar sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
      <div className="relative grid h-[4.5rem] grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 lg:flex lg:justify-between lg:gap-3 px-4 sm:px-6 lg:h-20 lg:px-8">
        <div className="flex min-w-touch items-center lg:hidden">
          <IconButton label="Open navigation menu" icon={<Menu className="h-6 w-6" />} onClick={onMenuClick} aria-expanded={menuOpen} aria-controls="mobile-app-navigation" />
        </div>
        <Logo className="min-w-0 justify-self-center lg:hidden" />
        <div className="hidden min-w-0 lg:block">
          <h1 className="truncate text-xl font-bold tracking-tight xl:text-2xl">{title}</h1>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
          {terminal ? (
            <div className="hidden items-center gap-2 px-3 text-xs font-medium text-text-secondary 2xl:flex">
              <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {terminal}
            </div>
          ) : null}
          <div className="relative">
            <Link to={notificationsHref} className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-control border border-border bg-surface text-text-secondary hover:bg-cream hover:text-text-primary" aria-label={`${notifications} notifications`}><Bell className="h-5 w-5" /></Link>
            {notifications > 0 ? (
              <span className="pointer-events-none absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-[0.5625rem] font-bold text-text-inverse">
                {notifications}
              </span>
            ) : null}
          </div>
          <Link to={profileHref} className="flex min-h-touch min-w-touch items-center gap-2.5 rounded-control pl-1 pr-0.5 hover:bg-background sm:pr-2" aria-label={`${userName} profile`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-primary/10 bg-primary-soft text-xs font-bold text-primary-dark">
              {initials}
            </span>
            <span className="hidden text-left md:block">
              <span className="block max-w-40 truncate text-sm font-semibold text-text-primary">{userName}</span>
              <span className="block text-[0.625rem] capitalize text-text-secondary">{role}</span>
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
