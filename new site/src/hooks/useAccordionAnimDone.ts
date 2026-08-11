import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Marks a section "anim-done" (enabling internal scrolling on its content) once the
// section's wrapper has actually finished resizing, rather than after a fixed timer.
// A fixed delay tied to the CSS transition-duration races against real paint timing --
// the box's growth is driven by its (closing) sibling's max-height transition via flex
// reflow, not a transition on this element itself, so there's no single authoritative
// duration to time against. If the timer fires even a hair before the box reaches its
// final height, flipping straight to overflow-y:auto exposes a sliver of overflow for
// one frame -- a scrollbar flashes in and immediately back out. Watching the wrapper
// with a ResizeObserver and waiting for a short quiet period with no further size
// changes sidesteps the race entirely: it doesn't matter what's driving the resize or
// how long it takes, "anim-done" only flips once the box has genuinely stopped moving.
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
