// src/components/common/ActionsMenuButton.tsx
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tip } from '../../utils/Common';

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
  /** Portals the menu to <body>, fixed-positioned off the trigger's own rect, for a trigger
   * that sits inside an overflow:hidden ancestor (e.g. a rounded-corner tab panel) where the
   * default position:absolute-in-position:relative placement would get clipped. */
  portal?: boolean;
}

/** Shared "..." actions-menu trigger: a 3-dot icon button that opens a `.pin-menu` list.
 * Every item click closes the menu (before running the item's own onClick, so an async handler
 * doesn't race a still-open menu) -- matches how every existing menu item in this app behaves. */
export const ActionsMenuButton: React.FC<ActionsMenuButtonProps> = ({
  items, triggerClassName, iconSize = 14, portal = false
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!portal || !menuOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right
    });
  }, [menuOpen, portal]);

  const menu = menuOpen && (
    <>
      <div className="pin-menu-backdrop" onClick={() => setMenuOpen(false)} />
      <div className="pin-menu" style={portal ? menuStyle : undefined}>
        {items.map((item, i) => (
          <button
            key={item.key ?? i}
            type="button"
            className={`pin-menu-item ${item.danger ? 'pin-menu-item-danger' : ''}`}
            onClick={() => {
              setMenuOpen(false);
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        ref={btnRef}
        onClick={() => setMenuOpen(o => !o)}
        {...tip('More actions')}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2"></circle>
          <circle cx="12" cy="12" r="2"></circle>
          <circle cx="12" cy="19" r="2"></circle>
        </svg>
      </button>
      {portal ? (menuOpen && createPortal(menu, document.body)) : menu}
    </>
  );
};
