import { cn } from '../../lib/cn';

interface LoadingSkeletonProps {
  className?: string;
  lines?: number;
}

export function LoadingSkeleton({ className, lines = 1 }: LoadingSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={cn('h-4 animate-pulse rounded-pill bg-border', index === lines - 1 && lines > 1 && 'w-2/3')} />
      ))}
      <span className="sr-only">Loading content</span>
    </div>
  );
}

