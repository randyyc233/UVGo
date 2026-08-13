import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { StatusTone } from './StatusBadge';

interface AlertItemProps {
  icon: ReactNode;
  title: string;
  message: string;
  timestamp?: string;
  tone?: StatusTone;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-cream text-text-secondary',
};

export function AlertItem({ icon, title, message, timestamp, tone = 'neutral', className }: AlertItemProps) {
  return (
    <article className={cn('flex gap-3 border-b border-border py-3 last:border-b-0', className)}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', toneClasses[tone])}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {timestamp ? <time className="shrink-0 text-xs text-text-muted">{timestamp}</time> : null}
        </div>
        <p className="mt-0.5 text-xs leading-5 text-text-secondary">{message}</p>
      </div>
    </article>
  );
}

