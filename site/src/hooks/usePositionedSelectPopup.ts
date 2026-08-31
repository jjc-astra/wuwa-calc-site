import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type React from 'react';
import { TooltipManager } from '../utils/Common';

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
}

/** Shared lifecycle for a <select> replacement whose popup is a portaled, fixed-position list of
 * divs rather than a real (OS-styled, un-stylable) native popup -- open/close state, click-outside
 * and scroll/resize auto-close, fixed-position placement (flips upward if there isn't room below),
 * active-index bookkeeping, scroll-into-view, and arrow/enter/escape/typeahead keyboard nav. Used
 * by both IconSelect and Dropdown, which differ only in how options are rendered and matched. */
export function usePositionedSelectPopup({
  itemCount, popupMaxHeight, activeOptionSelector, findInitialActiveIndex, findTypeaheadMatch, onSelectIndex
}: UsePositionedSelectPopupOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popupPos, setPopupPos] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // A native select's OS popup stays anchored through page scroll/resize -- ours can't cheaply
  // do the same across every scrollable ancestor, so just close instead of drifting off-anchor.
  // Scroll events don't bubble but capture-phase listeners on window still see them, including
  // the popup's own internal list scrolling (e.g. the scrollIntoView below) -- those must be
  // ignored or the popup would close itself the instant it opens.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      if (popupRef.current && e.target instanceof Node && popupRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    const close = () => setIsOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < popupMaxHeight && spaceAbove > spaceBelow;
    setPopupPos({
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 8),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(popupMaxHeight, spaceAbove - 8) }
        : { top: rect.bottom + 4, maxHeight: Math.min(popupMaxHeight, spaceBelow - 8) })
    });
  }, [isOpen, popupMaxHeight]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
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
