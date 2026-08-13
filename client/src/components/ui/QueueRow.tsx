import type { ReactNode } from 'react';
import { Card } from './Card';
import { StatusBadge, type StatusTone } from './StatusBadge';

interface QueueRowProps {
  position: number;
  vanId: string;
  driver: string;
  arrival: string;
  occupancy: string;
  status: string;
  statusTone: StatusTone;
  action?: ReactNode;
}

export function QueueRow({ position, vanId, driver, arrival, occupancy, status, statusTone, action }: QueueRowProps) {
  return (
    <Card className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 p-3 lg:grid-cols-[3rem_1fr_1.2fr_1fr_0.8fr_1fr_auto] lg:rounded-control lg:shadow-none">
      <span className="flex h-8 w-8 items-center justify-center rounded-control bg-cream text-sm font-bold text-text-primary">
        {position}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-text-primary">{vanId}</p>
        <p className="truncate text-xs text-text-secondary lg:hidden">{driver}</p>
      </div>
      <StatusBadge tone={statusTone}>{status}</StatusBadge>
      <p className="hidden truncate text-sm text-text-primary lg:block">{driver}</p>
      <p className="hidden text-sm text-text-secondary lg:block">{arrival}</p>
      <p className="hidden text-sm font-semibold text-text-primary lg:block">{occupancy}</p>
      <div className="col-span-2 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs lg:hidden">
        <p className="text-text-secondary">Arrival <span className="font-semibold text-text-primary">{arrival}</span></p>
        <p className="text-right text-text-secondary">Seats <span className="font-semibold text-text-primary">{occupancy}</span></p>
      </div>
      {action ? <div className="col-span-1 row-start-2 justify-self-end lg:col-auto lg:row-auto">{action}</div> : null}
    </Card>
  );
}

