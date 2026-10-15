// Rotation row shape and pure helpers. No store imports.

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
  // true: sub-loop starts here; false: suppress auto split; unset: auto.
  loopSplit?: boolean;
  // Hold Repeat block boundaries share a groupId. repeatCount is on the start row.
  repeatBlockStart?: string;
  repeatBlockEnd?: string;
  repeatCount?: number;
  // End row only: `timing` override for the last repetition.
  repeatFinalTiming?: string;
  [key: string]: any;
}

export interface RotationRow extends RotationRowFields {
  // Local-only React key.
  id: string;
}

export const REPEAT_FIELDS = ['repeatBlockStart', 'repeatBlockEnd', 'repeatCount', 'repeatFinalTiming'] as const;

export const DEFAULT_REPEAT_COUNT = 2;

export const makeRow = (fields: Partial<RotationRowFields> & { unit: string; action: string; timing: string }): RotationRow => ({
  id: crypto.randomUUID(),
  offset: 0,
  ...fields
});

export const makeBlankRow = (): RotationRow => makeRow({ unit: '', action: '', timing: 'Auto' });

export const pickFields = (row: RotationRowFields, keys: readonly string[]): Record<string, any> =>
  Object.fromEntries(keys.map(key => [key, row[key]]));

// Maps repeat block groupIds to fresh ones; share one remapper across all copied rows.
export const createGroupIdRemapper = () => {
  const remapped = new Map<string, string>();
  return (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    if (!remapped.has(id)) remapped.set(id, crypto.randomUUID());
    return remapped.get(id);
  };
};

export const withRemappedGroupIds = <T extends RotationRowFields>(row: T, remap: (id: string | undefined) => string | undefined): T =>
  ({ ...row, repeatBlockStart: remap(row.repeatBlockStart), repeatBlockEnd: remap(row.repeatBlockEnd) });

export const withoutRepeatFields = <T extends RotationRowFields>(row: T): T => {
  const copy = { ...row };
  for (const key of REPEAT_FIELDS) delete copy[key];
  return copy;
};

const repeatFieldsOf = (row: RotationRowFields) => ({
  ...(row.repeatBlockStart !== undefined && { repeatBlockStart: row.repeatBlockStart, repeatCount: row.repeatCount }),
  ...(row.repeatBlockEnd !== undefined && { repeatBlockEnd: row.repeatBlockEnd, ...(row.repeatFinalTiming !== undefined && { repeatFinalTiming: row.repeatFinalTiming }) })
});

// Row views without `id`.
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

// Authored fields only, plus the trailing blank row the engine expects.
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

export const rowGameEnd = (row: any): number => (row?.gameTimeStart || 0) + (row?.gameTimePassed || 0);

/** Index of the loop-end marker row, or -1. */
export const loopEndIndexOf = (rows: any[]): number => rows.findIndex(r => r?.loopEndOverride === true);

/** e.g. "Auto (Cancel)", "Full", "Cancel 0". */
export const timingLabel = (row: any): string =>
  !row.timing || row.timing === 'Auto'
    ? row._autoTimingChoice ? `Auto (${row._autoTimingChoice})` : 'Auto'
    : String(row.timing).replace(/^SwapCancel_/, 'Swap + Cancel ').replace('_', ' ');

/** Splits rows into opener, loop template and ending rows. */
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
 * Sub-loop start indices into `loopTemplate` (excluding 0).
 * Auto: after each main DPS Outro, overridden by `loopSplit`. Needs already-run rows.
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

/** Sub-loop end indices (exclusive) into `loopTemplate`. */
export const loopCycleBounds = (loopTemplate: any[], mainDps: string | undefined): number[] =>
  [...loopSplitStarts(loopTemplate, mainDps), loopTemplate.length];

/** Sub-loop start indices (after the first) into `rows`. */
export function loopSplitRowIndices(rows: any[], loopStartIndex: number, endingRotationEnabled: boolean, mainDps: string | undefined): number[] {
  const contentIndices = rows.flatMap((row, i) => (row?.unit ? [i] : []));
  const { openerRows, loopTemplate } = splitLoopSegments(contentIndices.map(i => rows[i]), loopStartIndex, endingRotationEnabled);
  return loopSplitStarts(loopTemplate, mainDps).map(rel => contentIndices[openerRows.length + rel]);
}

// Ending Rotation start: `reps` whole loops plus `partialRows` (whole sub-loops) fitting in 120s.
// One fewer with endRotationStartsEarlier.
export function endingPlacement(
  openerRows: any[],
  loopTemplate: any[],
  mainDps: string | undefined,
  endRotationStartsEarlier: boolean
): { reps: number; partialRows: number } {
  const { openerEnd, loopDuration } = loopTiming(openerRows, loopTemplate);
  const bounds = loopCycleBounds(loopTemplate, mainDps);
  const subEnds = bounds.map(b => rowGameEnd(loopTemplate[b - 1]) - openerEnd);
  const left = TWO_MIN - openerEnd;
  const wholeLoops = Math.max(0, Math.floor(left / loopDuration));
  const remainder = left - wholeLoops * loopDuration;
  const fitting = wholeLoops * bounds.length + subEnds.slice(0, -1).filter(end => end <= remainder).length;
  const units = Math.max(1, fitting - (endRotationStartsEarlier ? 1 : 0));
  const partialUnits = units % bounds.length;
  return { reps: Math.floor(units / bounds.length), partialRows: partialUnits === 0 ? 0 : bounds[partialUnits - 1] };
}

export function loopTiming(openerRows: any[], loopTemplate: any[]): { openerEnd: number; loopDuration: number } {
  const openerEnd = rowGameEnd(openerRows[openerRows.length - 1]);
  return { openerEnd, loopDuration: rowGameEnd(loopTemplate[loopTemplate.length - 1]) - openerEnd };
}

export const repeatLoop = (openerRows: any[], loopTemplate: any[], reps: number, endingRows: any[] = []): any[] =>
  [...openerRows, ...Array.from({ length: reps }, () => loopTemplate).flat(), ...endingRows];
