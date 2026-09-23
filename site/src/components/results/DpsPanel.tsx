// src/components/results/DpsPanel.tsx
import React from 'react';
import { useResultsSource } from './ResultsSource';
import { DPS_WINDOWS } from '../../data/dpsWindows';
import { PinRotationControl } from './PinRotationControl';
import { tip } from '../../utils/Common';

const formatDps = (v: number) => Math.round(v).toLocaleString();
const formatDelta = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`;

const ROWS = DPS_WINDOWS.map(window => ({ key: window.dpsField, label: window.label }));

// Smallest |delta| that fills half the track, so near-identical rotations don't show full bars.
const MIN_DELTA_SCALE = 1;

// Solo: one slim bar per window, scaled to the highest. Pinned: each bar grows left (worse) or
// right (better) from a 0% center line, scaled to the largest change.
export const DpsPanel: React.FC = () => {
  const { results, pinned, allowPin } = useResultsSource();

  if (!results) return null;
  const current = results.dpsStats;

  const rows = ROWS.map(row => {
    const value = current[row.key];
    const pinnedValue = pinned?.dpsStats[row.key];
    const delta = value !== null && pinnedValue ? ((value - pinnedValue) / pinnedValue) * 100 : null;
    return { ...row, value, pinnedValue, delta };
  });
  const maxValue = Math.max(1, ...rows.map(r => r.value ?? 0));
  const deltaScale = Math.max(MIN_DELTA_SCALE, ...rows.map(r => Math.abs(r.delta ?? 0)));

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>DPS</span>
        {allowPin && <PinRotationControl />}
      </div>

      {pinned && <div className="dps-vs-label">vs {pinned.label}</div>}

      <div className={`dps-list ${pinned ? 'is-compare' : ''}`}>
        {rows.map(row => (
          <div
            key={row.key}
            className="dps-row"
            {...(pinned && row.value !== null && row.pinnedValue
              ? tip(`Current ${formatDps(row.value)} · Pinned ${formatDps(row.pinnedValue)}`)
              : {})}
          >
            <span className="dps-row-label">{row.label}</span>
            <span className="bar-track">
              {!pinned && row.value !== null && (
                <span className="bar-fill" style={{ width: `${(row.value / maxValue) * 100}%` }} />
              )}
              {pinned && row.delta !== null && (
                <>
                  <span className="dps-zero-line" />
                  <span
                    className={`dps-delta-bar ${row.delta >= 0 ? 'is-up' : 'is-down'}`}
                    style={{ width: `${(Math.abs(row.delta) / deltaScale) * 50}%` }}
                  />
                </>
              )}
            </span>
            <span className="dps-row-value">{row.value === null ? 'N/A' : formatDps(row.value)}</span>
            {pinned && (
              <span className={`dps-row-delta ${row.delta === null ? '' : row.delta >= 0 ? 'is-up' : 'is-down'}`}>
                {row.delta === null ? '—' : formatDelta(row.delta)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
