import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type React from 'react';
import { TooltipManager } from '../utils/Common';
import { computePopupPosition } from '../utils/popupPosition';
import { usePopupDismiss } from './usePopupDismiss';

interface UsePositionedSelectPopupOptions {
  itemCount: number;
  popupMaxHeight: number;
  /** Selector for the active option. */
  activeOptionSelector: string;
  /** Initial active index (usually the selected option). */
  findInitialActiveIndex: () => number;
  /** Index matching a lowercase typeahead term, or -1. */
  findTypeaheadMatch: (term: string) => number;
  /** Enter handler; callers guard disabled options. */
  onSelectIndex: (index: number) => void;
  /** Edge aligned to the trigger (default 'left'). */
  align?: 'left' | 'right';
}

/** Portaled <select>-replacement popup: positioning, dismissal, keyboard nav. */
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
    // Hide the tooltip on close (no mouseleave fires).
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

  // Also used on an <input>.
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
