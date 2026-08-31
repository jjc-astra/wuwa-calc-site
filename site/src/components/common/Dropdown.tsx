import React from 'react';
import { createPortal } from 'react-dom';
import { TooltipManager } from '../../utils/Common';
import { usePositionedSelectPopup } from '../../hooks/usePositionedSelectPopup';

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
  const flat: FlatEntry[] = isGrouped(options)
    ? options.flatMap(g => g.options.map((opt, i) => ({ opt, groupLabel: g.label, groupStart: i === 0 })))
    : options.map(opt => ({ opt, groupStart: false }));

  const selectOption = (opt: DropdownOption) => {
    if (opt.disabled) return;
    TooltipManager.hide();
    onChange(opt.value);
    setIsOpen(false);
  };

  const {
    isOpen, setIsOpen, activeIndex, setActiveIndex, popupPos, rootRef, triggerRef, popupRef, handleKeyDown
  } = usePositionedSelectPopup({
    itemCount: flat.length,
    popupMaxHeight: POPUP_MAX_HEIGHT,
    activeOptionSelector: '.dropdown-option.is-active',
    findInitialActiveIndex: () => flat.findIndex(e => e.opt.value === value),
    findTypeaheadMatch: term =>
      flat.findIndex(entry => String(entry.opt.label ?? entry.opt.value).toLowerCase().startsWith(term)),
    onSelectIndex: index => selectOption(flat[index].opt)
  });

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
