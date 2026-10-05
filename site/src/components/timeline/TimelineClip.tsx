import React from 'react';
import { formatFramesAsSeconds, toFrames } from '../../utils/Frames';
import { tooltipLine } from '../../utils/Common';
import { timingLabel } from '../../logic/rotationRows';
import { describeInput, hairlinePx, rowHits, CLIP_INSET_PX } from './timelineLayout';
import type { TimelineSegment } from './timelineLayout';

const seconds = (frames: number) => formatFramesAsSeconds(toFrames(frames));

interface TimelineClipProps {
  segment: TimelineSegment;
}

// "Hit #n: x dmg" per hit, with `activeHit` (1-based) highlighted.
function buildHitLinesHtml(row: any, activeHit: number | undefined, withSystemHits: boolean): string {
  const hits = rowHits(row, withSystemHits);
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
export function buildClipTooltipHtml(
  { type, row, pause }: Pick<TimelineSegment, 'type' | 'row' | 'pause'>,
  activeHit?: number,
  withSystemHits = true
): string {
  if (type === 'motionstop' && pause) {
    return (
      `<div>Motion Stop</div>` +
      tooltipLine('Paused by', `${pause.by} (${pause.moveName})`) +
      tooltipLine('Paused', seconds(pause.frames)) +
      tooltipLine('Move', row.moveName)
    );
  }
  if (type === 'wait') {
    const reason = row.waitTime === row.cdWaitTime ? 'Waiting for Skill CD' : 'Off-Field Animation Lock';
    return `<div>${reason}</div>` + tooltipLine('Wait', seconds(row.waitTime));
  }
  return (
    `<div>${row.moveName}${type === 'offfield' ? ' (off-field)' : ''}</div>` +
    tooltipLine('Start', seconds(row.gameTimeStart)) +
    tooltipLine('Duration', seconds(row.duration)) +
    tooltipLine('Timing', timingLabel(row)) +
    tooltipLine('Input', describeInput(row)) +
    buildHitLinesHtml(row, activeHit, withSystemHits)
  );
}

/** One segment of a unit's row (on-field, off-field or wait). Hover, and the linked-row highlight
 * (`is-linked`), are handled by TimelineRow. Memoized: hovering re-renders the row, not its clips. */
export const TimelineClip = React.memo<TimelineClipProps>(({ segment }) => {
  // Outer box is the true, unmodified hit target. The fill's gap from its neighbor (same idea as
  // StackedContributionBar's .ranking-bar-fill gap) is computed here, not a static CSS inset, so
  // it uses the same device-pixel-snapped hairline as every other edge.
  const hairline = hairlinePx();
  const fillWidth = Math.max(0, segment.widthPx - hairline * 2);

  return (
    <div
      className="timeline-clip-hit"
      data-row-id={segment.row?.id}
      style={{ left: segment.xPx, width: segment.widthPx, top: CLIP_INSET_PX, bottom: CLIP_INSET_PX }}
    >
      <div className={`timeline-clip timeline-clip-${segment.type}`} style={{ left: hairline, width: fillWidth }} />
    </div>
  );
});
