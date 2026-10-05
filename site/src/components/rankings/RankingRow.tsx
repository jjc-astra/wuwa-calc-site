import React, { useState } from 'react';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from './StackedContributionBar';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import { RankingTimelinePanel } from './RankingTimelinePanel';
import { useRankedResults, rosterOf } from './useRankedResults';
import { loadSavedRotation } from '../../store/loadSavedRotation';
import { useComparisonStore } from '../../store/useComparisonStore';
import { DataLoader } from '../../utils/DataLoader';
import { rotationTypeLabel } from '../../store/useRankingsStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { DpsWindowKey } from '../../types/results';
import { dpsFieldOf } from '../../data/dpsWindows';
import { calculatorHash, guideHash } from '../../hooks/useHashRoute';
import type { ActionsMenuItem } from '../common/ActionsMenuButton';

/** A rotation's Linear / Quickswap tag. */
export const RotationTypeBadge: React.FC<{ type: RankingEntry['rotationType'] }> = ({ type }) => (
  <span className={`ranking-row-type-badge caps-tag pill-badge outline-badge ranking-row-type-${type ?? 'unclassified'}`}>{rotationTypeLabel(type)}</span>
);

interface RankingRowProps {
  rank: number;
  entry: RankingEntry;
  activeWindow: DpsWindowKey;
  maxDps: number;
  // When set, the bar's % label reads against this instead of the top entry.
  baselineDps?: number;
  extraMenuItems?: ActionsMenuItem[];
}

/** One ranked rotation: team, DPS bar and actions, expanding to its timeline. */
export const RankingRow: React.FC<RankingRowProps> = ({ rank, entry, activeWindow, maxDps, baselineDps, extraMenuItems = [] }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const dps = entry.dpsStats[dpsFieldOf(activeWindow)] ?? 0;
  const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
  const unitNames = entry.characters.filter(Boolean);
  const label = unitNames.join(' · ');
  // Team details, author and contribution aren't in the index: they come with the row's results file.
  const results = useRankedResults(entry);
  const forWindow = results?.results.contribution[activeWindow];
  const segments = forWindow?.team ?? [];
  const unitBreakdowns = results ? forWindow?.units ?? {} : null;

  // Opens the ranked run: its rotation, on the team its ranked results were calculated with.
  const handleOpenInCalculator = async () => {
    let run;
    try {
      run = await DataLoader.loadRankedRun(entry);
    } catch (err: any) {
      alert(err?.message || String(err));
      return;
    }
    await loadSavedRotation(run);
    // No navigate() prop reaches this deep; the hook's hashchange listener picks this up the same way.
    window.location.hash = calculatorHash(2);
  };

  // No dmgOverTimeSeries on RankingEntry -- recalculates via worker like Import JSON does
  // (pinFromRankingEntry), then jumps to Calculator since Rankings has no such panel to show it.
  const handlePinToComparison = () => {
    useComparisonStore.getState().pinFromRankingEntry(entry);
    window.location.hash = calculatorHash(2);
  };

return (
    <>
      <div
        className={`ranking-row ${isExpanded ? 'is-expanded' : ''}`}
        onClick={() => setIsExpanded(v => !v)}
      >
        <span className={`ranking-row-expand-icon ${isExpanded ? 'is-open' : ''}`}>▶</span>
        <div className="ranking-row-rank">{rank}</div>
        <div className="ranking-row-icons">
          <TeamPreview team={rosterOf(entry, results)} />
        </div>
        <div className="ranking-row-main">
          <div className="ranking-row-label-line">
            <span className="ranking-row-label">{label || 'Empty Team'}</span>
            <div className="ranking-row-badges">
              <RotationTypeBadge type={entry.rotationType} />
              {results?.author && (
                <span className="ranking-row-author-badge caps-tag pill-badge outline-badge">By: {results.author}</span>
              )}
            </div>
          </div>
          <StackedContributionBar
            segments={segments}
            unitNames={unitNames}
            unitBreakdowns={unitBreakdowns}
            widthPct={widthPct}
            dpsValue={dps}
            percentLabel={baselineDps ? (dps / baselineDps) * 100 : undefined}
          />
        </div>
        <div className="ranking-row-menu-wrap" onClick={e => e.stopPropagation()}>
          <ActionsMenuButton
            triggerClassName="ranking-row-menu-btn"
            iconSize={20}
            items={[
              { key: 'open-in-calculator', label: 'Open in Rotation Calculator', onClick: handleOpenInCalculator },
              { key: 'pin-to-comparison', label: 'Pin to Comparison', onClick: handlePinToComparison },
              ...unitNames.map(name => ({ key: `guide-${name}`, label: `Open ${name} Guide`, onClick: () => { window.location.hash = guideHash(name); } })),
              ...extraMenuItems
            ]}
          />
        </div>
      </div>
      {isExpanded && <RankingTimelinePanel entry={entry} />}
    </>
  );
};
