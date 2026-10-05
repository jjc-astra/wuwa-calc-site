// "Video editor" style rotation timeline -- pure/presentational (evaluated rows + team in, JSX
// out), no fetching/page knowledge, so reuse elsewhere is just a thin wrapper, not a rewrite.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TimelineFlagTrack } from './TimelineFlagTrack';
import { useUiScale } from '../../hooks/useUiScale';
import { TimelineRow } from './TimelineRow';
import { TimelineRuler } from './TimelineRuler';
import { TimelineEffectRow } from './TimelineEffectRow';
import { buildEffectTimeline, EFFECT_ROW_HEIGHT_PX, SECTION_ROW_HEIGHT_PX, UNIT_EFFECT_GROUPS } from './effectLayout';
import type { EffectLane, EffectSourceKind } from './effectLayout';
import { useTimelineViewStore } from '../../store/useTimelineViewStore';
import { TooltipManager } from '../../utils/Common';
import { FastForwardIcon } from '../common/icons';
import { loopEndIndexOf, rowGameEnd } from '../../logic/rotationRows';
import {
  buildUnitRows,
  buildFlags,
  assignFlagLanes,
  generateTicks,
  computeTotalDurationFrames,
  buildTimeCompression,
  compressedTimeToPx,
  snapToDevicePixel,
  flagTrackHeightPx,
  HEADER_COL_WIDTH_PX,
  EFFECTS_HEADER_COL_WIDTH_PX,
  LANE_HEIGHT_PX,
  FLAG_LABEL_HEIGHT_PX,
  ROW_HEIGHT_PX,
  hairlinePx
} from './timelineLayout';
import type { TeamSlot } from '../../types';

interface RotationTimelineProps {
  evaluatedRows: any[];
  team: TeamSlot[];
  loopStartIndex: number | null;
  className?: string;
  // The flag track above the rows: key inputs (E, R, Hold...) and unit swaps (1, 2, 3).
  showInputs?: boolean;
  // Effect sections (the Calculator's): each unit's buffs nested under it, then Enemy Effects,
  // System Effects (with System hits, taken off the unit rows) and Trackers -- each collapsible,
  // with the view choices in useTimelineViewStore.
  withEffects?: boolean;
  // Hovering a move highlights its row in the rotation table (and the other way around); hovering a
  // buff, the rows it reached.
  linkToTable?: boolean;
}

interface TimelineSectionRowProps {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  // A group inside a unit's effects (Weapon, Echo Sets), not a top-level section.
  nested?: boolean;
}

// A collapsible effect section's (or a unit's effect group's) header row.
const TimelineSectionRow: React.FC<TimelineSectionRowProps> = ({ title, count, open, onToggle, nested = false }) => (
  <div className={`timeline-row timeline-section-row${nested ? ' is-nested' : ''}`} style={{ height: SECTION_ROW_HEIGHT_PX }}>
    <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
      <button type="button" className={`timeline-section-toggle ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <span className="timeline-section-caret">▾</span>
        <span className="timeline-section-title">{title}</span>
        <span className="timeline-expander-count">{count}</span>
      </button>
    </div>
    <div className="timeline-row-track" />
  </div>
);

interface TimelineItem {
  key: string;
  height: number;
  node: React.ReactNode;
  // Rendered even when scrolled out of view (a unit row: a table hover scrolls to its clips).
  pinned?: boolean;
}

// Only rows within this much (design px) of the view are rendered; the rest are spacers. The
// window moves in steps of WINDOW_STEP_PX, so scrolling re-renders once per step, not per frame.
const WINDOW_OVERSCAN_PX = 240;
const WINDOW_STEP_PX = 120;

const ENDING_CUT_TIP = 'The loop repeats silently here before the Ending Rotation begins.';

// The scrolled view, in steps of WINDOW_STEP_PX of design px.
function useViewSteps(scrollRef: React.RefObject<HTMLDivElement | null>, scale: number) {
  const [steps, setSteps] = useState({ first: 0, last: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const first = Math.floor(el.scrollTop / scale / WINDOW_STEP_PX);
      const last = Math.ceil((el.scrollTop + el.clientHeight) / scale / WINDOW_STEP_PX);
      setSteps(prev => (prev.first === first && prev.last === last ? prev : { first, last }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [scrollRef, scale]);
  return steps;
}

// The items to render: those near [top, bottom] (design px, from the first item) or pinned, with
// each run of skipped items collapsed into one spacer of their total height.
function windowItems(items: TimelineItem[], top: number, bottom: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let y = 0;
  let skipped = 0;
  const flushSpacer = (key: string) => {
    if (skipped > 0) out.push(<div key={`spacer:${key}`} className="timeline-spacer" style={{ height: skipped }} />);
    skipped = 0;
  };
  for (const item of items) {
    if (item.pinned || (y + item.height > top && y < bottom)) {
      flushSpacer(item.key);
      out.push(<React.Fragment key={item.key}>{item.node}</React.Fragment>);
    } else {
      skipped += item.height;
    }
    y += item.height;
  }
  flushSpacer('end');
  return out;
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

export const RotationTimeline: React.FC<RotationTimelineProps> = ({ evaluatedRows, team, loopStartIndex, className = '', showInputs = true, withEffects = false, linkToTable = false }) => {
  // All timeline geometry is laid out in fixed design px (timelineLayout), so the content is
  // zoomed by the UI scale as a whole -- boxes and text shrink together, instead of rem text
  // shrinking inside px boxes.
  const scale = useUiScale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const view = useViewSteps(scrollRef, scale);
  // Squeezes the Ending Rotation's silently-simulated gap down to a small fixed width. All
  // x/width math below routes through compressedTimeToPx so clips/flags/ticks/width all agree.
  const compression = useMemo(() => buildTimeCompression(evaluatedRows), [evaluatedRows]);
  const flags = useMemo(
    () => (showInputs ? assignFlagLanes(buildFlags(evaluatedRows, team), compression) : []),
    [evaluatedRows, team, compression, showInputs]
  );
  const unitRows = useMemo(() => buildUnitRows(evaluatedRows, team, compression, !withEffects), [evaluatedRows, team, compression, withEffects]);
  const effects = useMemo(() => (withEffects ? buildEffectTimeline(evaluatedRows, team, compression) : null), [evaluatedRows, team, compression, withEffects]);
  const totalFrames = useMemo(() => computeTotalDurationFrames(evaluatedRows), [evaluatedRows]);
  const ticks = useMemo(() => generateTicks(totalFrames, compression), [totalFrames, compression]);
  const { showPermanent, collapsed, toggleCollapsed } = useTimelineViewStore();

  // Every row under the flag track, top to bottom, with its height (the markers below span them).
  const items: TimelineItem[] = [];
  if (!effects) {
    unitRows.forEach(row => items.push({ key: row.unit, height: ROW_HEIGHT_PX, pinned: true, node: <TimelineRow data={row} linked={linkToTable} /> }));
  } else {
    const shown = (lanes: EffectLane[] = []) => (showPermanent ? lanes : lanes.filter(lane => !lane.alwaysOn));
    const isOpen = (id: string) => !collapsed.includes(id);
    const laneItems = (lanes: EffectLane[], nested = false) => lanes.forEach(lane =>
      items.push({ key: lane.id, height: EFFECT_ROW_HEIGHT_PX, node: <TimelineEffectRow lane={lane} nested={nested} linkRows={linkToTable ? evaluatedRows : undefined} /> }));
    const section = (id: string, title: string, count: number, body: () => void, nested = false) => {
      items.push({
        key: `section:${id}`,
        height: SECTION_ROW_HEIGHT_PX,
        node: <TimelineSectionRow title={title} count={count} open={isOpen(id)} onToggle={() => toggleCollapsed(id)} nested={nested} />
      });
      if (isOpen(id)) body();
    };

    // Each unit: its own effects, then what its weapon and echoes add (each a collapsible
    // group), then its cooldowns.
    section('units', 'Unit Effects', unitRows.length, () => unitRows.forEach(row => {
      const lanes = shown(effects.unitLanes[row.unit]);
      const id = `unit:${row.unit}`;
      items.push({
        key: row.unit,
        height: ROW_HEIGHT_PX,
        pinned: true,
        node: <TimelineRow data={row} linked={linkToTable} expander={{ open: isOpen(id), count: lanes.length, onToggle: () => toggleCollapsed(id) }} />
      });
      if (!isOpen(id)) return;
      const buffs = lanes.filter(lane => lane.kind !== 'cooldown');
      const grouped = new Set<EffectSourceKind>(UNIT_EFFECT_GROUPS.flatMap(group => group.kinds));
      laneItems(buffs.filter(lane => !grouped.has(lane.sourceKind ?? 'character')));
      UNIT_EFFECT_GROUPS.forEach(group => {
        const groupLanes = buffs.filter(lane => lane.sourceKind && group.kinds.includes(lane.sourceKind));
        if (groupLanes.length > 0) section(`${id}:${group.id}`, group.title, groupLanes.length, () => laneItems(groupLanes, true), true);
      });
      laneItems(lanes.filter(lane => lane.kind === 'cooldown'));
    }));
    const enemy = shown(effects.enemy);
    section('enemy', 'Enemy Effects', enemy.length, () => laneItems(enemy));
    const system = shown(effects.system);
    section('system', 'System Effects', system.length, () => laneItems(system));
    section('trackers', 'Trackers', effects.trackers.length, () => laneItems(effects.trackers));
  }

  // The name column: wider with effects, whose names run longer than a unit's. Rows read it as
  // --timeline-header-width.
  const headerWidth = withEffects ? EFFECTS_HEADER_COL_WIDTH_PX : HEADER_COL_WIDTH_PX;
  const contentWidth = headerWidth + compressedTimeToPx(totalFrames, compression);

  const loopStartRow = loopStartIndex !== null ? evaluatedRows[loopStartIndex] : null;
  const loopStartLeft = loopStartRow ? headerWidth + compressedTimeToPx(loopStartRow.gameTimeStart, compression) : null;

  // Same two-marker convention as RotationRow.tsx: LOOP END closes the loop template; END
  // ROTATION marks custom replacement content when the loop-end row is followed by real content.
  // Both derived from loopEndOverride/row-adjacency (mirrors RotationBuilder.tsx's
  // hasEndRotationContent) rather than persisted flags, so this view can't disagree with that one.
  const loopEndIndex = loopEndIndexOf(evaluatedRows);
  const loopEndRow = loopEndIndex !== -1 ? evaluatedRows[loopEndIndex] : null;
  const loopEndLeft = loopEndRow ? headerWidth + compressedTimeToPx(rowGameEnd(loopEndRow), compression) : null;
  const hasEndRotationContent = loopEndIndex !== -1 && !!evaluatedRows[loopEndIndex + 1]?.unit;
  const endRotationRow = hasEndRotationContent ? evaluatedRows[loopEndIndex + 1] : null;
  const endRotationLeft = endRotationRow ? headerWidth + compressedTimeToPx(endRotationRow.gameTimeStart, compression) : null;

  // Poles stop at the bottom of the rows (never cross into the ruler below), and start right at
  // their own flag's label -- not above it, where they'd cross through lower-lane flags' labels.
  // Hidden inputs drop the whole track, so the rows start at the top.
  const flagTrackHeight = showInputs ? flagTrackHeightPx(flags) : 0;
  const rowsBottom = flagTrackHeight + items.reduce((sum, item) => sum + item.height, 0);
  // The loop/ending markers span the rows, below the flag track.
  const markerSpan = { top: flagTrackHeight, height: Math.max(0, rowsBottom - flagTrackHeight), width: snapToDevicePixel(2) };
  const hairline = hairlinePx();
  const shownItems = windowItems(
    items,
    view.first * WINDOW_STEP_PX - flagTrackHeight - WINDOW_OVERSCAN_PX,
    view.last * WINDOW_STEP_PX - flagTrackHeight + WINDOW_OVERSCAN_PX
  );

  return (
    <div className={`timeline-root ${className}`}>
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className="timeline-content"
          style={{ width: contentWidth, zoom: scale, '--timeline-header-width': `${headerWidth}px` } as React.CSSProperties}
        >
          {showInputs && <TimelineFlagTrack flags={flags} />}
          {shownItems}
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
                  left: headerWidth + flag.xPx,
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
            <TimelineMarkerLine lineClassName="timeline-loop-start-line" left={loopStartLeft} {...markerSpan} />
          )}

          {/* Ending Rotation: gap between the loop-end row and Ending Rotation's first row
              (silently-simulated repeat loops get no rows of their own, see
              previewEndingRotationTiming) is compressed by buildTimeCompression --
              endRotationLeft - loopEndLeft always equals ENDING_ROTATION_CUT_WIDTH_PX here.
              Striped fill is scoped to unit rows only -- the ruler already shows the skip via
              generateTicks omitting ticks inside the gap. */}
          {loopEndLeft !== null && (
            <TimelineMarkerLine lineClassName="timeline-loop-end-line" left={loopEndLeft} {...markerSpan} />
          )}
          {loopEndLeft !== null && endRotationLeft !== null && endRotationLeft > loopEndLeft && (
            <div
              className="timeline-ending-rotation-cut"
              style={{ left: loopEndLeft, top: markerSpan.top, width: endRotationLeft - loopEndLeft, height: markerSpan.height }}
              onMouseEnter={e => TooltipManager.showAtPoint(e.clientX, e.clientY, ENDING_CUT_TIP)}
              onMouseMove={e => TooltipManager.showAtPoint(e.clientX, e.clientY, ENDING_CUT_TIP)}
              onMouseLeave={() => TooltipManager.hide()}
            >
              <FastForwardIcon className="timeline-ending-rotation-cut-ff" />
            </div>
          )}
          {endRotationLeft !== null && (
            <TimelineMarkerLine lineClassName="timeline-end-rotation-line" left={endRotationLeft} {...markerSpan} />
          )}
        </div>
      </div>
    </div>
  );
};
