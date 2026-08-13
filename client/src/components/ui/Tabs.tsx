import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}

export function Tabs({ items, activeId, onChange, label, className }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = items.length - 1;
    else return;
    event.preventDefault();
    const item = items[target];
    if (!item) return;
    onChange(item.id);
    refs.current[target]?.focus();
  }

  return (
    <div className={cn('flex border-b border-border', className)} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const selected = item.id === activeId;

        return (
          <button
            ref={(element) => { refs.current[index] = element; }}
            key={item.id}
            id={`${baseId}-${item.id}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(
              'relative flex min-h-touch flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold transition-colors',
              selected ? 'text-primary-dark' : 'text-text-secondary hover:text-text-primary',
            )}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className={cn('rounded-pill px-1.5 py-0.5 text-[0.6875rem]', selected ? 'bg-primary-soft text-primary' : 'bg-cream text-text-secondary')}>
                {item.count}
              </span>
            ) : null}
            {selected ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-pill bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
