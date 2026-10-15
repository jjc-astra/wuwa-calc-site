import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor } from '../../utils/Common';

interface UnitTabsProps {
  tabs: string[];
  active: string;
  onSelect: (tab: string) => void;
  /** Tabs without a unit theme color (e.g. "Team"). */
  unthemed?: string[];
}

/** Per-unit tab strip, themed by character. */
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
