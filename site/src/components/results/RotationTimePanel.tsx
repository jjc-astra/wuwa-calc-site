// src/components/results/RotationTimePanel.tsx
import React, { useState } from 'react';
import { useResultsSource } from './ResultsSource';
import { DataLoader } from '../../utils/DataLoader';
import type { DpsWindowKey } from '../../types/results';
import { DPS_WINDOWS, DEFAULT_BREAKDOWN_WINDOW, shownWindow } from '../../data/dpsWindows';
import { getCharacterThemeColor } from '../../utils/Common';
import { Dropdown } from '../common/Dropdown';

const formatSeconds = (v: number | undefined) => (v ? `${v.toFixed(2)}s` : '—');

// The window's length and how much of it each unit spent on field (Avg Loop: per loop).
export const RotationTimePanel: React.FC = () => {
  const { team, results } = useResultsSource();
  const [pickedWindow, setDpsType] = useState<DpsWindowKey>(DEFAULT_BREAKDOWN_WINDOW);
  const units = team.filter(s => s.character).map(s => s.character);
  const dpsType = shownWindow(pickedWindow, results?.dpsStats);
  const forWindow = results?.contribution[dpsType];

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Rotation Time</span>
        <Dropdown
          className="base-select text-xs results-dps-type-select"
          value={dpsType}
          onChange={v => setDpsType(v as DpsWindowKey)}
          options={DPS_WINDOWS.map(window => ({ value: window.key, label: window.label }))}
        />
      </div>
      <div className="rotation-time-list">
        <div className="rotation-time-row">
          <span className="dps-row-label">Total</span>
          <span className="dps-row-value">{formatSeconds(forWindow?.duration)}</span>
        </div>
        {units.map(unit => (
          <div
            key={unit}
            className="rotation-time-row is-unit"
            style={{ '--char-theme-raw': getCharacterThemeColor(DataLoader.characterDB[unit]) } as React.CSSProperties}
          >
            <span className="dps-row-label">{unit}</span>
            <span className="dps-row-value">
              {formatSeconds(forWindow?.fieldTime?.[unit])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
