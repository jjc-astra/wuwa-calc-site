import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

// Sync with .collapsible-content's transition.
const TRANSITION_MS = 300;
const OPEN_CAP_PX = 9999;

// Animates max-height open/closed, releasing to "none" once open.
export function useCollapseMaxHeight(isOpen: boolean, contentRef: RefObject<HTMLElement | null>): string {
  const [maxHeight, setMaxHeight] = useState<string>(isOpen ? 'none' : '0px');
  const prevOpen = useRef(isOpen);

  useLayoutEffect(() => {
    if (prevOpen.current === isOpen) return;
    prevOpen.current = isOpen;

    let settleTimer: ReturnType<typeof setTimeout>;

    if (isOpen) {
      // Commit 0px before animating.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setMaxHeight(`${OPEN_CAP_PX}px`));
      });
      settleTimer = setTimeout(() => setMaxHeight('none'), TRANSITION_MS + 50);
    } else {
      // Freeze at the current height, then animate to 0.
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
