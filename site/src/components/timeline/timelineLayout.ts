// Pure layout math for the rotation Timeline.
import { getCharacterThemeColor, uiScale } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { INPUT_KEY_MAP } from '../../data/db';
import { FPS, toFrames, framesToSeconds, frozenFramesWithin, secondsToFrames } from '../../utils/Frames';
import { loopEndIndexOf, rowGameEnd } from '../../logic/rotationRows';
import { continuesHold } from '../../logic/inputBindings';
import { SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import type { TeamSlot } from '../../types';

// Row fields the Timeline reads; add any new ones here.
const TIMELINE_ROW_FIELDS = [
  'unit', 'action', 'moveName', 'input', 'inputType', 'priority', 'timing', '_autoTimingChoice', 'loopEndOverride',
  'gameTimeStart', 'gameTimePassed', 'duration', 'waitTime', 'cdWaitTime', 'freezeTime', 'freezeStart', 'animationCommitment',
  'motionStopPauses', 'backOnFieldAt'
] as const;

export const trimRowsForTimeline = (rows: any[]): any[] =>
  rows.map(row => row && {
    ...Object.fromEntries(TIMELINE_ROW_FIELDS.filter(f => f in row).map(f => [f, row[f]])),
    ...(row.damageInstances && {
      damageInstances: row.damageInstances.map((d: any) => ({ title: d.title, total: d.total, gameTime: d.gameTime, moveRef: d.moveRef }))
    })
  });

const PX_PER_SECOND = 50;
export const HEADER_COL_WIDTH_PX = 140;
// With effect rows.
export const EFFECTS_HEADER_COL_WIDTH_PX = 200;
export const ROW_HEIGHT_PX = 44;
export const RULER_HEIGHT_PX = 28;
export const LANE_HEIGHT_PX = 26;
// Keep in sync with .timeline-flag-label.
export const FLAG_LABEL_HEIGHT_PX = 20;
export const FLAG_TRACK_MIN_HEIGHT_PX = LANE_HEIGHT_PX;
export const CLIP_INSET_PX = 6;
const CLIP_HEIGHT_PX = ROW_HEIGHT_PX - 1 - CLIP_INSET_PX * 2;
// Hit dots: size (sync with .timeline-hit-dot), stack gap, edge margin.
const HIT_DOT_SIZE_PX = 4;
const HIT_DOT_GAP_PX = 5;
const HIT_DOT_EDGE_PX = 3;
const HIT_DOT_SAME_TIME_PX = 1;

const FLAG_CHAR_WIDTH_PX = 5.5;
const FLAG_LABEL_PADDING_PX = 2;
const FLAG_MIN_WIDTH_PX = 12;
const FLAG_LANE_GAP_PX = 6;
const MIN_CLIP_WIDTH_PX = 4;

// Screen pixels per design pixel (devicePixelRatio x UI scale).
function getDevicePixelRatio(): number {
  return ((typeof window !== 'undefined' && window.devicePixelRatio) || 1) * uiScale();
}

// Rounds to whole screen pixels.
export function snapToDevicePixel(px: number): number {
  const dpr = getDevicePixelRatio();
  return Math.round(px * dpr) / dpr;
}

export function hairlinePx(): number {
  return snapToDevicePixel(1);
}
export function simultaneousLineHeightPx(): number {
  return snapToDevicePixel(3);
}

function timeToPx(frames: number): number {
  return snapToDevicePixel(framesToSeconds(toFrames(frames)) * PX_PER_SECOND);
}

// Fixed width of the Ending Rotation jump.
const ENDING_ROTATION_CUT_WIDTH_PX = 48;

export interface TimeCompression {
  gapStartFrames: number;
  gapEndFrames: number;
  compressedWidthPx: number;
}

// Ending Rotation gap to compress; null if none or too small.
export function buildTimeCompression(evaluatedRows: any[]): TimeCompression | null {
  const loopEndIndex = loopEndIndexOf(evaluatedRows);
  if (loopEndIndex === -1) return null;
  const endRotationRow = evaluatedRows[loopEndIndex + 1];
  if (!endRotationRow?.unit) return null;

  const gapStartFrames = toFrames(rowGameEnd(evaluatedRows[loopEndIndex]));
  const gapEndFrames = toFrames(endRotationRow.gameTimeStart);
  if (gapEndFrames <= gapStartFrames) return null;

  const realGapWidthPx = timeToPx(gapEndFrames) - timeToPx(gapStartFrames);
  if (realGapWidthPx <= ENDING_ROTATION_CUT_WIDTH_PX) return null;

  return { gapStartFrames, gapEndFrames, compressedWidthPx: ENDING_ROTATION_CUT_WIDTH_PX };
}

// timeToPx with the Ending Rotation gap compressed. Use instead of timeToPx.
export function compressedTimeToPx(frames: number, compression: TimeCompression | null): number {
  if (!compression) return timeToPx(frames);
  const { gapStartFrames, gapEndFrames, compressedWidthPx } = compression;
  if (frames <= gapStartFrames) return timeToPx(frames);
  const gapStartPx = timeToPx(gapStartFrames);
  if (frames >= gapEndFrames) {
    const realGapWidthPx = timeToPx(gapEndFrames) - gapStartPx;
    return timeToPx(frames) - realGapWidthPx + compressedWidthPx;
  }
  // Inside the gap: interpolate.
  const gapFrames = gapEndFrames - gapStartFrames;
  const frac = gapFrames > 0 ? (frames - gapStartFrames) / gapFrames : 0;
  return gapStartPx + frac * compressedWidthPx;
}

// Inverse of compressedTimeToPx.
export function pxToCompressedTime(px: number, compression: TimeCompression | null): number {
  const pxToTime = (x: number) => secondsToFrames(Math.max(0, x) / PX_PER_SECOND);
  if (!compression) return pxToTime(px);
  const { gapStartFrames, gapEndFrames, compressedWidthPx } = compression;
  const gapStartPx = timeToPx(gapStartFrames);
  if (px <= gapStartPx) return pxToTime(px);
  if (px < gapStartPx + compressedWidthPx) return gapStartFrames + ((px - gapStartPx) / compressedWidthPx) * (gapEndFrames - gapStartFrames);
  return pxToTime(px - compressedWidthPx + (timeToPx(gapEndFrames) - gapStartPx));
}

export type SegmentType = 'onfield' | 'offfield' | 'wait' | 'motionstop';

// Another unit's motion stop pausing this row's move.
export interface MotionStopPause {
  gameTime: number;
  frames: number;
  by: string;
  moveName: string;
}

export interface TimelineSegment {
  type: SegmentType;
  xPx: number;
  widthPx: number;
  row: any;
  pause?: MotionStopPause;
}

export interface SimultaneousLine {
  xPx: number;
  widthPx: number;
  row: any;
}

export interface HitDot {
  xPx: number;
  yPx: number;
  row: any;
  // 1-based within its row.
  hitNumber: number;
  gameTime: number;
}

export interface UnitRowData {
  unit: string;
  slotIndex: number;
  themeColor: string;
  segments: TimelineSegment[];
  simultaneousLines: SimultaneousLine[];
  hitDots: HitDot[];
  withSystemHits: boolean;
  compression: TimeCompression | null;
}

function deriveSegments(rows: any[], compression: TimeCompression | null): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const pauseSegments: TimelineSegment[] = [];
  for (const row of rows) {
    // gameTimePassed is freeze-adjusted; duration is real time.
    const onStartX = compressedTimeToPx(row.gameTimeStart, compression);
    const onTrueEndX = compressedTimeToPx(row.gameTimeStart + row.gameTimePassed, compression);
    // Min width extends rightward.
    const onWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onTrueEndX - onStartX);
    const onRenderedEndX = onStartX + onWidthPx;
    segments.push({ type: 'onfield', xPx: onStartX, widthPx: onWidthPx, row });

    // Cooldown wait. An Animation Lock is drawn on the move it waits out (backOnFieldAt).
    if (row.waitTime > 0 && row.waitTime === row.cdWaitTime && row.timing !== 'Simultaneous') {
      const waitTrueStartX = compressedTimeToPx(row.gameTimeStart - row.waitTime, compression);
      const waitWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onStartX - waitTrueStartX);
      segments.push({ type: 'wait', xPx: onStartX - waitWidthPx, widthPx: waitWidthPx, row });
    }

    // Off-field tail, extended by motion stops.
    const pauses: MotionStopPause[] = row.motionStopPauses || [];
    const pausedFrames = pauses.reduce((sum, p) => sum + p.frames, 0);
    const frozen = frozenFramesWithin(row.animationCommitment, row.freezeStart || 0, row.freezeTime || 0);
    const animEndFrames = row.gameTimeStart + row.animationCommitment - frozen + pausedFrames;
    // Back on field before it ends: the rest plays on field.
    const offEndFrames = Math.min(animEndFrames, row.backOnFieldAt ?? Infinity);
    if (offEndFrames > row.gameTimeStart + row.gameTimePassed) {
      const offEndX = compressedTimeToPx(offEndFrames, compression);
      segments.push({ type: 'offfield', xPx: onRenderedEndX, widthPx: Math.max(MIN_CLIP_WIDTH_PX, offEndX - onRenderedEndX), row });
    }
    if (animEndFrames > offEndFrames && row.backOnFieldAt !== undefined) {
      const backX = compressedTimeToPx(offEndFrames, compression);
      segments.push({ type: 'onfield', xPx: backX, widthPx: Math.max(MIN_CLIP_WIDTH_PX, compressedTimeToPx(animEndFrames, compression) - backX), row });
    }

    for (const pause of pauses) {
      const startX = compressedTimeToPx(pause.gameTime, compression);
      const endX = compressedTimeToPx(pause.gameTime + pause.frames, compression);
      pauseSegments.push({ type: 'motionstop', xPx: startX, widthPx: Math.max(MIN_CLIP_WIDTH_PX, endX - startX), row, pause });
    }
  }
  // Last, to draw on top.
  return [...segments, ...pauseSegments];
}

// Line for a Simultaneous action, until its animation ends or its Release.
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

/** A System move that takes no game time (e.g. Tune Break). */
export const isInstantSystemRow = (row: any): boolean =>
  typeof row?.action === 'string' && row.action.startsWith(`${SYSTEM_NAMESPACE}_`) && !(row.gameTimePassed > 0);

export const isSystemHit = (hit: any): boolean => typeof hit.moveRef === 'string' && hit.moveRef.startsWith(`@${SYSTEM_NAMESPACE}(`);

// A row's hits in time order, optionally without System hits.
export const rowHits = (row: any, withSystemHits = true): any[] =>
  (row.damageInstances || [])
    .filter((hit: any) => withSystemHits || !isSystemHit(hit))
    .sort((a: any, b: any) => (a.gameTime ?? 0) - (b.gameTime ?? 0));

// Stacks same-time dots vertically within a band. `dots` must be sorted by x.
export function stackDots<T extends { xPx: number; yPx: number }>(dots: T[], bandTop: number, bandHeight: number): T[] {
  const centerY = bandTop + bandHeight / 2;
  const maxSpan = bandHeight - HIT_DOT_EDGE_PX * 2 - HIT_DOT_SIZE_PX;
  for (let start = 0; start < dots.length;) {
    let end = start + 1;
    while (end < dots.length && dots[end].xPx - dots[start].xPx < HIT_DOT_SAME_TIME_PX) end++;
    const count = end - start;
    const step = count > 1 ? Math.max(0, Math.min(HIT_DOT_GAP_PX, maxSpan / (count - 1))) : 0;
    for (let j = 0; j < count; j++) {
      dots[start + j].yPx = snapToDevicePixel(centerY + (j - (count - 1) / 2) * step);
    }
    start = end;
  }
  return dots;
}

function deriveHitDots(rows: any[], compression: TimeCompression | null, withSystemHits: boolean): HitDot[] {
  const dots: HitDot[] = rows.flatMap(row => rowHits(row, withSystemHits).map((hit, i) => ({
    xPx: compressedTimeToPx(hit.gameTime ?? row.gameTimeStart, compression),
    yPx: 0,
    row,
    hitNumber: i + 1,
    gameTime: hit.gameTime ?? row.gameTimeStart
  })));
  dots.sort((a, b) => a.xPx - b.xPx);
  return stackDots(dots, CLIP_INSET_PX, CLIP_HEIGHT_PX);
}

// Per-unit clips, Simultaneous lines and hit dots.
export function buildUnitRows(
  evaluatedRows: any[],
  team: TeamSlot[],
  compression: TimeCompression | null = null,
  withSystemHits = true
): UnitRowData[] {
  const unitRows: UnitRowData[] = [];
  team.forEach((slot, slotIndex) => {
    if (!slot.character) return;
    const rows = evaluatedRows.filter(r => r.unit === slot.character && (withSystemHits || !isInstantSystemRow(r)));
    unitRows.push({
      unit: slot.character,
      slotIndex,
      themeColor: getCharacterThemeColor(DataLoader.characterDB[slot.character]),
      segments: deriveSegments(rows, compression),
      simultaneousLines: deriveSimultaneousLines(rows, compression),
      hitDots: deriveHitDots(rows, compression, withSystemHits),
      withSystemHits,
      compression
    });
  });
  return unitRows;
}

export type FlagType = 'swap' | 'input';

// Whether an input can be mashed early ('spam') or must wait ('wait').
export type SpamState = 'spam' | 'wait';

export interface TimelineFlag {
  type: FlagType;
  timeFrames: number;
  label: string;
  prefix?: 'Hold' | 'Release';
  // Glyph shown instead of key text.
  icon?: 'mouse-left';
  spamState?: SpamState;
  row: any;
  themeColor: string;
  // Hold carried across moves: the input is held until this game time.
  holdUntilFrames?: number;
}

export interface LaidOutFlag extends TimelineFlag {
  xPx: number;
  widthPx: number;
  lane: number;
  // Hold bar width (holdUntilFrames), px.
  holdWidthPx?: number;
}

export const flagTrackHeightPx = (flags: LaidOutFlag[]): number =>
  Math.max(FLAG_TRACK_MIN_HEIGHT_PX, (Math.max(-1, ...flags.map(f => f.lane)) + 1) * LANE_HEIGHT_PX);

// 'spam' if the previous move outranks this one or it's a combo continuation; else 'wait'.
function describeSpamState(prevRow: any, row: any): SpamState | undefined {
  if (!prevRow) return undefined;
  if (prevRow.input === row.input && (prevRow.inputType || 'Press') === (row.inputType || 'Press')) return 'spam';
  const prevPriority = Number(prevRow.priority) || 0;
  const priority = Number(row.priority) || 0;
  return prevPriority > priority ? 'spam' : 'wait';
}

// One flag per input, plus a unit number on each swap.
export function buildFlags(evaluatedRows: any[], team: TeamSlot[]): TimelineFlag[] {
  const flags: TimelineFlag[] = [];
  let prevUnit: string | null = null;
  let prevRow: any = null;
  // The unit's last non-Simultaneous row, and the flag of the hold it may carry on.
  let unitPrev: any = null;
  let holdFlag: TimelineFlag | null = null;

  for (const row of evaluatedRows) {
    if (!row.unit) continue;
    const themeColor = getCharacterThemeColor(DataLoader.characterDB[row.unit]);

    if (prevUnit !== null && prevUnit !== row.unit) {
      unitPrev = null;
      holdFlag = null;
      const slotIndex = team.findIndex(s => s.character === row.unit);
      if (slotIndex >= 0) {
        flags.push({ type: 'swap', timeFrames: row.gameTimeStart, label: `${slotIndex + 1}`, row, themeColor });
      }
    }

    if (row.input && holdFlag && continuesHold(row, unitPrev)) {
      // Still held: no new press, the hold's bar runs on.
      holdFlag.holdUntilFrames = rowGameEnd(row);
    } else if (row.input) {
      const prefix = row.inputType === 'Hold' || row.inputType === 'Release' ? row.inputType : undefined;
      const icon = row.input === 'Basic' ? 'mouse-left' : undefined;
      const spamState = describeSpamState(prevRow, row);
      const flag: TimelineFlag = { type: 'input', timeFrames: row.gameTimeStart, label: describeInput(row), prefix, icon, spamState, row, themeColor };
      flags.push(flag);
      holdFlag = row.inputType === 'Hold' && row.timing !== 'Simultaneous' ? flag : null;
    }

    prevUnit = row.unit;
    prevRow = row;
    if (row.timing !== 'Simultaneous') unitPrev = row;
  }

  // A one-move hold has no bar.
  flags.forEach(f => { if (f.holdUntilFrames !== undefined && f.holdUntilFrames <= rowGameEnd(f.row)) delete f.holdUntilFrames; });
  return flags;
}

// Character-count estimate instead of measureText.
function estimateLabelWidthPx(label: string): number {
  return Math.max(FLAG_MIN_WIDTH_PX, label.length * FLAG_CHAR_WIDTH_PX + FLAG_LABEL_PADDING_PX * 2);
}

const ICON_SIZE_PX = 11;
const ICON_GAP_PX = 3;

function estimateFlagWidthPx(flag: TimelineFlag): number {
  if (!flag.icon) return estimateLabelWidthPx(flag.label);
  const prefixWidth = flag.prefix ? flag.prefix.length * FLAG_CHAR_WIDTH_PX + ICON_GAP_PX : 0;
  return Math.max(FLAG_MIN_WIDTH_PX, prefixWidth + ICON_SIZE_PX + FLAG_LABEL_PADDING_PX * 2);
}

// Greedy lane assignment by x.
export function assignFlagLanes(flags: TimelineFlag[], compression: TimeCompression | null = null): LaidOutFlag[] {
  const positioned = flags
    .map(f => {
      const xPx = compressedTimeToPx(f.timeFrames, compression);
      const holdWidthPx = f.holdUntilFrames !== undefined ? compressedTimeToPx(f.holdUntilFrames, compression) - xPx : undefined;
      // A hold bar keeps its lane clear.
      return { ...f, xPx, holdWidthPx, widthPx: Math.max(estimateFlagWidthPx(f), holdWidthPx ?? 0) };
    })
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

// Ruler ticks every 0.25s, labeled each second.
export function generateTicks(totalFrames: number, compression: TimeCompression | null = null): Tick[] {
  const ticks: Tick[] = [];
  for (let f = 0; f <= totalFrames; f += FPS / 4) {
    if (compression && f > compression.gapStartFrames && f < compression.gapEndFrames) continue;
    const tier: TickTier = f % FPS === 0 ? 'major' : f % (FPS / 2) === 0 ? 'secondary' : 'minor';
    ticks.push({
      frames: f,
      xPx: compressedTimeToPx(f, compression),
      tier,
      label: tier === 'major' ? `${Math.round(framesToSeconds(toFrames(f)))}s` : undefined
    });
  }
  return ticks;
}

// Rounded up to a whole second.
export function computeTotalDurationFrames(evaluatedRows: any[]): number {
  let max = 0;
  for (const row of evaluatedRows) {
    if (!row.unit) continue;
    max = Math.max(max, row.gameTimeStart + row.animationCommitment);
  }
  return Math.ceil(max / FPS) * FPS;
}

export function describeInput(row: any): string {
  if (!row.input) return 'None';
  const keyLabel = INPUT_KEY_MAP[row.input] || row.input;
  if (row.inputType === 'Hold') return `Hold ${keyLabel}`;
  if (row.inputType === 'Release') return `Release ${keyLabel}`;
  return keyLabel;
}
