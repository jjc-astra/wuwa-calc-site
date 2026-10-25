// Time axis (game time) with major / secondary / minor tick tiers.
import React from 'react';
import { RULER_HEIGHT_PX, hairlinePx } from './timelineLayout';
import type { Tick } from './timelineLayout';

interface TimelineRulerProps {
  ticks: Tick[];
  /** xPx is a % of the track (fluid width) instead of px. */
  percent?: boolean;
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ ticks, percent = false }) => {
  const hairline = hairlinePx();
  return (
    <div className="timeline-ruler" style={{ height: RULER_HEIGHT_PX }}>
      <div className="timeline-ruler-spacer" style={{ width: 'var(--timeline-header-width)' }} />
      <div className="timeline-ruler-track">
        {ticks.map(tick => (
          <div key={tick.frames} className={`timeline-ruler-tick timeline-ruler-tick-${tick.tier}`} style={{ left: percent ? `${tick.xPx}%` : tick.xPx }}>
            <span className="timeline-ruler-tick-mark" style={{ width: hairline }} />
            {tick.label && <span className="timeline-ruler-tick-label">{tick.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
