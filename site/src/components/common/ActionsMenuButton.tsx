// src/components/common/ActionsMenuButton.tsx
import React from 'react';
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
  /** Extra class on the popup itself -- e.g. to override .pin-menu's min-width for a menu whose
   * items are all shorter than the other menus that class is shared with. */
  popupClassName?: string;
}

// Generous ceiling on the popup's own height -- usePositionedSelectPopup only ever shrinks a
// popup down to whatever room is actually available (see its maxHeight clamp), so this just
// needs to be at least as tall as this menu's content ever realistically gets; it never forces
// the popup to be this tall when there's less content or less room.
const MENU_MAX_HEIGHT = 240;

/** Shared "..." actions-menu trigger: a 3-dot icon button that opens a `.pin-menu` list.
 * Positioning (fixed-position portal placement, flips above the trigger when the viewport
 * doesn't have room below -- e.g. the last row of a scrollable list) reuses the exact same
 * usePositionedSelectPopup hook that backs Dropdown/IconSelect's popups, rather than
 * re-deriving the same boundary math here. Every item click closes the menu (before running the
 * item's own onClick, so an async handler doesn't race a still-open menu) -- matches how every
 * existing menu item in this app behaves. */
export const ActionsMenuButton: React.FC<ActionsMenuButtonProps> = ({
  items, triggerClassName, iconSize = 14, triggerContent, triggerTooltip, popupClassName
}) => {
  // Only the default 3-dot icon needs a tooltip to explain itself -- a custom triggerContent is
  // expected to already be self-explanatory (e.g. a labeled "Support" button).
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
    // No persistent "selected" option for an action menu (unlike Dropdown/IconSelect) -- these
    // two are only consulted for keyboard nav bookkeeping this component doesn't otherwise use.
    activeOptionSelector: '.pin-menu-item.is-active',
    findInitialActiveIndex: () => -1,
    findTypeaheadMatch: () => -1,
    onSelectIndex: selectItem,
    // The trigger is a narrow icon pinned to the row's right edge -- right-anchor so the menu
    // opens back over the row instead of hanging off to the right past it.
    align: 'right'
  });

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
        <div className={`pin-menu ${popupClassName ?? ''}`} ref={popupRef} style={popupPos}>
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
