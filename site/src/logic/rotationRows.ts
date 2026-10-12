// A rotation row's shape and the small pure helpers around it. Kept free of store imports so
// both useRotationStore and HistoryManager's commands can build and read rows the same way.

// A row's authored fields, without the local-only `id`.
import { toFrames } from '../utils/Frames';

/** The 2-Min DPS window, in frames. */
export const TWO_MIN = toFrames(120 * 60);

export interface RotationRowFields {
  unit: string;
  action: string;
  timing: string;
  offset?: number;
  manualOffset?: number;
  loopStartOverride?: boolean;
  loopEndOverride?: boolean;
  // A sub-loop starts at this row (true), or not even where one would be auto-detected (false);
  // unset follows the auto-detection (see loopSplitStarts).
  loopSplit?: boolean;
  // A Hold Repeat block's boundary rows -- both carry the same groupId, so multiple independent
  // blocks can coexist (unlike loopStartOverride/loopEndOverride, which are rotation-wide
  // singletons). repeatCount lives on the start row only.
  repeatBlockStart?: string;
  repeatBlockEnd?: string;
  repeatCount?: number;
  // Overrides `timing` on just the LAST repetition's copy of the end row (e.g. the final rep
  // needs "Full" instead of "Auto" to not get cut short before an Outro) -- lives on the end
  // row only, like repeatCount lives on the start row. Unset means every rep uses the row's own
  // `timing` uniformly.
  repeatFinalTiming?: string;
  [key: string]: any;
}

export interface RotationRow extends RotationRowFields {
  // Local-only React list key; selection/drag/loop markers still address rows by array position.
  id: string;
}

// Every field a Hold Repeat block puts on a row.
export const REPEAT_FIELDS = ['repeatBlockStart', 'repeatBlockEnd', 'repeatCount', 'repeatFinalTiming'] as const;

// A new block repeats twice until the user says otherwise.
export const DEFAULT_REPEAT_COUNT = 2;

// Builds a fresh row (with a new id) ready for AddRowCommand.
export const makeRow = (fields: Partial<RotationRowFields> & { unit: string; action: string; timing: string }): RotationRow => ({
  id: crypto.randomUUID(),
  offset: 0,
  ...fields
});

// The empty trailing row the rotation always ends on.
export const makeBlankRow = (): RotationRow => makeRow({ unit: '', action: '', timing: 'Auto' });

// Just `keys` off a row, as the old-value / new-value maps an EditFieldsCommand takes.
export const pickFields = (row: RotationRowFields, keys: readonly string[]): Record<string, any> =>
  Object.fromEntries(keys.map(key => [key, row[key]]));

// A pasted or copied repeat block gets fresh groupId(s) of its own -- never reuses the source's,
// which likely still exists elsewhere and would otherwise end up sharing one groupId across two
// independent blocks (findBlocks assumes one start/end pair per id). Each call makes a remapper
// to share across every row being copied, so a block's start+end (or a 1-row block's shared
// start===end id) still land on the same new groupId as each other.
export const createGroupIdRemapper = () => {
  const remapped = new Map<string, string>();
  return (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    if (!remapped.has(id)) remapped.set(id, crypto.randomUUID());
    return remapped.get(id);
  };
};

// The row with its repeat block ids passed through `remap` (from createGroupIdRemapper).
export const withRemappedGroupIds = <T extends RotationRowFields>(row: T, remap: (id: string | undefined) => string | undefined): T =>
  ({ ...row, repeatBlockStart: remap(row.repeatBlockStart), repeatBlockEnd: remap(row.repeatBlockEnd) });

// The row without its repeat block fields.
export const withoutRepeatFields = <T extends RotationRowFields>(row: T): T => {
  const copy = { ...row };
  for (const key of REPEAT_FIELDS) delete copy[key];
  return copy;
};

const repeatFieldsOf = (row: RotationRowFields) => ({
  ...(row.repeatBlockStart !== undefined && { repeatBlockStart: row.repeatBlockStart, repeatCount: row.repeatCount }),
  ...(row.repeatBlockEnd !== undefined && { repeatBlockEnd: row.repeatBlockEnd, ...(row.repeatFinalTiming !== undefined && { repeatFinalTiming: row.repeatFinalTiming }) })
});

// Narrower views of a row, none carrying `id`.
export const toClipboardRow = (row: RotationRowFields) => ({
  unit: row.unit,
  action: row.action,
  timing: row.timing,
  ...repeatFieldsOf(row)
});

export const toSavedRow = (row: RotationRowFields) => ({
  unit: row.unit,
  action: row.action,
  timing: row.timing,
  ...(row.loopStartOverride === true && { loopStartOverride: true }),
  ...(row.loopEndOverride === true && { loopEndOverride: true }),
  ...(typeof row.loopSplit === 'boolean' && { loopSplit: row.loopSplit }),
  ...repeatFieldsOf(row)
});

export const toPersistedRow = (row: RotationRowFields) => ({
  ...toSavedRow(row),
  ...(row.offset !== undefined && { offset: row.offset }),
  ...(row.manualOffset !== undefined && { manualOffset: row.manualOffset })
});

// Rows as a fresh engine run: each row's authored fields and offsets only (no evaluated state or
// markers), plus the empty trailing row TimelineEngine.recalculateState expects last.
export const toRunInput = (rows: RotationRowFields[]): RotationRowFields[] => [
  ...rows.map(row => ({
    unit: row.unit,
    action: row.action,
    timing: row.timing,
    ...(row.offset !== undefined && { offset: row.offset }),
    ...(row.manualOffset !== undefined && { manualOffset: row.manualOffset })
  })),
  { unit: '', action: '', timing: 'Auto', offset: 0 }
];

// --- Evaluated rows (after an engine run) ---

/** When a row's game time runs out (0 for no row). */
export const rowGameEnd = (row: any): number => (row?.gameTimeStart || 0) + (row?.gameTimePassed || 0);

/** The row carrying the loop-end marker (the Ending Rotation split), or -1. */
export const loopEndIndexOf = (rows: any[]): number => rows.findIndex(r => r?.loopEndOverride === true);

/** A row's timing as shown: "Auto (Cancel)", "Full", "Cancel 0"... */
export const timingLabel = (row: any): string =>
  !row.timing || row.timing === 'Auto'
    ? row._autoTimingChoice ? `Auto (${row._autoTimingChoice})` : 'Auto'
    : String(row.timing).replace('_', ' ');

/**
 * Content rows split into opener, loop template and -- with Ending Rotation on and a loop-end
 * marker before the last row -- the ending rows after it.
 */
export function splitLoopSegments(
  contentRows: any[],
  loopStartIndex: number,
  endingRotationEnabled: boolean
): { openerRows: any[]; loopTemplate: any[]; endingRows: any[] } {
  const clampedStart = Math.max(0, Math.min(loopStartIndex, contentRows.length));
  const openerRows = contentRows.slice(0, clampedStart);
  const loopTemplate = contentRows.slice(clampedStart);
  const endRel = endingRotationEnabled ? loopEndIndexOf(loopTemplate) : -1;
  if (endRel === -1 || endRel === loopTemplate.length - 1) return { openerRows, loopTemplate, endingRows: [] };
  return { openerRows, loopTemplate: loopTemplate.slice(0, endRel + 1), endingRows: loopTemplate.slice(endRel + 1) };
}

/**
 * Where the loop's sub-loops start, as indices into `loopTemplate` (0, the loop's own start, left
 * out): a loop that's really two or more cycles, e.g. A uses Tune Break once and B twice. Auto-
 * detected as the row after each main DPS Outro (as findLoopStart finds the loop itself), unless
 * that row's `loopSplit` is false; a row with `loopSplit: true` starts one regardless. Reads
 * castTypes, so `loopTemplate` must be already-run rows.
 */
export function loopSplitStarts(loopTemplate: any[], mainDps: string | undefined): number[] {
  const starts: number[] = [];
  for (let i = 1; i < loopTemplate.length; i++) {
    const row = loopTemplate[i];
    if (row?.loopSplit === false) continue;
    const prev = loopTemplate[i - 1];
    const afterMainOutro = !!mainDps && prev?.unit === mainDps && Array.isArray(prev.castTypes) && prev.castTypes.includes('Outro');
    if (row?.loopSplit === true || afterMainOutro) starts.push(i);
  }
  return starts;
}

/** Where each sub-loop ends, as indices into `loopTemplate` (one past its last row); the last is the loop's own end. */
export const loopCycleBounds = (loopTemplate: any[], mainDps: string | undefined): number[] =>
  [...loopSplitStarts(loopTemplate, mainDps), loopTemplate.length];

/** Where each sub-loop after the first starts, as indices into the table's `rows`. */
export function loopSplitRowIndices(rows: any[], loopStartIndex: number, endingRotationEnabled: boolean, mainDps: string | undefined): number[] {
  const contentIndices = rows.flatMap((row, i) => (row?.unit ? [i] : []));
  const { openerRows, loopTemplate } = splitLoopSegments(contentIndices.map(i => rows[i]), loopStartIndex, endingRotationEnabled);
  return loopSplitStarts(loopTemplate, mainDps).map(rel => contentIndices[openerRows.length + rel]);
}

// Where Ending Rotation starts: after `reps` whole loops, plus the first `partialRows` rows of the
// next one -- a whole number of its sub-loops (loopSplitStarts), so a loop that's really two cycles
// can end on either. As many sub-loops as fit in what's left of 120s (floor, not ceil, so it fills
// the time rather than a truncated loop), at least one; one fewer with endRotationStartsEarlier,
// so it replaces/extends the final one. The table's preview and the Results pass both use this.
export function endingPlacement(
  openerRows: any[],
  loopTemplate: any[],
  mainDps: string | undefined,
  endRotationStartsEarlier: boolean
): { reps: number; partialRows: number } {
  const { openerEnd, loopDuration } = loopTiming(openerRows, loopTemplate);
  const bounds = loopCycleBounds(loopTemplate, mainDps);
  // Each sub-loop's end, from the loop's start, off the table's single rep.
  const subEnds = bounds.map(b => rowGameEnd(loopTemplate[b - 1]) - openerEnd);
  const left = TWO_MIN - openerEnd;
  const wholeLoops = Math.max(0, Math.floor(left / loopDuration));
  const remainder = left - wholeLoops * loopDuration;
  const fitting = wholeLoops * bounds.length + subEnds.slice(0, -1).filter(end => end <= remainder).length;
  const units = Math.max(1, fitting - (endRotationStartsEarlier ? 1 : 0));
  const partialUnits = units % bounds.length;
  return { reps: Math.floor(units / bounds.length), partialRows: partialUnits === 0 ? 0 : bounds[partialUnits - 1] };
}

/** When the opener ends and how long one loop takes, off already-run rows. */
export function loopTiming(openerRows: any[], loopTemplate: any[]): { openerEnd: number; loopDuration: number } {
  const openerEnd = rowGameEnd(openerRows[openerRows.length - 1]);
  return { openerEnd, loopDuration: rowGameEnd(loopTemplate[loopTemplate.length - 1]) - openerEnd };
}

/** Opener, `reps` copies of the loop, then the ending rows. */
export const repeatLoop = (openerRows: any[], loopTemplate: any[], reps: number, endingRows: any[] = []): any[] =>
  [...openerRows, ...Array.from({ length: reps }, () => loopTemplate).flat(), ...endingRows];
