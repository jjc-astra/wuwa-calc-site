// src/components/results/ResultsTab.tsx
import React from 'react';
import { DpsPanel } from './DpsPanel';
import { DmgOverTimeChart } from './DmgOverTimeChart';
import { SubstatWorthChart } from './SubstatWorthChart';
import { TeamContributionPanel } from './TeamContributionPanel';

export const ResultsTab: React.FC = () => (
  <div className="results-tab-grid">
    <DpsPanel />
    <DmgOverTimeChart />
    <SubstatWorthChart />
    <TeamContributionPanel />
  </div>
);
