// src/components/guide/EchoStatsPanel.tsx
// The selected build's echoes for one unit: each substat summed across all five echoes, and
// every echo's main stat in layout order.
import React from 'react';
import { CommonUtils } from '../../utils/Common';
import { STAT_DB, formatStatValue } from '../../data/db';
import type { TeamSlot } from '../../types';

interface EchoStatsPanelProps {
  slot: TeamSlot;
}

export const EchoStatsPanel: React.FC<EchoStatsPanelProps> = ({ slot }) => {
  const totals: Record<string, number> = {};
  slot.echoes.forEach(echo => echo.substats.forEach(sub => {
    const value = parseFloat(String(sub.value));
    if (sub.name !== 'N/A' && !isNaN(value)) totals[sub.name] = (totals[sub.name] || 0) + value;
  }));
  // STAT_DB order, and only substats the build actually rolls.
  const substats = Object.keys(STAT_DB).filter(stat => totals[stat] > 0);

  return (
    <div className="results-card guide-echo-stats">
      <div className="results-card-header"><span>Echo Stats</span></div>
      <div className="guide-echo-row">
        <span className="guide-echo-row-label">Substats</span>
        <div className="guide-echo-chips">
          {substats.map(stat => (
            <span key={stat} className="guide-echo-chip">
              <span className="guide-echo-chip-label">{stat}</span>
              <span className="guide-echo-chip-value">{formatStatValue(stat, CommonUtils.trimNumber(totals[stat], 1))}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="guide-echo-row">
        <span className="guide-echo-row-label">Main Stats<span className="guide-echo-row-sub">{slot.layout.replace(/ /g, '')}</span></span>
        <div className="guide-echo-chips">
          {slot.echoes.map((echo, i) => (
            <span key={i} className="guide-echo-chip">
              <span className="guide-echo-chip-value">{echo.mainStat}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
