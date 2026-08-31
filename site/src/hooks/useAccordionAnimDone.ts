import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Marks a section "anim-done" (enabling internal scrolling) once its wrapper has actually
// stopped resizing, rather than after a fixed timer -- the wrapper's growth is driven by a
// sibling's transition via flex reflow, not one on itself, so no fixed duration reliably
// matches it. A timer that fires a hair early flips to overflow-y:auto before the box
// reaches final size, flashing a scrollbar in and out. Waiting for a quiet period of no
// further ResizeObserver events avoids that regardless of what's driving the resize.
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
