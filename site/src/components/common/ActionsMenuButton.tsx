// src/components/common/ActionsMenuButton.tsx
import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tip } from '../../utils/Common';
import { usePositionedSelectPopup } from '../../hooks/usePositionedSelectPopup';

export interface ActionsMenuItem {
  /** Only needed when two items could share a label (e.g. one "Open X Guide" item per unit). */
  key?: string;
  label: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ActionsMenuButtonProps {
  items: ActionsMenuItem[];
  triggerClassName: string;
  iconSize?: number;
  /** Overrides the default 3-dot icon -- e.g. a labeled "Support ▾"-style trigger. */
  triggerContent?: React.ReactNode;
  triggerTooltip?: string;
  /** Extra class on the popup -- e.g. to override .pin-menu's min-width for a shorter-item menu. */
  popupClassName?: string;
  /** Pins the popup to the trigger's own rendered width instead of shrink-wrapping to the
   * items' content -- for a wide labeled trigger (e.g. "Export JSON") whose items read as
   * individually shorter text. */
  matchTriggerWidth?: boolean;
}

// Ceiling on popup height -- usePositionedSelectPopup only ever shrinks it to available room
// (its maxHeight clamp), so this just needs to cover the menu's realistic max content.
const MENU_MAX_HEIGHT = 240;

/** Shared "..." actions-menu trigger: 3-dot icon button opening a `.pin-menu` list.
 * Reuses usePositionedSelectPopup for portal positioning (same as Dropdown/IconSelect).
 * Item clicks close the menu before running onClick, to avoid racing an async handler. */
export const ActionsMenuButton: React.FC<ActionsMenuButtonProps> = ({
  items, triggerClassName, iconSize = 14, triggerContent, triggerTooltip, popupClassName, matchTriggerWidth = false
}) => {
  // Only the default 3-dot icon needs a tooltip -- custom triggerContent is assumed self-explanatory.
  const resolvedTooltip = triggerTooltip ?? (triggerContent ? undefined : 'More actions');
  const selectItem = (index: number) => {
    setIsOpen(false);
    items[index]?.onClick();
  };

  const {
    isOpen, setIsOpen, popupPos, rootRef, triggerRef, popupRef, handleKeyDown
  } = usePositionedSelectPopup({
    itemCount: items.length,
    popupMaxHeight: MENU_MAX_HEIGHT,
    // No persistent "selected" option (unlike Dropdown/IconSelect) -- only used for
    // keyboard-nav bookkeeping this component doesn't otherwise need.
    activeOptionSelector: '.pin-menu-item.is-active',
    findInitialActiveIndex: () => -1,
    findTypeaheadMatch: () => -1,
    onSelectIndex: selectItem,
    // Right-anchored so the menu opens back over the row, not off its right edge.
    align: 'right'
  });

  const [triggerWidth, setTriggerWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (matchTriggerWidth && isOpen && triggerRef.current) {
      setTriggerWidth(triggerRef.current.getBoundingClientRect().width);
    }
  }, [isOpen, matchTriggerWidth, triggerRef]);

  const popupStyle = matchTriggerWidth && triggerWidth != null
    ? { ...popupPos, width: triggerWidth, minWidth: triggerWidth }
    : popupPos;

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        ref={triggerRef}
        onClick={() => setIsOpen(o => !o)}
        onKeyDown={handleKeyDown}
        {...(resolvedTooltip ? tip(resolvedTooltip) : {})}
      >
        {triggerContent ?? (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"></circle>
            <circle cx="12" cy="12" r="2"></circle>
            <circle cx="12" cy="19" r="2"></circle>
          </svg>
        )}
      </button>
      {isOpen && createPortal(
        <div className={`pin-menu ${popupClassName ?? ''}`} ref={popupRef} style={popupStyle}>
          {items.map((item, i) => (
            <button
              key={item.key ?? i}
              type="button"
              className={`pin-menu-item ${item.danger ? 'pin-menu-item-danger' : ''}`}
              onClick={() => selectItem(i)}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
