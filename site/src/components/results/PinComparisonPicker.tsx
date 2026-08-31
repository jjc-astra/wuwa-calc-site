// src/components/results/PinComparisonPicker.tsx
// "Pin from History" / "Pin from Rankings" -- a floating panel that mirrors those pages'
// row list (icons, label, DPS bar) but strips every action *except* picking the row: no
// favorite star, no "..." menu, no hover tooltips on those controls (they don't exist here).
// Clicking anywhere on a row pins it and closes the panel. Deliberately reuses each source's
// own row markup/CSS classes (.history-row/.ranking-row and friends) and, for Rankings, the
// exact same search/filter toolbar and filtering logic the full page uses -- this is a
// different *shell* around the same data and rules, not a parallel implementation of them.
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useComparisonStore } from '../../store/useComparisonStore';
import { useRotationHistoryStore } from '../../store/useRotationHistoryStore';
import type { HistoryEntry } from '../../store/useRotationHistoryStore';
import { useRankingsStore, filterRankingEntries, RANKING_DPS_FIELD } from '../../store/useRankingsStore';
import type { RankingEntry } from '../../store/useRankingsStore';
import { TeamPreview } from '../common/TeamPreview';
import { StackedContributionBar } from '../rankings/StackedContributionBar';
import { RankingFilterToolbar } from '../rankings/RankingFilterToolbar';
import { ChromeTabs } from './ChromeTabs';
import type { ChromeTabDef } from './ChromeTabs';
import type { DpsWindowKey } from '../../types/results';

const WINDOW_TABS: ChromeTabDef[] = [
  { id: 'opener', label: 'Opener' },
  { id: 'firstLoop', label: 'First Loop' },
  { id: 'avgLoop', label: 'Avg Loop' },
  { id: 'twoMin', label: '2-Min' }
];

interface PinComparisonPickerProps {
  source: 'history' | 'rankings';
  onClose: () => void;
}

interface PanelRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// History's row is a simple single-column list -- as wide as it'd be in its actual home (the
// Results panel's own History tab) reads better than stretching it across the full Step 1/2
// footprint. Rankings' row has a full DPS bar (StackedContributionBar) alongside its sidebar --
// at half width that bar gets cut down to almost nothing, so it gets the full footprint instead.
function measurePanelRect(source: 'history' | 'rankings'): PanelRect | null {
  const stepsEl = document.querySelector('.calculator-steps');
  if (!stepsEl) return null;
  const stepsRect = stepsEl.getBoundingClientRect();

  let width = stepsRect.width;
  if (source === 'history') {
    const resultsEl = document.querySelector('.results-panel');
    width = resultsEl ? resultsEl.getBoundingClientRect().width : stepsRect.width;
  }

  return { top: stepsRect.top, left: stepsRect.left, width, height: stepsRect.height };
}

// Floats over Step 1/Step 2 (measured live off .calculator-steps, and for History off
// .results-panel too) rather than a page-centered modal -- the Results panel (and the Pin
// Comparison trigger inside it) stay visible beside it.
export const PinComparisonPicker: React.FC<PinComparisonPickerProps> = ({ source, onClose }) => {
  const [rect, setRect] = useState<PanelRect | null>(null);

  useLayoutEffect(() => {
    const measure = () => setRect(measurePanelRect(source));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [source]);

  if (!rect) return null;

  return createPortal(
    <>
      <div className="pin-picker-backdrop" onClick={onClose} />
      <div className="pin-picker-panel" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}>
        <div className="pin-picker-header">
          <span>{source === 'history' ? 'Pin from History' : 'Pin from Rankings'}</span>
          <button type="button" className="modal-close-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {source === 'history' ? <HistoryPickerBody onClose={onClose} /> : <RankingsPickerBody onClose={onClose} />}
      </div>
    </>,
    document.body
  );
};

const HistoryPickerBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const entries = useRotationHistoryStore(s => s.entries);
  const pinFromHistoryEntry = useComparisonStore(s => s.pinFromHistoryEntry);

  const pick = (entry: HistoryEntry) => {
    pinFromHistoryEntry(entry.team, entry.results);
    onClose();
  };

  return (
    <div className="pin-picker-body">
      {entries.length === 0 && <div className="results-empty">No history yet -- press Calculate to build some up.</div>}
      <div className="history-list">
        {entries.map(entry => {
          const unitNames = entry.team.filter(s => s.character).map(s => s.character);
          const label = unitNames.join(' · ');
          const dps = entry.results.dpsStats.twoMinDps ?? 0;
          const segments = entry.results.contribution.twoMin?.team ?? [];
          const unitBreakdowns = entry.results.contribution.twoMin?.units ?? {};
          return (
            <div
              key={entry.id}
              className="history-row pin-picker-row"
              role="button"
              tabIndex={0}
              onClick={() => pick(entry)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') pick(entry); }}
            >
              <div className="history-row-top">
                <div className="history-row-icons">
                  <TeamPreview team={entry.team} />
                </div>
              </div>
              <div className="history-row-bottom">
                <div className="history-row-main">
                  <div className="history-row-label-line">
                    <span className="history-row-label">{label || 'Empty Team'}</span>
                    <span className="history-row-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                  <StackedContributionBar
                    segments={segments}
                    unitNames={unitNames}
                    unitBreakdowns={unitBreakdowns}
                    widthPct={100}
                    dpsValue={dps}
                    showPercentage={false}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RankingsPickerBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    status, entries, error, load,
    activeWindow, setActiveWindow,
    search, setSearch,
    filters, setFilters
  } = useRankingsStore();
  const pinFromRankingEntry = useComparisonStore(s => s.pinFromRankingEntry);

  useEffect(() => {
    load();
  }, [load]);

  const visibleEntries = useMemo(
    () => filterRankingEntries(entries, filters, search, activeWindow),
    [entries, filters, search, activeWindow]
  );
  const maxDps = visibleEntries.length > 0 ? (visibleEntries[0].dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0) : 0;

  const pick = (entry: RankingEntry) => {
    // Async (recalculates through the worker -- a RankingEntry never carries dmgOverTimeSeries)
    // but not awaited here, matching pinFromFile's own JSON-import UX: close immediately and
    // let the Pin Comparison trigger's own "Calculating..." state carry the rest.
    pinFromRankingEntry(entry.id);
    onClose();
  };

  return (
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
              {visibleEntries.map((entry, i) => {
                const dps = entry.dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0;
                const widthPct = maxDps > 0 ? (dps / maxDps) * 100 : 0;
                const unitNames = entry.team.filter(s => s.character).map(s => s.character);
                const label = unitNames.join(' · ');
                const segments = entry.contribution[activeWindow]?.team ?? [];
                const unitBreakdowns = entry.contribution[activeWindow]?.units ?? {};
                return (
                  <div
                    key={entry.id}
                    className="ranking-row pin-picker-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => pick(entry)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') pick(entry); }}
                  >
                    <div className="ranking-row-rank">{i + 1}</div>
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
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
