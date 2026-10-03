import React from 'react';
import { formatFramesAsSeconds, toFrames } from '../../utils/Frames';
import { describeTiming, describeInput, hairlinePx, rowHits, CLIP_INSET_PX } from './timelineLayout';
import type { TimelineSegment } from './timelineLayout';

interface TimelineClipProps {
  segment: TimelineSegment;
}

// "Hit #n: x dmg" per hit, with `activeHit` (1-based) highlighted.
function buildHitLinesHtml(row: any, activeHit?: number): string {
  const hits = rowHits(row);
  if (hits.length === 0) return '';
  const lines = hits.map((hit, i) => {
    // A proc names its mechanic, e.g. "[Proc] Forte Detonate (Hit 2)" -> "(Forte Detonate)".
    const proc = typeof hit.title === 'string' && hit.title.startsWith('[Proc] ')
      ? ` (${hit.title.slice(7).replace(/ \(Hit \d+\)$/, '')})`
      : '';
    const cls = i + 1 === activeHit ? 'timeline-tooltip-hit is-active' : 'timeline-tooltip-hit';
    return `<div class="${cls}"><span class="tooltip-key">Hit #${i + 1}${proc}:</span> <span class="tooltip-val">${Math.floor(hit.total || 0).toLocaleString()} dmg</span></div>`;
  });
  return `<div class="timeline-tooltip-hits">${lines.join('')}</div>`;
}

/** Tooltip for a row's clip, or for one of its hit dots (`activeHit`). */
export function buildClipTooltipHtml({ type, row, pause }: Pick<TimelineSegment, 'type' | 'row' | 'pause'>, activeHit?: number): string {
  if (type === 'motionstop' && pause) {
    return (
      `<div>Motion Stop</div>` +
      `<div><span class="tooltip-key">Paused by:</span> <span class="tooltip-val">${pause.by} (${pause.moveName})</span></div>` +
      `<div><span class="tooltip-key">Paused:</span> <span class="tooltip-val">${formatFramesAsSeconds(toFrames(pause.frames))}</span></div>` +
      `<div><span class="tooltip-key">Move:</span> <span class="tooltip-val">${row.moveName}</span></div>`
    );
  }
  if (type === 'wait') {
    const reason = row.waitTime === row.cdWaitTime ? 'Waiting for Skill CD' : 'Off-Field Animation Lock';
    return (
      `<div>${reason}</div>` +
      `<div><span class="tooltip-key">Wait:</span> <span class="tooltip-val">${formatFramesAsSeconds(toFrames(row.waitTime))}</span></div>`
    );
  }
  return (
    `<div>${row.moveName}${type === 'offfield' ? ' (off-field)' : ''}</div>` +
    `<div><span class="tooltip-key">Start:</span> <span class="tooltip-val">${formatFramesAsSeconds(toFrames(row.gameTimeStart))}</span></div>` +
    `<div><span class="tooltip-key">Duration:</span> <span class="tooltip-val">${formatFramesAsSeconds(toFrames(row.duration))}</span></div>` +
    `<div><span class="tooltip-key">Timing:</span> <span class="tooltip-val">${describeTiming(row)}</span></div>` +
    `<div><span class="tooltip-key">Input:</span> <span class="tooltip-val">${describeInput(row)}</span></div>` +
    buildHitLinesHtml(row, activeHit)
  );
}

/** One segment of a unit's row (on-field, off-field or wait). Hover is handled by TimelineRow. */
export const TimelineClip: React.FC<TimelineClipProps> = ({ segment }) => {
  // Outer box is the true, unmodified hit target. The fill's gap from its neighbor (same idea as
  // StackedContributionBar's .ranking-bar-fill gap) is computed here, not a static CSS inset, so
  // it uses the same device-pixel-snapped hairline as every other edge.
  const hairline = hairlinePx();
  const fillWidth = Math.max(0, segment.widthPx - hairline * 2);

  return (
    <div className="timeline-clip-hit" style={{ left: segment.xPx, width: segment.widthPx, top: CLIP_INSET_PX, bottom: CLIP_INSET_PX }}>
      <div className={`timeline-clip timeline-clip-${segment.type}`} style={{ left: hairline, width: fillWidth }} />
    </div>
  );
};
