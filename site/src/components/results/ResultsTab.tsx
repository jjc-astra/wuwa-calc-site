import React from 'react';
import { useResultsSource } from './ResultsSource';
import { DpsPanel } from './DpsPanel';
import { RotationTimePanel } from './RotationTimePanel';
import { DmgOverTimeChart } from './DmgOverTimeChart';
import { TeamContributionPanel } from './TeamContributionPanel';
import { SubstatWorthChart } from './SubstatWorthChart';

/** The Results tab: the result panels, or a prompt to Calculate. */
export const ResultsTab: React.FC = () => {
  const { results } = useResultsSource();

  if (!results) {
    return (
      <div className="results-uncalculated">
        <h3>No Results Yet</h3>
        <p className="text-dim">Press Calculate to run the rotation and see DPS, damage over time, and contribution breakdowns.</p>
      </div>
    );
  }

  return <ResultsGrid />;
};

// The result panels.
export const ResultsGrid: React.FC = () => {
  const { results } = useResultsSource();
  if (!results) return null;
  return (
    <div className="results-tab-grid">
      <DpsPanel />
      <DmgOverTimeChart />
      <RotationTimePanel />
      <TeamContributionPanel />
      <SubstatWorthChart />
    </div>
  );
};
