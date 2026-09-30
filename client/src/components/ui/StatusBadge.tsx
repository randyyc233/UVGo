import { cn } from '../../lib/cn';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

interface StatusBadgeProps {
  children: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  success: 'border-success/20 bg-success-soft text-success',
  info: 'border-info/20 bg-info-soft text-info',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
  neutral: 'border-border bg-cream text-text-secondary',
};

const dotClasses: Record<StatusTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-text-muted',
};

export function StatusBadge({ children, tone = 'neutral', dot = false, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'ui-status inline-flex min-h-6 w-fit items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs font-semibold leading-none',
        toneClasses[tone],
        className,
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dotClasses[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
