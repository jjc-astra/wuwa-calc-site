// src/components/rankings/RankingRow.tsx
import React, { useState } from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from './StackedContributionBar';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import { RankingTimelinePanel } from './RankingTimelinePanel';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import { DataLoader } from '../../utils/DataLoader';
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
  const [isExpanded, setIsExpanded] = useState(false);
  const dps = entry.dpsStats[DPS_FIELD[activeWindow]] ?? 0;
  const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
  const unitNames = entry.team.filter(s => s.character).map(s => s.character);
  const label = unitNames.join(' · ');
  const segments = entry.contribution[activeWindow]?.team ?? [];
  const unitBreakdowns = entry.contribution[activeWindow]?.units ?? {};

  // entry.id is the source file name -- DataLoader.characterResults still caches the full record
  // (rotation/settings); RankingEntry itself only carries computed dpsStats/contribution.
  const handleOpenInCalculator = async () => {
    const data = DataLoader.characterResults[entry.id];
    if (!data) return;
    await useRosterStore.getState().importTeam(entry.team);
    useRotationStore.getState().importRotation(data.rotation, data.settings);
    // Mirrors useHashRoute's routeToHash('calculator', 2) -- no navigate() prop reaches this deep,
    // so this sets the hash directly; the hook's hashchange listener picks it up the same way.
    window.location.hash = '#/calculator/step-2';
  };

  // No dmgOverTimeSeries on RankingEntry -- recalculates via worker like Import JSON does
  // (pinFromRankingEntry), then jumps to Calculator since Rankings has no such panel to show it.
  const handlePinToComparison = () => {
    useComparisonStore.getState().pinFromRankingEntry(entry.id);
    window.location.hash = '#/calculator/step-2';
  };

  const handleOpenGuide = () => {
    // Character Guide has no per-character route yet (still "Soon" in nav.ts) -- lands on the
    // coming-soon page for now instead of a dead link.
    window.location.hash = '#/guide';
  };

  return (
    <>
      <div className={`ranking-row ${isExpanded ? 'is-expanded' : ''}`} onClick={() => setIsExpanded(v => !v)}>
        <span className={`ranking-row-expand-icon ${isExpanded ? 'is-open' : ''}`}>▶</span>
        <div className="ranking-row-rank">{rank}</div>
        <div className="ranking-row-icons">
          <TeamPreview team={entry.team} />
        </div>
        <div className="ranking-row-main">
          <div className="ranking-row-label-line">
            <span className="ranking-row-label">{label || 'Empty Team'}</span>
            <div className="ranking-row-badges">
              <span className={`ranking-row-type-badge ranking-row-type-${entry.rotationType ?? 'unclassified'}`}>
                {entry.rotationType === 'linear' ? 'Linear' : entry.rotationType === 'quickswap' ? 'Quickswap' : 'Unclassified'}
              </span>
              {entry.author && (
                <span className="ranking-row-author-badge">By: {entry.author}</span>
              )}
            </div>
          </div>
          <StackedContributionBar
            segments={segments}
            unitNames={unitNames}
            unitBreakdowns={unitBreakdowns}
            widthPct={widthPct}
            dpsValue={dps}
          />
        </div>
        <div className="ranking-row-menu-wrap" onClick={e => e.stopPropagation()}>
          <ActionsMenuButton
            triggerClassName="ranking-row-menu-btn"
            iconSize={20}
            items={[
              { key: 'open-in-calculator', label: 'Open in Rotation Calculator', onClick: handleOpenInCalculator },
              { key: 'pin-to-comparison', label: 'Pin to Comparison', onClick: handlePinToComparison },
              ...unitNames.map(name => ({ key: `guide-${name}`, label: `Open ${name} Guide`, onClick: handleOpenGuide }))
            ]}
          />
        </div>
      </div>
      {isExpanded && <RankingTimelinePanel entry={entry} />}
    </>
  );
};
