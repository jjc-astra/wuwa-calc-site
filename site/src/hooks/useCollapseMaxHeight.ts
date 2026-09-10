import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const TRANSITION_MS = 300; // matches .collapsible-content's transition duration in calculator.css
const OPEN_CAP_PX = 9999; // comfortably larger than any real panel content

// Animates height via max-height instead of display:none, so it transitions instead of
// snapping. Opening ramps 0 -> OPEN_CAP_PX; closing freezes the current height then ramps to 0
// (max-height can't transition to/from "none"). The large open cap avoids claiming full size
// before a closing sibling's flex-shrink frees space; it releases to "none" after the transition.
export function useCollapseMaxHeight(isOpen: boolean, contentRef: RefObject<HTMLElement | null>): string {
  const [maxHeight, setMaxHeight] = useState<string>(isOpen ? 'none' : '0px');
  const prevOpen = useRef(isOpen);

  useLayoutEffect(() => {
    if (prevOpen.current === isOpen) return;
    prevOpen.current = isOpen;

    let settleTimer: ReturnType<typeof setTimeout>;

    if (isOpen) {
      // Delay a frame so the browser commits the current '0px' before animating away from it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setMaxHeight(`${OPEN_CAP_PX}px`));
      });
      settleTimer = setTimeout(() => setMaxHeight('none'), TRANSITION_MS + 50);
    } else {
      // Freeze at the current rendered height first so there's a concrete value to animate
      // from, then flip to 0 next frame.
      const current = contentRef.current?.getBoundingClientRect().height ?? 0;
      setMaxHeight(`${current}px`);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setMaxHeight('0px'));
      });
    }

    return () => clearTimeout(settleTimer);
  }, [isOpen, contentRef]);

  return maxHeight;
}
