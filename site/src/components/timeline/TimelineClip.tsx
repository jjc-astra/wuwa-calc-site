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
  // Outer box is the true, unmodified hit target (hover/tooltip). The fill's gap from its
  // neighbor (same idea as StackedContributionBar's .ranking-bar-fill gap) is computed here,
  // not a static CSS inset, so it uses the same device-pixel-snapped hairline as every other edge.
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
