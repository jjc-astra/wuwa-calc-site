// src/components/timeline/RotationTimeline.tsx
// "Video editor" style rotation timeline -- pure/presentational (evaluated rows + team in, JSX
// out), no fetching/page knowledge, so reuse elsewhere is just a thin wrapper, not a rewrite.
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
  buildTimeCompression,
  compressedTimeToPx,
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

// Loop/ending-rotation marker: a line spanning just the unit rows (not through the ruler), plus
// a solid triangle in the ruler pointing up at it -- the "playhead marker" idiom, styled like
// .toggle-icon/expand-caret's plain glyph rather than a line colliding with the ruler's ticks.
interface MarkerLineProps {
  left: number;
  top: number;
  height: number;
  width: number;
  lineClassName: string;
}
const TimelineMarkerLine: React.FC<MarkerLineProps> = ({ left, top, height, width, lineClassName }) => (
  <>
    <div className={lineClassName} style={{ left, top, height, width }} />
    <span className="timeline-marker-arrow" style={{ left: left + width / 2, top: top + height }}>▲</span>
  </>
);

export const RotationTimeline: React.FC<RotationTimelineProps> = ({ evaluatedRows, team, loopStartIndex, className = '' }) => {
  // Squeezes the Ending Rotation's silently-simulated gap down to a small fixed width. All
  // x/width math below routes through compressedTimeToPx so clips/flags/ticks/width all agree.
  const compression = useMemo(() => buildTimeCompression(evaluatedRows), [evaluatedRows]);
  const flags = useMemo(() => assignFlagLanes(buildFlags(evaluatedRows, team), compression), [evaluatedRows, team, compression]);
  const unitRows = useMemo(() => buildUnitRows(evaluatedRows, team, compression), [evaluatedRows, team, compression]);
  const totalFrames = useMemo(() => computeTotalDurationFrames(evaluatedRows), [evaluatedRows]);
  const ticks = useMemo(() => generateTicks(totalFrames, compression), [totalFrames, compression]);

  const contentWidth = HEADER_COL_WIDTH_PX + compressedTimeToPx(totalFrames, compression);

  const loopStartRow = loopStartIndex !== null ? evaluatedRows[loopStartIndex] : null;
  const loopStartLeft = loopStartRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(loopStartRow.gameTimeStart, compression) : null;

  // Same two-marker convention as RotationRow.tsx: LOOP END closes the loop template; END
  // ROTATION marks custom replacement content when the loop-end row is followed by real content.
  // Both derived from loopEndOverride/row-adjacency (mirrors RotationBuilder.tsx's
  // hasEndRotationContent) rather than persisted flags, so this view can't disagree with that one.
  const loopEndIndex = evaluatedRows.findIndex(r => r && r.unit && r.loopEndOverride === true);
  const loopEndRow = loopEndIndex !== -1 ? evaluatedRows[loopEndIndex] : null;
  const loopEndLeft = loopEndRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(loopEndRow.gameTimeStart + loopEndRow.gameTimePassed, compression) : null;
  const hasEndRotationContent = loopEndIndex !== -1 && !!evaluatedRows[loopEndIndex + 1]?.unit;
  const endRotationRow = hasEndRotationContent ? evaluatedRows[loopEndIndex + 1] : null;
  const endRotationLeft = endRotationRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(endRotationRow.gameTimeStart, compression) : null;

  // Poles stop at the bottom of the rows (never cross into the ruler below), and start right at
  // their own flag's label -- not above it, where they'd cross through lower-lane flags' labels.
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

          {/* Vertical bar per flag -- starts at the bottom of its own label (not the full lane
              band, which would leave a floating gap above), stops at the bottom of the last row. */}
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

          {/* Starts at the top of the first unit row (not the flag track) and stops at the last
              row -- the ruler gets its own arrow marker instead of a line crossing its ticks. */}
          {loopStartLeft !== null && (
            <TimelineMarkerLine
              lineClassName="timeline-loop-start-line"
              left={loopStartLeft}
              top={flagTrackHeight}
              height={Math.max(0, rowsBottom - flagTrackHeight)}
              width={snapToDevicePixel(2)}
            />
          )}

          {/* Ending Rotation: gap between the loop-end row and Ending Rotation's first row
              (silently-simulated repeat loops get no rows of their own, see
              previewEndingRotationTiming) is compressed by buildTimeCompression --
              endRotationLeft - loopEndLeft always equals ENDING_ROTATION_CUT_WIDTH_PX here.
              Striped fill is scoped to unit rows only -- the ruler already shows the skip via
              generateTicks omitting ticks inside the gap. */}
          {loopEndLeft !== null && (
            <TimelineMarkerLine
              lineClassName="timeline-loop-end-line"
              left={loopEndLeft}
              top={flagTrackHeight}
              height={Math.max(0, rowsBottom - flagTrackHeight)}
              width={snapToDevicePixel(2)}
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
            <TimelineMarkerLine
              lineClassName="timeline-end-rotation-line"
              left={endRotationLeft}
              top={flagTrackHeight}
              height={Math.max(0, rowsBottom - flagTrackHeight)}
              width={snapToDevicePixel(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
};
