import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type React from 'react';
import { TooltipManager } from '../utils/Common';
import { computePopupPosition } from '../utils/popupPosition';
import { usePopupDismiss } from './usePopupDismiss';

interface UsePositionedSelectPopupOptions {
  itemCount: number;
  popupMaxHeight: number;
  /** CSS selector (scoped to the popup) for the currently-active option, used to scroll it into view. */
  activeOptionSelector: string;
  /** Index to seed activeIndex with when the popup opens -- typically the currently selected option. */
  findInitialActiveIndex: () => number;
  /** Given the accumulated lowercase typeahead term, return a matching item index or -1. */
  findTypeaheadMatch: (term: string) => number;
  /** Fired on Enter with the active index -- callers apply their own disabled-option guard here. */
  onSelectIndex: (index: number) => void;
  /** Horizontal anchor: 'left' (default) aligns the popup's left edge to the trigger's (for a
   * <select>-style trigger). 'right' aligns the popup's right edge instead, for a narrow
   * icon-only trigger pinned to the row's right (e.g. "..." menu), so it doesn't hang off. */
  align?: 'left' | 'right';
}

/** Shared lifecycle for a <select> replacement popup (portaled, fixed-position divs, not a
 * native popup): open/close, click-outside and scroll/resize auto-close, flip-upward
 * placement, active-index + scroll-into-view, and keyboard nav. Used by IconSelect and Dropdown. */
export function usePositionedSelectPopup({
  itemCount, popupMaxHeight, activeOptionSelector, findInitialActiveIndex, findTypeaheadMatch, onSelectIndex,
  align = 'left'
}: UsePositionedSelectPopupOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popupPos, setPopupPos] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  usePopupDismiss(isOpen, () => setIsOpen(false), { popupRef, clickInsideRefs: [rootRef, popupRef] });

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    setPopupPos(computePopupPosition(triggerRef.current.getBoundingClientRect(), { maxHeight: popupMaxHeight, align }));
  }, [isOpen, popupMaxHeight, align]);

  useEffect(() => {
    // Closing without a natural mouseleave (click-select, outside-click, Escape) would
    // otherwise leave a hovered disabled-option tooltip stuck on screen.
    if (!isOpen) {
      TooltipManager.hide();
      return;
    }
    setActiveIndex(Math.max(0, findInitialActiveIndex()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !popupRef.current) return;
    const activeEl = popupRef.current.querySelector(activeOptionSelector);
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  // HTMLElement, not HTMLButtonElement -- IconSelect's searchable variant also wires this to a
  // popup <input>, and only .key/.preventDefault() are used here, both element-agnostic.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + itemCount) % itemCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) onSelectIndex(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      typeaheadRef.current += e.key.toLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => { typeaheadRef.current = ''; }, 600);
      const match = findTypeaheadMatch(typeaheadRef.current);
      if (match >= 0) setActiveIndex(match);
    }
  };

  return {
    isOpen, setIsOpen, activeIndex, setActiveIndex, popupPos, rootRef, triggerRef, popupRef, handleKeyDown
  };
}
