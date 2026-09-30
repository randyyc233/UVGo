import { useEffect, type RefObject } from 'react';

/** Wait for the updated section to render, respecting the user's motion preference. */
export function useMobileSectionScroll(target: RefObject<HTMLElement | null>, request: number) {
  useEffect(() => {
    if (!request || !window.matchMedia('(max-width: 1023px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      const element = target.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      element.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [target, request]);
}
