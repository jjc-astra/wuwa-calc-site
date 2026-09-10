// src/components/rotation/Gauge.tsx

import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { MECHANICS_NOTATION } from '../../data/db';
import { TooltipManager } from '../../utils/Common';
import { toFrames, framesToSeconds } from '../../utils/Frames';

const formatGaugeValue = (val: number): number => (Number.isInteger(val) ? val : parseFloat(val.toFixed(2)));

const gaugeTooltipHandlers = (name: string, value: number) => ({
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
    TooltipManager.show(e.currentTarget, `<span class="tooltip-key">${name}:</span> <span class="tooltip-val">${formatGaugeValue(value)}</span>`),
  onMouseLeave: () => TooltipManager.hide()
});

interface DialGaugeProps {
  name: string;
  value?: number;
  max?: number;
}

export const DialGauge: React.FC<DialGaugeProps> = ({ name, value = 0, max = 100 }) => {
  const pct = Math.min(100, Math.max(0, (value / (max || 100)) * 100));
  const isFull = pct >= 99.9;

  return (
    <div className="gauge-cell" style={{ width: '100%' }}>
      <div
        className={`gauge-dial ${isFull ? 'is-full' : ''}`}
        data-name={name}
        style={{ '--p': `${pct}%` } as React.CSSProperties}
        {...gaugeTooltipHandlers(name, value)}
      />
    </div>
  );
};

interface VerticalGaugeProps {
  name: string;
  value?: number;
  max?: number;
}

export const VerticalGauge: React.FC<VerticalGaugeProps> = ({ name, value = 0, max = 100 }) => {
  const pct = Math.min(100, Math.max(0, (value / (max || 100)) * 100));
  const isFull = pct >= 99.9;

  return (
    <div className="gauge-cell" style={{ width: '100%' }}>
      <div
        className={`gauge-vertical ${isFull ? 'is-full' : ''}`}
        data-name={name}
        {...gaugeTooltipHandlers(name, value)}
      >
        <div className="gauge-vertical-fill" style={{ '--p': `${pct}%` } as React.CSSProperties} />
      </div>
    </div>
  );
};

interface MultiForteGaugeProps {
  unit: string;
  stateData: any;
  activeTrigger?: string | null;
  onGaugeClick?: (trigger: string) => void;
}

export const MultiForteGauge: React.FC<MultiForteGaugeProps> = ({ unit, stateData, activeTrigger, onGaugeClick }) => {
  const dbChar: Record<string, any> = unit ? DataLoader.characterDB[unit] || {} : {};
  const forteCount = dbChar.forteCount || 1;

  return (
    <div className="gauge-cell" style={{ width: '100%' }}>
      <div className="multi-gauge-wrap" data-count={forteCount}>
        {Array.from({ length: forteCount }).map((_, idx) => {
          const num = idx + 1;
          const trigger = `forte${num}`;
          const fKey = `forte${num}`;
          const maxKey = `maxForte${num}`;
          let val = stateData?.[fKey]?.[unit] || 0;
          let max = dbChar[maxKey] !== undefined ? parseFloat(dbChar[maxKey]) : 100;
          let isGlowing = false;

          // Forte 1 shows the live hold-release cursor (glows in the release window) during a Hold.
          // Hold_Start/Hold_Unit are flat trackers shared by every row -- ignore a hold owned by a different unit.
          const holdStart = stateData?.trackers?.Hold_Start;
          const holdOwnedByUnit = stateData?.trackers?.Hold_Unit === unit;
          if (num === 1 && holdStart !== undefined && holdOwnedByUnit) {
            const d = MECHANICS_NOTATION.HOLD_DEFAULTS;
            const speed = d.CURSOR_SPEED;
            const maxVal = d.MAX_CURSOR_VAL;
            const mode: string = d.CURSOR_MODE;
            const rowEndGameTime = (stateData.gameTimeStart || 0) + (stateData.gameTimePassed || 0);
            const currentHoldDuration = rowEndGameTime - holdStart;
            const accumulated = stateData.trackers.Cursor_Accumulated || 0;
            // cursorSpeed is per real-time second; currentHoldDuration is frames -- convert here.
            // Mirrors TimelineEngine.ts's hold-physics formula.
            const progress = accumulated + (framesToSeconds(toFrames(currentHoldDuration)) * speed);

            if (mode === 'clamp') {
              val = Math.min(progress, maxVal);
            } else if (mode === 'loop') {
              val = progress % maxVal;
            } else {
              const doubleMax = maxVal * 2;
              const wrapped = ((progress % doubleMax) + doubleMax) % doubleMax;
              val = wrapped > maxVal ? doubleMax - wrapped : wrapped;
            }
            max = maxVal;

            const center = stateData.trackers.Forte_Win_Center ?? parseFloat(d.WINDOW_CENTER);
            const size = stateData.trackers.Forte_Win_Size ?? parseFloat(d.WINDOW_SIZE);
            isGlowing = Math.abs(val - center) <= size / 2;
          }

          const pct = Math.min(100, Math.max(0, (val / (max || 100)) * 100));
          const isFull = pct >= 99.9 || isGlowing;

          return (
            <div
              key={num}
              className={`sub-panel-trigger ${activeTrigger === trigger ? 'is-active' : ''}`}
              onClick={() => onGaugeClick?.(trigger)}
            >
              <div
                className={`gauge-dial ${isFull ? 'is-full' : ''}`}
                data-name={`Forte ${num}`}
                style={{ '--p': `${pct}%` } as React.CSSProperties}
                {...gaugeTooltipHandlers(`Forte ${num}`, val)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};