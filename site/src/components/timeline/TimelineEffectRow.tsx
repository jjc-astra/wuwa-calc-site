import React, { useLayoutEffect, useRef } from 'react';
import { TooltipManager, tip, escapeHtml, tooltipLine as line, formatNum as formatValue, getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { buildClipTooltipHtml } from './TimelineClip';
import { formatFramesAsSeconds, framesToSeconds, secondsToFrames, toFrames } from '../../utils/Frames';
import { EFFECT_BAR_INSET_PX, EFFECT_ROW_HEIGHT_PX, barValueAt, describeAppliesTo, pointLabelFits, rowsReceivingBar, rowsReceivingLane } from './effectLayout';
import { useLinkedRowStore } from '../../store/useLinkedRowStore';
import { nearestMarker, trackPointer, useActiveMarker, useFrameMove } from './trackPointer';
import type { EffectAction, EffectBar, EffectLane, EffectPoint } from './effectLayout';

interface TimelineEffectRowProps {
  lane: EffectLane;
  nested?: boolean;
  // Set when linked to the rotation table.
  linkRows?: any[];
}

// Instant System move clip width and hover margin.
const ACTION_WIDTH_PX = 3;
const ACTION_HOVER_PX = 3;

const timeRange = (start: number, end: number) =>
  `${formatFramesAsSeconds(toFrames(start))} – ${formatFramesAsSeconds(toFrames(end))}`;

// "x4" stacks, "1/2" charges, or a tracker value.
const pointLabel = (lane: EffectLane, bar: EffectBar, value: number) =>
  lane.kind === 'tracker' ? formatValue(value) : lane.kind === 'cooldown' ? `${value}/${bar.info.maxStacks}` : `x${value}`;

const showsPoint = (lane: EffectLane, bar: EffectBar, index: number) =>
  index > 0 || lane.kind === 'tracker' || bar.info.maxStacks > 1;

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
  // "DMG Bonus → 40%"
  const effect = [info.stat, barValueAt(bar, cursorFrames)].filter(v => v !== undefined && v !== '').join(' → ');
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

// Game time under the cursor within a bar.
const framesAt = (bar: EffectBar, x: number): number =>
  bar.widthPx > 0
    ? bar.startFrames + Math.min(1, Math.max(0, (x - bar.xPx) / bar.widthPx)) * (bar.endFrames - bar.startFrames)
    : bar.startFrames;

/** One effect's row of bars and markers, or a System mechanic's hits. */
export const TimelineEffectRow = React.memo<TimelineEffectRowProps>(({ lane, nested = false, linkRows }) => {
  const markActive = useActiveMarker();
  const hover = useLinkedRowStore(s => s.hover);
  const linked = useRef<EffectBar | EffectAction | undefined>(undefined);
  const hoverLinked = (target: EffectBar | EffectAction | undefined) => {
    if (!linkRows || target === linked.current) return;
    linked.current = target;
    if (target && 'row' in target) return hover(target.row?.id ? [target.row.id] : [], 'timeline');
    hover(target ? rowsReceivingBar(linkRows, lane, target) : [], 'timeline', false);
  };

  // Highlights this row when a hovered move received the buff. Toggled on the DOM.
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const receivedBy = useRef<{ lane: EffectLane; rows: any[]; ids: Set<string> } | null>(null);
  useLayoutEffect(() => {
    if (!linkRows) return;
    const received = (rowIds: string[]): boolean => {
      if (receivedBy.current?.lane !== lane || receivedBy.current.rows !== linkRows) {
        receivedBy.current = { lane, rows: linkRows, ids: rowsReceivingLane(linkRows, lane) };
      }
      return rowIds.some(id => receivedBy.current!.ids.has(id));
    };
    const apply = ({ rowIds, source, scroll }: ReturnType<typeof useLinkedRowStore.getState>) => {
      const moveIds = source === 'table' || (source === 'timeline' && scroll) ? rowIds : [];
      rowRef.current?.classList.toggle('is-linked', moveIds.length > 0 && lane.kind === 'buff' && received(moveIds));
      trackRef.current?.querySelectorAll<HTMLElement>('[data-row-id]').forEach(el =>
        el.classList.toggle('is-linked', moveIds.includes(el.dataset.rowId!)));
    };
    apply(useLinkedRowStore.getState());
    return useLinkedRowStore.subscribe((s, prev) => { if (s !== prev) apply(s); });
  });

  const markers = [
    ...lane.bars.flatMap(bar => bar.points.slice(1).map(point => ({ xPx: point.xPx, yPx: point.yPx, bar, point }))),
    ...lane.hits.map(hit => ({ xPx: hit.xPx, yPx: hit.yPx, hit }))
  ];
  const firstHitMarker = markers.length - lane.hits.length;
  const barMarkerStart = lane.bars.map((_, b) => lane.bars.slice(0, b).reduce((n, bar) => n + bar.points.length - 1, 0));

  const move = useFrameMove(e => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(markers, pointer);
    if (nearest !== -1) {
      const marker: any = markers[nearest];
      const at = pointer.toClient(marker.xPx, marker.yPx);
      markActive(e.currentTarget.querySelector(`[data-marker="${nearest}"]`));
      hoverLinked(marker.bar);
      const html = marker.hit
        ? `<div>${escapeHtml(marker.hit.moveName)}</div>` + line('Hit', `${Math.floor(marker.hit.total).toLocaleString()} dmg`) + line('Time', formatFramesAsSeconds(toFrames(marker.hit.frames)))
        : barTooltipHtml(lane, marker.bar, marker.point, marker.point.frames);
      TooltipManager.showAtPoint(at.x, at.y, html);
      return;
    }
    markActive(null);
    const action = lane.actions.find(a => Math.abs(pointer.x - a.xPx) <= ACTION_HOVER_PX);
    if (action) {
      hoverLinked(action);
      TooltipManager.showAtPoint(e.clientX, e.clientY, buildClipTooltipHtml({ type: 'onfield', row: action.row }, action.row.gameTimeStart));
      return;
    }
    const bar = [...lane.bars].reverse().find(b => pointer.x >= b.xPx && pointer.x < b.xPx + b.widthPx);
    hoverLinked(bar);
    if (!bar) return TooltipManager.hide();
    const point = [...bar.points].reverse().find(p => p.xPx <= pointer.x) ?? bar.points[0];
    TooltipManager.showAtPoint(e.clientX, e.clientY, barTooltipHtml(lane, bar, point, framesAt(bar, pointer.x)));
   });

  const handleLeave = () => {
    move.cancel();
    markActive(null);
    hoverLinked(undefined);
    TooltipManager.hide();
  };

  return (
    <div
      ref={rowRef}
      className={`timeline-row timeline-effect-row timeline-effect-${lane.kind}${nested ? ' is-nested' : ''}`}
      style={{ height: EFFECT_ROW_HEIGHT_PX, '--char-theme-raw': lane.color } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
        <span className="timeline-effect-label" {...tip(escapeHtml(lane.fullName))}>{lane.label}</span>
      </div>
      <div ref={trackRef} className="timeline-row-track" onMouseMove={move.onMove} onMouseLeave={handleLeave}>
        {lane.bars.map((bar, i) => (
          <div
            key={`bar-${i}`}
            className={`timeline-effect-bar${bar.info.permanent ? ' is-permanent' : ''}`}
            style={{ left: bar.xPx, width: bar.widthPx, top: EFFECT_BAR_INSET_PX, bottom: EFFECT_BAR_INSET_PX }}
          />
        ))}
        {lane.bars.flatMap((bar, b) => bar.points.map((point, i) => {
          if (!showsPoint(lane, bar, i)) return null;
          const label = pointLabel(lane, bar, point.value);
          return (
            <React.Fragment key={`pt-${b}-${i}`}>
              {i > 0 && <div className="timeline-effect-point" data-marker={barMarkerStart[b] + i - 1} style={{ left: point.xPx, top: point.yPx }} />}
              {pointLabelFits(bar, i, label) && (
                <span className="timeline-effect-point-label" style={{ left: point.xPx + (i > 0 ? 4 : 3), top: point.yPx }}>{label}</span>
              )}
            </React.Fragment>
          );
        }))}
        {lane.actions.map((action, i) => (
          <div
            key={`action-${i}`}
            data-row-id={action.row?.id}
            className="timeline-clip timeline-clip-onfield"
            style={{
              left: action.xPx - ACTION_WIDTH_PX / 2, width: ACTION_WIDTH_PX, top: EFFECT_BAR_INSET_PX, bottom: EFFECT_BAR_INSET_PX,
              '--char-theme-raw': getCharacterThemeColor(DataLoader.characterDB[action.row.unit])
            } as React.CSSProperties}
          />
        ))}
        {lane.hits.map((hit, i) => (
          <div
            key={`hit-${i}`}
            className="timeline-hit-dot"
            data-marker={firstHitMarker + i}
            style={{ left: hit.xPx, top: hit.yPx }}
          />
        ))}
      </div>
    </div>
  );
});
