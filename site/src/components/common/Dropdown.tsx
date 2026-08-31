import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { TooltipManager } from '../../utils/Common';

export interface DropdownOption {
  value: string;
  label?: React.ReactNode;
  disabled?: boolean;
  tooltip?: string;
}

export interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface FlatEntry {
  opt: DropdownOption;
  groupLabel?: string;
  groupStart: boolean;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[] | DropdownGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  // Overrides the default gold popup highlight -- e.g. a rotation row's character theme color.
  accentColor?: string;
}

const POPUP_MAX_HEIGHT = 420;

const isGrouped = (options: DropdownOption[] | DropdownGroup[]): options is DropdownGroup[] =>
  options.length > 0 && (options[0] as DropdownGroup).options !== undefined;

/** A <select> replacement whose popup is fully CSS-styled instead of the browser/OS-native
 * popup a real <select> renders -- e.g. Windows Chrome always highlights the hovered/selected
 * option with its own blue system-accent color no matter what CSS targets .option, and optgroup
 * labels get the OS's own styling too. This reimplements the dropdown as a positioned list of
 * divs instead, portaled to <body> and positioned in fixed coordinates so it always escapes any
 * clipping/scrolling ancestor the way a native select's OS popup would -- same approach as
 * IconSelect, minus the per-option icon, plus optgroup-style grouping. */
export const Dropdown: React.FC<DropdownProps> = ({
  value, options, onChange, placeholder = '', className = '', disabled = false, accentColor
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popupPos, setPopupPos] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flat: FlatEntry[] = isGrouped(options)
    ? options.flatMap(g => g.options.map((opt, i) => ({ opt, groupLabel: g.label, groupStart: i === 0 })))
    : options.map(opt => ({ opt, groupStart: false }));

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
    // otherwise leave a hovered option's tooltip stuck on screen.
    if (!isOpen) {
      TooltipManager.hide();
      return;
    }
    setActiveIndex(Math.max(0, flat.findIndex(e => e.opt.value === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !popupRef.current) return;
    const activeEl = popupRef.current.querySelector('.dropdown-option.is-active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const selectOption = (opt: DropdownOption) => {
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
      setActiveIndex(prev => (prev + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) selectOption(flat[activeIndex].opt);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
      typeaheadRef.current += e.key.toLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => { typeaheadRef.current = ''; }, 600);
      const term = typeaheadRef.current;
      const match = flat.findIndex(entry => String(entry.opt.label ?? entry.opt.value).toLowerCase().startsWith(term));
      if (match >= 0) setActiveIndex(match);
    }
  };

  const selected = flat.find(e => e.opt.value === value)?.opt;
  const triggerLabel = selected ? (selected.label ?? selected.value) : placeholder;

  const popupStyle: React.CSSProperties = accentColor
    ? ({ ...popupPos, '--dropdown-accent': accentColor } as React.CSSProperties)
    : popupPos;

  const triggerStyle: React.CSSProperties = accentColor
    ? ({ '--dropdown-accent': accentColor } as React.CSSProperties)
    : {};

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger ${className}`}
        style={triggerStyle}
        disabled={disabled}
        onClick={() => setIsOpen(o => !o)}
        onKeyDown={handleKeyDown}
      >
        <span className="dropdown-trigger-label">{triggerLabel}</span>
        <svg className="dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && createPortal(
        <div className="dropdown-popup" ref={popupRef} style={popupStyle}>
          {flat.map((entry, i) => (
            <React.Fragment key={`${entry.groupLabel ?? ''}::${entry.opt.value}::${i}`}>
              {entry.groupStart && <div className="dropdown-group-label">{entry.groupLabel}</div>}
              <div
                className={`dropdown-option ${entry.opt.value === value ? 'is-selected' : ''} ${i === activeIndex ? 'is-active' : ''} ${entry.opt.disabled ? 'is-disabled' : ''}`}
                onMouseEnter={e => {
                  setActiveIndex(i);
                  if (entry.opt.tooltip) TooltipManager.show(e.currentTarget, entry.opt.tooltip);
                }}
                onMouseLeave={() => TooltipManager.hide()}
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectOption(entry.opt)}
              >
                <span className="dropdown-option-label">{entry.opt.label ?? entry.opt.value}</span>
              </div>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
