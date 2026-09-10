// src/components/timeline/TimelineRuler.tsx
// Time axis, game-time domain, 3 tick tiers -- riffs on RangeSlider's tick-mark convention
// (RangeSlider.tsx / rankings.css) but adds major/minor tiers that component doesn't have.
import React from 'react';
import { HEADER_COL_WIDTH_PX, RULER_HEIGHT_PX, hairlinePx } from './timelineLayout';
import type { Tick } from './timelineLayout';

interface TimelineRulerProps {
  ticks: Tick[];
}

export const TimelineRuler: React.FC<TimelineRulerProps> = ({ ticks }) => {
  const hairline = hairlinePx();
  return (
    <div className="timeline-ruler" style={{ height: RULER_HEIGHT_PX }}>
      <div className="timeline-ruler-spacer" style={{ width: HEADER_COL_WIDTH_PX }} />
      <div className="timeline-ruler-track">
        {ticks.map(tick => (
          <div key={tick.frames} className={`timeline-ruler-tick timeline-ruler-tick-${tick.tier}`} style={{ left: tick.xPx }}>
            <span className="timeline-ruler-tick-mark" style={{ width: hairline }} />
            {tick.label && <span className="timeline-ruler-tick-label">{tick.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
