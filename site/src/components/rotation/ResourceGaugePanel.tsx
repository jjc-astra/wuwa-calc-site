// A row's resource panel (Energy, Concerto, Tune, Forte): what the move tried and managed to change,
// and a gauge from 0 to the max with its level before and after the move.
import React from 'react';
import { CommonUtils, tip } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { forteLabel } from '../../utils/ForteNames';
import { beforeKey, deltaKey, forteSlotOf, lateDeltaKey, requestedDeltaKey } from '../../utils/ResourceKeys';
import { resourceCap } from '../../logic/resources';
import { PanelInfoItem } from '../common/PanelInfoItem';
import { SplitValue } from '../common/SplitValue';
import { TimelineRuler } from '../timeline/TimelineRuler';
import { holdCursorOf } from './holdCursor';
import { MECHANICS_NOTATION } from '../../data/db';
import { holdSlotNumber, forteKey as forteKeyOf } from '../../utils/ResourceKeys';
import type { Tick } from '../timeline/timelineLayout';

interface ResourceGaugePanelProps {
  title: string;
  resourceKey: string;
  row: any;
}

const fmt = (v: number) => String(CommonUtils.trimNumber(v));
const signed = (v: number) => `${v > 0 ? '+' : ''}${fmt(v)}`;
const EPSILON = 1e-9;
// Labeled tick steps; the smallest that keeps ~10 labels.
const SCALE_STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** The resource panel: Generated / Applied / Before → After / Lands Later, then the gauge. */
export const ResourceGaugePanel: React.FC<ResourceGaugePanelProps> = ({ title, resourceKey, row }) => {
  const unit = row.unit;
  const isTune = resourceKey === 'tune';
  const tracker = (key: string): number => Number(row.trackers?.[key] ?? row.dropdownState?.trackers?.[key] ?? 0) || 0;
  const generated = tracker(requestedDeltaKey(resourceKey));
  const applied = tracker(deltaKey(resourceKey));
  const late = tracker(lateDeltaKey(resourceKey));
  const before = Number(row[beforeKey(resourceKey)] ?? 0) || 0;
  const after = Number(isTune ? row.enemyTune : row[resourceKey]?.[unit]) || 0;
  const max = isTune ? Number(row.enemyMaxTune) || resourceCap(unit, resourceKey) : resourceCap(unit, resourceKey);
  const lost = generated - applied;

  const forteSlot = forteSlotOf(resourceKey);
  const heading = forteSlot !== null ? `${forteLabel(DataLoader.characterDB[unit], forteSlot)} Breakdown` : title;

  const finite = Number.isFinite(max) && max > 0;
  const scale = finite ? max : Math.max(before, after + late, 1);
  const pct = (v: number) => `${(Math.max(0, Math.min(scale, v)) / scale) * 100}%`;
  const bar = (from: number, to: number, className: string, html: string) => (to - from > EPSILON
    ? <div className={`resource-gauge-seg ${className}`} style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }} {...tip(html)} />
    : null);
  const gain = after >= before;

  // The hold's forte cursor: live while holding, else where a Release left it.
  const releaseSlot = forteKeyOf(holdSlotNumber(DataLoader.mechanicsDB[row.action]?.holdConfig?.forteSlot || MECHANICS_NOTATION.HOLD_DEFAULTS.FORTE_SLOT));
  const live = holdCursorOf(unit, row);
  const cursor = live?.forteKey === resourceKey
    ? live
    : row.forteCursorPos !== undefined && releaseSlot === resourceKey
      // A Release stops the cursor where it was cast.
      ? { cursor: row.forteCursorPos, before: row.forteCursorPos, travel: 0, legs: [], center: row.forteWinCenter, size: row.forteWinSize,
          mode: row.forteWinSize ? 'window' : 'clamp', inWindow: !!row.isInForteWindow }
      : null;
  const windowed = !!cursor && cursor.mode !== 'clamp' && cursor.size > 0;
  const winFrom = windowed ? cursor.center - cursor.size / 2 : 0;
  const winTo = windowed ? cursor.center + cursor.size / 2 : 0;

  // Scale ticks: labeled every step, half steps secondary, fifths minor.
  const step = SCALE_STEPS.find(s => scale / s <= 10) ?? SCALE_STEPS[SCALE_STEPS.length - 1];
  const ticks: Tick[] = [];
  for (let k = 0; (k * step) / 10 <= scale + EPSILON; k++) {
    const v = (k * step) / 10;
    const tier = k % 10 === 0 ? 'major' : k % 5 === 0 ? 'secondary' : k % 2 === 0 ? 'minor' : null;
    if (tier) ticks.push({ frames: v, xPx: (v / scale) * 100, tier, label: tier === 'major' ? fmt(v) : undefined });
  }

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">{heading}</div>
      <div className="panel-content-grid">
        {windowed ? (
          <>
            {/* A window hold moves the cursor, not the forte pool. */}
            <PanelInfoItem label="Generated" value={signed(cursor.travel)} />
            <PanelInfoItem label="Applied" value={signed(cursor.cursor - cursor.before)} />
            <PanelInfoItem label="Cursor" value={<SplitValue left={['Before', fmt(cursor.before)]} right={['After', fmt(cursor.cursor)]} />} />
            <PanelInfoItem label={cursor.inWindow ? 'Window · Cursor In' : 'Window'} extraClass={cursor.inWindow ? 'text-gold' : ''}
              value={`${fmt(winFrom)}–${fmt(winTo)}`} />
          </>
        ) : (
          <>
            <PanelInfoItem label="Generated" value={signed(generated)} />
            <PanelInfoItem label="Applied" value={signed(applied)} />
            <PanelInfoItem label={isTune ? 'Tune' : 'Gauge'} value={<SplitValue left={['Before', fmt(before)]} right={['After', fmt(after)]} />} />
          </>
        )}
        {Math.abs(late) > EPSILON && (
          <PanelInfoItem label="Lands Later" value={signed(late)} />
        )}
      </div>

      <div className="resource-gauge">
        <div className="resource-gauge-track">
          {bar(0, Math.min(before, after), 'is-base', `<div>Before the move: ${fmt(Math.min(before, after))}</div>`)}
          {gain
            ? bar(before, after, 'is-gain', `<div>Gained during the move: ${signed(after - before)}</div>`)
            : bar(after, before, 'is-spend', `<div>Spent: ${signed(after - before)}</div>`)}
          {late > 0 && bar(after, after + late, 'is-late', `<div>Lands later: ${signed(late)}</div>`)}
          {late < 0 && bar(after + late, after, 'is-late-spend', `<div>Spent later: ${signed(late)}</div>`)}
          {windowed && bar(winFrom, winTo, 'is-window', `<div>Release window: ${fmt(winFrom)}–${fmt(winTo)}</div>`)}
          {windowed && Math.abs(cursor.before - cursor.cursor) > EPSILON && (
            <span className="resource-gauge-cursor is-before" style={{ left: pct(cursor.before) }} {...tip(`<div>Cursor before: ${fmt(cursor.before)}</div>`)} />
          )}
          {cursor && (
            <span className={`resource-gauge-cursor${cursor.inWindow ? ' is-in' : ''}`} style={{ left: pct(cursor.cursor) }}
              {...tip(`<div>Cursor: ${fmt(cursor.cursor)}${cursor.inWindow ? ' (in window)' : ''}</div>`)} />
          )}
          <span className="resource-gauge-mark" style={{ left: pct(before) }} {...tip(`<div>Before: ${fmt(before)}</div>`)} />
          <span className="resource-gauge-mark is-after" style={{ left: pct(after) }} {...tip(`<div>After: ${fmt(after)}</div>`)} />
        </div>
        {windowed && cursor.legs.length > 0 && (
          // The cursor's path this move: one arrow per straight leg (pingpong turns, loop wraps).
          <div className="resource-gauge-path">
            {cursor.legs.map((leg, i) => {
              const lo = Math.min(leg.from, leg.to);
              const hi = Math.max(leg.from, leg.to);
              return (
                <div key={i} className={`resource-gauge-leg ${leg.to >= leg.from ? 'is-right' : 'is-left'}`}
                  style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
                  {...tip(`<div>Cursor ${fmt(leg.from)} → ${fmt(leg.to)} (${signed(leg.to - leg.from)})</div>`)}>
                  <span className="resource-gauge-leg-label">{fmt(hi - lo)}</span>
                </div>
              );
            })}
          </div>
        )}
        <TimelineRuler ticks={ticks} percent />
        {lost > EPSILON && <div className="resource-gauge-lost">{signed(lost)} lost{isTune ? '' : ' to the cap'}</div>}
      </div>
    </div>
  );
};
