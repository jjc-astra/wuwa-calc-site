// src/components/results/DpsPanel.tsx
import React from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { DpsStats } from '../../types/results';
import { PinRotationControl } from './PinRotationControl';
import { ResultsLegend } from './ResultsLegend';
import { CATEGORICAL_PALETTE } from './chartPalette';

const formatDps = (v: number, shorten: boolean) => {
  if (shorten)
    return `${(v / 1000).toFixed(1)}K`;
  return Math.round(v).toLocaleString();
};

const ROWS: Array<{ key: keyof DpsStats; label: string }> = [
  { key: 'openerDps', label: 'Opener DPS' },
  { key: 'firstLoopDps', label: 'First Loop DPS' },
  { key: 'avgLoopDps', label: 'Avg Loop DPS' },
  { key: 'twoMinDps', label: '2-Minute DPS' }
];

// How far the bar's split point can travel from the center (50%) per point of delta%,
// so the split visibly moves even for the modest deltas DPS comparisons usually produce
// (a raw value-share split barely moves off 50/50 even for a 20%+ real difference).
const DELTA_SCALE = 40 / 50;
const MIN_SPLIT = 10;
const MAX_SPLIT = 90;

// Floor for the solo (no comparison) bars, so the lowest-DPS metric still renders a readable
// bar instead of shrinking to a sliver next to the group's highest value.
const MIN_SOLO_WIDTH = 20;

export const DpsPanel: React.FC = () => {
  const results = useRotationStore(s => s.results);
  const { pinned } = useComparisonStore();

  if (!results) return null;
  const current = results.dpsStats;
  const knownVals = ROWS.map(row => current[row.key]).filter((v): v is number => v !== null);
  const maxCurrentDps = knownVals.length > 0 ? Math.max(...knownVals) : 1;

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>DPS</span>
        <PinRotationControl />
      </div>

      {pinned && (
        <ResultsLegend
          items={[
            { label: 'Current', color: CATEGORICAL_PALETTE[0] },
            { label: pinned.label, color: CATEGORICAL_PALETTE[1] }
          ]}
        />
      )}

      <div className="dps-compare-list">
        {ROWS.map(row => {
          const currentVal = current[row.key];
          const pinnedVal = pinned?.dpsStats[row.key];

          if (currentVal === null) {
            return (
              <div key={row.key} className="dps-compare-row">
                <div className="dps-compare-row-head">
                  <span className="dps-table-label">{row.label}</span>
                </div>
                <div className="dps-compare-bar">
                  <div className="dps-compare-segment dps-compare-segment-solo results-empty" style={{ width: `${MIN_SOLO_WIDTH}%` }}>
                    <span>N/A</span>
                  </div>
                </div>
              </div>
            );
          }

          if (pinnedVal === undefined || pinnedVal === null) {
            const soloWidth = Math.max(MIN_SOLO_WIDTH, (currentVal / maxCurrentDps) * 100);
            return (
              <div key={row.key} className="dps-compare-row">
                <div className="dps-compare-row-head">
                  <span className="dps-table-label">{row.label}</span>
                </div>
                <div className="dps-compare-bar">
                  <div className="dps-compare-segment dps-compare-segment-solo" style={{ width: `${soloWidth}%` }}>
                    <span>{formatDps(currentVal,false)}</span>
                  </div>
                </div>
              </div>
            );
          }

          // DPS: higher is better, so a positive delta (current > pinned) is "good".
          const delta = ((currentVal - pinnedVal) / pinnedVal) * 100;
          const currentWins = delta >= 0;
          const splitPct = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, 50 + delta * DELTA_SCALE));

          return (
            <div key={row.key} className="dps-compare-row">
              <div className="dps-compare-row-head">
                <span className="dps-table-label">{row.label}</span>
                <span className={currentWins ? 'dps-delta-good' : 'dps-delta-bad'}>
                  {currentWins ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
              </div>
              <div className="dps-compare-bar">
                <div
                  className={`dps-compare-segment dps-compare-segment-left ${currentWins ? 'is-winner' : 'is-loser'}`}
                  style={{ width: `${splitPct}%` }}
                >
                  <span className="dps-compare-segment-swatch" style={{ background: CATEGORICAL_PALETTE[0] }} />
                  <span>{formatDps(currentVal,true)}</span>
                </div>
                <div
                  className={`dps-compare-segment dps-compare-segment-right ${currentWins ? 'is-loser' : 'is-winner'}`}
                  style={{ width: `${100 - splitPct}%` }}
                >
                  <span className="dps-compare-segment-swatch" style={{ background: CATEGORICAL_PALETTE[1] }} />
                  <span>{formatDps(pinnedVal,true)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
