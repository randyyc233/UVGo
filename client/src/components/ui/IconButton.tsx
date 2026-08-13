import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  tone?: 'default' | 'primary' | 'danger';
}

const toneClasses = {
  default: 'text-text-secondary hover:bg-cream hover:text-text-primary',
  primary: 'text-primary hover:bg-primary-soft',
  danger: 'text-danger hover:bg-danger-soft',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex min-h-touch min-w-touch items-center justify-center rounded-full transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});

