// src/components/rotation/Gauge.tsx

import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { MECHANICS_NOTATION } from '../../data/db';
import { TooltipManager, CommonUtils } from '../../utils/Common';

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

  // The active hold's own Release mechanic, so the cursor overlay below uses its real
  // cursorSpeed/cursorMode/forteSlot instead of the generic defaults. Hold_Input (stamped at
  // press time) disambiguates which Release this is, for a character with more than one Hold.
  const holdStart = stateData?.trackers?.Hold_Start;
  const holdOwnedByUnit = stateData?.trackers?.Hold_Unit === unit;
  const d = MECHANICS_NOTATION.HOLD_DEFAULTS;
  let holdConfig: Record<string, any> | undefined;
  if (holdOwnedByUnit && holdStart !== undefined) {
    const holdInput = stateData?.trackers?.Hold_Input;
    holdConfig = DataLoader.findHoldReleaseConfig(unit, holdInput) || {};
  }
  const holdForteNum = parseInt((holdConfig?.forteSlot || d.FORTE_SLOT).replace('forte', ''), 10) || 1;

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

          if (holdConfig && num === holdForteNum) {
            const mode: string = holdConfig.cursorMode || d.CURSOR_MODE;
            const speed = holdConfig.cursorSpeed ?? d.CURSOR_SPEED;
            if (mode === 'clamp') {
              // Clamp ties the cursor to this forte slot -- TimelineEngine already keeps
              // stateData[fKey][unit] (val, above) in lockstep, so no separate value to
              // resolve here. Just add the empty-side glow (pct-based isFull only catches full).
              isGlowing = speed < 0 && val <= 0;
            } else {
              // Window modes (e.g. Sanhua's): the cursor is a separate live-timing preview, not
              // the actual forte pool -- resolve where release would land right now.
              const maxVal = max;
              const rowEndGameTime = (stateData.gameTimeStart || 0) + (stateData.gameTimePassed || 0);
              const currentHoldDuration = rowEndGameTime - holdStart;
              const accumulated = stateData.trackers.Cursor_Accumulated || 0;
              val = CommonUtils.resolveHoldCursorAtTime(accumulated, currentHoldDuration, speed, mode, maxVal);
              const center = stateData.trackers.Forte_Win_Center ?? parseFloat(d.WINDOW_CENTER);
              const size = stateData.trackers.Forte_Win_Size ?? parseFloat(d.WINDOW_SIZE);
              isGlowing = Math.abs(val - center) <= size / 2;
              max = maxVal;
            }
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