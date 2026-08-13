import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
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
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-text-primary">
        {label}
      </label>
      <div className="relative">
        {leadingIcon ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-secondary">
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          className={cn(
            'min-h-touch w-full rounded-control border bg-surface px-3 py-2.5 text-sm text-text-primary shadow-sm',
            'placeholder:text-text-muted disabled:cursor-not-allowed disabled:bg-cream disabled:text-text-muted',
            leadingIcon && 'pl-10',
            error ? 'border-danger' : 'border-border-strong hover:border-text-muted',
            className,
          )}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? helperId : undefined}
          {...props}
        />
      </div>
      {error || hint ? (
        <p id={helperId} className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-text-secondary')}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
});

