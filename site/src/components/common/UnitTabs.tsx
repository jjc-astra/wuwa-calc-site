// src/components/common/UnitTabs.tsx
import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor } from '../../utils/Common';

interface UnitTabsProps {
  tabs: string[];
  active: string;
  onSelect: (tab: string) => void;
  /** Tabs that render without a --unit-theme color, e.g. a non-character "Team" tab. */
  unthemed?: string[];
}

/** Shared per-unit tab strip for picking "Team" and/or one character -- each themed tab
 * colors itself via the same character theme used elsewhere in results panels. */
export const UnitTabs: React.FC<UnitTabsProps> = ({ tabs, active, onSelect, unthemed = [] }) => (
  <div className="unit-tabs">
    {tabs.map(t => (
      <button
        key={t}
        type="button"
        className={`unit-tab ${t === active ? 'is-active' : ''}`}
        style={unthemed.includes(t) ? undefined : ({ '--unit-theme': getCharacterThemeColor(DataLoader.characterDB[t]) } as React.CSSProperties)}
        onClick={() => onSelect(t)}
      >
        {t}
      </button>
    ))}
  </div>
);
