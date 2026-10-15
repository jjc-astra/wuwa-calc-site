import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Marks "anim-done" after a quiet period of resize events (no fixed timer matches the reflow).
const SETTLE_QUIET_MS = 60;

export function useAccordionAnimDone(isOpen: boolean, wrapperRef: RefObject<HTMLElement | null>): boolean {
  const [animDone, setAnimDone] = useState(false);

  useEffect(() => {
    setAnimDone(false);
    if (!isOpen) return;
    const el = wrapperRef.current;
    if (!el) return;

    let settleTimer: ReturnType<typeof setTimeout>;
    const scheduleSettleCheck = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setAnimDone(true), SETTLE_QUIET_MS);
    };

    const observer = new ResizeObserver(scheduleSettleCheck);
    observer.observe(el);
    // Box may already be at its final size.
    scheduleSettleCheck();

    return () => {
      observer.disconnect();
      clearTimeout(settleTimer);
    };
  }, [isOpen, wrapperRef]);

  return animDone;
}
