import { useEffect, useRef, type ReactNode } from 'react';

interface ReservationActionProps {
  children: ReactNode;
  total?: number;
  caption?: string;
}

/** Presents the existing action in a mobile dock; the caller owns its handler/form. */
export function ReservationAction({ children, total, caption }: ReservationActionProps) {
  const action = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = action.current;
    const flow = element?.closest<HTMLElement>('.reservation-flow');
    if (!element || !flow) return;
    const observer = new ResizeObserver(() => {
      flow.style.setProperty('--reservation-action-height', `${element.getBoundingClientRect().height}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      flow.style.removeProperty('--reservation-action-height');
    };
  }, []);

  return (
    <div ref={action} className="reservation-action">
      {total !== undefined ? <div className="reservation-action-price" aria-live="polite" aria-atomic="true">
        <span className="text-sm font-semibold text-text-secondary">Total Price</span>
        <strong className="block text-xl font-bold leading-tight text-primary-dark">₱{total.toFixed(2)}</strong>
        {caption ? <span className="mt-1 block text-sm text-text-secondary">{caption}</span> : null}
      </div> : null}
      {children}
    </div>
  );
}
