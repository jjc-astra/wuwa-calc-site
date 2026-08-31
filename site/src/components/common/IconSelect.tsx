import React from 'react';
import { createPortal } from 'react-dom';
import type { ImageFolder } from '../../data/db';
import { AvatarIcon } from './AvatarIcon';
import { TooltipManager } from '../../utils/Common';
import { usePositionedSelectPopup } from '../../hooks/usePositionedSelectPopup';

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
  const avatarClass = iconShape === 'rect' ? 'avatar-sm avatar-rect' : 'avatar-sm';

  const selectOption = (opt: IconSelectOption) => {
    if (opt.disabled) return;
    TooltipManager.hide();
    onChange(opt.value);
    setIsOpen(false);
  };

  const {
    isOpen, setIsOpen, activeIndex, setActiveIndex, popupPos, rootRef, triggerRef, popupRef, handleKeyDown
  } = usePositionedSelectPopup({
    itemCount: options.length,
    popupMaxHeight: POPUP_MAX_HEIGHT,
    activeOptionSelector: '.icon-select-option.is-active',
    findInitialActiveIndex: () => options.findIndex(o => o.value === value),
    findTypeaheadMatch: term => options.findIndex(o => o.value.toLowerCase().startsWith(term)),
    onSelectIndex: index => selectOption(options[index])
  });

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
