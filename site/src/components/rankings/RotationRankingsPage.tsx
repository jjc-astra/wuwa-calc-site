// src/components/rankings/RotationRankingsPage.tsx
import React, { useEffect, useMemo, useRef } from 'react';
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

const PAGE_SIZE_OPTIONS = [10, 20, 50];

export const RotationRankingsPage: React.FC = () => {
  const {
    status, entries, error, load,
    activeWindow, setActiveWindow,
    search, setSearch,
    filters, setFilters,
    page, pageSize, setPage, setPageSize,
    hasHydrated
  } = useRankingsStore();

  useEffect(() => {
    load();
  }, [load]);

  const visibleEntries = useMemo(
    () => filterRankingEntries(entries, filters, search, activeWindow),
    [entries, filters, search, activeWindow]
  );

  const maxDps = visibleEntries.length > 0 ? (visibleEntries[0].dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0) : 0;

  // A new search/filter/window means a different result set -- start back at page 1 rather than
  // risk landing mid-list (or past the end) of whatever this now shows. Two things this must NOT
  // fire on: before rehydration (hasHydrated false -- search/filters/activeWindow are still just
  // their pre-persistence defaults, not a real "change"), and the render right as rehydration
  // lands (zustand's persist swaps in new, if deeply-equal, object references for
  // search/filters/activeWindow *after* the first render, which would otherwise look like a
  // "change" and stomp the just-restored page number straight back to 1).
  const skippedHydrationRun = useRef(false);
  useEffect(() => {
    if (!hasHydrated) return;
    if (!skippedHydrationRun.current) { skippedHydrationRun.current = true; return; }
    setPage(1);
  }, [search, filters, activeWindow, hasHydrated, setPage]);

  const totalPages = Math.max(1, Math.ceil(visibleEntries.length / pageSize));
  // Clamped rather than trusting `page` outright -- entries can shrink out from under an already
  //-deep page (a data-freshness reload evicting a stale result, say) between the effect above
  // and this render.
  const safePage = Math.min(page, totalPages);
  const pageEntries = visibleEntries.slice((safePage - 1) * pageSize, safePage * pageSize);

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
                {pageEntries.map((entry, i) => (
                  <RankingRow
                    key={entry.id}
                    rank={(safePage - 1) * pageSize + i + 1}
                    entry={entry}
                    activeWindow={activeWindow}
                    maxDps={maxDps}
                  />
                ))}
              </div>

              {visibleEntries.length > 0 && (
                <div className="ranking-pagination">
                  <div className="segmented-toggle" role="group" aria-label="Rows per page">
                    {PAGE_SIZE_OPTIONS.map(size => (
                      <button
                        key={size}
                        type="button"
                        className={`segmented-toggle-btn ${pageSize === size ? 'is-active' : ''}`}
                        onClick={() => setPageSize(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>

                  <div className="ranking-pagination-nav">
                    <button
                      type="button"
                      className="base-btn text-xs"
                      disabled={safePage <= 1}
                      onClick={() => setPage(safePage - 1)}
                    >
                      Prev
                    </button>
                    <span className="ranking-pagination-status">Page {safePage} of {totalPages}</span>
                    <button
                      type="button"
                      className="base-btn text-xs"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(safePage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
