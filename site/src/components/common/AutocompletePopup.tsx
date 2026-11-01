import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TooltipManager } from '../../utils/Common';

export interface PopupGroup {
  group: string;
  items: Array<{ label: string; tooltip?: string }>;
}

interface AutocompletePopupProps {
  groups: PopupGroup[];
  /** Index across all groups. */
  activeIndex: number;
  onActiveChange: (index: number) => void;
  onSelect: (index: number) => void;
  popupRef: React.RefObject<HTMLDivElement | null>;
  style: React.CSSProperties;
}

/** Grouped suggestion list, portaled to <body>; items are indexed across groups. */
export const AutocompletePopup: React.FC<AutocompletePopupProps> = ({ groups, activeIndex, onActiveChange, onSelect, popupRef, style }) => {
  // Keep the active item in view.
  useEffect(() => {
    popupRef.current?.querySelector('.autocomplete-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, popupRef]);

  // Hide the tooltip on close (no mouseleave fires).
  useEffect(() => () => TooltipManager.hide(), []);

  let globalIdx = 0;
  return createPortal(
    <div ref={popupRef} className="autocomplete-popup" style={{ display: 'block', ...style }}>
      {groups.map(g => (
        <React.Fragment key={g.group}>
          <div className="autocomplete-group-header">{g.group}</div>
          {g.items.map((item, i) => {
            const idx = globalIdx++;
            return (
              <div
                key={i}
                className={`autocomplete-item ${idx === activeIndex ? 'is-active' : ''}`}
                onMouseDown={e => {
                  e.preventDefault();
                  onSelect(idx);
                }}
                onMouseEnter={e => {
                  onActiveChange(idx);
                  if (item.tooltip) {
                    TooltipManager.show(e.currentTarget, `<div class="tooltip-val">${item.label}</div><div style="margin-top:2px;">${item.tooltip}</div>`);
                  }
                }}
                onMouseLeave={() => TooltipManager.hide()}
              >
                {item.label}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>,
    document.body
  );
};
