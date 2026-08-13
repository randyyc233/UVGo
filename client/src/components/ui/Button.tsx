import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-text-inverse shadow-sm hover:bg-primary-dark active:bg-primary-deeper',
  secondary: 'bg-primary-soft text-primary-dark hover:bg-accent active:bg-accent',
  outline: 'border border-primary text-primary-dark hover:bg-primary-soft active:bg-accent',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft',
  ghost: 'text-text-secondary hover:bg-cream hover:text-text-primary',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-touch px-4 py-2 text-sm',
  md: 'min-h-touch px-5 py-2.5 text-sm',
  lg: 'min-h-[3rem] px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : leadingIcon}
      <span>{children}</span>
      {!loading && trailingIcon}
    </button>
  );
});

