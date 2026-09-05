// src/components/timeline/timelineLayout.ts
// Pure layout math for the rotation Timeline -- no React/DOM here, so it stays trivially
// testable and reusable by every future call site independent of how they fetch/render it.
// Everything reads off already-recalculated rows (TimelineEngine.recalculateState output, or
// the worker's 'recalculate' response) -- see TimelineEngine.ts for what each field means.
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
// A flag's own label box height -- deliberately shorter than LANE_HEIGHT_PX so a visible gap
// (LANE_HEIGHT_PX - FLAG_LABEL_HEIGHT_PX) separates one lane's label from the next lane's, and
// so its own pole (which starts right at this height, see RotationTimeline.tsx) reads as
// unambiguously "belonging" to it rather than blurring into whichever label sits in the lane
// below. Duplicated as an explicit height in timeline.css's .timeline-flag-label -- keep both in
// sync if this changes.
export const FLAG_LABEL_HEIGHT_PX = 20;
export const FLAG_TRACK_MIN_HEIGHT_PX = LANE_HEIGHT_PX;

const FLAG_CHAR_WIDTH_PX = 5.5;
const FLAG_LABEL_PADDING_PX = 2;
const FLAG_MIN_WIDTH_PX = 12;
const FLAG_LANE_GAP_PX = 6;
// Comfortably larger than the (device-pixel-snapped) gap inset applied around each clip's fill
// -- a segment narrower than that would have its fill insets meet or cross, collapsing it to
// zero width and vanishing entirely (which reads as one much wider gap right there, next to
// normal gaps everywhere else).
const MIN_CLIP_WIDTH_PX = 4;

// Rounding to a whole *CSS* pixel isn't enough on its own: at a fractional devicePixelRatio
// (e.g. 1.25, from 125% Windows display scaling -- very common), a "whole" CSS pixel still maps
// to a fractional number of actual screen pixels, so the browser has to anti-alias every edge,
// and exactly how much blur each edge gets depends on that edge's own position relative to the
// physical pixel grid -- different clips land differently, so otherwise-identical gaps/line
// widths read as inconsistent from one to the next. Snapping to the nearest whole *device*
// pixel (expressed back in CSS px) instead makes every edge land exactly on a physical pixel
// boundary, so nothing needs blurring and every instance renders identically crisp.
function getDevicePixelRatio(): number {
  return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
}

export function snapToDevicePixel(px: number): number {
  const dpr = getDevicePixelRatio();
  return Math.round(px * dpr) / dpr;
}

// The visual gap between adjacent clips (TimelineClip.tsx insets its fill by this on each
// side) and the width of a flag pole / the loop-start line -- both nominally "1px", snapped to
// whatever CSS value actually renders as exactly 1 device pixel on this screen. Functions, not
// frozen constants -- devicePixelRatio can change after this module first loads (moving the
// window to a different-DPI monitor, the OS scale setting changing), so these need to read it
// fresh on every call rather than baking in whatever it happened to be at import time.
export function hairlinePx(): number {
  return snapToDevicePixel(1);
}
// The bottom-of-row Simultaneous-action indicator's thickness -- same snapping, same reason.
export function simultaneousLineHeightPx(): number {
  return snapToDevicePixel(3);
}

export function timeToPx(frames: number): number {
  return snapToDevicePixel(framesToSeconds(toFrames(frames)) * PX_PER_SECOND);
}

// A fixed, compact width for the Ending Rotation's "fast forward" jump -- deliberately NOT
// proportional to the real (potentially huge, many-silently-repeated-loops') time it represents.
// Rendering that gap at its true width is just a long stretch of empty timeline that happens to
// be decorated, not a "skip ahead" -- a real video editor's jump-cut/speed-ramp marker is always
// a small, fixed-size indicator regardless of how much time it actually elides. compressedTimeToPx
// below is what actually enforces this: every frame in the gap collapses into this many pixels,
// and everything after the gap shifts left to sit immediately against it, rather than one
// decorative element being resized while its neighbors keep their true (huge) positions -- that
// would leave it visually disconnected from the content right after it.
export const ENDING_ROTATION_CUT_WIDTH_PX = 48;

export interface TimeCompression {
  gapStartFrames: number;
  gapEndFrames: number;
  compressedWidthPx: number;
}

// Mirrors RotationBuilder.tsx's/RotationTimeline.tsx's own loopEndOverride + row-adjacency
// derivation exactly, so the row table and this Timeline can never disagree about where an
// Ending Rotation split sits. Returns null when there's no split, or when the real gap is
// already smaller than the compressed width (nothing to compress -- compressing it would
// paradoxically stretch a short gap out instead of shrinking a long one).
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

// Same as timeToPx, but every frame inside [gapStartFrames, gapEndFrames) collapses into a
// fixed compressedWidthPx-wide band, and every frame at/after gapEndFrames shifts left by
// however much real width that collapse removed -- so content right after the gap sits right
// after the (now compact) band instead of stranded out at its true, huge offset. Every x/width
// calculation in this module should route through this instead of calling timeToPx directly, so
// the whole layout -- clips, flags, ticks, total width -- agrees on the same compressed axis.
export function compressedTimeToPx(frames: number, compression: TimeCompression | null): number {
  if (!compression) return timeToPx(frames);
  const { gapStartFrames, gapEndFrames, compressedWidthPx } = compression;
  if (frames <= gapStartFrames) return timeToPx(frames);
  const gapStartPx = timeToPx(gapStartFrames);
  if (frames >= gapEndFrames) {
    const realGapWidthPx = timeToPx(gapEndFrames) - gapStartPx;
    return timeToPx(frames) - realGapWidthPx + compressedWidthPx;
  }
  // Falls inside the gap -- only reached by a tick about to be filtered out (see generateTicks)
  // or a defensive/edge-case caller; interpolate proportionally within the compressed band
  // rather than returning something outside [gapStartPx, gapStartPx + compressedWidthPx].
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
    // The on-field clip must end where the action actually finishes *in game time*, not
    // row.duration (a real-time-domain value -- it includes any freeze-frame time the move's
    // animation has, which pauses the game clock but not the real-world one). gameTimePassed is
    // the engine's own freeze-adjusted figure (TimelineEngine.ts: `duration - freezeTime`), so
    // it's used directly rather than re-deriving the subtraction here.
    const onStartX = compressedTimeToPx(row.gameTimeStart, compression);
    const onTrueEndX = compressedTimeToPx(row.gameTimeStart + row.gameTimePassed, compression);
    // Below the min-width floor, extend rightward (not the true end) so this clip's start stays
    // anchored to the actual game-time boundary shared with the wait segment before it.
    const onWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onTrueEndX - onStartX);
    const onRenderedEndX = onStartX + onWidthPx;
    segments.push({ type: 'onfield', xPx: onStartX, widthPx: onWidthPx, row });

    if (row.waitTime > 0 && row.timing !== 'Simultaneous') {
      // Anchored to onStartX (the shared, fixed boundary) and extended *backward* when floored,
      // so a floored wait clip can never creep forward into the on-field clip it precedes.
      const waitTrueStartX = compressedTimeToPx(row.gameTimeStart - row.waitTime, compression);
      const waitWidthPx = Math.max(MIN_CLIP_WIDTH_PX, onStartX - waitTrueStartX);
      segments.push({ type: 'wait', xPx: onStartX - waitWidthPx, widthPx: waitWidthPx, row });
    }

    // Off-field tail: animationCommitment is likewise a real-time-domain busy-duration (it's
    // added to row.timeStart, not gameTimeStart, for TimelineEngine's own unitBusyUntil) -- the
    // same freeze-time subtraction TimelineEngine.ts applies when converting a hit's real-time
    // executeAt into game time is applied here to land it on this timeline's game-time axis.
    // Anchored to onRenderedEndX (not the true, unfloored on-field end) so a floored on-field
    // clip can never overlap the off-field tail that follows it.
    const offEndFrames = row.gameTimeStart + Math.max(0, row.animationCommitment - (row.freezeTime || 0));
    if (offEndFrames > row.gameTimeStart + row.gameTimePassed) {
      const offEndX = compressedTimeToPx(offEndFrames, compression);
      segments.push({ type: 'offfield', xPx: onRenderedEndX, widthPx: Math.max(MIN_CLIP_WIDTH_PX, offEndX - onRenderedEndX), row });
    }
  }
  return segments;
}

// Simultaneous rows already get their normal on-field/off-field clip from deriveSegments above
// (which may visually overlap the previous action's clip on this same row -- expected, since a
// Simultaneous action genuinely starts before the previous one finishes). This adds a thin
// bottom-of-row line marking how long the simultaneous action itself actually runs: until its
// own animation finishes, or -- for a Hold-type simultaneous action (e.g. a Forte Hold Press
// starting mid-combo) -- until the matching Release row fires later in the rotation.
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

// Whether this row's own input can be safely mashed ahead of time ('spam') or has to actually be
// waited for ('wait') -- see describeSpamState below for the priority comparison this comes from.
export type SpamState = 'spam' | 'wait';

export interface TimelineFlag {
  type: FlagType;
  timeFrames: number;
  // Full text form -- always populated (used for the lane-width estimate's fallback path, and
  // as this flag's accessible/tooltip text) even when `icon` means it isn't rendered directly.
  label: string;
  // Shown as text before the icon/key -- only for a Hold/Release input flag.
  prefix?: 'Hold' | 'Release';
  // When set, the flag renders this glyph instead of writing the key out (e.g. a mouse icon
  // instead of the text "Left Click").
  icon?: 'mouse-left';
  // Only set for 'input' flags with a previous row to compare against -- see describeSpamState.
  spamState?: SpamState;
  row: any;
  // Whichever unit is acting when this input/swap happens -- e.g. for a swap flag, the
  // character being swapped *to*, since that's who the "Press N" belongs to.
  themeColor: string;
}

export interface LaidOutFlag extends TimelineFlag {
  xPx: number;
  widthPx: number;
  lane: number;
}

// One flag per unit-swap boundary (labeled with whichever team slot is being swapped to) and
// one per row whose resolved mechanic carries an `input` tag. Only Hold/Release call that out
// explicitly ("Hold E", "Release Q") -- a plain press is just the key name, since that's the
// default and doesn't need spelling out. Both a swap and an input flag can land on the same row
// (swapping in and immediately pressing something) -- they're never merged, just laid out
// independently by assignFlagLanes below. A default swap-in move (e.g. an Intro cast) naturally
// produces no input flag of its own, since those mechanics carry no `input` tag in the first
// place -- no special-casing needed here.
// Whether mashing this row's key ahead of time is safe, based on comparing this row's own
// (TimelineEngine-resolved) cancel priority against the immediately preceding row's. Priority is
// a per-category cancel tier (Basic < Heavy < Skill < Echo < Dodge/Jump < Liberation < Intro <
// Outro, see GAME_DEFAULTS in db.ts) -- a strictly higher-tier action can always cut off whatever
// is currently playing, which is a real DPS risk if it's thrown out too early (e.g. spamming
// Dodge mid-Basic-Attack can cancel that Basic Attack's remaining hits before they land), so:
//  - prev priority > this priority -> the currently-playing move outranks this row's own action,
//    which therefore *can't* preempt it -- pressing/mashing this key early costs nothing (it'll
//    simply fire the instant the higher-tier move naturally ends), safe to spam ('spam').
//  - prev priority <= this priority -> this row's own action is at least as high tier as what's
//    playing, so it's capable of cutting it short the moment it's pressed -- mash it too early
//    and you risk losing whatever's left of the current move's damage, so the player should
//    actually wait for it ('wait').
// Exception: a row that shares its (input, inputType) with the immediately preceding row is a
// same-string combo continuation (e.g. a Basic Attack's own hit 2 following hit 1), not a real
// cross-category cancel contest -- priority still increments across a combo string's own hits,
// but purely to break ties in the rotation dropdown when several are valid at once (see
// RotationRow.tsx's getActionGroups), not to signal early-cancel risk between them. Those are
// always safe to mash forward through, regardless of the raw priority numbers.
// No previous row (the rotation's first action) has nothing to compare against.
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
      // Basic (left click) is drawn as a mouse-with-filled-left-button icon instead of writing
      // "Left Click" out -- see MouseClickIcon.tsx -- since it's by far the most frequent input
      // and the text version ate the most flag-track width.
      const icon = row.input === 'Basic' ? 'mouse-left' : undefined;
      const spamState = describeSpamState(prevRow, row);
      flags.push({ type: 'input', timeFrames: row.gameTimeStart, label, prefix, icon, spamState, row, themeColor });
    }

    prevUnit = row.unit;
    prevRow = row;
  }

  return flags;
}

// A pure, synchronous character-count heuristic instead of an offscreen-canvas measureText pass
// -- the flag label vocabulary is small and fixed ("Hold Shift", "1"/"2"/"3"), so generous
// padding plus the lane-gap buffer in assignFlagLanes tolerates the estimate's slack, and this
// stays a plain function of the label string (no DOM, no font-load race, no mount-then-remeasure
// render pass).
function estimateLabelWidthPx(label: string): number {
  return Math.max(FLAG_MIN_WIDTH_PX, label.length * FLAG_CHAR_WIDTH_PX + FLAG_LABEL_PADDING_PX * 2);
}

const ICON_SIZE_PX = 11;
const ICON_GAP_PX = 3;

// An icon flag (currently just the mouse-left-click glyph) reserves far less lane width than
// its text label would have -- computed from the icon's own fixed size plus any Hold/Release
// prefix text, not from `label.length` (which still holds the full "Left Click" wording, kept
// around as this flag's accessible/tooltip text even though it isn't drawn).
export function estimateFlagWidthPx(flag: TimelineFlag): number {
  if (!flag.icon) return estimateLabelWidthPx(flag.label);
  const prefixWidth = flag.prefix ? flag.prefix.length * FLAG_CHAR_WIDTH_PX + ICON_GAP_PX : 0;
  return Math.max(FLAG_MIN_WIDTH_PX, prefixWidth + ICON_SIZE_PX + FLAG_LABEL_PADDING_PX * 2);
}

// Greedy interval-partitioning: sort by x (stable sort keeps same-timestamp flags in emission
// order, so a swap flag always lands before its co-timed input flag), then place each flag in
// the first lane whose last-occupied edge has cleared this flag's start, else open a new lane.
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

// Frame-domain loop (not repeated float-second addition) -- 60fps divides evenly into all three
// intervals (major=60f/1s, secondary=30f/0.5s, minor=15f/0.25s), so there's no drift to guard
// against.
export function generateTicks(totalFrames: number, compression: TimeCompression | null = null): Tick[] {
  const ticks: Tick[] = [];
  for (let f = 0; f <= totalFrames; f += 15) {
    // Skip ticks that fall strictly inside the compressed gap -- crammed into a ~48px band at
    // 0.25s resolution they'd be illegible, and their spacing would imply real elapsed time that
    // compressedTimeToPx no longer represents there (the whole point of compressing it).
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

// Rounded up to the next whole second so the ruler's last major tick covers the full rendered
// width instead of stopping mid-second.
export function computeTotalDurationFrames(evaluatedRows: any[]): number {
  let max = 0;
  for (const row of evaluatedRows) {
    if (!row.unit) continue;
    max = Math.max(max, row.gameTimeStart + row.animationCommitment);
  }
  return Math.ceil(max / 60) * 60;
}

// Replicates TimelineEngine.ts's own inline `timingLabel` derivation exactly (the same string
// it already uses internally for offset-reason labels), so the hover tooltip's "time
// modification" text matches the app's existing vocabulary instead of inventing new wording.
export function describeTiming(row: any): string {
  if (row.timing === 'Auto') {
    return row._autoTimingChoice ? `Auto (${row._autoTimingChoice})` : 'Auto';
  }
  return String(row.timing || 'Auto').replace('_', ' ');
}

// Same label convention buildFlags uses for the input-press flags -- "None" for a move with no
// `input` tag (e.g. a default swap-in Intro cast), otherwise "Hold/Release <key>" or just the
// key name for a plain press.
export function describeInput(row: any): string {
  if (!row.input) return 'None';
  const keyLabel = INPUT_KEY_MAP[row.input] || row.input;
  if (row.inputType === 'Hold') return `Hold ${keyLabel}`;
  if (row.inputType === 'Release') return `Release ${keyLabel}`;
  return keyLabel;
}
