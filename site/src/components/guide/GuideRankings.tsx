// src/components/guide/GuideRankings.tsx
// Rankings for teams with this unit, with the Rankings page's sequence and rotation-style filters
// (kept separately from that page's own filter state).
import React, { useMemo, useState } from 'react';
import { filterRankingEntries } from '../../store/useRankingsStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import { DEFAULT_RANKING_FILTERS, SequenceRangeFilters, RotationStyleToggle } from '../rankings/RankingFilterToolbar';
import type { RankingFilters } from '../rankings/RankingFilterToolbar';
import { RankingRow } from '../rankings/RankingRow';
import { ChromeTabs } from '../results/ChromeTabs';
import { DPS_WINDOW_TABS } from '../results/chartPalette';
import { dpsFieldOf } from '../../data/dpsWindows';
import type { DpsWindowKey } from '../../types/results';
import type { RotationSummary } from '../../types/results';

const PAGE_SIZE = 20;

interface GuideRankingsProps {
  unit: string;
  entries: RankingEntry[];
  // The default rotation's live result; every row reads as a % of it.
  baseline: RotationSummary | undefined;
  onShowInGuide: (entry: RankingEntry) => void;
}

export const GuideRankings: React.FC<GuideRankingsProps> = ({ unit, entries, baseline, onShowInGuide }) => {
  const [activeWindow, setActiveWindow] = useState<DpsWindowKey>('twoMin');
  const [filters, setFilters] = useState<RankingFilters>(DEFAULT_RANKING_FILTERS);
  const [shown, setShown] = useState(PAGE_SIZE);

  const visible = useMemo(
    () => filterRankingEntries(entries.filter(e => e.team.some(s => s.character === unit)), filters, '', activeWindow),
    [entries, unit, filters, activeWindow]
  );
  const maxDps = visible[0]?.dpsStats[dpsFieldOf(activeWindow)] ?? 0;
  const baselineDps = baseline?.dpsStats[dpsFieldOf(activeWindow)] ?? undefined;

  return (
    <div className="guide-section">
      <div className="panel-header-main">{unit} Rankings</div>
      <div className="guide-rankings-filters">
        <SequenceRangeFilters filters={filters} onChange={setFilters} />
        <RotationStyleToggle filters={filters} onChange={setFilters} />
      </div>
      <div className="rankings-tab-panel">
        <ChromeTabs tabs={DPS_WINDOW_TABS} activeId={activeWindow} onSelect={id => setActiveWindow(id as DpsWindowKey)} />
        <div className="rankings-tab-panel-body">
          <div className="ranking-list">
            {visible.length === 0 && <div className="results-empty">No rotations match these filters.</div>}
            {visible.slice(0, shown).map((entry, i) => (
              <RankingRow
                key={entry.id}
                rank={i + 1}
                entry={entry}
                activeWindow={activeWindow}
                maxDps={maxDps}
                baselineDps={baselineDps}
                extraMenuItems={[{ key: 'show-in-guide', label: 'Show This Rotation Above', onClick: () => onShowInGuide(entry) }]}
              />
            ))}
          </div>
          {visible.length > shown && (
            <div className="ranking-pagination">
              <button type="button" className="base-btn text-xs" onClick={() => setShown(n => n + PAGE_SIZE)}>
                Show More ({visible.length - shown} left)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
