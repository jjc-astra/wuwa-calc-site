// Virtualizes Hold Repeat blocks by expanding rows before worker calc and collapsing results back, keeping the table layout fixed.
import type { RotationRow } from '../store/useRotationStore';

interface Block {
  startIdx: number;
  endIdx: number;
  count: number;
}

function findBlocks(rows: RotationRow[]): Map<string, Block> {
  const blocks = new Map<string, Block>();
  rows.forEach((r, i) => {
    if (r.repeatBlockStart) {
      const b = blocks.get(r.repeatBlockStart) || { startIdx: -1, endIdx: -1, count: 2 };
      b.startIdx = i;
      b.count = r.repeatCount || 2;
      blocks.set(r.repeatBlockStart, b);
    }
    if (r.repeatBlockEnd) {
      const b = blocks.get(r.repeatBlockEnd) || { startIdx: -1, endIdx: -1, count: 2 };
      b.endIdx = i;
      blocks.set(r.repeatBlockEnd, b);
    }
  });
  return blocks;
}

// `collapseMap[expandedIndex]` is the original authored index that expanded row came from.
export function expandRepeatBlocks(rows: RotationRow[]): { expanded: RotationRow[]; collapseMap: number[] } {
  const blocks = findBlocks(rows);
  const blockByStart = new Map<number, Block>();
  blocks.forEach(b => {
    // A dangling boundary (its partner was deleted) isn't a real block -- leave those rows alone.
    if (b.startIdx !== -1 && b.endIdx !== -1 && b.endIdx >= b.startIdx) blockByStart.set(b.startIdx, b);
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
          // Clones don't carry the block flags -- only the ORIGINAL authored row represents the
          // block boundary; a clone claiming to also be a boundary would confuse a second
          // expansion pass (e.g. a stale re-run) and serves no purpose downstream.
          const { repeatBlockStart, repeatBlockEnd, repeatCount, repeatFinalTiming, ...clean } = rows[j];
          const isFinalRepEndRow = rep === block.count - 1 && j === block.endIdx;
          expanded.push(isFinalRepEndRow && endRow.repeatFinalTiming ? { ...clean, timing: endRow.repeatFinalTiming } : { ...clean });
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

// Collapses expanded worker rows into one authored row: concatenates damage, takes start timing from the first repetition, and takes end state from the last.
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
      // Restores stripped block flags on 1-count expansions so start/end tags don't disappear when count drops to 1.
      // timing is restored to the authored base value too -- reps[0] ran with repeatFinalTiming's
      // override applied (it's simultaneously the first AND final rep at count 1), which belongs
      // to the runtime clone, not to the row the user edits.
      return orig.repeatBlockStart || orig.repeatBlockEnd
        ? { ...reps[0], timing: orig.timing, repeatBlockStart: orig.repeatBlockStart, repeatBlockEnd: orig.repeatBlockEnd, repeatCount: orig.repeatCount, repeatFinalTiming: orig.repeatFinalTiming }
        : reps[0];
    }
    const first = reps[0];
    const last = reps[reps.length - 1];
    // Sums per-row `*_Delta` trackers across repetitions to report total gains in breakdown panels, while keeping terminal values for stateful counters.
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
      // The end row's last clone ran with repeatFinalTiming's override (if any) applied --
      // restore the authored base timing on the row the user actually edits.
      timing: orig.timing,
      damageInstances: reps.flatMap(r => r.damageInstances || []),
      errorMsgs: Array.from(new Set(reps.flatMap(r => r.errorMsgs || []))),
      warningMsgs: Array.from(new Set(reps.flatMap(r => r.warningMsgs || []))),
      trackers,
      // The clones had these stripped (see expandRepeatBlocks) -- restore the real flags.
      repeatBlockStart: orig.repeatBlockStart,
      repeatBlockEnd: orig.repeatBlockEnd,
      repeatCount: orig.repeatCount,
      repeatFinalTiming: orig.repeatFinalTiming
    };
  });
}
