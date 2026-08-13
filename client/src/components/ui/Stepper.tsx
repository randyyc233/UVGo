import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface StepItem {
  id: string;
  label: string;
}

interface StepperProps {
  steps: StepItem[];
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={className}>
      <ol className="flex w-full items-start" aria-label="Booking progress">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const complete = stepNumber < currentStep;
          const active = stepNumber === currentStep;

          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index > 0 ? (
                <span
                  className={cn(
                    'absolute right-1/2 top-4 h-px w-full -translate-y-1/2',
                    complete || active ? 'bg-primary' : 'bg-border-strong',
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold',
                  complete && 'border-primary bg-primary text-text-inverse',
                  active && 'border-primary bg-primary-dark text-text-inverse shadow-sm',
                  !complete && !active && 'border-border-strong bg-surface text-text-secondary',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {complete ? <Check className="h-4 w-4" aria-label="Completed" /> : stepNumber}
              </span>
              <span className={cn('sr-only mt-2 text-center text-xs font-medium sm:not-sr-only', active || complete ? 'text-primary-dark' : 'text-text-secondary')}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-center text-xs font-semibold text-primary-dark sm:hidden">
        Step {currentStep} of {steps.length}: {steps[currentStep - 1]?.label}
      </p>
    </div>
  );
}
