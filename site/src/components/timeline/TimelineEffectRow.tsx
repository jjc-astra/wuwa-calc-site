import React, { useState } from 'react';
import { TooltipManager, tip } from '../../utils/Common';
import { formatFramesAsSeconds, framesToSeconds, secondsToFrames, toFrames } from '../../utils/Frames';
import { EFFECT_BAR_INSET_PX, EFFECT_ROW_HEIGHT_PX, describeAppliesTo } from './effectLayout';
import { nearestMarker, trackPointer } from './trackPointer';
import type { EffectBar, EffectLane, EffectPoint } from './effectLayout';

interface TimelineEffectRowProps {
  lane: EffectLane;
  // Inside a unit's effect group (Weapon, Echo Sets): indented one more step.
  nested?: boolean;
}

const escapeHtml = (text: unknown): string =>
  String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const line = (key: string, value: unknown) =>
  `<div><span class="tooltip-key">${key}:</span> <span class="tooltip-val">${escapeHtml(value)}</span></div>`;

const timeRange = (start: number, end: number) =>
  `${formatFramesAsSeconds(toFrames(start))} – ${formatFramesAsSeconds(toFrames(end))}`;

const formatValue = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

// What a marker shows: "x4" for stacks, "1/2" charges in use for a cooldown, a tracker's value.
const pointLabel = (lane: EffectLane, bar: EffectBar, value: number) =>
  lane.kind === 'tracker' ? formatValue(value) : lane.kind === 'cooldown' ? `${value}/${bar.info.maxStacks}` : `x${value}`;

// A marker at the bar's start only says something when the buff stacks / the move has charges.
const showsPoint = (lane: EffectLane, bar: EffectBar, index: number) =>
  index > 0 || lane.kind === 'tracker' || bar.info.maxStacks > 1;

// "At" and "Remaining" lines for the cursor's time: how long the buff/cooldown has left there.
function cursorLines(point: EffectPoint, cursorFrames: number): string {
  const at = line('At', formatFramesAsSeconds(toFrames(cursorFrames)));
  if (point.remaining === undefined) return at;
  const left = Math.max(0, point.remaining - framesToSeconds(toFrames(cursorFrames - point.frames)));
  return at + line('Remaining', formatFramesAsSeconds(toFrames(secondsToFrames(left))));
}

function barTooltipHtml(lane: EffectLane, bar: EffectBar, point: EffectPoint, cursorFrames: number): string {
  const { info } = bar;
  const time = line('Time', timeRange(bar.startFrames, bar.endFrames) + (info.permanent ? ' (permanent)' : ''));
  if (lane.kind === 'tracker') {
    return `<div>${escapeHtml(lane.label)}</div>` + line('Value', formatValue(point.value)) + time + cursorLines(point, cursorFrames);
  }
  if (lane.kind === 'cooldown') {
    return (
      `<div>${escapeHtml(info.name)} cooldown</div>` +
      line('Unit', info.provider || 'Unknown') +
      (info.maxStacks > 1 ? line('Charges in use', `${point.value} / ${info.maxStacks}`) : '') +
      time + cursorLines(point, cursorFrames)
    );
  }
  const effect = [info.stat, info.value].filter(v => v !== undefined && v !== '').join(' ');
  return (
    `<div>${escapeHtml(info.label && info.label !== info.name ? `${lane.label} (${info.label})` : lane.label)}</div>` +
    line('Provider', info.provider || 'Unknown') +
    line('Applies to', describeAppliesTo(info)) +
    (effect ? line('Effect', effect) : '') +
    (info.maxStacks > 1 ? line('Stacks', `${point.value} / ${info.maxStacks}`) : '') +
    time + cursorLines(point, cursorFrames) +
    (info.sourceOwner && info.sourceOwner !== info.provider ? line('From', info.sourceOwner) : '') +
    (info.source && info.source !== info.name ? line('Source', info.source) : '')
  );
}

// The game time under the cursor, inside a bar (a bar never spans the Ending Rotation's
// compressed gap, so px and frames are linear across it).
const framesAt = (bar: EffectBar, x: number): number =>
  bar.widthPx > 0
    ? bar.startFrames + Math.min(1, Math.max(0, (x - bar.xPx) / bar.widthPx)) * (bar.endFrames - bar.startFrames)
    : bar.startFrames;

/** One effect's row: a bar per stretch it held steady (a refresh or value change starts a new
 * one), stack/value changes marked inside it -- the same for a cooldown ticking -- or a System
 * mechanic's hits. */
export const TimelineEffectRow: React.FC<TimelineEffectRowProps> = ({ lane, nested = false }) => {
  const [active, setActive] = useState<number | null>(null);

  // Snap targets: stack/value changes after a bar's start, and hits.
  const markers = [
    ...lane.bars.flatMap(bar => bar.points.slice(1).map(point => ({ xPx: point.xPx, yPx: point.yPx, bar, point }))),
    ...lane.hits.map(hit => ({ xPx: hit.xPx, yPx: hit.yPx, hit }))
  ];
  const firstHitMarker = markers.length - lane.hits.length;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(markers, pointer);
    if (nearest !== -1) {
      const marker: any = markers[nearest];
      const at = pointer.toClient(marker.xPx, marker.yPx);
      setActive(nearest);
      const html = marker.hit
        ? `<div>${escapeHtml(marker.hit.moveName)}</div>` + line('Hit', `${Math.floor(marker.hit.total).toLocaleString()} dmg`) + line('Time', formatFramesAsSeconds(toFrames(marker.hit.frames)))
        : barTooltipHtml(lane, marker.bar, marker.point, marker.point.frames);
      TooltipManager.showAtPoint(at.x, at.y, html);
      return;
    }
    setActive(null);
    const bar = [...lane.bars].reverse().find(b => pointer.x >= b.xPx && pointer.x < b.xPx + b.widthPx);
    if (!bar) return TooltipManager.hide();
    // The stack count under the cursor.
    const point = [...bar.points].reverse().find(p => p.xPx <= pointer.x) ?? bar.points[0];
    TooltipManager.showAtPoint(e.clientX, e.clientY, barTooltipHtml(lane, bar, point, framesAt(bar, pointer.x)));
  };

  const handleLeave = () => {
    setActive(null);
    TooltipManager.hide();
  };

  return (
    <div
      className={`timeline-row timeline-effect-row timeline-effect-${lane.kind}${nested ? ' is-nested' : ''}`}
      style={{ height: EFFECT_ROW_HEIGHT_PX, '--char-theme-raw': lane.color } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
        <span className="timeline-effect-label" {...tip(escapeHtml(lane.fullName))}>{lane.label}</span>
      </div>
      <div className="timeline-row-track" onMouseMove={handleMove} onMouseLeave={handleLeave}>
        {lane.bars.map((bar, i) => (
          <div
            key={`bar-${i}`}
            className={`timeline-effect-bar${bar.info.permanent ? ' is-permanent' : ''}`}
            style={{ left: bar.xPx, width: bar.widthPx, top: EFFECT_BAR_INSET_PX, bottom: EFFECT_BAR_INSET_PX }}
          />
        ))}
        {lane.bars.flatMap((bar, b) => bar.points.map((point, i) => showsPoint(lane, bar, i) && (
          <React.Fragment key={`pt-${b}-${i}`}>
            {i > 0 && <div className="timeline-effect-point" style={{ left: point.xPx, top: point.yPx }} />}
            <span className="timeline-effect-point-label" style={{ left: point.xPx + (i > 0 ? 4 : 3), top: point.yPx }}>
              {pointLabel(lane, bar, point.value)}
            </span>
          </React.Fragment>
        )))}
        {markers.map((marker: any, i) => i === active && marker.point && (
          <div key="active" className="timeline-effect-point is-active" style={{ left: marker.xPx, top: marker.yPx }} />
        ))}
        {lane.hits.map((hit, i) => (
          <div
            key={`hit-${i}`}
            className={`timeline-hit-dot${active === firstHitMarker + i ? ' is-active' : ''}`}
            style={{ left: hit.xPx, top: hit.yPx }}
          />
        ))}
      </div>
    </div>
  );
};
