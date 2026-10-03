import React, { useState } from 'react';
import { ChromeTabs } from './ChromeTabs';
import type { ChromeTabDef } from './ChromeTabs';
import { ResultsTab } from './ResultsTab';
import { TimelineTab } from './TimelineTab';
import { HistoryTab } from './HistoryTab';

const TABS: ChromeTabDef[] = [
  { id: 'results', label: 'Results' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'history', label: 'History' }
];

interface ResultsPanelProps {
  /** Collapses the panel to a thin rail -- its info only matters while working in Step 2. */
  collapsed: boolean;
}

/** The Calculator's Results column: Results, Timeline and History tabs. The Timeline widens it. */
export const ResultsPanel: React.FC<ResultsPanelProps> = ({ collapsed }) => {
  const [activeTab, setActiveTab] = useState('results');
  const isTimeline = activeTab === 'timeline';

  return (
    <div className={`results-panel ${collapsed ? 'is-collapsed' : ''} ${isTimeline ? 'is-wide' : ''}`}>
      <div className="results-panel-rail-label">Results</div>
      <div className="results-panel-content">
        <ChromeTabs tabs={TABS} activeId={activeTab} onSelect={setActiveTab} />
        <div className={`results-panel-body ${isTimeline ? 'is-timeline' : ''}`}>
          {activeTab === 'results' && <ResultsTab />}
          {isTimeline && <TimelineTab />}
          {activeTab === 'history' && <HistoryTab />}
        </div>
      </div>
    </div>
  );
};
