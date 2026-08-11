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
  { key: 'avgLoopDps', label: 'Avg Loop DPS (3 loops)' },
  { key: 'twoMinDps', label: '2-Minute DPS' }
];

export const DpsPanel: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const rows = useRotationStore(s => s.rows);
  const { pinned } = useComparisonStore();

  const teamNames = team.filter(s => s.character).map(s => s.character);
  const seed = `${teamNames.join(',')}:${rows.length}`;
  const current = generateMockDpsStats(seed || 'empty-team');

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>DPS</span>
        <PinRotationControl />
      </div>
      <table className="dps-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>This Rotation</th>
            {pinned && <th>{pinned.label}</th>}
            {pinned && <th>Δ</th>}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => {
            const currentVal = current[row.key];
            const pinnedVal = pinned?.dpsStats[row.key];
            const delta = pinnedVal !== undefined ? ((currentVal - pinnedVal) / pinnedVal) * 100 : null;
            return (
              <tr key={row.key}>
                <td className="dps-table-label">{row.label}</td>
                <td className="dps-table-value">{formatDps(currentVal)}</td>
                {pinned && <td className="dps-table-value">{formatDps(pinnedVal!)}</td>}
                {pinned && (
                  <td className={`dps-table-delta ${delta! >= 0 ? 'is-good' : 'is-bad'}`}>
                    {delta! >= 0 ? '▲' : '▼'} {Math.abs(delta!).toFixed(1)}%
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
