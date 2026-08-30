// src/components/common/RangeSlider.tsx
// A dual-handle range slider (min + max on one track) -- no existing precedent in this
// codebase to build on, so this is genuinely new. Implemented as two overlapping native
// <input type="range"> elements sharing one track (a standard technique): each input's own
// track is made transparent via CSS so only the thumbs render, with a separate static div
// underneath drawing the visible track + the highlighted selected-range fill. Integer tick
// marks are drawn below the track (assumes step=1, the only case this is used for today) and
// double as the range's own numeric labels -- gold while inside the selected [min,max], dim
// otherwise -- so the slider doesn't need a separate "S0-S6" text readout beside it.
import React from 'react';
import { CommonUtils } from '../../utils/Common';

export interface RangeValue {
  min: number;
  max: number;
}

interface RangeSliderProps {
  min: number;
  max: number;
  value: RangeValue;
  onChange: (next: RangeValue) => void;
  step?: number;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({ min, max, value, onChange, step = 1 }) => {
  const span = max - min || 1;
  const fillLeft = ((value.min - min) / span) * 100;
  const fillRight = ((max - value.max) / span) * 100;
  const ticks = Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step);

  const handleMinChange = (raw: number) => {
    const next = CommonUtils.clampToRange(raw, min, value.max);
    onChange({ ...value, min: next });
  };
  const handleMaxChange = (raw: number) => {
    const next = CommonUtils.clampToRange(raw, value.min, max);
    onChange({ ...value, max: next });
  };

  return (
    <div className="range-slider">
      <div className="range-slider-track-wrap">
        <div className="range-slider-track" />
        <div className="range-slider-range" style={{ left: `${fillLeft}%`, right: `${fillRight}%` }} />
        <input
          type="range"
          className="range-slider-input"
          min={min}
          max={max}
          step={step}
          value={value.min}
          onChange={e => handleMinChange(parseInt(e.target.value, 10))}
        />
        <input
          type="range"
          className="range-slider-input"
          min={min}
          max={max}
          step={step}
          value={value.max}
          onChange={e => handleMaxChange(parseInt(e.target.value, 10))}
        />
      </div>
      <div className="range-slider-ticks">
        {ticks.map(t => {
          const pos = ((t - min) / span) * 100;
          const inRange = t >= value.min && t <= value.max;
          return (
            <div key={t} className="range-slider-tick" style={{ left: `${pos}%` }}>
              <span className="range-slider-tick-mark" />
              <span className={`range-slider-tick-label ${inRange ? 'is-active' : ''}`}>{t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
