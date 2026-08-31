// src/components/rankings/RotationRankingsPage.tsx
import React, { useEffect, useMemo } from 'react';
import { useRankingsStore } from '../../store/useRankingsStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import { DataLoader } from '../../utils/DataLoader';
import { ChromeTabs } from '../results/ChromeTabs';
import type { ChromeTabDef } from '../results/ChromeTabs';
import { RankingFilterToolbar } from './RankingFilterToolbar';
import { RankingRow } from './RankingRow';
import type { DpsWindowKey } from '../../types/results';

const WINDOW_TABS: ChromeTabDef[] = [
  { id: 'opener', label: 'Opener' },
  { id: 'firstLoop', label: 'First Loop' },
  { id: 'avgLoop', label: 'Avg Loop' },
  { id: 'twoMin', label: '2-Min' }
];

const DPS_FIELD: Record<DpsWindowKey, 'openerDps' | 'firstLoopDps' | 'avgLoopDps' | 'twoMinDps'> = {
  opener: 'openerDps',
  firstLoop: 'firstLoopDps',
  avgLoop: 'avgLoopDps',
  twoMin: 'twoMinDps'
};

// "Same rotation" for the Best Only toggle: same characters in the same slots at the same
// sequence. Gear/echoes and button order deliberately don't factor in -- two submissions that
// differ only there collapse into one entry, keeping the higher-DPS one.
function rotationGroupKey(entry: RankingEntry): string {
  return entry.team.map((slot, i) => `${slot.character || ''}@S${entry.sequences[i] ?? 0}`).join('|');
}

export const RotationRankingsPage: React.FC = () => {
  const {
    status, entries, error, load,
    activeWindow, setActiveWindow,
    search, setSearch,
    filters, setFilters
  } = useRankingsStore();

  useEffect(() => {
    load();
  }, [load]);

  const visibleEntries = useMemo(() => {
    const searchLower = search.trim().toLowerCase();

    // Sequence range, rotation style, and search text narrow the candidate set first --
    // "Best Only" (below) only ever dedupes *within* whatever survives these, so a rotation
    // that's the best of its group never gets silently hidden by a duplicate that itself
    // would've been filtered out anyway.
    let candidates = entries.filter(entry => {
      for (let i = 0; i < 3; i++) {
        const slotChar = entry.team[i]?.character;
        // 4-star units are effectively always S6 -- dupes are far easier to acquire than even
        // S0 of a 5-star, so a sequence range that's meaningful for 5-stars doesn't apply here.
        const rarity = slotChar ? DataLoader.characterDB[slotChar]?.rarity : undefined;
        if (rarity === 4) continue;
        const seq = entry.sequences[i] ?? 0;
        const range = filters.sequenceRanges[i];
        if (seq < range.min || seq > range.max) return false;
      }
      if (filters.rotationStyle !== 'any' && entry.rotationType !== filters.rotationStyle) return false;
      if (searchLower) {
        const label = entry.team.filter(s => s.character).map(s => s.character).join(' · ').toLowerCase();
        if (!label.includes(searchLower)) return false;
      }
      return true;
    });

    if (filters.bestOnly) {
      const bestByGroup = new Map<string, RankingEntry>();
      for (const entry of candidates) {
        const key = rotationGroupKey(entry);
        const existing = bestByGroup.get(key);
        const dps = entry.dpsStats[DPS_FIELD[activeWindow]] ?? 0;
        const existingDps = existing ? existing.dpsStats[DPS_FIELD[activeWindow]] ?? 0 : -Infinity;
        if (!existing || dps > existingDps) bestByGroup.set(key, entry);
      }
      candidates = Array.from(bestByGroup.values());
    }

    return candidates
      .slice()
      .sort((a, b) => (b.dpsStats[DPS_FIELD[activeWindow]] ?? 0) - (a.dpsStats[DPS_FIELD[activeWindow]] ?? 0));
  }, [entries, filters, search, activeWindow]);

  const maxDps = visibleEntries.length > 0 ? (visibleEntries[0].dpsStats[DPS_FIELD[activeWindow]] ?? 0) : 0;

  return (
    <div className="rankings-page">
      <div className="rankings-page-body">
        <div className="rankings-sidebar">
          <div className="panel-header-main">Search and Filter</div>
          <input
            type="text"
            className="rankings-search-input"
            placeholder="Search characters..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <RankingFilterToolbar filters={filters} onChange={setFilters} />
        </div>

        <div className="rankings-main">
          <div className="panel-header-main">Rankings</div>
          <div className="rankings-tab-panel">
            <ChromeTabs tabs={WINDOW_TABS} activeId={activeWindow} onSelect={id => setActiveWindow(id as DpsWindowKey)} />
            <div className="rankings-tab-panel-body">
              <div className="ranking-list">
                {status === 'loading' && entries.length === 0 && (
                  <div className="results-empty">Calculating rotations...</div>
                )}
                {status === 'error' && <div className="results-empty">Failed to load rankings: {error}</div>}
                {status === 'ready' && visibleEntries.length === 0 && (
                  <div className="results-empty">No rotations match these filters.</div>
                )}
                {visibleEntries.map((entry, i) => (
                  <RankingRow key={entry.id} rank={i + 1} entry={entry} activeWindow={activeWindow} maxDps={maxDps} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
