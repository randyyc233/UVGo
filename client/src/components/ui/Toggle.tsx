import { cn } from '../../lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-11 w-14 shrink-0 items-center rounded-pill border-2 border-transparent p-0.5 transition-colors',
        checked ? 'bg-primary' : 'bg-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-6 w-6 rounded-full bg-surface shadow-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-0',
        )}
      />
    </button>
  );
}
