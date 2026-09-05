// Pure layout math for the rotation Timeline -- no React/DOM here.
// Reads off already-recalculated rows (see TimelineEngine.ts for field meanings).
import { getCharacterThemeColor } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { INPUT_KEY_MAP } from '../../data/db';
import { toFrames, framesToSeconds } from '../../utils/Frames';
import type { TeamSlot } from '../../types';

export const PX_PER_SECOND = 50;
export const HEADER_COL_WIDTH_PX = 140;
export const ROW_HEIGHT_PX = 44;
export const RULER_HEIGHT_PX = 28;
export const LANE_HEIGHT_PX = 26;
// Shorter than LANE_HEIGHT_PX so a gap separates each lane's label from the next.
// Duplicated in timeline.css's .timeline-flag-label -- keep in sync.
export const FLAG_LABEL_HEIGHT_PX = 20;
export const FLAG_TRACK_MIN_HEIGHT_PX = LANE_HEIGHT_PX;

const FLAG_CHAR_WIDTH_PX = 5.5;
const FLAG_LABEL_PADDING_PX = 2;
const FLAG_MIN_WIDTH_PX = 12;
const FLAG_LANE_GAP_PX = 6;
// Larger than the clip fill's gap inset so a narrow segment's insets can't cross and vanish it.
const MIN_CLIP_WIDTH_PX = 4;

// Snaps to whole device pixels, not just CSS pixels, so edges land crisp under fractional
// devicePixelRatio (e.g. 125% Windows scaling) instead of anti-aliasing inconsistently.
function getDevicePixelRatio(): number {
  return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
}

export function snapToDevicePixel(px: number): number {
  const dpr = getDevicePixelRatio();
  return Math.round(px * dpr) / dpr;
}

// Read fresh each call since devicePixelRatio can change (monitor/OS scale change) after load.
export function hairlinePx(): number {
  return snapToDevicePixel(1);
}
export function simultaneousLineHeightPx(): number {
  return snapToDevicePixel(3);
}

export function timeToPx(frames: number): number {
  return snapToDevicePixel(framesToSeconds(toFrames(frames)) * PX_PER_SECOND);
}

// Fixed width for the Ending Rotation "fast forward" jump, deliberately not proportional to the
// real (potentially huge) time it represents -- see compressedTimeToPx.
export const ENDING_ROTATION_CUT_WIDTH_PX = 48;

export interface TimeCompression {
  gapStartFrames: number;
  gapEndFrames: number;
  compressedWidthPx: number;
}

// Mirrors RotationBuilder/RotationTimeline's loopEndOverride + row-adjacency logic so the row
// table and this Timeline never disagree on where an Ending Rotation split sits. Returns null
// when there's no split, or the real gap is already smaller than the compressed width.
export function buildTimeCompression(evaluatedRows: any[]): TimeCompression | null {
  const loopEndIndex = evaluatedRows.findIndex(r => r && r.unit && r.loopEndOverride === true);
  if (loopEndIndex === -1) return null;
  const loopEndRow = evaluatedRows[loopEndIndex];
  const endRotationRow = evaluatedRows[loopEndIndex + 1];
  if (!endRotationRow || !endRotationRow.unit) return null;

  const gapStartFrames = toFrames(loopEndRow.gameTimeStart + loopEndRow.gameTimePassed);
  const gapEndFrames = toFrames(endRotationRow.gameTimeStart);
  if (gapEndFrames <= gapStartFrames) return null;

  const realGapWidthPx = timeToPx(gapEndFrames) - timeToPx(gapStartFrames);
  if (realGapWidthPx <= ENDING_ROTATION_CUT_WIDTH_PX) return null;

  return { gapStartFrames, gapEndFrames, compressedWidthPx: ENDING_ROTATION_CUT_WIDTH_PX };
}

// Like timeToPx, but frames inside the gap collapse into a fixed compressedWidthPx band and
// everything after shifts left to match. All layout in this module should route through this
// instead of timeToPx directly, so clips/flags/ticks agree on the same compressed axis.
export function compressedTimeToPx(frames: number, compression: TimeCompression | null): number {
  if (!compression) return timeToPx(frames);
  const { gapStartFrames, gapEndFrames, compressedWidthPx } = compression;
  if (frames <= gapStartFrames) return timeToPx(frames);
  const gapStartPx = timeToPx(gapStartFrames);
  if (frames >= gapEndFrames) {
    const realGapWidthPx = timeToPx(gapEndFrames) - gapStartPx;
    return timeToPx(frames) - realGapWidthPx + compressedWidthPx;
  }
  // Inside the gap (only reached by a tick about to be filtered, see generateTicks) -- interpolate
  // proportionally within the compressed band.
  const gapFrames = gapEndFrames - gapStartFrames;
  const frac = gapFrames > 0 ? (frames - gapStartFrames) / gapFrames : 0;
  return gapStartPx + frac * compressedWidthPx;
}

export type SegmentType = 'onfield' | 'offfield' | 'wait';

export interface TimelineSegment {
  type: SegmentType;
  xPx: number;
  widthPx: number;
  row: any;
}

export interface SimultaneousLine {
  xPx: number;
  widthPx: number;
  row: any;
}

export interface UnitRowData {
  unit: string;
  slotIndex: number;
  themeColor: string;
  segments: TimelineSegment[];
  simultaneousLines: SimultaneousLine[];
}

function deriveSegments(rows: any[], compression: TimeCompression | null): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (const row of rows) {
    // gameTimePassed (not row.duration) is the freeze-adjusted end, since duration is real-time.
    const onStartX = compressedTimeToPx(row.gameTimeStart, compression);
    const onTrueEndX = compressedTimeToPx(row.gameTimeStart + row.gameTimePassed, compression);
    // Below min-width, extend rightward so the start stays anchored to the wait segment before it.
    const onWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onTrueEndX - onStartX);
    const onRenderedEndX = onStartX + onWidthPx;
    segments.push({ type: 'onfield', xPx: onStartX, widthPx: onWidthPx, row });

    if (row.waitTime > 0 && row.timing !== 'Simultaneous') {
      // Extended backward when floored so it can't creep into the on-field clip it precedes.
      const waitTrueStartX = compressedTimeToPx(row.gameTimeStart - row.waitTime, compression);
      const waitWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onStartX - waitTrueStartX);
      segments.push({ type: 'wait', xPx: onStartX - waitWidthPx, widthPx: waitWidthPx, row });
    }

    // Off-field tail, anchored to onRenderedEndX so a floored on-field clip can't overlap it.
    const offEndFrames = row.gameTimeStart + Math.max(0, row.animationCommitment - (row.freezeTime || 0));
    if (offEndFrames > row.gameTimeStart + row.gameTimePassed) {
      const offEndX = compressedTimeToPx(offEndFrames, compression);
      segments.push({ type: 'offfield', xPx: onRenderedEndX, widthPx: Math.max(MIN_CLIP_WIDTH_PX, offEndX - onRenderedEndX), row });
    }
  }
  return segments;
}

// Thin bottom-of-row line for a Simultaneous action's own duration, separate from its normal
// (possibly overlapping) on/off-field clip. Runs until its animation ends, or for a Hold action
// until the matching Release row.
function deriveSimultaneousLines(rows: any[], compression: TimeCompression | null): SimultaneousLine[] {
  const lines: SimultaneousLine[] = [];
  rows.forEach((row, i) => {
    if (row.timing !== 'Simultaneous') return;
    let endGameTime = row.gameTimeStart + row.gameTimePassed;
    if (row.inputType === 'Hold') {
      const releaseRow = rows.slice(i + 1).find(r => r.inputType === 'Release');
      if (releaseRow) endGameTime = releaseRow.gameTimeStart;
    }
    const startX = compressedTimeToPx(row.gameTimeStart, compression);
    const endX = compressedTimeToPx(endGameTime, compression);
    lines.push({ xPx: startX, widthPx: Math.max(1, endX - startX), row });
  });
  return lines;
}

export function buildUnitRows(evaluatedRows: any[], team: TeamSlot[], compression: TimeCompression | null = null): UnitRowData[] {
  const unitRows: UnitRowData[] = [];
  team.forEach((slot, slotIndex) => {
    if (!slot.character) return;
    const rows = evaluatedRows.filter(r => r.unit === slot.character);
    unitRows.push({
      unit: slot.character,
      slotIndex,
      themeColor: getCharacterThemeColor(DataLoader.characterDB[slot.character]),
      segments: deriveSegments(rows, compression),
      simultaneousLines: deriveSimultaneousLines(rows, compression)
    });
  });
  return unitRows;
}

export type FlagType = 'swap' | 'input';

// Whether this row's input is safe to mash ahead of time ('spam') or must be waited for ('wait').
export type SpamState = 'spam' | 'wait';

export interface TimelineFlag {
  type: FlagType;
  timeFrames: number;
  label: string;
  // Only for a Hold/Release input flag.
  prefix?: 'Hold' | 'Release';
  // Renders this glyph instead of the key text (e.g. mouse icon instead of "Left Click").
  icon?: 'mouse-left';
  spamState?: SpamState;
  row: any;
  themeColor: string;
}

export interface LaidOutFlag extends TimelineFlag {
  xPx: number;
  widthPx: number;
  lane: number;
}

// A strictly higher cancel-priority action (Basic < Heavy < Skill < Echo < Dodge/Jump <
// Liberation < Intro < Outro, see GAME_DEFAULTS in db.ts) can always cut off whatever is
// currently playing. So: if the previous row outranks this one, this row can't preempt it and
// is safe to mash early ('spam'); otherwise mashing early risks cutting the current move short
// ('wait'). Same (input, inputType) as the previous row means it's a same-string combo
// continuation, not a cancel contest, so it's always safe to mash.
function describeSpamState(prevRow: any, row: any): SpamState | undefined {
  if (!prevRow) return undefined;
  if (prevRow.input === row.input && (prevRow.inputType || 'Press') === (row.inputType || 'Press')) return 'spam';
  const prevPriority = Number(prevRow.priority) || 0;
  const priority = Number(row.priority) || 0;
  return prevPriority > priority ? 'spam' : 'wait';
}

export function buildFlags(evaluatedRows: any[], team: TeamSlot[]): TimelineFlag[] {
  const flags: TimelineFlag[] = [];
  let prevUnit: string | null = null;
  let prevRow: any = null;

  for (const row of evaluatedRows) {
    if (!row.unit) continue;
    const themeColor = getCharacterThemeColor(DataLoader.characterDB[row.unit]);

    if (prevUnit !== null && prevUnit !== row.unit) {
      const slotIndex = team.findIndex(s => s.character === row.unit);
      if (slotIndex >= 0) {
        flags.push({ type: 'swap', timeFrames: row.gameTimeStart, label: `${slotIndex + 1}`, row, themeColor });
      }
    }

    if (row.input) {
      const keyLabel = INPUT_KEY_MAP[row.input] || row.input;
      const prefix = row.inputType === 'Hold' ? 'Hold' : row.inputType === 'Release' ? 'Release' : undefined;
      const label = prefix ? `${prefix} ${keyLabel}` : keyLabel;
      // Basic (left click) gets a mouse icon instead of text -- it's by far the most frequent
      // input and the text version ate the most flag-track width.
      const icon = row.input === 'Basic' ? 'mouse-left' : undefined;
      const spamState = describeSpamState(prevRow, row);
      flags.push({ type: 'input', timeFrames: row.gameTimeStart, label, prefix, icon, spamState, row, themeColor });
    }

    prevUnit = row.unit;
    prevRow = row;
  }

  return flags;
}

// Character-count heuristic instead of measureText -- label vocabulary is small and fixed, and
// generous padding tolerates the estimate's slack.
function estimateLabelWidthPx(label: string): number {
  return Math.max(FLAG_MIN_WIDTH_PX, label.length * FLAG_CHAR_WIDTH_PX + FLAG_LABEL_PADDING_PX * 2);
}

const ICON_SIZE_PX = 11;
const ICON_GAP_PX = 3;

export function estimateFlagWidthPx(flag: TimelineFlag): number {
  if (!flag.icon) return estimateLabelWidthPx(flag.label);
  const prefixWidth = flag.prefix ? flag.prefix.length * FLAG_CHAR_WIDTH_PX + ICON_GAP_PX : 0;
  return Math.max(FLAG_MIN_WIDTH_PX, prefixWidth + ICON_SIZE_PX + FLAG_LABEL_PADDING_PX * 2);
}

// Greedy interval-partitioning: sort by x, place each flag in the first lane whose last edge
// has cleared this flag's start, else open a new lane.
export function assignFlagLanes(flags: TimelineFlag[], compression: TimeCompression | null = null): LaidOutFlag[] {
  const positioned = flags
    .map(f => ({ ...f, xPx: compressedTimeToPx(f.timeFrames, compression), widthPx: estimateFlagWidthPx(f) }))
    .sort((a, b) => a.xPx - b.xPx);

  const laneEndX: number[] = [];
  return positioned.map(flag => {
    let lane = laneEndX.findIndex(endX => endX + FLAG_LANE_GAP_PX <= flag.xPx);
    if (lane === -1) {
      lane = laneEndX.length;
      laneEndX.push(flag.xPx + flag.widthPx);
    } else {
      laneEndX[lane] = flag.xPx + flag.widthPx;
    }
    return { ...flag, lane };
  });
}

export type TickTier = 'major' | 'secondary' | 'minor';

export interface Tick {
  frames: number;
  xPx: number;
  tier: TickTier;
  label?: string;
}

export function generateTicks(totalFrames: number, compression: TimeCompression | null = null): Tick[] {
  const ticks: Tick[] = [];
  for (let f = 0; f <= totalFrames; f += 15) {
    // Skip ticks inside the compressed gap -- illegible at that resolution and their spacing
    // no longer represents real elapsed time there.
    if (compression && f > compression.gapStartFrames && f < compression.gapEndFrames) continue;
    const tier: TickTier = f % 60 === 0 ? 'major' : f % 30 === 0 ? 'secondary' : 'minor';
    ticks.push({
      frames: f,
      xPx: compressedTimeToPx(f, compression),
      tier,
      label: tier === 'major' ? `${Math.round(framesToSeconds(toFrames(f)))}s` : undefined
    });
  }
  return ticks;
}

// Rounded up to the next whole second so the ruler's last major tick covers the full width.
export function computeTotalDurationFrames(evaluatedRows: any[]): number {
  let max = 0;
  for (const row of evaluatedRows) {
    if (!row.unit) continue;
    max = Math.max(max, row.gameTimeStart + row.animationCommitment);
  }
  return Math.ceil(max / 60) * 60;
}

// Mirrors TimelineEngine.ts's own timingLabel derivation so the tooltip text matches.
export function describeTiming(row: any): string {
  if (row.timing === 'Auto') {
    return row._autoTimingChoice ? `Auto (${row._autoTimingChoice})` : 'Auto';
  }
  return String(row.timing || 'Auto').replace('_', ' ');
}

export function describeInput(row: any): string {
  if (!row.input) return 'None';
  const keyLabel = INPUT_KEY_MAP[row.input] || row.input;
  if (row.inputType === 'Hold') return `Hold ${keyLabel}`;
  if (row.inputType === 'Release') return `Release ${keyLabel}`;
  return keyLabel;
}
