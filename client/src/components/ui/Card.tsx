import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  padded?: boolean;
  elevated?: boolean;
}

export function Card({ children, padded = true, elevated = false, className, ...props }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-card border border-border bg-surface',
        padded && 'p-4 sm:p-5',
        elevated && 'shadow-card',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <header className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="text-base font-bold sm:text-lg">{title}</h2>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

