// src/components/results/ResultsPanel.tsx
import React, { useState } from 'react';
import { ChromeTabs } from './ChromeTabs';
import type { ChromeTabDef } from './ChromeTabs';
import { ResultsTab } from './ResultsTab';
import { ComingSoonTab } from './ComingSoonTab';

const TABS: ChromeTabDef[] = [
  { id: 'results', label: 'Results' },
  { id: 'timeline', label: 'Timeline', comingSoon: true },
  { id: 'history', label: 'History', comingSoon: true }
];

export const ResultsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState('results');

  return (
    <div className="results-panel">
      <ChromeTabs tabs={TABS} activeId={activeTab} onSelect={setActiveTab} />
      <div className="results-panel-body">
        {activeTab === 'results' && <ResultsTab />}
        {activeTab === 'timeline' && (
          <ComingSoonTab
            title="Timeline"
            description="A video-editor style timeline of character moves, buff lifetimes, and negative status stacks."
          />
        )}
        {activeTab === 'history' && (
          <ComingSoonTab title="History" description="Snapshots of rotations you've previously run, ready to revisit or compare." />
        )}
      </div>
    </div>
  );
};
