// src/components/timeline/RotationTimeline.tsx
// Core "video editor" style rotation timeline -- pure/presentational (already-evaluated rows +
// team in, JSX out), no fetching or page-specific knowledge, so later reuse elsewhere (e.g. the
// live Rotation Calculator) is just a new thin wrapper around this component, not a rewrite.
import React, { useMemo } from 'react';
import { TimelineFlagTrack } from './TimelineFlagTrack';
import { TimelineRow } from './TimelineRow';
import { TimelineRuler } from './TimelineRuler';
import { TooltipManager } from '../../utils/Common';
import {
  buildUnitRows,
  buildFlags,
  assignFlagLanes,
  generateTicks,
  computeTotalDurationFrames,
  timeToPx,
  snapToDevicePixel,
  HEADER_COL_WIDTH_PX,
  LANE_HEIGHT_PX,
  FLAG_LABEL_HEIGHT_PX,
  FLAG_TRACK_MIN_HEIGHT_PX,
  ROW_HEIGHT_PX,
  hairlinePx
} from './timelineLayout';
import type { TeamSlot } from '../../types';

interface RotationTimelineProps {
  evaluatedRows: any[];
  team: TeamSlot[];
  loopStartIndex: number | null;
  className?: string;
}

export const RotationTimeline: React.FC<RotationTimelineProps> = ({ evaluatedRows, team, loopStartIndex, className = '' }) => {
  const flags = useMemo(() => assignFlagLanes(buildFlags(evaluatedRows, team)), [evaluatedRows, team]);
  const unitRows = useMemo(() => buildUnitRows(evaluatedRows, team), [evaluatedRows, team]);
  const totalFrames = useMemo(() => computeTotalDurationFrames(evaluatedRows), [evaluatedRows]);
  const ticks = useMemo(() => generateTicks(totalFrames), [totalFrames]);

  const contentWidth = HEADER_COL_WIDTH_PX + timeToPx(totalFrames);

  const loopStartRow = loopStartIndex !== null ? evaluatedRows[loopStartIndex] : null;
  const loopStartLeft = loopStartRow ? HEADER_COL_WIDTH_PX + timeToPx(loopStartRow.gameTimeStart) : null;

  // Same two-marker convention as the Rotation Calculator's own row table (RotationRow.tsx):
  // LOOP END closes off the repeating loop template, and -- whenever the loop-end row is
  // followed by real content -- END ROTATION marks where that custom replacement content
  // starts. Both derived from loopEndOverride/row-adjacency rather than their own persisted
  // flags, mirroring RotationBuilder.tsx's hasEndRotationContent exactly, so the two views can
  // never disagree about where these markers sit.
  const loopEndIndex = evaluatedRows.findIndex(r => r && r.unit && r.loopEndOverride === true);
  const loopEndRow = loopEndIndex !== -1 ? evaluatedRows[loopEndIndex] : null;
  const loopEndLeft = loopEndRow ? HEADER_COL_WIDTH_PX + timeToPx(loopEndRow.gameTimeStart + loopEndRow.gameTimePassed) : null;
  const hasEndRotationContent = loopEndIndex !== -1 && !!evaluatedRows[loopEndIndex + 1]?.unit;
  const endRotationRow = hasEndRotationContent ? evaluatedRows[loopEndIndex + 1] : null;
  const endRotationLeft = endRotationRow ? HEADER_COL_WIDTH_PX + timeToPx(endRotationRow.gameTimeStart) : null;

  // Poles stop at the bottom of the rows (never cross into the ruler's tick-mark section
  // below), and start right at their own flag's label -- not above it, which would otherwise
  // needlessly cross through whichever other flags' labels sit in a lower lane number above it.
  const maxLane = flags.reduce((max, f) => Math.max(max, f.lane), -1);
  const flagTrackHeight = Math.max(FLAG_TRACK_MIN_HEIGHT_PX, (maxLane + 1) * LANE_HEIGHT_PX);
  const rowsBottom = flagTrackHeight + unitRows.length * ROW_HEIGHT_PX;
  const hairline = hairlinePx();

  return (
    <div className={`timeline-root ${className}`}>
      <div className="timeline-scroll">
        <div className="timeline-content" style={{ width: contentWidth }}>
          <TimelineFlagTrack flags={flags} />
          {unitRows.map(row => (
            <TimelineRow key={row.unit} data={row} />
          ))}
          <TimelineRuler ticks={ticks} />

          {/* Vertical bar per flag -- starts right at the bottom of its own label (not the full
              lane band, which would leave the lane gap floating disconnected above the bar) and
              stops at the bottom of the last row, before the ruler. */}
          {flags.map((flag, i) => {
            const top = flag.lane * LANE_HEIGHT_PX + FLAG_LABEL_HEIGHT_PX;
            return (
              <div
                key={i}
                className="timeline-flag-pole"
                style={{
                  left: HEADER_COL_WIDTH_PX + flag.xPx,
                  top,
                  height: Math.max(0, rowsBottom - top),
                  width: hairline,
                  background: flag.themeColor
                }}
              />
            );
          })}

          {/* Starts at the top of the first unit row (not the flag track above it) -- it's
              marking a point in the rows/ruler, not something the flag track's own markers
              need to be crossed by. */}
          {loopStartLeft !== null && (
            <div
              className="timeline-loop-start-line"
              style={{ left: loopStartLeft, top: flagTrackHeight, width: snapToDevicePixel(2) }}
            />
          )}

          {/* Ending Rotation: the gap between loopEndLeft and endRotationLeft is genuinely
              empty here (the silently-simulated repeat loops never get their own rows in
              evaluatedRows -- only the tail's timing shifts to reflect them, see
              previewEndingRotationTiming) -- filled with the same "sped up / time remapped"
              video-editor convention as the row table's own cut graphic, rather than left as an
              unexplained blank stretch of timeline. */}
          {loopEndLeft !== null && (
            <div
              className="timeline-loop-end-line"
              style={{ left: loopEndLeft, top: flagTrackHeight, width: snapToDevicePixel(2) }}
            />
          )}
          {loopEndLeft !== null && endRotationLeft !== null && endRotationLeft > loopEndLeft && (
            <div
              className="timeline-ending-rotation-cut"
              style={{ left: loopEndLeft, top: flagTrackHeight, width: endRotationLeft - loopEndLeft, height: Math.max(0, rowsBottom - flagTrackHeight) }}
              onMouseEnter={e => TooltipManager.showAtPoint(e.clientX, e.clientY, 'The loop repeats silently here before the Ending Rotation begins.')}
              onMouseMove={e => TooltipManager.showAtPoint(e.clientX, e.clientY, 'The loop repeats silently here before the Ending Rotation begins.')}
              onMouseLeave={() => TooltipManager.hide()}
            >
              <svg className="timeline-ending-rotation-cut-ff" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="1,4 11,12 1,20" />
                <polygon points="12,4 22,12 12,20" />
              </svg>
            </div>
          )}
          {endRotationLeft !== null && (
            <div
              className="timeline-end-rotation-line"
              style={{ left: endRotationLeft, top: flagTrackHeight, width: snapToDevicePixel(2) }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
