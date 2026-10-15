import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UsePopupDismissOptions {
  popupRef: RefObject<HTMLElement | null>;
  /** Clicks inside these keep it open. Omit to skip click-outside dismissal. */
  clickInsideRefs?: RefObject<HTMLElement | null>[];
  /** Elements whose scrolling doesn't dismiss. */
  ignoreScrollFrom?: RefObject<Element | null>[];
}

/** Closes a portaled popup on outside click, scroll, or resize. */
export function usePopupDismiss(
  isOpen: boolean,
  close: () => void,
  { popupRef, clickInsideRefs, ignoreScrollFrom = [] }: UsePopupDismissOptions
) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (clickInsideRefs?.some(ref => ref.current?.contains(target))) return;
      closeRef.current();
    };
    const handleScroll = (e: Event) => {
      if (popupRef.current && e.target instanceof Node && popupRef.current.contains(e.target)) return;
      if (ignoreScrollFrom.some(ref => e.target === ref.current)) return;
      closeRef.current();
    };
    const handleResize = () => closeRef.current();

    if (clickInsideRefs) document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
