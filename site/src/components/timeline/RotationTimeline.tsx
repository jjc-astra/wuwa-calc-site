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

// A loop/ending-rotation marker is a line spanning just the unit rows (not a single line
// crossing the whole height down through the ruler) plus a solid triangle sitting in the ruler
// itself, pointing up at the line -- the same "playhead marker" idiom video editors use, and
// the same solid-triangle styling as this app's own .toggle-icon/expand-caret glyphs (a plain
// colored Unicode glyph, not a bespoke SVG) rather than a line that visually collides with the
// ruler's own tick marks and second labels.
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
  // Squeezes the Ending Rotation's silently-simulated gap (if any) down to a small fixed width
  // instead of its true (potentially huge) span -- every x/width calculation below routes
  // through compressedTimeToPx (a no-op passthrough to plain timeToPx when there's no gap to
  // compress), so clips/flags/ticks/total-width all agree on the same compressed axis.
  const compression = useMemo(() => buildTimeCompression(evaluatedRows), [evaluatedRows]);
  const flags = useMemo(() => assignFlagLanes(buildFlags(evaluatedRows, team), compression), [evaluatedRows, team, compression]);
  const unitRows = useMemo(() => buildUnitRows(evaluatedRows, team, compression), [evaluatedRows, team, compression]);
  const totalFrames = useMemo(() => computeTotalDurationFrames(evaluatedRows), [evaluatedRows]);
  const ticks = useMemo(() => generateTicks(totalFrames, compression), [totalFrames, compression]);

  const contentWidth = HEADER_COL_WIDTH_PX + compressedTimeToPx(totalFrames, compression);

  const loopStartRow = loopStartIndex !== null ? evaluatedRows[loopStartIndex] : null;
  const loopStartLeft = loopStartRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(loopStartRow.gameTimeStart, compression) : null;

  // Same two-marker convention as the Rotation Calculator's own row table (RotationRow.tsx):
  // LOOP END closes off the repeating loop template, and -- whenever the loop-end row is
  // followed by real content -- END ROTATION marks where that custom replacement content
  // starts. Both derived from loopEndOverride/row-adjacency rather than their own persisted
  // flags, mirroring RotationBuilder.tsx's hasEndRotationContent exactly, so the two views can
  // never disagree about where these markers sit. (buildTimeCompression above derives the same
  // two rows internally, but doesn't expose them -- cheap enough to just re-derive here too.)
  const loopEndIndex = evaluatedRows.findIndex(r => r && r.unit && r.loopEndOverride === true);
  const loopEndRow = loopEndIndex !== -1 ? evaluatedRows[loopEndIndex] : null;
  const loopEndLeft = loopEndRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(loopEndRow.gameTimeStart + loopEndRow.gameTimePassed, compression) : null;
  const hasEndRotationContent = loopEndIndex !== -1 && !!evaluatedRows[loopEndIndex + 1]?.unit;
  const endRotationRow = hasEndRotationContent ? evaluatedRows[loopEndIndex + 1] : null;
  const endRotationLeft = endRotationRow ? HEADER_COL_WIDTH_PX + compressedTimeToPx(endRotationRow.gameTimeStart, compression) : null;

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

          {/* Starts at the top of the first unit row (not the flag track above it) and stops at
              the bottom of the last row -- the ruler below gets its own arrow marker instead of
              the line crossing through it and visually colliding with the tick marks/labels. */}
          {loopStartLeft !== null && (
            <TimelineMarkerLine
              lineClassName="timeline-loop-start-line"
              left={loopStartLeft}
              top={flagTrackHeight}
              height={Math.max(0, rowsBottom - flagTrackHeight)}
              width={snapToDevicePixel(2)}
            />
          )}

          {/* Ending Rotation: the real gap between the loop-end row and the Ending Rotation's
              first row (the silently-simulated repeat loops never get their own rows in
              evaluatedRows -- only the tail's timing shifts to reflect them, see
              previewEndingRotationTiming) has already been compressed down to a small fixed
              width by buildTimeCompression -- endRotationLeft - loopEndLeft always equals
              exactly ENDING_ROTATION_CUT_WIDTH_PX whenever this renders, by construction. The
              striped fill below is scoped to just the unit rows (like the flag poles/marker
              lines) -- the ruler communicates the skip on its own, via generateTicks already
              omitting every tick inside the compressed gap (38s jumping straight to 118s), so it
              doesn't also need the hatching drawn over it. */}
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
