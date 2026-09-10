import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Marks "anim-done" once the wrapper's resize actually settles, not after a fixed timer --
// growth here is driven by a sibling's transition via flex reflow, so no fixed duration
// reliably matches it (an early timer flips to overflow-y:auto and flashes a scrollbar).
// Waits for a quiet period of ResizeObserver events instead.
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
    scheduleSettleCheck(); // covers the case where the box is already at its final size

    return () => {
      observer.disconnect();
      clearTimeout(settleTimer);
    };
  }, [isOpen, wrapperRef]);

  return animDone;
}
