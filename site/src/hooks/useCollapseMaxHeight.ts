import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const TRANSITION_MS = 300; // matches .collapsible-content's transition duration in layout.css
const OPEN_CAP_PX = 9999; // comfortably larger than any real panel content

// Animates an accordion panel's height via max-height rather than display:none, so it can
// transition smoothly instead of snapping. Both directions animate toward a concrete pixel
// value (max-height can't transition to/from the keyword "none") -- opening ramps 0 to
// OPEN_CAP_PX, closing freezes at the measured current height then ramps to 0. The large
// fixed cap on open (instead of jumping straight to "none") keeps this panel from claiming
// its full natural size before the closing sibling's shrink has had a chance to free up
// space; it stays a non-binding upper bound until the transition finishes, then releases to
// "none" so later content changes aren't capped.
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
