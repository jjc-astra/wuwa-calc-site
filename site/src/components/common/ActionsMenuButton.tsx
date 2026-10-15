import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { tip } from '../../utils/Common';
import { usePositionedSelectPopup } from '../../hooks/usePositionedSelectPopup';

export interface ActionsMenuItem {
  /** Needed only when labels can repeat. */
  key?: string;
  label: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface ActionsMenuButtonProps {
  items: ActionsMenuItem[];
  triggerClassName: string;
  iconSize?: number;
  /** Replaces the 3-dot icon. */
  triggerContent?: React.ReactNode;
  triggerTooltip?: string;
  popupClassName?: string;
  /** Popup width matches the trigger. */
  matchTriggerWidth?: boolean;
}

const MENU_MAX_HEIGHT = 240;

/** "..." actions menu. Closes before running an item's onClick. */
export const ActionsMenuButton: React.FC<ActionsMenuButtonProps> = ({
  items, triggerClassName, iconSize = 14, triggerContent, triggerTooltip, popupClassName, matchTriggerWidth = false
}) => {
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
    activeOptionSelector: '.pin-menu-item.is-active',
    findInitialActiveIndex: () => -1,
    findTypeaheadMatch: () => -1,
    onSelectIndex: selectItem,
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
