import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center rounded-card border border-dashed border-border-strong bg-surface px-6 py-10 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</span>
      <h3 className="mt-4 text-base font-bold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-6 text-text-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

