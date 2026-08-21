// src/components/results/ResultsTab.tsx
import React from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { DpsPanel } from './DpsPanel';
import { DmgOverTimeChart } from './DmgOverTimeChart';
import { TeamContributionPanel } from './TeamContributionPanel';
import { SubstatWorthChart } from './SubstatWorthChart';

export const ResultsTab: React.FC = () => {
  const results = useRotationStore(s => s.results);
  const isStale = useRotationStore(s => s.isStale);

  if (!results) {
    return (
      <div className="results-uncalculated">
        <h3>No Results Yet</h3>
        <p className="text-dim">Press Calculate to run the rotation and see DPS, damage over time, and contribution breakdowns.</p>
      </div>
    );
  }

  return (
    <div className={`results-tab-grid ${isStale ? 'is-stale' : ''}`}>
      <DpsPanel />
      <DmgOverTimeChart />
      <TeamContributionPanel />
      <SubstatWorthChart />
    </div>
  );
};
