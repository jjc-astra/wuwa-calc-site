// src/components/rankings/RankingRow.tsx
import React from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from './StackedContributionBar';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
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
  const dps = entry.dpsStats[DPS_FIELD[activeWindow]] ?? 0;
  const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
  const unitNames = entry.team.filter(s => s.character).map(s => s.character);
  const label = unitNames.join(' · ');
  const segments = entry.contribution[activeWindow]?.team ?? [];
  const unitBreakdowns = entry.contribution[activeWindow]?.units ?? {};

  // entry.id is the submitted file's name -- DataLoader.characterResults still has the full
  // record (rotation/settings included) it was loaded from, since useRankingsStore.load() never
  // clears that cache. RankingEntry itself only carries the computed dpsStats/contribution, not
  // the raw rotation, so this is the only place left to get it from.
  const handleOpenInCalculator = async () => {
    const data = DataLoader.characterResults[entry.id];
    if (!data) return;
    await useRosterStore.getState().importTeam(entry.team);
    useRotationStore.getState().importRotation(data.rotation, data.settings);
    // Mirrors useHashRoute's routeToHash('calculator', 2) -- no navigate() prop reaches this
    // deep (Rankings doesn't otherwise need routing), and the hook's own hashchange listener
    // picks this up the same as if it had called navigate() itself.
    window.location.hash = '#/calculator/step-2';
  };

  const handleOpenGuide = () => {
    // Character Guide has no per-character route yet (still "Soon" in nav.ts) -- lands on its
    // coming-soon page for now rather than a dead link, and starts working for real the moment
    // that page exists.
    window.location.hash = '#/guide';
  };

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
      <div className="ranking-row-menu-wrap">
        <ActionsMenuButton
          triggerClassName="ranking-row-menu-btn"
          iconSize={20}
          portal
          items={[
            { key: 'open-in-calculator', label: 'Open in Rotation Calculator', onClick: handleOpenInCalculator },
            ...unitNames.map(name => ({ key: `guide-${name}`, label: `Open ${name} Guide`, onClick: handleOpenGuide }))
          ]}
        />
      </div>
    </div>
  );
};
