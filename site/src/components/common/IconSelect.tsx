import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ImageFolder } from '../../data/db';
import { AvatarIcon } from './AvatarIcon';
import { TooltipManager } from '../../utils/Common';

export interface IconSelectOption {
  value: string;
  disabled?: boolean;
  disabledTooltip?: string;
}

interface IconSelectProps {
  value: string;
  options: IconSelectOption[];
  onChange: (value: string) => void;
  iconFolder: ImageFolder;
  /** 'circle' matches .avatar-sm alone, 'rect' adds .avatar-rect -- same shapes as the roster card avatars. */
  iconShape: 'circle' | 'rect';
  placeholder: string;
  className?: string;
  disabled?: boolean;
}

const POPUP_MAX_HEIGHT = 260;

/** A <select> replacement that renders each option with its character/weapon/set/echo icon,
 * styled the same as the roster card avatars. Native <select> can't reliably show images
 * inside its popup across browsers, so this reimplements the dropdown as a positioned list of
 * divs instead -- portaled to <body> and positioned in fixed coordinates so it always escapes
 * any scrollable/clipping ancestor (e.g. .char-row's overflow-x: auto) the way a native
 * select's OS-rendered popup would. */
export const IconSelect: React.FC<IconSelectProps> = ({
  value, options, onChange, iconFolder, iconShape, placeholder, className = '', disabled = false
}) => {
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
    const openUpward = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    setPopupPos({
      position: 'fixed',
      left: rect.left,
      minWidth: rect.width,
      maxWidth: Math.max(rect.width, window.innerWidth - rect.left - 8),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceAbove - 8) }
        : { top: rect.bottom + 4, maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceBelow - 8) })
    });
  }, [isOpen]);

  useEffect(() => {
    // Closing without a natural mouseleave (click-select, outside-click, Escape) would
    // otherwise leave a hovered disabled-option tooltip stuck on screen.
    if (!isOpen) {
      TooltipManager.hide();
      return;
    }
    setActiveIndex(Math.max(0, options.findIndex(o => o.value === value)));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !popupRef.current) return;
    const activeEl = popupRef.current.querySelector('.icon-select-option.is-active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const avatarClass = iconShape === 'rect' ? 'avatar-sm avatar-rect' : 'avatar-sm';

  const selectOption = (opt: IconSelectOption) => {
    if (opt.disabled) return;
    TooltipManager.hide();
    onChange(opt.value);
    setIsOpen(false);
  };

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
      setActiveIndex(prev => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) selectOption(options[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      typeaheadRef.current += e.key.toLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => { typeaheadRef.current = ''; }, 600);
      const term = typeaheadRef.current;
      const match = options.findIndex(o => o.value.toLowerCase().startsWith(term));
      if (match >= 0) setActiveIndex(match);
    }
  };

  return (
    <div className="icon-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-select-trigger ${className}`}
        disabled={disabled}
        onClick={() => setIsOpen(o => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="icon-select-trigger-label">{value || placeholder}</span>
      </button>
      {isOpen && createPortal(
        <div className="icon-select-popup" ref={popupRef} style={popupPos}>
          {options.map((opt, i) => (
            <div
              key={opt.value}
              className={`icon-select-option ${opt.value === value ? 'is-selected' : ''} ${i === activeIndex ? 'is-active' : ''} ${opt.disabled ? 'is-disabled' : ''}`}
              onMouseEnter={e => {
                setActiveIndex(i);
                if (opt.disabled && opt.disabledTooltip) TooltipManager.show(e.currentTarget, opt.disabledTooltip);
              }}
              onMouseLeave={() => TooltipManager.hide()}
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectOption(opt)}
            >
              <AvatarIcon name={opt.value} folder={iconFolder} className={avatarClass} />
              <span className="icon-select-option-label">{opt.value}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
