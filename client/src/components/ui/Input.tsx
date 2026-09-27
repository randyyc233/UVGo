import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  leadingIcon?: ReactNode;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, leadingIcon, hint, error, id: suppliedId, className, ...props },
  ref,
) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const helperId = `${id}-helper`;

  return (
    <div className="w-full">
      <label htmlFor={id} className={cn('mb-1.5 block text-sm font-semibold transition-colors', error ? 'text-danger' : 'text-text-primary')}>
        {label}
      </label>
      <div className="relative">
        {leadingIcon ? (
          <span className={cn('pointer-events-none absolute inset-y-0 left-3 flex items-center transition-colors', error ? 'text-danger' : 'text-text-secondary')}>
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          className={cn(
            'min-h-touch w-full rounded-control border bg-surface px-3 py-2.5 text-sm text-text-primary shadow-sm outline-none transition-all',
            'placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-cream disabled:text-text-muted',
            leadingIcon && 'pl-10',
            error
              ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
              : 'border-border-strong hover:border-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20',
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? helperId : undefined}
          {...props}
        />
      </div>
      {error || hint ? (
        <p
          id={helperId}
          className={cn('mt-1.5 flex items-center gap-1.5 text-xs font-semibold', error ? 'text-danger' : 'text-text-secondary')}
        >
          {error ? <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
});

