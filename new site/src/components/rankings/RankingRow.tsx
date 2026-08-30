// src/components/rankings/RankingRow.tsx
import React from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from './StackedContributionBar';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { DpsWindowKey } from '../../types/results';

const DPS_FIELD: Record<DpsWindowKey, 'openerDps' | 'firstLoopDps' | 'avgLoopDps' | 'twoMinDps'> = {
  opener: 'openerDps',
  firstLoop: 'firstLoopDps',
  avgLoop: 'avgLoopDps',
  twoMin: 'twoMinDps'
};

interface RankingRowProps {
  rank: number;
  entry: RankingEntry;
  activeWindow: DpsWindowKey;
  maxDps: number;
}

export const RankingRow: React.FC<RankingRowProps> = ({ rank, entry, activeWindow, maxDps }) => {
  const dps = entry.dpsStats[DPS_FIELD[activeWindow]] ?? 0;
  const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
  const unitNames = entry.team.filter(s => s.character).map(s => s.character);
  const label = unitNames.join(' · ');
  const segments = entry.contribution[activeWindow]?.team ?? [];
  const unitBreakdowns = entry.contribution[activeWindow]?.units ?? {};

  return (
    <div className="ranking-row">
      <div className="ranking-row-rank">{rank}</div>
      <div className="ranking-row-icons">
        <TeamPreview team={entry.team} />
      </div>
      <div className="ranking-row-main">
        <div className="ranking-row-label-line">
          <span className="ranking-row-label">{label || 'Empty Team'}</span>
          <span className={`ranking-row-type-badge ranking-row-type-${entry.rotationType ?? 'unclassified'}`}>
            {entry.rotationType === 'linear' ? 'Linear' : entry.rotationType === 'quickswap' ? 'Quickswap' : 'Unclassified'}
          </span>
        </div>
        <StackedContributionBar
          segments={segments}
          unitNames={unitNames}
          unitBreakdowns={unitBreakdowns}
          widthPct={widthPct}
          dpsValue={dps}
        />
      </div>
    </div>
  );
};
