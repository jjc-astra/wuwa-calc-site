
import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { MECHANICS_NOTATION } from '../../data/db';
import { CommonUtils, tip, tooltipLine } from '../../utils/Common';
import { forteLabel } from '../../utils/ForteNames';
import { forteKey, holdSlotNumber } from '../../utils/ResourceKeys';
import { forteMax } from '../../logic/resources';
import { rowGameEnd } from '../../logic/rotationRows';

const gaugePercent = (value: number, max: number): number => Math.min(100, Math.max(0, (value / (max || 100)) * 100));

const formatGaugeValue = (val: number): number => CommonUtils.trimNumber(val, 2);

const gaugeTooltipHandlers = (name: string, value: number) => tip(tooltipLine(name, formatGaugeValue(value)));

interface DialGaugeProps {
  name: string;
  value?: number;
  max?: number;
}

/** A round gauge for one resource. */
export const DialGauge: React.FC<DialGaugeProps> = ({ name, value = 0, max = 100 }) => {
  const pct = gaugePercent(value, max);
  const isFull = pct >= 99.9;

  return (
    <div className="gauge-cell">
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

/** A vertical bar gauge for one resource. */
export const VerticalGauge: React.FC<VerticalGaugeProps> = ({ name, value = 0, max = 100 }) => {
  const pct = gaugePercent(value, max);
  const isFull = pct >= 99.9;

  return (
    <div className="gauge-cell">
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

/** A unit's forte slots, with the active hold's cursor. */
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
  const holdForteNum = holdSlotNumber(holdConfig?.forteSlot || d.FORTE_SLOT);

  return (
    <div className="gauge-cell">
      <div className="multi-gauge-wrap" data-count={forteCount}>
        {Array.from({ length: forteCount }).map((_, idx) => {
          const num = idx + 1;
          const fKey = forteKey(num);
          let val = stateData?.[fKey]?.[unit] || 0;
          const max = forteMax(dbChar, num);
          let isGlowing = false;

          if (holdConfig && num === holdForteNum) {
            const mode: string = holdConfig.cursorMode || d.CURSOR_MODE;
            const speed = holdConfig.cursorSpeed ?? d.CURSOR_SPEED;
            // Clamp ties the cursor to this forte slot -- TimelineEngine already keeps val (above)
            // in lockstep. Window modes: the cursor is a separate live-timing preview, not the
            // actual forte pool -- resolve where release would land right now.
            if (mode !== 'clamp') {
              const currentHoldDuration = rowGameEnd(stateData) - holdStart;
              val = CommonUtils.resolveHoldCursorAtTime(stateData.trackers.Cursor_Accumulated || 0, currentHoldDuration, speed, mode, max);
            }
            isGlowing = CommonUtils.isHoldCursorDone(val, {
              mode, speed, maxVal: max,
              center: stateData.trackers.Forte_Win_Center ?? parseFloat(d.WINDOW_CENTER),
              size: stateData.trackers.Forte_Win_Size ?? parseFloat(d.WINDOW_SIZE)
            });
          }

          const pct = gaugePercent(val, max);
          const isFull = pct >= 99.9 || isGlowing;

          return (
            <div
              key={num}
              className={`sub-panel-trigger ${activeTrigger === fKey ? 'is-active' : ''}`}
              onClick={() => onGaugeClick?.(fKey)}
            >
              <div
                className={`gauge-dial ${isFull ? 'is-full' : ''}`}
                data-name={forteLabel(dbChar, num)}
                style={{ '--p': `${pct}%` } as React.CSSProperties}
                {...gaugeTooltipHandlers(forteLabel(dbChar, num), val)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};