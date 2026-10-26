import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import { postToWorker } from '../workers/calcWorkerClient';
import type { WorkerRequest } from '../workers/calcWorkerClient';
import { buildBuilderPayload } from '../workers/builderOverridePayload';
import type { RotationResults } from '../types/results';
import { useRosterStore } from './useRosterStore';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { expandRepeatBlocks, collapseRepeatResults, findBlocks, isValidBlock } from '../logic/RepeatBlocks';
import { useRotationHistoryStore } from './useRotationHistoryStore';
import { DataLoader } from '../utils/DataLoader';
import { teamCharacters } from '../utils/TeamUtils';
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
import type { Command, SerializedCommand, EndingRotationFlags } from '../systems/HistoryManager';
import {
  REPEAT_FIELDS, DEFAULT_REPEAT_COUNT, makeRow, makeBlankRow, pickFields, createGroupIdRemapper,
  withRemappedGroupIds, toClipboardRow, toSavedRow, toPersistedRow, loopEndIndexOf,
  loopTiming, endingPlacement, loopCycleBounds
} from '../logic/rotationRows';
import type { RotationRow, RotationRowFields } from '../logic/rotationRows';
export type { RotationRow, RotationRowFields };
export { toClipboardRow, toSavedRow, toPersistedRow };

function repeatCrossesLoopBoundary(repStartRaw: number, repEndRaw: number, loopStart: number, loopEnd: number | null): boolean {
  const repStart = Math.min(repStartRaw, repEndRaw);
  const repEnd = Math.max(repStartRaw, repEndRaw);
  // Loop start is only safe exactly at the block's start.
  if (repStart < loopStart && repEnd >= loopStart) return true;
  // Loop end is never safe inside a block.
  if (loopEnd !== null && repStart <= loopEnd && repEnd >= loopEnd) return true;
  return false;
}

// True when a loop marker at `loopIndex` would break a repeat block.
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

// Moves repeat block markers onto surviving rows after a delete.
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
    if (surviving.length === 0) return;

    const newStart = surviving[0];
    const newEnd = surviving[surviving.length - 1];

    if (newStart === newEnd && startDeleted && endDeleted) {
      // Single surviving row is both start and end.
      edits.push({
        index: newStart,
        oldValues: pickFields(rows[newStart], REPEAT_FIELDS),
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
        oldValues: pickFields(rows[newStart], ['repeatBlockStart', 'repeatCount']),
        newValues: { repeatBlockStart: groupId, repeatCount: rows[block.startIdx].repeatCount }
      });
    }
    if (endDeleted) {
      edits.push({
        index: newEnd,
        oldValues: pickFields(rows[newEnd], ['repeatBlockEnd', 'repeatFinalTiming']),
        newValues: { repeatBlockEnd: groupId, repeatFinalTiming: rows[block.endIdx].repeatFinalTiming }
      });
    }
  });

  return edits;
}

interface RotationState {
  rows: RotationRow[];
  startEnergy: boolean;
  startConcerto: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Serialized undo/redo stacks, for persistence only.
  undoStackData: SerializedCommand[];
  redoStackData: SerializedCommand[];
  isStale: boolean;
  // Builder overrides as of the last Calculate press.
  builderOverridesSnapshot: string | null;
  selectedIndices: number[];
  clipboard: RotationRowFields[];
  loopStartIndex: number;
  loopStartIsOverride: boolean;
  loopErrors: string[];
  loopWarnings: string[];
  endingRotationEnabled: boolean;
  // Ending Rotation replaces the final loop rep instead of following it.
  endRotationStartsEarlier: boolean;
  // Calculate includes substat worth (off by default; slow).
  substatWorthEnabled: boolean;
  results: RotationResults | null;
  // The units `results` were calculated for (the roster may have changed since).
  resultsUnits: string[] | null;
  isCalculating: boolean;
  // Last calc's expanded rows, for the Timeline. Not persisted.
  timelineRows: any[];
  timelineLoopStartIndex: number | null;
  // Timeline open: recalculate also prices hits.
  timelineActive: boolean;

  setStartEnergy: (val: boolean) => void;
  setTimelineActive: (active: boolean) => void;
  setStartConcerto: (val: boolean) => void;
  // Marks results stale if relevant Builder edits happened since the last Calculate.
  checkBuilderStaleness: () => void;
  setSelectedIndices: (indices: number[]) => void;

  addRow: (unit?: string, action?: string, index?: number) => void;
  deleteRows: (indices: number[]) => void;
  moveRows: (indicesToMove: number[], targetIndex: number) => void;
  pasteRows: () => void;
  copySelectedRows: () => boolean;
  insertRowAboveSelection: () => boolean;
  insertRowBelowSelection: () => boolean;
  updateRowField: (index: number, field: string, value: any) => void;
  updateRowFields: (index: number, fields: Record<string, any>) => void;
  // Sets a row's unit (clears action); appends a blank row if it was the last. One undo step.
  setRowUnit: (index: number, newUnit: string) => void;
  setLoopStartOverride: (index: number) => void;
  resetLoopStart: () => void;
  setLoopEndOverride: (index: number) => void;
  resetLoopEnd: () => void;
  // true: split here; false: suppress auto split; undefined: auto.
  setLoopSplit: (index: number, value: boolean | undefined) => void;
  // Wraps rows [startIndex, endIndex] in a new Hold Repeat block.
  addRepeatBlock: (startIndex: number, endIndex: number) => void;
  removeRepeatBlock: (groupId: string) => void;
  setRepeatCount: (groupId: string, count: number) => void;
  setRepeatFinalTiming: (groupId: string, timing: string | undefined) => void;
  setRepeatBlockStartIndex: (groupId: string, index: number) => void;
  setRepeatBlockEndIndex: (groupId: string, index: number) => void;
  // Enabling appends a copy of the sub-loop crossing 2 minutes; disabling removes it.
  setEndingRotationEnabled: (val: boolean) => void;
  setEndRotationStartsEarlier: (val: boolean) => void;
  setSubstatWorthEnabled: (val: boolean) => void;

  // markStale: false keeps isStale unchanged.
  // includeDamage: also fill the DMG column.
  recalculate: (markStale?: boolean, includeDamage?: boolean) => Promise<void>;
  calculateDamage: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  importRotation: (rows: RotationRowFields[], settings?: RotationSettingsInput) => void;
}

type RotationSettingsInput = { startEnergy?: boolean; startConcerto?: boolean } & Partial<EndingRotationFlags>;

const historyManager = new HistoryManager();

interface RevivalContext {
  getRows: () => RotationRow[];
  setRows: (rows: RotationRow[]) => void;
  setFlags: (vals: EndingRotationFlags) => void;
  onComplete: () => void;
}

// Rebuilds a Command from its serialized form on rehydration.
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

// Latest request per type, so recalculate() can't invalidate calculateDamage().
const latestSeqByType: Record<'recalculate' | 'calculateDamage', number> = { recalculate: 0, calculateDamage: 0 };

// Rotation table, undo history, and last results.
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

      // Coalesces same-tick recalculate() calls.
      let recalcScheduled = false;
      const triggerRecalc = () => {
        if (recalcScheduled) return;
        recalcScheduled = true;
        queueMicrotask(() => {
          recalcScheduled = false;
          get().recalculate();
        });
      };

      // Commands recalculate on completion unless `onComplete` is given.
      const cmd = {
        add: (row: RotationRow, index?: number) => new AddRowCommand(getRawRows, setRawRows, row, index, triggerRecalc),
        remove: (deletedData: { row: any; index: number }[], onComplete: () => void = triggerRecalc) =>
          new DeleteRowsCommand(getRawRows, setRawRows, deletedData, onComplete),
        editValue: (index: number, field: string, oldValue: any, newValue: any) =>
          new EditValueCommand(getRawRows, setRawRows, index, field, oldValue, newValue, triggerRecalc),
        editFields: (index: number, oldValues: Record<string, any>, newValues: Record<string, any>) =>
          new EditFieldsCommand(getRawRows, setRawRows, index, oldValues, newValues, triggerRecalc),
        setLoopStart: (newIndex: number | null, prevIndex: number | null) =>
          new SetLoopStartCommand(getRawRows, setRawRows, newIndex, prevIndex, triggerRecalc),
        setLoopEnd: (newIndex: number | null, prevIndex: number | null) =>
          new SetLoopEndCommand(getRawRows, setRawRows, newIndex, prevIndex, triggerRecalc),
        setRepeatStart: (groupId: string, newIndex: number | null, prevIndex: number | null, initialCount = DEFAULT_REPEAT_COUNT) =>
          new SetRepeatBlockStartCommand(getRawRows, setRawRows, groupId, newIndex, prevIndex, initialCount, triggerRecalc),
        setRepeatEnd: (groupId: string, newIndex: number | null, prevIndex: number | null) =>
          new SetRepeatBlockEndCommand(getRawRows, setRawRows, groupId, newIndex, prevIndex, triggerRecalc)
      };

      // Runs commands as one undo step.
      const runCommands = (commands: Command[]) => {
        if (commands.length === 0) return;
        historyManager.execute(commands.length === 1 ? commands[0] : new CompositeCommand(commands));
      };

      const clearSelectionAndRecalc = () => {
        set({ selectedIndices: [] });
        triggerRecalc();
      };

      // One worker round trip. Null on failure or when superseded.
      const runWorkerCalc = async (
        type: 'recalculate' | 'calculateDamage',
        extra: (collapseMap: number[]) => Partial<WorkerRequest>
      ) => {
        const team = useRosterStore.getState().team;
        const enemy = useRosterStore.getState().enemy;
        const { startEnergy, startConcerto, rows, endingRotationEnabled, endRotationStartsEarlier } = get();
        const options = { startEnergy, startConcerto };

        // Evict stale mechanics and refresh manifests.
        await checkTeamFreshness(team);

        // The engine runs expanded rows; results fold back via collapseMap.
        const { expanded, collapseMap } = expandRepeatBlocks(rows);

        set({ isCalculating: true });
        const { seq, result, builderOverrides } = postToWorker(type, {
          rows: expanded, team, options, enemy, endingRotationEnabled, endRotationStartsEarlier, ...extra(collapseMap)
        });
        latestSeqByType[type] = seq;
        let data: any;
        try {
          data = await result;
        } catch (err) {
          console.error(`[useRotationStore] ${type} failed`, err);
          if (seq === latestSeqByType[type]) set({ isCalculating: false });
          return null;
        }
        if (seq !== latestSeqByType[type]) return null;

        const evaluatedRows = collapseRepeatResults(data.evaluatedRows, collapseMap, rows);
        evaluatedRows.forEach((row: any, i: number) => {
          if (!row.id) row.id = rows[i]?.id || crypto.randomUUID();
        });
        return { data, evaluatedRows, collapseMap, rows, team, options, endingRotationEnabled, endRotationStartsEarlier, builderOverrides };
      };

      const repeatBlockCrossesCurrentLoop = (startIndex: number, endIndex: number): boolean =>
        repeatCrossesLoopBoundary(startIndex, endIndex, get().loopStartIndex, SetLoopEndCommand.findPrevIndex(get().rows));

      return {
        rows: [makeBlankRow()],
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
        substatWorthEnabled: false,
        results: null,
        resultsUnits: null,
        isCalculating: false,
        timelineRows: [],
        timelineLoopStartIndex: null,
        timelineActive: false,

        setTimelineActive: (active: boolean) => {
          if (get().timelineActive === active) return;
          set({ timelineActive: active });
          // Hit dots need priced hits.
          if (active) get().recalculate(false, true);
        },

        setStartEnergy: (val: boolean) => {
          set({ startEnergy: val });
          get().recalculate();
        },
        setStartConcerto: (val: boolean) => {
          set({ startConcerto: val });
          get().recalculate();
        },
        setSubstatWorthEnabled: (val: boolean) => set({ substatWorthEnabled: val }),
        checkBuilderStaleness: () => {
          const { results, isStale, builderOverridesSnapshot } = get();
          if (!results || isStale) return;
          const team = useRosterStore.getState().team;
          const currentSnapshot = JSON.stringify(buildBuilderPayload(team).builderOverrides);
          if (currentSnapshot !== builderOverridesSnapshot) set({ isStale: true });
        },
        setSelectedIndices: (indices: number[]) => set({ selectedIndices: indices }),

        addRow: (unit: string = '', action: string = '', index?: number) => {
          historyManager.execute(cmd.add(makeRow({ unit, action, timing: 'Auto' }), index));
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
          const commands: Command[] = computeRepeatBlockRebalanceOnDelete(rows, indices).map(e => cmd.editFields(e.index, e.oldValues, e.newValues));
          commands.push(cmd.remove(DeleteRowsCommand.computeDeletedData(rows, indices), clearSelectionAndRecalc));
          runCommands(commands);
        },

        moveRows: (indicesToMove: number[], targetIndex: number) => {
          // Authored fields only; keeps the persisted undo stack small.
          const previousRowsSnapshot = get().rows.map(r => ({ id: r.id, ...toPersistedRow(r) }));
          historyManager.execute(new MoveRowsCommand(getRawRows, setRawRows, indicesToMove, targetIndex, previousRowsSnapshot, (newIndices?: number[]) => {
            set({ selectedIndices: newIndices || [] });
            triggerRecalc();
          }));
        },

        // Overwrites selected rows 1:1, inserts extras, deletes leftovers.
        // No selection: inserts before the trailing blank row.
        pasteRows: () => {
          const state = get();
          const clipboard = state.clipboard;
          if (clipboard.length === 0) return;
          const rows = state.rows;
          const selectedIndices = [...state.selectedIndices].filter(i => i !== rows.length - 1).sort((a, b) => a - b);
          const hasSelection = selectedIndices.length > 0;
          const startIndex = hasSelection ? selectedIndices[0] : Math.max(0, rows.length - 1);
          const maxEdits = hasSelection ? Math.min(clipboard.length, selectedIndices.length) : 0;

          // Pasted repeat blocks get fresh group ids.
          const remapGroupId = createGroupIdRemapper();
          const pasted = clipboard.map(row => withRemappedGroupIds(row, remapGroupId));

          const commands: Command[] = [];

          for (let i = 0; i < maxEdits; i++) {
            const rowIdx = selectedIndices[i];
            const data = pasted[i];
            const existing = rows[rowIdx];
            (['unit', 'action', 'timing', 'inputChoice', ...REPEAT_FIELDS] as const).forEach(field => {
              if (existing[field] !== data[field]) {
                commands.push(cmd.editValue(rowIdx, field, existing[field], data[field]));
              }
            });
          }

          if (clipboard.length > maxEdits) {
            const insertBase = startIndex + maxEdits;
            for (let i = maxEdits; i < clipboard.length; i++) {
              commands.push(cmd.add(makeRow(pasted[i]), insertBase + (i - maxEdits)));
            }
          }

          if (hasSelection && selectedIndices.length > maxEdits) {
            const rowsToDelete = selectedIndices.slice(maxEdits);
            commands.push(cmd.remove(DeleteRowsCommand.computeDeletedData(rows, rowsToDelete), clearSelectionAndRecalc));
          }

          runCommands(commands);
        },

        updateRowField: (index: number, field: string, value: any) => {
          const row = get().rows[index];
          const oldValue = row?.[field];
          if (oldValue === value) return;
          const commands: Command[] = [cmd.editValue(index, field, oldValue, value)];
          // An input pick indexes the old move's bindings.
          if (field === 'action' && row?.inputChoice !== undefined) commands.push(cmd.editValue(index, 'inputChoice', row.inputChoice, undefined));

          // Carry the unit forward to the next row.
          if (field === 'action' && value && row?.unit) {
            const nextRow = get().rows[index + 1];
            const moveData = DataLoader.mechanicsDB[value];
            const isOutro = !!moveData?.castTypes?.includes('Outro');
            if (nextRow && !nextRow.unit && !nextRow.action && !isOutro) {
              commands.push(cmd.editValue(index + 1, 'unit', nextRow.unit, row.unit));
              if (index + 1 === get().rows.length - 1) commands.push(cmd.add(makeBlankRow()));
            }
          }

          runCommands(commands);
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
          historyManager.execute(cmd.editFields(index, oldValues, fields));
        },

        setRowUnit: (index: number, newUnit: string) => {
          const row = get().rows[index];
          if (!row) return;

          const oldValues: Record<string, any> = {};
          const newValues: Record<string, any> = {};
          if (row.unit !== newUnit) { oldValues.unit = row.unit; newValues.unit = newUnit; }
          if (row.action !== '') { oldValues.action = row.action; newValues.action = ''; }

          const commands: Command[] = [];
          if (Object.keys(newValues).length > 0) commands.push(cmd.editFields(index, oldValues, newValues));
          if (newUnit && index === get().rows.length - 1) commands.push(cmd.add(makeBlankRow()));
          runCommands(commands);
        },

        setLoopStartOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopStartOverride === true) return;
          if (loopMarkerCrossesAnyRepeatBlock(get().rows, index, 'start')) return;
          historyManager.execute(cmd.setLoopStart(index, SetLoopStartCommand.findPrevIndex(get().rows)));
        },

        resetLoopStart: () => {
          const prevIndex = SetLoopStartCommand.findPrevIndex(get().rows);
          if (prevIndex === null) return;
          historyManager.execute(cmd.setLoopStart(null, prevIndex));
        },

        setLoopEndOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopEndOverride === true) return;
          if (loopMarkerCrossesAnyRepeatBlock(get().rows, index, 'end')) return;
          historyManager.execute(cmd.setLoopEnd(index, SetLoopEndCommand.findPrevIndex(get().rows)));
        },

        setLoopSplit: (index: number, value: boolean | undefined) => {
          get().updateRowField(index, 'loopSplit', value);
        },

        addRepeatBlock: (startIndex: number, endIndex: number) => {
          const rows = get().rows;
          if (!rows[startIndex]?.unit || !rows[endIndex]?.unit || endIndex < startIndex) return;
          if (repeatBlockCrossesCurrentLoop(startIndex, endIndex)) return;
          const groupId = crypto.randomUUID();
          runCommands([cmd.setRepeatStart(groupId, startIndex, null), cmd.setRepeatEnd(groupId, endIndex, null)]);
        },

        removeRepeatBlock: (groupId: string) => {
          const rows = get().rows;
          const startIdx = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          const endIdx = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          const commands: Command[] = [];
          if (startIdx !== null) commands.push(cmd.setRepeatStart(groupId, null, startIdx));
          if (endIdx !== null) commands.push(cmd.setRepeatEnd(groupId, null, endIdx));
          runCommands(commands);
        },

        setRepeatCount: (groupId: string, count: number) => {
          const rows = get().rows;
          const idx = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          if (idx === null) return;
          const clamped = Math.max(1, Math.floor(count) || 1);
          if (rows[idx].repeatCount === clamped) return;
          historyManager.execute(cmd.editValue(idx, 'repeatCount', rows[idx].repeatCount ?? DEFAULT_REPEAT_COUNT, clamped));
        },

        setRepeatFinalTiming: (groupId: string, timing: string | undefined) => {
          const rows = get().rows;
          const idx = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          if (idx === null) return;
          if (rows[idx].repeatFinalTiming === timing) return;
          historyManager.execute(cmd.editValue(idx, 'repeatFinalTiming', rows[idx].repeatFinalTiming, timing));
        },

        setRepeatBlockStartIndex: (groupId: string, index: number) => {
          const rows = get().rows;
          if (!rows[index]?.unit) return;
          const prevIndex = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          if (prevIndex === index) return;
          const endIdx = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          if (endIdx !== null) {
            if (index > endIdx) return;
            if (repeatBlockCrossesCurrentLoop(index, endIdx)) return;
          }
          historyManager.execute(cmd.setRepeatStart(groupId, index, prevIndex));
        },

        setRepeatBlockEndIndex: (groupId: string, index: number) => {
          const rows = get().rows;
          if (!rows[index]?.unit) return;
          const prevIndex = SetRepeatBlockEndCommand.findIndexForGroup(rows, groupId);
          if (prevIndex === index) return;
          const startIdx = SetRepeatBlockStartCommand.findIndexForGroup(rows, groupId);
          if (startIdx !== null) {
            if (index < startIdx) return;
            if (repeatBlockCrossesCurrentLoop(startIdx, index)) return;
          }
          historyManager.execute(cmd.setRepeatEnd(groupId, index, prevIndex));
        },

        // Removes the Ending Rotation tag and its appended rows.
        resetLoopEnd: () => {
          const { rows, endingRotationEnabled, endRotationStartsEarlier } = get();
          const endIdx = loopEndIndexOf(rows);
          const flagCommand = new SetEndingRotationFlagsCommand(
            vals => set(vals),
            { endingRotationEnabled, endRotationStartsEarlier },
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
          if (toDelete.length > 0) commands.push(cmd.remove(DeleteRowsCommand.computeDeletedData(rows, toDelete)));
          commands.push(cmd.setLoopEnd(null, endIdx), flagCommand);
          runCommands(commands);
        },

        setEndingRotationEnabled: (val: boolean) => {
          if (!val) {
            get().resetLoopEnd();
            return;
          }

          const rows = get().rows;
          if (loopEndIndexOf(rows) !== -1) {
            set({ endingRotationEnabled: true });
            return;
          }

          const lastContentIdx = rows.reduce((last, r, i) => (r.unit ? i : last), -1);
          if (lastContentIdx === -1) {
            set({ endingRotationEnabled: true });
            return;
          }

          const commands: Command[] = [cmd.setLoopEnd(lastContentIdx, null)];
          const loopStart = get().loopStartIndex;
          const fullLoopRows = rows.slice(loopStart, lastContentIdx + 1);
          // Prefill with the sub-loop crossing 2 minutes.
          const contentRows = rows.slice(0, lastContentIdx + 1);
          const { loopDuration } = loopTiming(contentRows.slice(0, loopStart), fullLoopRows);
          const mainDps = useRosterStore.getState().team[0]?.character;
          const { partialRows } = loopDuration > 0
            ? endingPlacement(contentRows.slice(0, loopStart), fullLoopRows, mainDps, get().endRotationStartsEarlier)
            : { partialRows: 0 };
          const crossingEnd = loopCycleBounds(fullLoopRows, mainDps).find(bound => bound > partialRows) ?? fullLoopRows.length;
          const loopRows = fullLoopRows.slice(partialRows, crossingEnd);
          const remapGroupId = createGroupIdRemapper();
          loopRows.forEach((r, i) => {
            commands.push(cmd.add(makeRow(withRemappedGroupIds(toClipboardRow(r), remapGroupId)), lastContentIdx + 1 + i));
          });
          runCommands(commands);
          set({ endingRotationEnabled: true });
        },

        setEndRotationStartsEarlier: (val: boolean) => {
          if (!get().endingRotationEnabled) return;
          set({ endRotationStartsEarlier: val });
          triggerRecalc();
        },

        // Timings and gauges only; no damage.
        recalculate: async (markStale: boolean = true, includeDamage: boolean = false) => {
          const run = await runWorkerCalc('recalculate', collapseMap => ({ includeDamage: includeDamage || get().timelineActive, collapseMap }));
          if (!run) return;
          const { data, evaluatedRows, collapseMap } = run;

          // Keep existing damageInstances by row id.
          const existingDamageMap = new Map(get().rows.filter(r => r.id).map(r => [r.id, r.damageInstances]));
          evaluatedRows.forEach((row: any) => {
            row.damageInstances = (row.damageInstances && row.damageInstances.length > 0)
              ? row.damageInstances
              : (existingDamageMap.get(row.id) || []);
          });

          set({
            rows: evaluatedRows,
            timelineRows: data.evaluatedRows,
            timelineLoopStartIndex: data.loopStartIndex,
            isStale: markStale ? true : get().isStale,
            loopStartIndex: collapseMap[data.loopStartIndex] ?? data.loopStartIndex,
            loopStartIsOverride: data.loopStartIsOverride,
            loopErrors: data.loopErrors,
            loopWarnings: data.loopWarnings,
            isCalculating: false
          });
        },

        // Full damage calculation (Calculate button).
        calculateDamage: async () => {
          const { loopStartIndex } = get();
          const run = await runWorkerCalc('calculateDamage', collapseMap => {
            // Map loopStartIndex onto the expanded rows.
            const expandedLoopStartIndex = collapseMap.indexOf(loopStartIndex);
            return {
              loopStartIndex: expandedLoopStartIndex === -1 ? loopStartIndex : expandedLoopStartIndex,
              substatWorth: get().substatWorthEnabled
            };
          });
          if (!run) return;
          const { data, evaluatedRows, rows, team, options, endingRotationEnabled, endRotationStartsEarlier, builderOverrides } = run;

          set({
            rows: evaluatedRows,
            timelineRows: data.evaluatedRows,
            timelineLoopStartIndex: data.loopStartIndex,
            isStale: false,
            results: data.results,
            resultsUnits: teamCharacters(team),
            isCalculating: false,
            builderOverridesSnapshot: JSON.stringify(builderOverrides)
          });

          useRotationHistoryStore.getState().addEntry({
            team,
            rotation: rows.map(toSavedRow),
            settings: { ...options, endingRotationEnabled, endRotationStartsEarlier },
            results: data.results,
            enemy: { ...useRosterStore.getState().enemy }
          });
        },

        undo: () => {
          historyManager.undo();
        },

        redo: () => {
          historyManager.redo();
        },

        importRotation: (rows: RotationRowFields[], settings?: RotationSettingsInput) => {
          historyManager.clear();
          const idedRows: RotationRow[] = rows.map(r => ({ ...r, id: crypto.randomUUID() }));
          const trailingEmpty = makeBlankRow();
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
      storage: persistStorage(),
      partialize: (state) => ({
        rows: state.rows.map(toPersistedRow),
        startEnergy: state.startEnergy,
        startConcerto: state.startConcerto,
        endingRotationEnabled: state.endingRotationEnabled,
        endRotationStartsEarlier: state.endRotationStartsEarlier,
        substatWorthEnabled: state.substatWorthEnabled,
        results: state.results,
        resultsUnits: state.resultsUnits,
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
      // Assign row ids (persisted rows have none).
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<RotationState>) };
        return { ...merged, rows: merged.rows.map(r => (r.id ? r : { ...r, id: crypto.randomUUID() })) };
      },
      // Restores undo/redo stacks without re-running commands.
      onRehydrateStorage: () => state => {
        if (!state) return;
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
    }
  )
);