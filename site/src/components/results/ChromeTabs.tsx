// src/components/results/ChromeTabs.tsx
import React from 'react';

export interface ChromeTabDef {
  id: string;
  label: string;
  comingSoon?: boolean;
}

interface ChromeTabsProps {
  tabs: ChromeTabDef[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const ChromeTabs: React.FC<ChromeTabsProps> = ({ tabs, activeId, onSelect }) => (
  <div className="chrome-tabs" role="tablist">
    {tabs.map(tab => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={tab.id === activeId}
        className={`chrome-tab ${tab.id === activeId ? 'is-active' : ''}`}
        onClick={() => onSelect(tab.id)}
      >
        <span>{tab.label}</span>
        {tab.comingSoon && <span className="coming-soon-badge">Soon</span>}
      </button>
    ))}
  </div>
);
