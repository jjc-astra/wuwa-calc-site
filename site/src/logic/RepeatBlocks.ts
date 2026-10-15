// Expands Hold Repeat blocks for the engine and collapses results back.
import type { RotationRow } from './rotationRows';
import { DEFAULT_REPEAT_COUNT, REPEAT_FIELDS, pickFields, withoutRepeatFields } from './rotationRows';

export interface Block {
  startIdx: number;
  endIdx: number;
  count: number;
}

// False for dangling or reversed boundaries.
export function isValidBlock(b: Block): boolean {
  return b.startIdx !== -1 && b.endIdx !== -1 && b.endIdx >= b.startIdx;
}

export function findBlocks(rows: RotationRow[]): Map<string, Block> {
  const blocks = new Map<string, Block>();
  rows.forEach((r, i) => {
    if (r.repeatBlockStart) {
      const b = blocks.get(r.repeatBlockStart) || { startIdx: -1, endIdx: -1, count: DEFAULT_REPEAT_COUNT };
      b.startIdx = i;
      b.count = r.repeatCount || DEFAULT_REPEAT_COUNT;
      blocks.set(r.repeatBlockStart, b);
    }
    if (r.repeatBlockEnd) {
      const b = blocks.get(r.repeatBlockEnd) || { startIdx: -1, endIdx: -1, count: DEFAULT_REPEAT_COUNT };
      b.endIdx = i;
      blocks.set(r.repeatBlockEnd, b);
    }
  });
  return blocks;
}

// `collapseMap[expandedIndex]`: the authored row index.
export function expandRepeatBlocks(rows: RotationRow[]): { expanded: RotationRow[]; collapseMap: number[] } {
  const blocks = findBlocks(rows);
  const blockByStart = new Map<number, Block>();
  blocks.forEach(b => {
    if (isValidBlock(b)) blockByStart.set(b.startIdx, b);
  });

  const expanded: RotationRow[] = [];
  const collapseMap: number[] = [];
  let i = 0;
  while (i < rows.length) {
    const block = blockByStart.get(i);
    if (block) {
      const endRow = rows[block.endIdx];
      for (let rep = 0; rep < block.count; rep++) {
        for (let j = block.startIdx; j <= block.endIdx; j++) {
          // Clones don't carry block flags.
          const clean = withoutRepeatFields(rows[j]);
          const isFinalRepEndRow = rep === block.count - 1 && j === block.endIdx;
          expanded.push(isFinalRepEndRow && endRow.repeatFinalTiming ? { ...clean, timing: endRow.repeatFinalTiming } : clean);
          collapseMap.push(j);
        }
      }
      i = block.endIdx + 1;
    } else {
      expanded.push(rows[i]);
      collapseMap.push(i);
      i++;
    }
  }
  return { expanded, collapseMap };
}

// Collapses repetitions: damage concatenated, start from the first, end state from the last.
export function collapseRepeatResults(evaluatedExpandedRows: RotationRow[], collapseMap: number[], originalRows: RotationRow[]): RotationRow[] {
  const repsByOriginalIndex = new Map<number, RotationRow[]>();
  evaluatedExpandedRows.forEach((r, i) => {
    const origIdx = collapseMap[i];
    if (!repsByOriginalIndex.has(origIdx)) repsByOriginalIndex.set(origIdx, []);
    repsByOriginalIndex.get(origIdx)!.push(r);
  });

  return originalRows.map((orig, idx) => {
    const reps = repsByOriginalIndex.get(idx);
    if (!reps) return orig;
    if (reps.length <= 1) {
      // Count 1: restore block flags and the authored timing.
      return orig.repeatBlockStart || orig.repeatBlockEnd
        ? { ...reps[0], timing: orig.timing, ...pickFields(orig, REPEAT_FIELDS) }
        : reps[0];
    }
    const first = reps[0];
    const last = reps[reps.length - 1];
    // Sum `*_Delta` trackers across repetitions.
    const deltaKeys = new Set<string>();
    reps.forEach(r => { if (r.trackers) Object.keys(r.trackers).forEach(k => { if (k.endsWith('_Delta')) deltaKeys.add(k); }); });
    const trackers = { ...(last.trackers || {}) };
    deltaKeys.forEach(k => {
      trackers[k] = reps.reduce((sum, r) => sum + (r.trackers?.[k] || 0), 0);
    });
    return {
      ...last,
      gameTimeStart: first.gameTimeStart,
      timeStart: first.timeStart,
      offset: first.offset,
      // Authored timing, not repeatFinalTiming.
      timing: orig.timing,
      damageInstances: reps.flatMap(r => r.damageInstances || []),
      errorMsgs: Array.from(new Set(reps.flatMap(r => r.errorMsgs || []))),
      warningMsgs: Array.from(new Set(reps.flatMap(r => r.warningMsgs || []))),
      trackers,
      ...pickFields(orig, REPEAT_FIELDS)
    };
  });
}
