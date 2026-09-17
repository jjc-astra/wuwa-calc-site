import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '../utils/safeLocalStorage';
import { postToWorker } from '../workers/calcWorkerClient';
import { buildBuilderPayload } from '../workers/builderOverridePayload';
import type { RotationResults } from '../types/results';
import { useRosterStore } from './useRosterStore';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { expandRepeatBlocks, collapseRepeatResults, findBlocks, isValidBlock } from '../logic/RepeatBlocks';
import { useRotationHistoryStore } from './useRotationHistoryStore';
import { DataLoader } from '../utils/DataLoader';
import {
  HistoryManager,
  AddRowCommand,
  DeleteRowsCommand,
  EditValueCommand,
  EditFieldsCommand,
  MoveRowsCommand,
  SetLoopStartCommand,
  SetLoopEndCommand,
  SetRepeatBlockStartCommand,
  SetRepeatBlockEndCommand,
  SetEndingRotationFlagsCommand,
  CompositeCommand
} from '../systems/HistoryManager';
import type { Command, SerializedCommand } from '../systems/HistoryManager';

// A row's authored fields, without the local-only `id`.
export interface RotationRowFields {
  unit: string;
  action: string;
  timing: string;
  offset?: number;
  manualOffset?: number;
  loopStartOverride?: boolean;
  loopEndOverride?: boolean;
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

// Builds a fresh row (with a new id) ready for AddRowCommand.
const makeRow = (fields: Partial<RotationRowFields> & { unit: string; action: string; timing: string }): RotationRow => ({
  id: crypto.randomUUID(),
  offset: 0,
  ...fields
});

function repeatCrossesLoopBoundary(repStartRaw: number, repEndRaw: number, loopStart: number, loopEnd: number | null): boolean {
  const repStart = Math.min(repStartRaw, repEndRaw);
  const repEnd = Math.max(repStartRaw, repEndRaw);
  // loopStartOverride is located post-expansion by the FIRST occurrence of that row, so it's only
  // safe when it lands exactly on the block's own start (correctly the earliest point of the
  // whole repeated block) -- anywhere else inside the block strands part of a repetition as an
  // unintended "opener" before the loop.
  if (repStart < loopStart && repEnd >= loopStart) return true;
  // loopEndOverride has no equivalent safe spot: wherever inside the block it lands, the FIRST
  // occurrence match ends the loop after just the block's first repetition instead of all of them.
  if (loopEnd !== null && repStart <= loopEnd && repEnd >= loopEnd) return true;
  return false;
}

// True when moving a loop marker to `loopIndex` would land inside any existing repeat block's
// range in a way that breaks post-expansion lookup (see repeatCrossesLoopBoundary above for why
// loop start/end aren't symmetric: start is safe exactly at a block's own startIdx, end never is).
function loopMarkerCrossesAnyRepeatBlock(rows: RotationRow[], loopIndex: number, role: 'start' | 'end'): boolean {
  for (const block of findBlocks(rows).values()) {
    if (!isValidBlock(block)) continue;
    if (role === 'start') {
      if (loopIndex > block.startIdx && loopIndex <= block.endIdx) return true;
    } else {
      if (loopIndex >= block.startIdx && loopIndex <= block.endIdx) return true;
    }
  }
  return false;
}

// When deleting rows, a repeat block's start/end marker row might be among them. If rows from
// that block still survive the delete, the marker relocates to the new boundary row instead of
// just vanishing with the deleted row -- the label should only disappear once the block has
// nothing left in it.
function computeRepeatBlockRebalanceOnDelete(
  rows: RotationRow[],
  indicesToDelete: number[]
): { index: number; oldValues: Record<string, any>; newValues: Record<string, any> }[] {
  const deletedSet = new Set(indicesToDelete);
  const edits: { index: number; oldValues: Record<string, any>; newValues: Record<string, any> }[] = [];

  findBlocks(rows).forEach((block, groupId) => {
    if (!isValidBlock(block)) return;
    const startDeleted = deletedSet.has(block.startIdx);
    const endDeleted = deletedSet.has(block.endIdx);
    if (!startDeleted && !endDeleted) return;

    const surviving: number[] = [];
    for (let i = block.startIdx; i <= block.endIdx; i++) {
      if (!deletedSet.has(i)) surviving.push(i);
    }
    if (surviving.length === 0) return; // whole block deleted -- nothing left to relabel

    const newStart = surviving[0];
    const newEnd = surviving[surviving.length - 1];

    if (newStart === newEnd && startDeleted && endDeleted) {
      // Block shrinks to a single surviving row -- it becomes both the start and end marker.
      edits.push({
        index: newStart,
        oldValues: {
          repeatBlockStart: rows[newStart].repeatBlockStart, repeatCount: rows[newStart].repeatCount,
          repeatBlockEnd: rows[newStart].repeatBlockEnd, repeatFinalTiming: rows[newStart].repeatFinalTiming
        },
        newValues: {
          repeatBlockStart: groupId, repeatCount: rows[block.startIdx].repeatCount,
          repeatBlockEnd: groupId, repeatFinalTiming: rows[block.endIdx].repeatFinalTiming
        }
      });
      return;
    }

    if (startDeleted) {
      edits.push({
        index: newStart,
        oldValues: { repeatBlockStart: rows[newStart].repeatBlockStart, repeatCount: rows[newStart].repeatCount },
        newValues: { repeatBlockStart: groupId, repeatCount: rows[block.startIdx].repeatCount }
      });
    }
    if (endDeleted) {
      edits.push({
        index: newEnd,
        oldValues: { repeatBlockEnd: rows[newEnd].repeatBlockEnd, repeatFinalTiming: rows[newEnd].repeatFinalTiming },
        newValues: { repeatBlockEnd: groupId, repeatFinalTiming: rows[block.endIdx].repeatFinalTiming }
      });
    }
  });

  return edits;
}

const repeatFieldsOf = (row: RotationRow) => ({
  ...(row.repeatBlockStart !== undefined && { repeatBlockStart: row.repeatBlockStart, repeatCount: row.repeatCount }),
  ...(row.repeatBlockEnd !== undefined && { repeatBlockEnd: row.repeatBlockEnd, ...(row.repeatFinalTiming !== undefined && { repeatFinalTiming: row.repeatFinalTiming }) })
});

// Three narrower views of a row, none carrying `id`.
export const toClipboardRow = (row: RotationRow) => ({
  unit: row.unit,
  action: row.action,
  timing: row.timing,
  ...repeatFieldsOf(row)
});

export const toSavedRow = (row: RotationRow) => ({
  unit: row.unit,
  action: row.action,
  timing: row.timing,
  ...(row.loopStartOverride === true && { loopStartOverride: true }),
  ...(row.loopEndOverride === true && { loopEndOverride: true }),
  ...repeatFieldsOf(row)
});

export const toPersistedRow = (row: RotationRow) => ({
  ...toSavedRow(row),
  ...(row.offset !== undefined && { offset: row.offset }),
  ...(row.manualOffset !== undefined && { manualOffset: row.manualOffset })
});

interface RotationState {
  rows: RotationRow[];
  startEnergy: boolean;
  startConcerto: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Serialized undo/redo stacks, mirrored here purely so persist's partialize can pick them up
  // -- nothing selects these directly (canUndo/canRedo drive the UI), so writing them on every
  // history change doesn't cost extra re-renders. Revived back into historyManager's real
  // stacks in onRehydrateStorage below.
  undoStackData: SerializedCommand[];
  redoStackData: SerializedCommand[];
  isStale: boolean;
  // JSON snapshot of the Builder overrides baked into `results` as of the last Calculate press
  // -- see checkBuilderStaleness.
  builderOverridesSnapshot: string | null;
  selectedIndices: number[];
  clipboard: RotationRowFields[];
  loopStartIndex: number;
  loopStartIsOverride: boolean;
  loopErrors: string[];
  loopWarnings: string[];
  endingRotationEnabled: boolean;
  // True: sim one fewer loop rep before the Ending Rotation splice, so it replaces/extends
  // the final loop instead of tacking on after it.
  endRotationStartsEarlier: boolean;
  results: RotationResults | null;
  isCalculating: boolean;

  setStartEnergy: (val: boolean) => void;
  setStartConcerto: (val: boolean) => void;
  setStale: (val: boolean) => void;
  // Dims (isStale=true) instead of silently recalculating when a Mechanics Builder edit
  // relevant to the current team happened since the last Calculate press. Call on returning to
  // the Rotation Calculator -- a no-op if nothing changed or there's nothing calculated yet.
  checkBuilderStaleness: () => void;
  setSelectedIndices: (indices: number[]) => void;
  setClipboard: (rows: RotationRowFields[]) => void;

  addRow: (unit?: string, action?: string, index?: number) => void;
  deleteRows: (indices: number[]) => void;
  moveRows: (indicesToMove: number[], targetIndex: number) => void;
  pasteRows: () => void;
  // Returns whether it did anything (no selection is a no-op).
  copySelectedRows: () => boolean;
  insertRowAboveSelection: () => boolean;
  insertRowBelowSelection: () => boolean;
  updateRowField: (index: number, field: string, value: any) => void;
  updateRowFields: (index: number, fields: Record<string, any>) => void;
  // Sets a row's unit (clearing `action`, since the old action rarely applies to the new unit)
  // and, when this is currently the last row, appends a fresh blank end row -- both as one
  // undo/redo step, since they're one user action (picking a unit for the trailing row).
  setRowUnit: (index: number, newUnit: string) => void;
  setLoopStartOverride: (index: number) => void;
  resetLoopStart: () => void;
  setLoopEndOverride: (index: number) => void;
  resetLoopEnd: () => void;
  // Wraps rows [startIndex, endIndex] as a new, independent Hold Repeat block (its own groupId,
  // so it doesn't disturb any other block already in the rotation).
  addRepeatBlock: (startIndex: number, endIndex: number) => void;
  removeRepeatBlock: (groupId: string) => void;
  setRepeatCount: (groupId: string, count: number) => void;
  setRepeatFinalTiming: (groupId: string, timing: string | undefined) => void;
  // Drag-reposition an existing block's start/end marker (mirrors setLoopStartOverride/setLoopEndOverride).
  setRepeatBlockStartIndex: (groupId: string, index: number) => void;
  setRepeatBlockEndIndex: (groupId: string, index: number) => void;
  // Enabling tags the last content row as loop end and appends a copy of the loop segment as
  // "Ending Rotation" content. Disabling removes the tag and appended rows.
  setEndingRotationEnabled: (val: boolean) => void;
  // No-op while there's no active Ending Rotation split.
  setEndRotationStartsEarlier: (val: boolean) => void;

  executeCommand: (cmd: Command) => void;
  // markStale: false for an informational refresh that shouldn't flip isStale back on.
  // includeDamage: true only for the one-time mount refresh, so DMG column populates without
  // every live-preview recalc paying for the extra damage pass.
  recalculate: (markStale?: boolean, includeDamage?: boolean) => Promise<void>;
  calculateDamage: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  importRotation: (rows: RotationRowFields[], settings?: { startEnergy?: boolean; startConcerto?: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean }) => void;
}

const historyManager = new HistoryManager();

interface RevivalContext {
  getRows: () => RotationRow[];
  setRows: (rows: RotationRow[]) => void;
  setFlags: (vals: { endingRotationEnabled: boolean; endRotationStartsEarlier: boolean }) => void;
  onComplete: () => void;
}

// Rebuilds a live Command from its persisted description (see Command.serialize) -- used only
// at rehydration, against the current store's own getRows/setRows/setFlags, never against the
// closures the command was originally created with (those don't survive a reload).
function reviveCommand(data: SerializedCommand, ctx: RevivalContext): Command {
  switch (data.type) {
    case 'add':
      return new AddRowCommand(ctx.getRows, ctx.setRows, data.newRow, data.insertedIndex, ctx.onComplete);
    case 'delete':
      return new DeleteRowsCommand(ctx.getRows, ctx.setRows, data.deletedData, ctx.onComplete);
    case 'editValue':
      return new EditValueCommand(ctx.getRows, ctx.setRows, data.index, data.field, data.oldValue, data.newValue, ctx.onComplete);
    case 'editFields':
      return new EditFieldsCommand(ctx.getRows, ctx.setRows, data.index, data.oldValues, data.newValues, ctx.onComplete);
    case 'setLoopStart':
      return new SetLoopStartCommand(ctx.getRows, ctx.setRows, data.newIndex, data.prevIndex, ctx.onComplete);
    case 'setLoopEnd':
      return new SetLoopEndCommand(ctx.getRows, ctx.setRows, data.newIndex, data.prevIndex, ctx.onComplete);
    case 'setRepeatBlockStart':
      return new SetRepeatBlockStartCommand(ctx.getRows, ctx.setRows, data.groupId, data.newIndex, data.prevIndex, data.initialCount, ctx.onComplete);
    case 'setRepeatBlockEnd':
      return new SetRepeatBlockEndCommand(ctx.getRows, ctx.setRows, data.groupId, data.newIndex, data.prevIndex, ctx.onComplete);
    case 'move':
      return new MoveRowsCommand(ctx.getRows, ctx.setRows, data.indicesToMove, data.targetIndex, data.previousRowsSnapshot, ctx.onComplete);
    case 'endingRotationFlags':
      return new SetEndingRotationFlagsCommand(ctx.setFlags, data.oldValues, data.newValues);
    case 'composite':
      return new CompositeCommand(data.commands.map(c => reviveCommand(c, ctx)));
  }
}

// Simulation pipeline runs in a worker (postToWorker) so long rotations never block the UI thread.

// Tracked per request type, not globally -- a background recalculate() can't invalidate a
// just-landed calculateDamage() (Calculate press).
const latestSeqByType: Record<'recalculate' | 'calculateDamage', number> = { recalculate: 0, calculateDamage: 0 };

export const useRotationStore = create<RotationState>()(
  persist(
    (set, get) => {
      historyManager.setOnChangeCallback((canUndo: boolean, canRedo: boolean) => {
        set({
          canUndo,
          canRedo,
          undoStackData: historyManager.serializeUndoStack(),
          redoStackData: historyManager.serializeRedoStack()
        });
      });

      const getRawRows = () => get().rows;
      const setRawRows = (rows: RotationRow[]) => set({ rows });

      // Coalesces same-tick recalculate() calls (e.g. a multi-row paste) into one microtask.
      let recalcScheduled = false;
      const triggerRecalc = () => {
        if (recalcScheduled) return;
        recalcScheduled = true;
        queueMicrotask(() => {
          recalcScheduled = false;
          get().recalculate();
        });
      };

      // Shared by addRepeatBlock/setRepeatBlockStartIndex/setRepeatBlockEndIndex -- same check
      // against the CURRENT loop, just from three different call sites moving different edges.
      const repeatBlockCrossesCurrentLoop = (startIndex: number, endIndex: number): boolean => {
        const rows = get().rows;
        const loopEndIdx = rows.findIndex(r => r.loopEndOverride === true);
        return repeatCrossesLoopBoundary(startIndex, endIndex, get().loopStartIndex, loopEndIdx === -1 ? null : loopEndIdx);
      };

      return {
        rows: [makeRow({ unit: '', action: '', timing: 'Auto' })],
        startEnergy: true,
        startConcerto: false,
        canUndo: false,
        canRedo: false,
        undoStackData: [],
        redoStackData: [],
        isStale: false,
        builderOverridesSnapshot: null,
        selectedIndices: [],
        clipboard: [],
        loopStartIndex: 0,
        loopStartIsOverride: false,
        loopErrors: [],
        loopWarnings: [],
        endingRotationEnabled: false,
        endRotationStartsEarlier: false,
        results: null,
        isCalculating: false,

        setStartEnergy: (val: boolean) => {
          set({ startEnergy: val });
          get().recalculate();
        },
        setStartConcerto: (val: boolean) => {
          set({ startConcerto: val });
          get().recalculate();
        },
        setStale: (val: boolean) => set({ isStale: val }),
        checkBuilderStaleness: () => {
          const { results, isStale, builderOverridesSnapshot } = get();
          if (!results || isStale) return;
          const team = useRosterStore.getState().team;
          const currentSnapshot = JSON.stringify(buildBuilderPayload(team).builderOverrides);
          if (currentSnapshot !== builderOverridesSnapshot) set({ isStale: true });
        },
        setSelectedIndices: (indices: number[]) => set({ selectedIndices: indices }),
        setClipboard: (rows: RotationRowFields[]) => set({ clipboard: rows }),

        addRow: (unit: string = '', action: string = '', index?: number) => {
          const newRow = makeRow({ unit, action, timing: 'Auto' });
          const cmd = new AddRowCommand(getRawRows, setRawRows, newRow, index, triggerRecalc);
          historyManager.execute(cmd);
        },

        copySelectedRows: () => {
          const { rows, selectedIndices } = get();
          const lastIndex = rows.length - 1;
          const validIndices = selectedIndices.filter(i => i !== lastIndex);
          const selectedRows = rows.filter((_, i) => validIndices.includes(i));
          if (selectedRows.length === 0) return false;
          set({ clipboard: selectedRows.map(toClipboardRow), selectedIndices: [] });
          return true;
        },

        insertRowAboveSelection: () => {
          const { rows, selectedIndices } = get();
          if (selectedIndices.length === 0) return false;
          const firstIndex = selectedIndices[0];
          get().addRow(rows[firstIndex]?.unit || '', '', firstIndex);
          set({ selectedIndices: selectedIndices.map(i => i + 1) });
          return true;
        },

        insertRowBelowSelection: () => {
          const { rows, selectedIndices } = get();
          if (selectedIndices.length === 0) return false;
          const selLastIndex = selectedIndices[selectedIndices.length - 1];
          get().addRow(rows[selLastIndex]?.unit || '', '', selLastIndex + 1);
          return true;
        },

        deleteRows: (indices: number[]) => {
          const rows = get().rows;
          const rebalanceEdits = computeRepeatBlockRebalanceOnDelete(rows, indices);
          const deletedData = DeleteRowsCommand.computeDeletedData(rows, indices);
          const commands: Command[] = rebalanceEdits.map(e =>
            new EditFieldsCommand(getRawRows, setRawRows, e.index, e.oldValues, e.newValues, triggerRecalc)
          );
          commands.push(new DeleteRowsCommand(getRawRows, setRawRows, deletedData, () => {
            set({ selectedIndices: [] });
            triggerRecalc();
          }));
          historyManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands));
        },

        moveRows: (indicesToMove: number[], targetIndex: number) => {
          // Authored fields + id only -- damageInstances/dropdownState/prevRow/nextRow don't
          // need to survive an undo, since onComplete always triggers a recalculate afterward
          // regardless. This snapshot sits in the persisted undo stack indefinitely (until
          // MAX_HISTORY_SIZE evicts it), so keeping it light matters for localStorage quota.
          const previousRowsSnapshot = get().rows.map(r => ({ id: r.id, ...toPersistedRow(r) }));
          const cmd = new MoveRowsCommand(getRawRows, setRawRows, indicesToMove, targetIndex, previousRowsSnapshot, (newIndices?: number[]) => {
            set({ selectedIndices: newIndices || [] });
            triggerRecalc();
          });
          historyManager.execute(cmd);
        },

        // 1-to-1 overwrite of selected rows; extra clipboard rows insert; leftover selected
        // rows delete. Nothing selected -- rows insert before the trailing blank row.
        pasteRows: () => {
          const state = get();
          const clipboard = state.clipboard;
          if (clipboard.length === 0) return;
          const rows = state.rows;
          const selectedIndices = [...state.selectedIndices].filter(i => i !== rows.length - 1).sort((a, b) => a - b);
          const hasSelection = selectedIndices.length > 0;
          const startIndex = hasSelection ? selectedIndices[0] : Math.max(0, rows.length - 1);
          const maxEdits = hasSelection ? Math.min(clipboard.length, selectedIndices.length) : 0;

          // A pasted repeat block gets fresh groupId(s) of its own -- never reuses the copied
          // source's, which likely still exists elsewhere and would otherwise end up sharing one
          // groupId across two independent blocks (findBlocks assumes one start/end pair per id).
          // Shared across every clipboard row below so a copied block's start+end (or a 1-row
          // block's shared start===end id) still land on the same new groupId as each other.
          const groupIdRemap = new Map<string, string>();
          const remapGroupId = (id: string | undefined) => {
            if (id === undefined) return undefined;
            if (!groupIdRemap.has(id)) groupIdRemap.set(id, crypto.randomUUID());
            return groupIdRemap.get(id);
          };
          const repeatFieldsFor = (data: RotationRowFields) => ({
            repeatBlockStart: remapGroupId(data.repeatBlockStart),
            repeatBlockEnd: remapGroupId(data.repeatBlockEnd),
            repeatCount: data.repeatCount,
            repeatFinalTiming: data.repeatFinalTiming
          });

          const commands: Command[] = [];

          for (let i = 0; i < maxEdits; i++) {
            const rowIdx = selectedIndices[i];
            const data: RotationRowFields = { ...clipboard[i], ...repeatFieldsFor(clipboard[i]) };
            const existing = rows[rowIdx];
            (['unit', 'action', 'timing', 'repeatBlockStart', 'repeatBlockEnd', 'repeatCount', 'repeatFinalTiming'] as const).forEach(field => {
              if (existing[field] !== data[field]) {
                commands.push(new EditValueCommand(getRawRows, setRawRows, rowIdx, field, existing[field], data[field], triggerRecalc));
              }
            });
          }

          if (clipboard.length > maxEdits) {
            const insertBase = startIndex + maxEdits;
            for (let i = maxEdits; i < clipboard.length; i++) {
              const data = clipboard[i];
              const targetIndex = insertBase + (i - maxEdits);
              const newRow = makeRow({ unit: data.unit, action: data.action, timing: data.timing, ...repeatFieldsFor(data) });
              commands.push(new AddRowCommand(getRawRows, setRawRows, newRow, targetIndex, triggerRecalc));
            }
          }

          if (hasSelection && selectedIndices.length > maxEdits) {
            const rowsToDelete = selectedIndices.slice(maxEdits);
            const deletedData = DeleteRowsCommand.computeDeletedData(rows, rowsToDelete);
            commands.push(new DeleteRowsCommand(getRawRows, setRawRows, deletedData, () => {
              set({ selectedIndices: [] });
              triggerRecalc();
            }));
          }

          if (commands.length > 0) {
            historyManager.execute(new CompositeCommand(commands));
          }
        },

        updateRowField: (index: number, field: string, value: any) => {
          const row = get().rows[index];
          const oldValue = row?.[field];
          if (oldValue === value) return;
          const commands: Command[] = [new EditValueCommand(getRawRows, setRawRows, index, field, oldValue, value, triggerRecalc)];

          // Speeds up authoring a rotation: picking a move carries the row's unit forward
          if (field === 'action' && value && row?.unit) {
            const nextRow = get().rows[index + 1];
            const moveData = DataLoader.mechanicsDB[value];
            const isOutro = !!moveData?.castTypes?.includes('Outro');
            if (nextRow && !nextRow.unit && !nextRow.action && !isOutro) {
              commands.push(new EditValueCommand(getRawRows, setRawRows, index + 1, 'unit', nextRow.unit, row.unit, triggerRecalc));
              if (index + 1 === get().rows.length - 1) {
                const newRow = makeRow({ unit: '', action: '', timing: 'Auto' });
                commands.push(new AddRowCommand(getRawRows, setRawRows, newRow, -1, triggerRecalc));
              }
            }
          }

          historyManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands));
        },

        updateRowFields: (index: number, fields: Record<string, any>) => {
          const row = get().rows[index];
          if (!row) return;
          const oldValues: Record<string, any> = {};
          let changed = false;
          Object.keys(fields).forEach(key => {
            oldValues[key] = row[key];
            if (row[key] !== fields[key]) changed = true;
          });
          if (!changed) return;
          const cmd = new EditFieldsCommand(getRawRows, setRawRows, index, oldValues, fields, triggerRecalc);
          historyManager.execute(cmd);
        },

        setRowUnit: (index: number, newUnit: string) => {
          const row = get().rows[index];
          if (!row) return;

          const oldValues: Record<string, any> = {};
          const newValues: Record<string, any> = {};
          if (row.unit !== newUnit) { oldValues.unit = row.unit; newValues.unit = newUnit; }
          if (row.action !== '') { oldValues.action = row.action; newValues.action = ''; }

          const commands: Command[] = [];
          if (Object.keys(newValues).length > 0) {
            commands.push(new EditFieldsCommand(getRawRows, setRawRows, index, oldValues, newValues, triggerRecalc));
          }

          if (newUnit && index === get().rows.length - 1) {
            const newRow = makeRow({ unit: '', action: '', timing: 'Auto' });
            commands.push(new AddRowCommand(getRawRows, setRawRows, newRow, -1, triggerRecalc));
          }

          if (commands.length === 0) return;
          historyManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands));
        },

        setLoopStartOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopStartOverride === true) return;
          if (loopMarkerCrossesAnyRepeatBlock(get().rows, index, 'start')) return;
          const prevIndex = SetLoopStartCommand.findPrevIndex(get().rows);
          const cmd = new SetLoopStartCommand(getRawRows, setRawRows, index, prevIndex, triggerRecalc);
          historyManager.execute(cmd);
        },

        resetLoopStart: () => {
          const prevIndex = SetLoopStartCommand.findPrevIndex(get().rows);
          if (prevIndex === null) return;
          const cmd = new SetLoopStartCommand(getRawRows, setRawRows, null, prevIndex, triggerRecalc);
          historyManager.execute(cmd);
        },

        setLoopEndOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopEndOverride === true) return;
          if (loopMarkerCrossesAnyRepeatBlock(get().rows, index, 'end')) return;
          const prevIndex = SetLoopEndCommand.findPrevIndex(get().rows);
          const cmd = new SetLoopEndCommand(getRawRows, setRawRows, index, prevIndex, triggerRecalc);
          historyManager.execute(cmd);
        },

        addRepeatBlock: (startIndex: number, endIndex: number) => {
          const rows = get().rows;
          if (!rows[startIndex]?.unit || !rows[endIndex]?.unit || endIndex < startIndex) return;
          if (repeatBlockCrossesCurrentLoop(startIndex, endIndex)) return;
          const groupId = crypto.randomUUID();
          const commands: Command[] = [
            new SetRepeatBlockStartCommand(getRawRows, setRawRows, groupId, startIndex, null, 2, triggerRecalc),
            new SetRepeatBlockEndCommand(getRawRows, setRawRows, groupId, endIndex, null, triggerRecalc)
          ];
          historyManager.execute(new CompositeCommand(commands));
        },

        removeRepeatBlock: (groupId: string) => {
          const rows = get().rows;
          const startIdx = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          const endIdx = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          const commands: Command[] = [];
          if (startIdx !== null) commands.push(new SetRepeatBlockStartCommand(getRawRows, setRawRows, groupId, null, startIdx, 2, triggerRecalc));
          if (endIdx !== null) commands.push(new SetRepeatBlockEndCommand(getRawRows, setRawRows, groupId, null, endIdx, triggerRecalc));
          if (commands.length === 0) return;
          historyManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands));
        },

        setRepeatCount: (groupId: string, count: number) => {
          const rows = get().rows;
          const idx = rows.findIndex(r => r.repeatBlockStart === groupId);
          if (idx === -1) return;
          const clamped = Math.max(1, Math.floor(count) || 1);
          if (rows[idx].repeatCount === clamped) return;
          const cmd = new EditValueCommand(getRawRows, setRawRows, idx, 'repeatCount', rows[idx].repeatCount ?? 2, clamped, triggerRecalc);
          historyManager.execute(cmd);
        },

        setRepeatFinalTiming: (groupId: string, timing: string | undefined) => {
          const rows = get().rows;
          const idx = rows.findIndex(r => r.repeatBlockEnd === groupId);
          if (idx === -1) return;
          if (rows[idx].repeatFinalTiming === timing) return;
          const cmd = new EditValueCommand(getRawRows, setRawRows, idx, 'repeatFinalTiming', rows[idx].repeatFinalTiming, timing, triggerRecalc);
          historyManager.execute(cmd);
        },

        setRepeatBlockStartIndex: (groupId: string, index: number) => {
          const rows = get().rows;
          if (!rows[index]?.unit) return;
          const prevIndex = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          if (prevIndex === index) return;
          const endIdx = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          if (endIdx !== null) {
            if (index > endIdx) return; // start can't land below its own block's end
            if (repeatBlockCrossesCurrentLoop(index, endIdx)) return;
          }
          const cmd = new SetRepeatBlockStartCommand(getRawRows, setRawRows, groupId, index, prevIndex, 2, triggerRecalc);
          historyManager.execute(cmd);
        },

        setRepeatBlockEndIndex: (groupId: string, index: number) => {
          const rows = get().rows;
          if (!rows[index]?.unit) return;
          const prevIndex = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          if (prevIndex === index) return;
          const startIdx = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          if (startIdx !== null) {
            if (index < startIdx) return; // end can't land above its own block's start
            if (repeatBlockCrossesCurrentLoop(startIdx, index)) return;
          }
          const cmd = new SetRepeatBlockEndCommand(getRawRows, setRawRows, groupId, index, prevIndex, triggerRecalc);
          historyManager.execute(cmd);
        },

        // Removes the whole Ending Rotation split (tag + appended rows), not just the tag.
        // Shared by the row marker's reset button and unchecking the toolbar checkbox.
        resetLoopEnd: () => {
          const rows = get().rows;
          const endIdx = rows.findIndex(r => r.loopEndOverride === true);
          const wasEnabled = get().endingRotationEnabled;
          const wasStartingEarlier = get().endRotationStartsEarlier;
          // Flag flip rides in the same CompositeCommand, so undo restores both together.
          const flagCommand = new SetEndingRotationFlagsCommand(
            vals => set(vals),
            { endingRotationEnabled: wasEnabled, endRotationStartsEarlier: wasStartingEarlier },
            { endingRotationEnabled: false, endRotationStartsEarlier: false }
          );

          if (endIdx === -1) {
            historyManager.execute(flagCommand);
            return;
          }

          const lastIdx = rows.length - 1;
          const toDelete: number[] = [];
          for (let i = endIdx + 1; i <= lastIdx; i++) {
            if (i === lastIdx && !rows[i].unit) continue;
            toDelete.push(i);
          }

          const commands: Command[] = [];
          if (toDelete.length > 0) {
            const deletedData = DeleteRowsCommand.computeDeletedData(rows, toDelete);
            commands.push(new DeleteRowsCommand(getRawRows, setRawRows, deletedData, triggerRecalc));
          }
          commands.push(new SetLoopEndCommand(getRawRows, setRawRows, null, endIdx, triggerRecalc));
          commands.push(flagCommand);
          historyManager.execute(new CompositeCommand(commands));
        },

        setEndingRotationEnabled: (val: boolean) => {
          if (!val) {
            get().resetLoopEnd();
            return;
          }

          const rows = get().rows;
          const alreadyTagged = rows.some(r => r.loopEndOverride === true);
          if (alreadyTagged) {
            set({ endingRotationEnabled: true });
            return;
          }

          const lastContentIdx = rows.reduce((last, r, i) => (r.unit ? i : last), -1);
          if (lastContentIdx === -1) {
            // Nothing to tag/copy yet -- just flip the flag.
            set({ endingRotationEnabled: true });
            return;
          }

          const commands: Command[] = [
            new SetLoopEndCommand(getRawRows, setRawRows, lastContentIdx, null, triggerRecalc)
          ];
          const loopStart = get().loopStartIndex;
          const loopRows = rows.slice(loopStart, lastContentIdx + 1);
          loopRows.forEach((r, i) => {
            // Only the authored fields carry over -- `r` also carries TimelineEngine's runtime state.
            const newRow = makeRow({ unit: r.unit, action: r.action, timing: r.timing });
            commands.push(new AddRowCommand(getRawRows, setRawRows, newRow, lastContentIdx + 1 + i, triggerRecalc));
          });
          historyManager.execute(new CompositeCommand(commands));
          set({ endingRotationEnabled: true });
        },

        setEndRotationStartsEarlier: (val: boolean) => {
          if (!get().endingRotationEnabled) return;
          set({ endRotationStartsEarlier: val });
          triggerRecalc();
        },

        executeCommand: (cmd: Command) => {
          historyManager.execute(cmd);
        },

        // Recalculates timeline/gauges/timings only -- does not run combat damage.
        recalculate: async (markStale: boolean = true, includeDamage: boolean = false) => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows, endingRotationEnabled, endRotationStartsEarlier } = get();
          const options = { startEnergy, startConcerto };

          // So a mechanics-file change is picked up without waiting for a Calculate press or reload.
          const staleRefs = await checkTeamFreshness(team);

          // Hold Repeat blocks are authoring/display sugar -- TimelineEngine only ever sees
          // `expanded` (each block's row range cloned `repeatCount` times); the response gets
          // folded back onto `rows`' original positions below via collapseMap.
          const { expanded, collapseMap } = expandRepeatBlocks(rows);

          set({ isCalculating: true });
          const { seq, result } = postToWorker('recalculate', { rows: expanded, team, options, enemy, includeDamage, endingRotationEnabled, endRotationStartsEarlier, staleRefs, ...buildBuilderPayload(team) });
          latestSeqByType.recalculate = seq;
          let data: any;
          try {
            data = await result;
          } catch (err) {
            console.error('[useRotationStore] recalculate failed', err);
            if (seq === latestSeqByType.recalculate) set({ isCalculating: false });
            return;
          }
          // A newer recalculate() already landed -- drop this stale result.
          if (seq !== latestSeqByType.recalculate) return;

          // Preserve existing damageInstances unless the result has fresh ones (TimelineEngine
          // always resets them to [], truthy but not "fresh").
          const existingDamageMap = new Map(get().rows.map((r, i) => [i, r.damageInstances]));
          const evaluatedRows = collapseRepeatResults(data.evaluatedRows, collapseMap, rows);
          evaluatedRows.forEach((row: any, i: number) => {
            row.damageInstances = (row.damageInstances && row.damageInstances.length > 0)
              ? row.damageInstances
              : (existingDamageMap.get(i) || []);
            // Guarantees every committed row has an id, independent of whatever `rows[i]` has.
            if (!row.id) row.id = rows[i]?.id || crypto.randomUUID();
          });

          set({
            rows: evaluatedRows,
            isStale: markStale ? true : get().isStale,
            loopStartIndex: collapseMap[data.loopStartIndex] ?? data.loopStartIndex,
            loopStartIsOverride: data.loopStartIsOverride,
            loopErrors: data.loopErrors,
            loopWarnings: data.loopWarnings,
            isCalculating: false
          });
        },

        // Runs full combat damage -- only triggered by the "Calculate" button.
        calculateDamage: async () => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier } = get();
          const options = { startEnergy, startConcerto };

          // Evicts stale mechanic JSONs so Calculate runs against current data; staleRefs is
          // also passed to the worker so its own DataLoader instance drops the same entries.
          const staleRefs = await checkTeamFreshness(team);

          const { expanded, collapseMap } = expandRepeatBlocks(rows);
          // loopStartIndex was computed against the original (collapsed) rows -- translate it to
          // where that same content now sits in `expanded` before the worker uses it to run the loop.
          const expandedLoopStartIndex = collapseMap.indexOf(loopStartIndex);

          const builderPayload = buildBuilderPayload(team);

          set({ isCalculating: true });
          const { seq, result } = postToWorker('calculateDamage', { rows: expanded, team, options, enemy, loopStartIndex: expandedLoopStartIndex === -1 ? loopStartIndex : expandedLoopStartIndex, endingRotationEnabled, endRotationStartsEarlier, staleRefs, ...builderPayload });
          latestSeqByType.calculateDamage = seq;
          let data: any;
          try {
            data = await result;
          } catch (err) {
            console.error('[useRotationStore] calculateDamage failed', err);
            if (seq === latestSeqByType.calculateDamage) set({ isCalculating: false });
            return;
          }
          if (seq !== latestSeqByType.calculateDamage) return;

          const evaluatedRows = collapseRepeatResults(data.evaluatedRows, collapseMap, rows);
          evaluatedRows.forEach((row: any, i: number) => {
            if (!row.id) row.id = rows[i]?.id || crypto.randomUUID();
          });
          set({
            rows: evaluatedRows,
            isStale: false,
            results: data.results,
            isCalculating: false,
            builderOverridesSnapshot: JSON.stringify(builderPayload.builderOverrides)
          });

          // One history row per successful Calculate press, in the same shape Export Rotation uses.
          useRotationHistoryStore.getState().addEntry({
            team: team.map(slot => {
              const { domRef, ...clean } = slot as any;
              return clean;
            }),
            rotation: rows.map(toSavedRow),
            settings: { ...options, endingRotationEnabled, endRotationStartsEarlier },
            results: data.results
          });
        },

        undo: () => {
          historyManager.undo();
        },

        redo: () => {
          historyManager.redo();
        },

        importRotation: (rows: RotationRowFields[], settings?: { startEnergy?: boolean; startConcerto?: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean }) => {
          historyManager.clear();
          const idedRows: RotationRow[] = rows.map(r => ({ ...r, id: crypto.randomUUID() }));
          const trailingEmpty = makeRow({ unit: '', action: '', timing: 'Auto' });
          const withTrailingRow = idedRows.length > 0 && idedRows[idedRows.length - 1].unit
            ? [...idedRows, trailingEmpty]
            : (idedRows.length > 0 ? idedRows : [trailingEmpty]);
          set({
            rows: withTrailingRow,
            startEnergy: settings?.startEnergy ?? get().startEnergy,
            startConcerto: settings?.startConcerto ?? get().startConcerto,
            endingRotationEnabled: settings?.endingRotationEnabled ?? get().endingRotationEnabled,
            endRotationStartsEarlier: settings?.endRotationStartsEarlier ?? get().endRotationStartsEarlier,
            selectedIndices: []
          });
          get().recalculate();
        }
      };
    },
    {
      name: 'wuwa_calc_rotation_cache',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (state) => ({
        rows: state.rows.map(toPersistedRow),
        startEnergy: state.startEnergy,
        startConcerto: state.startConcerto,
        endingRotationEnabled: state.endingRotationEnabled,
        endRotationStartsEarlier: state.endRotationStartsEarlier,
        // Last Calculate press's output, so a reload still shows Results instead of "No Results Yet".
        results: state.results,
        isStale: state.isStale,
        builderOverridesSnapshot: state.builderOverridesSnapshot,
        loopStartIndex: state.loopStartIndex,
        loopStartIsOverride: state.loopStartIsOverride,
        loopErrors: state.loopErrors,
        loopWarnings: state.loopWarnings,
        clipboard: state.clipboard,
        undoStackData: state.undoStackData,
        redoStackData: state.redoStackData
      }),
      // Rebuilds historyManager's real stacks from the persisted descriptions -- restoreStacks
      // just assigns them (no execute()/undo() side effects), since `rows` above is already the
      // up-to-date result of those commands having run before the reload.
      onRehydrateStorage: () => state => {
        if (!state) return;
        // Persisted rows never carry an id (see toPersistedRow) -- backfill on rehydrate.
        if (state.rows.some(r => !r.id)) {
          useRotationStore.setState({ rows: state.rows.map(r => (r.id ? r : { ...r, id: crypto.randomUUID() })) });
        }
        const ctx: RevivalContext = {
          getRows: () => useRotationStore.getState().rows,
          setRows: rows => useRotationStore.setState({ rows }),
          setFlags: vals => useRotationStore.setState(vals),
          onComplete: () => useRotationStore.getState().recalculate()
        };
        const undoStack = (state.undoStackData || []).map(d => reviveCommand(d, ctx));
        const redoStack = (state.redoStackData || []).map(d => reviveCommand(d, ctx));
        historyManager.restoreStacks(undoStack, redoStack);
      }
      // No auto-recalculate on rehydrate -- this store loads app-wide; RotationBuilder's mount
      // effect recalculates once the calculator page actually opens.
    }
  )
);