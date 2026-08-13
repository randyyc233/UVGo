import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../../lib/cn';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    label: string;
    positive?: boolean;
  };
  className?: string;
}

const trendIcons = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

export function MetricCard({ label, value, icon, trend, className }: MetricCardProps) {
  const TrendIcon = trend ? trendIcons[trend.direction] : null;

  return (
    <Card className={cn('min-w-0', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-5 text-text-secondary">{label}</p>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-tight text-text-primary">{value}</p>
      {trend && TrendIcon ? (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-xs font-medium',
            trend.positive === true && 'text-success',
            trend.positive === false && 'text-danger',
            trend.positive === undefined && 'text-text-secondary',
          )}
        >
          <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {trend.label}
        </p>
      ) : null}
    </Card>
  );
}

