import React, { useEffect, useRef, useState } from 'react';
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
  /** Adds a text filter at the top of the popup, for long option lists (e.g. the character list). */
  searchable?: boolean;
}

const POPUP_MAX_HEIGHT = 260;

/** <select> replacement that renders each option with its icon (styled like roster card
 * avatars) -- native <select> can't reliably show images in its popup cross-browser. Portaled
 * to <body>, fixed-positioned, so it escapes clipping ancestors (e.g. .char-row's overflow-x). */
export const IconSelect: React.FC<IconSelectProps> = ({
  value, options, onChange, iconFolder, iconShape, placeholder, className = '', disabled = false, searchable = false
}) => {
  const avatarClass = iconShape === 'rect' ? 'avatar-sm avatar-rect' : 'avatar-sm';
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = searchable && searchTerm.trim()
    ? options.filter(o => o.value.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    : options;

  const selectOption = (opt: IconSelectOption) => {
    if (opt.disabled) return;
    TooltipManager.hide();
    onChange(opt.value);
    setIsOpen(false);
  };

  const {
    isOpen, setIsOpen, activeIndex, setActiveIndex, popupPos, rootRef, triggerRef, popupRef, handleKeyDown
  } = usePositionedSelectPopup({
    itemCount: filteredOptions.length,
    popupMaxHeight: POPUP_MAX_HEIGHT,
    activeOptionSelector: '.icon-select-option.is-active',
    findInitialActiveIndex: () => filteredOptions.findIndex(o => o.value === value),
    // Search box replaces letter-by-letter typeahead -- see the activeIndex reset below instead.
    findTypeaheadMatch: term => (searchable ? -1 : filteredOptions.findIndex(o => o.value.toLowerCase().startsWith(term))),
    onSelectIndex: index => selectOption(filteredOptions[index])
  });

  // Fresh search + focus each time the popup opens.
  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm('');
    if (searchable) requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [isOpen, searchable]);

  // Highlights the first match as the list narrows.
  useEffect(() => {
    if (searchable && isOpen) setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

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
          {searchable && (
            <input
              ref={searchInputRef}
              type="text"
              className="icon-select-search"
              placeholder="Search..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          )}
          {searchable && filteredOptions.length === 0 && (
            <div className="icon-select-empty">No matches</div>
          )}
          {filteredOptions.map((opt, i) => (
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
