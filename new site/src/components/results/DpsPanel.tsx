// src/components/results/DpsPanel.tsx
import React from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import { generateMockDpsStats } from '../../data/mockResults';
import type { DpsStats } from '../../data/mockResults';
import { PinRotationControl } from './PinRotationControl';

const formatDps = (v: number): string => `${(v / 1000).toFixed(1)}K`;

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
  const team = useRosterStore(s => s.team);
  const rows = useRotationStore(s => s.rows);
  const { pinned } = useComparisonStore();

  const teamNames = team.filter(s => s.character).map(s => s.character);
  const seed = `${teamNames.join(',')}:${rows.length}`;
  const current = generateMockDpsStats(seed || 'empty-team');
  const maxCurrentDps = Math.max(...ROWS.map(row => current[row.key]));

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>DPS</span>
        <PinRotationControl />
      </div>

      {pinned && (
        <div className="dps-compare-legend">
          <span className="text-dim">Current Rotation</span>
          <span className="text-dim">{pinned.label}</span>
        </div>
      )}

      <div className="dps-compare-list">
        {ROWS.map(row => {
          const currentVal = current[row.key];
          const pinnedVal = pinned?.dpsStats[row.key];

          if (pinnedVal === undefined) {
            const soloWidth = Math.max(MIN_SOLO_WIDTH, (currentVal / maxCurrentDps) * 100);
            return (
              <div key={row.key} className="dps-compare-row">
                <div className="dps-compare-row-head">
                  <span className="dps-table-label">{row.label}</span>
                </div>
                <div className="dps-compare-bar">
                  <div className="dps-compare-segment dps-compare-segment-solo" style={{ width: `${soloWidth}%` }}>
                    <span>{formatDps(currentVal)}</span>
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
                  <span>{formatDps(currentVal)}</span>
                </div>
                <div
                  className={`dps-compare-segment dps-compare-segment-right ${currentWins ? 'is-loser' : 'is-winner'}`}
                  style={{ width: `${100 - splitPct}%` }}
                >
                  <span>{formatDps(pinnedVal)}</span>
                </div>
                <div className="dps-compare-midline" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
