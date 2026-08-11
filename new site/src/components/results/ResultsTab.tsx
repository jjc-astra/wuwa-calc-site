// src/components/results/ResultsTab.tsx
import React from 'react';
import { DpsPanel } from './DpsPanel';
import { TimeToKillChart } from './TimeToKillChart';
import { SubstatWorthChart } from './SubstatWorthChart';
import { TeamContributionPanel } from './TeamContributionPanel';

export const ResultsTab: React.FC = () => (
  <div className="results-tab-grid">
    <DpsPanel />
    <TimeToKillChart />
    <SubstatWorthChart />
    <TeamContributionPanel />
  </div>
);
