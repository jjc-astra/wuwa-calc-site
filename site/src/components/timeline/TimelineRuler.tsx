// src/components/timeline/TimelineRuler.tsx
// Time axis along the bottom, game-time domain. 3 tick tiers riffing on RangeSlider's own
// tick-mark convention (src/components/common/RangeSlider.tsx / rankings.css's
// .range-slider-tick-mark/.range-slider-tick-label) -- that component has no major/minor
// distinction, so this is a new tiered variant rather than a literal reuse.
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
