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

// "Hit #n: x dmg" for `onlyHit` (1-based).
function buildHitLinesHtml(row: any, onlyHit: number | undefined, withSystemHits: boolean): string {
  if (onlyHit === undefined) return '';
  const lines = rowHits(row, withSystemHits).flatMap((hit, i) => {
    if (i + 1 !== onlyHit) return [];
    // "[Proc] Forte Detonate (Hit 2)" -> "(Forte Detonate)"
    const proc = typeof hit.title === 'string' && hit.title.startsWith('[Proc] ')
      ? ` (${hit.title.slice(7).replace(/ \(Hit \d+\)$/, '')})`
      : '';
    return [`<div class="timeline-tooltip-hit"><span class="tooltip-key">Hit #${i + 1}${proc}:</span> <span class="tooltip-val">${Math.floor(hit.total || 0).toLocaleString()} dmg</span></div>`];
  });
  return lines.length > 0 ? `<div class="timeline-tooltip-hits">${lines.join('')}</div>` : '';
}

/** Clip tooltip at `atFrames`; lists `onlyHit` when snapped. */
export function buildClipTooltipHtml(
  { type, row, pause }: Pick<TimelineSegment, 'type' | 'row' | 'pause'>,
  atFrames: number,
  onlyHit?: number,
  withSystemHits = true
): string {
  const at = tooltipLine('At', seconds(atFrames));
  if (type === 'motionstop' && pause) {
    return (
      `<div>Motion Stop</div>` +
      tooltipLine('Paused by', `${pause.by} (${pause.moveName})`) +
      tooltipLine('Paused', seconds(pause.frames)) +
      tooltipLine('Move', row.moveName) +
      at
    );
  }
  if (type === 'wait') {
    const reason = row.waitTime === row.cdWaitTime ? 'Waiting for Skill CD' : 'Animation Lock';
    return `<div>${reason}</div>` + tooltipLine('Wait', seconds(row.waitTime)) + at;
  }
  return (
    `<div>${row.moveName}${type === 'offfield' ? ' (off-field)' : ''}</div>` +
    tooltipLine('Start', seconds(row.gameTimeStart)) +
    // Game time, excluding freeze.
    tooltipLine('Duration', seconds(row.gameTimePassed ?? row.duration)) +
    tooltipLine('Timing', timingLabel(row)) +
    tooltipLine('Input', describeInput(row)) +
    at +
    buildHitLinesHtml(row, onlyHit, withSystemHits)
  );
}

/** One segment of a unit's row (on-field, off-field or wait). */
export const TimelineClip = React.memo<TimelineClipProps>(({ segment }) => {
  // Pixel-snapped gap between fills.
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
