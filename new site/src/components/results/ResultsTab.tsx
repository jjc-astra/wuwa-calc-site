// src/components/results/ResultsTab.tsx
import React from 'react';
import { DpsPanel } from './DpsPanel';
import { DmgOverTimeChart } from './DmgOverTimeChart';
import { TeamContributionPanel } from './TeamContributionPanel';
import { SubstatWorthChart } from './SubstatWorthChart';

export const ResultsTab: React.FC = () => (
  <div className="results-tab-grid">
    <DpsPanel />
    <DmgOverTimeChart />
    <TeamContributionPanel />
    <SubstatWorthChart />
  </div>
);
