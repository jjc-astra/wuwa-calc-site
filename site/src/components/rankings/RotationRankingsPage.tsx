// src/components/rankings/RotationRankingsPage.tsx
import React, { useEffect, useMemo } from 'react';
import { useRankingsStore, filterRankingEntries, RANKING_DPS_FIELD } from '../../store/useRankingsStore';
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

  const visibleEntries = useMemo(
    () => filterRankingEntries(entries, filters, search, activeWindow),
    [entries, filters, search, activeWindow]
  );

  const maxDps = visibleEntries.length > 0 ? (visibleEntries[0].dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0) : 0;

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
