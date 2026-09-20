import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UsePopupDismissOptions {
  /** The popup itself: scrolling inside it never dismisses. */
  popupRef: RefObject<HTMLElement | null>;
  /** A mousedown inside any of these (the trigger, the popup) keeps the popup open; one anywhere
   * else closes it. Omit to skip click-outside dismissal (e.g. a popup that closes on blur). */
  clickInsideRefs?: RefObject<HTMLElement | null>[];
  /** Elements whose own scrolling doesn't dismiss (e.g. a text input scrolling as you type). */
  ignoreScrollFrom?: RefObject<Element | null>[];
}

/** Closes an open portaled popup on an outside click, any scroll, or a window resize. A native
 * popup stays anchored through scroll/resize -- ours can't do that cheaply, so it closes instead.
 * The scroll listener is capture-phase, so it also sees the popup's own internal scrolling (e.g.
 * scrollIntoView on open), which must be ignored or the popup would close itself. */
export function usePopupDismiss(
  isOpen: boolean,
  close: () => void,
  { popupRef, clickInsideRefs, ignoreScrollFrom = [] }: UsePopupDismissOptions
) {
  // Always the caller's latest `close`, without re-subscribing the listeners on every render.
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
    // The ref lists are fixed for a component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
}
