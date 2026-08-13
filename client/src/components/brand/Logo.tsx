import { cn } from '../../lib/cn';

interface LogoProps {
  compact?: boolean;
  className?: string;
}

export function Logo({ compact = false, className }: LogoProps) {
  return (
    <div className={cn('inline-flex flex-col leading-none', className)} aria-label="UVGo">
      <span className="text-[1.75rem] font-black tracking-[-0.08em] text-primary-dark">
        UV<span className="text-primary">Go</span>
      </span>
      {!compact ? (
        <span className="mt-1 text-[0.5rem] font-bold uppercase tracking-[0.12em] text-primary-dark">
          Bicol van dispatch
        </span>
      ) : null}
    </div>
  );
}

