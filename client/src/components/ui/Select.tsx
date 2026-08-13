import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  leadingIcon?: ReactNode;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, leadingIcon, hint, error, id: suppliedId, className, children, ...props },
  ref,
) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const helperId = `${id}-helper`;

  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-text-primary">
        {label}
      </label>
      <div className="relative">
        {leadingIcon ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-secondary">
            {leadingIcon}
          </span>
        ) : null}
        <select
          ref={ref}
          id={id}
          className={cn(
            'min-h-touch w-full appearance-none rounded-control border bg-surface px-3 py-2.5 pr-10 text-sm text-text-primary shadow-sm',
            'disabled:cursor-not-allowed disabled:bg-cream disabled:text-text-muted',
            leadingIcon && 'pl-10',
            error ? 'border-danger' : 'border-border-strong hover:border-text-muted',
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? helperId : undefined}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
      </div>
      {error || hint ? (
        <p id={helperId} className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-text-secondary')}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
});

