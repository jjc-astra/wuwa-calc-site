
import React from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils, tip, tooltipLine } from '../../utils/Common';
import { forteLabel } from '../../utils/ForteNames';
import { forteKey } from '../../utils/ResourceKeys';
import { forteMax } from '../../logic/resources';
import { holdCursorOf } from './holdCursor';

const gaugePercent = (value: number, max: number): number => Math.min(100, Math.max(0, (value / (max || 100)) * 100));

const formatGaugeValue = (val: number): number => CommonUtils.trimNumber(val, 2);

const gaugeTooltipHandlers = (name: string, value: number) => tip(tooltipLine(name, formatGaugeValue(value)));

interface DialGaugeProps {
  name: string;
  value?: number;
  max?: number;
  // Fills clockwise from the top, as the game's Tune gauge does.
  clockwise?: boolean;
}

export const DialGauge: React.FC<DialGaugeProps> = ({ name, value = 0, max = 100, clockwise = false }) => {
  const pct = gaugePercent(value, max);
  const isFull = pct >= 99.9;

  return (
    <div className="gauge-cell">
      <div
        className={`gauge-dial ${clockwise ? 'is-clockwise' : ''} ${isFull ? 'is-full' : ''}`}
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

  const hold = holdCursorOf(unit, stateData);

  return (
    <div className="gauge-cell">
      <div className="multi-gauge-wrap" data-count={forteCount}>
        {Array.from({ length: forteCount }).map((_, idx) => {
          const num = idx + 1;
          const fKey = forteKey(num);
          const max = forteMax(dbChar, num);
          // The hold's slot shows its cursor (window modes: where release would land now).
          const holding = hold?.forteKey === fKey;
          const val = holding ? hold.cursor : stateData?.[fKey]?.[unit] || 0;
          const isGlowing = holding && hold.inWindow;

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