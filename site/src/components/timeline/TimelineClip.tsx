// src/components/timeline/TimelineClip.tsx
import React from 'react';
import { TooltipManager } from '../../utils/Common';
import { formatFramesAsSeconds, toFrames } from '../../utils/Frames';
import { describeTiming, describeInput, hairlinePx } from './timelineLayout';
import type { TimelineSegment } from './timelineLayout';

interface TimelineClipProps {
  segment: TimelineSegment;
}

function buildTooltipHtml(segment: TimelineSegment): string {
  const { type, row } = segment;
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
    `<div><span class="tooltip-key">Input:</span> <span class="tooltip-val">${describeInput(row)}</span></div>`
  );
}

export const TimelineClip: React.FC<TimelineClipProps> = ({ segment }) => {
  // The outer box is the true, unmodified time-boundary hit target (hover/tooltip). The fill's
  // own gap from its neighbor (the same idea as StackedContributionBar's .ranking-bar-fill
  // `gap`) is computed here rather than left to a static CSS inset, so it can use the same
  // device-pixel-snapped hairline every other edge in this timeline uses -- a plain "1px" CSS
  // inset would itself land at a different sub-pixel offset per clip and blur inconsistently.
  const hairline = hairlinePx();
  const fillWidth = Math.max(0, segment.widthPx - hairline * 2);

  return (
    <div
      className="timeline-clip-hit"
      style={{ left: segment.xPx, width: segment.widthPx }}
      onMouseEnter={e => TooltipManager.showAtPoint(e.clientX, e.clientY, buildTooltipHtml(segment))}
      onMouseMove={e => TooltipManager.showAtPoint(e.clientX, e.clientY, buildTooltipHtml(segment))}
      onMouseLeave={() => TooltipManager.hide()}
    >
      <div className={`timeline-clip timeline-clip-${segment.type}`} style={{ left: hairline, width: fillWidth }} />
    </div>
  );
};
