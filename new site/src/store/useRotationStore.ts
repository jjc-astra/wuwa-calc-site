import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postToWorker } from '../workers/calcWorkerClient';
import type { RotationResults } from '../types/results';
import { useRosterStore } from './useRosterStore';
import { useRotationHistoryStore } from './useRotationHistoryStore';
import {
  HistoryManager,
  AddRowCommand,
  DeleteRowsCommand,
  EditValueCommand,
  EditFieldsCommand,
  MoveRowsCommand,
  SetLoopStartCommand,
  CompositeCommand
} from '../systems/HistoryManager';
import type { Command } from '../systems/HistoryManager';

export interface RotationRow {
  unit: string;
  action: string;
  timing: string;
  offset?: number;
  manualOffset?: number;
  loopStartOverride?: boolean;
  [key: string]: any;
}

interface RotationState {
  rows: RotationRow[];
  startEnergy: boolean;
  startConcerto: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isStale: boolean;
  selectedIndices: number[];
  clipboard: RotationRow[];
  loopStartIndex: number;
  loopStartIsOverride: boolean;
  loopErrors: string[];
  loopWarnings: string[];
  results: RotationResults | null;
  isCalculating: boolean;

  setStartEnergy: (val: boolean) => void;
  setStartConcerto: (val: boolean) => void;
  setStale: (val: boolean) => void;
  setSelectedIndices: (indices: number[]) => void;
  setClipboard: (rows: RotationRow[]) => void;

  addRow: (unit?: string, action?: string, index?: number) => void;
  deleteRows: (indices: number[]) => void;
  moveRows: (indicesToMove: number[], targetIndex: number) => void;
  pasteRows: () => void;
  updateRowField: (index: number, field: string, value: any) => void;
  updateRowFields: (index: number, fields: Record<string, any>) => void;
  setLoopStartOverride: (index: number) => void;
  resetLoopStart: () => void;

  executeCommand: (cmd: Command) => void;
  // markStale defaults true (a real edit always invalidates the last Calculate) -- pass false
  // for a purely informational refresh (e.g. the Calculator's mount effect re-deriving
  // gauges/loop info for a rehydrated-but-unedited rotation) that shouldn't itself flip a
  // freshly-restored `isStale: false` back to stale with nothing having actually changed.
  recalculate: (markStale?: boolean) => Promise<void>;
  calculateDamage: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  importRotation: (rows: RotationRow[], settings?: { startEnergy?: boolean; startConcerto?: boolean }) => void;
}

const historyManager = new HistoryManager();

// The actual TimelineEngine/CombatCalculator/ResultsCalculator run inside a worker instead of
// on the main thread (postToWorker, imported above), so a long rotation's simulation never
// freezes the UI while it runs -- see calcWorkerClient.ts for the worker/queue lifecycle,
// shared with the Rankings page's batch loader.

// Every call gets its own request id (returned by postToWorker), used both to match responses
// to requests and to detect staleness -- but staleness is tracked per type (recalculate vs
// calculateDamage), not globally. A recalculate() firing in the background (e.g. from an
// unrelated edit's triggerRecalc) must never invalidate an explicit calculateDamage() the user
// just triggered by pressing Calculate -- that's the one result that should always win once it
// lands, since it's a deliberate action, not an incidental background sync. Each type only
// checks itself for a newer in-flight/landed request of the *same* type.
const latestSeqByType: Record<'recalculate' | 'calculateDamage', number> = { recalculate: 0, calculateDamage: 0 };

export const useRotationStore = create<RotationState>()(
  persist(
    (set, get) => {
      historyManager.setOnChangeCallback((canUndo: boolean, canRedo: boolean) => {
        set({ canUndo, canRedo });
      });

      const getRawRows = () => get().rows;
      const setRawRows = (rows: RotationRow[]) => set({ rows });

      // Multi-row operations (paste, undo/redo of a paste) run as several Commands inside one
      // CompositeCommand, and each Command's execute()/undo() calls this individually -- without
      // coalescing, pasting N rows would re-run the full recalculation (now including the loop
      // analysis) N times in a row. Collapsing same-tick calls into one microtask-deferred
      // recalculate() fixes that with no perceptible delay (microtasks flush before the next
      // paint, so a single edit still updates effectively immediately).
      let recalcScheduled = false;
      const triggerRecalc = () => {
        if (recalcScheduled) return;
        recalcScheduled = true;
        queueMicrotask(() => {
          recalcScheduled = false;
          get().recalculate();
        });
      };

      return {
        rows: [{ unit: '', action: '', timing: 'Auto', offset: 0 }],
        startEnergy: true,
        startConcerto: false,
        canUndo: false,
        canRedo: false,
        isStale: false,
        selectedIndices: [],
        clipboard: [],
        loopStartIndex: 0,
        loopStartIsOverride: false,
        loopErrors: [],
        loopWarnings: [],
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
        setSelectedIndices: (indices: number[]) => set({ selectedIndices: indices }),
        setClipboard: (rows: RotationRow[]) => set({ clipboard: rows }),

        addRow: (unit: string = '', action: string = '', index?: number) => {
          const newRow: RotationRow = { unit, action, timing: 'Auto', offset: 0 };
          const cmd = new AddRowCommand(getRawRows, setRawRows, newRow, index, triggerRecalc);
          historyManager.execute(cmd);
        },

        deleteRows: (indices: number[]) => {
          const cmd = new DeleteRowsCommand(getRawRows, setRawRows, indices, () => {
            set({ selectedIndices: [] });
            triggerRecalc();
          });
          historyManager.execute(cmd);
        },

        moveRows: (indicesToMove: number[], targetIndex: number) => {
          const cmd = new MoveRowsCommand(getRawRows, setRawRows, indicesToMove, targetIndex, (newIndices?: number[]) => {
            // Follow the moved rows to their new positions (undo has no well-defined
            // "new" position, so it just clears the selection instead).
            set({ selectedIndices: newIndices || [] });
            triggerRecalc();
          });
          historyManager.execute(cmd);
        },

        // Mirrors the old site: 1-to-1 overwrite of selected rows, extra clipboard rows are
        // inserted, and any selected rows left over once the clipboard runs out are deleted.
        // With nothing selected, clipboard rows are inserted before the trailing empty row.
        pasteRows: () => {
          const state = get();
          const clipboard = state.clipboard;
          if (clipboard.length === 0) return;
          const rows = state.rows;
          const selectedIndices = [...state.selectedIndices].filter(i => i !== rows.length - 1).sort((a, b) => a - b);
          const hasSelection = selectedIndices.length > 0;
          const startIndex = hasSelection ? selectedIndices[0] : Math.max(0, rows.length - 1);
          const maxEdits = hasSelection ? Math.min(clipboard.length, selectedIndices.length) : 0;

          const commands: Command[] = [];

          for (let i = 0; i < maxEdits; i++) {
            const rowIdx = selectedIndices[i];
            const data = clipboard[i];
            const existing = rows[rowIdx];
            (['unit', 'action', 'timing'] as const).forEach(field => {
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
              const newRow: RotationRow = { unit: data.unit, action: data.action, timing: data.timing, offset: 0 };
              commands.push(new AddRowCommand(getRawRows, setRawRows, newRow, targetIndex, triggerRecalc));
            }
          }

          if (hasSelection && selectedIndices.length > maxEdits) {
            const rowsToDelete = selectedIndices.slice(maxEdits);
            commands.push(new DeleteRowsCommand(getRawRows, setRawRows, rowsToDelete, () => {
              set({ selectedIndices: [] });
              triggerRecalc();
            }));
          }

          if (commands.length > 0) {
            historyManager.execute(new CompositeCommand(commands));
          }
        },

        updateRowField: (index: number, field: string, value: any) => {
          const oldValue = get().rows[index]?.[field];
          if (oldValue === value) return;
          const cmd = new EditValueCommand(getRawRows, setRawRows, index, field, oldValue, value, triggerRecalc);
          historyManager.execute(cmd);
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

        setLoopStartOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopStartOverride === true) return;
          const cmd = new SetLoopStartCommand(getRawRows, setRawRows, index, triggerRecalc);
          historyManager.execute(cmd);
        },

        resetLoopStart: () => {
          const hasOverride = get().rows.some(r => r.loopStartOverride === true);
          if (!hasOverride) return;
          const cmd = new SetLoopStartCommand(getRawRows, setRawRows, null, triggerRecalc);
          historyManager.execute(cmd);
        },

        executeCommand: (cmd: Command) => {
          historyManager.execute(cmd);
        },

        // Timeline/Gauges/Timings Recalculation (Only marks stale, does NOT run combat damage)
        // -- runs in the calc worker (see postToWorker above) so it never blocks the UI thread.
        recalculate: async (markStale: boolean = true) => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows } = get();
          const options = { startEnergy, startConcerto };

          set({ isCalculating: true });
          const { seq, result } = postToWorker('recalculate', { rows, team, options, enemy });
          latestSeqByType.recalculate = seq;
          let data: any;
          try {
            data = await result;
          } catch (err) {
            console.error('[useRotationStore] recalculate failed', err);
            if (seq === latestSeqByType.recalculate) set({ isCalculating: false });
            return;
          }
          // A newer recalculate() already landed (or is still in flight) by the time this one
          // came back -- its result is stale, so just drop it instead of clobbering fresher
          // state. calculateDamage() has its own independent tracking (see comment above),
          // so an interleaved Calculate press doesn't affect this check either way.
          if (seq !== latestSeqByType.recalculate) return;

          // Read the row-level damageInstances fresh, right now, rather than a snapshot taken
          // before this request was sent -- a calculateDamage() (or another recalculate())
          // could easily have finished and populated fresher per-row damage in the meantime,
          // and stomping that with whatever existed when this request started would silently
          // undo it.
          const existingDamageMap = new Map(get().rows.map((r, i) => [i, r.damageInstances]));
          const evaluatedRows = data.evaluatedRows;
          evaluatedRows.forEach((row: any, i: number) => {
            row.damageInstances = existingDamageMap.get(i) || row.damageInstances || [];
          });

          set({
            rows: evaluatedRows,
            isStale: markStale ? true : get().isStale,
            loopStartIndex: data.loopStartIndex,
            loopStartIsOverride: data.loopStartIsOverride,
            loopErrors: data.loopErrors,
            loopWarnings: data.loopWarnings,
            isCalculating: false
          });
        },

        // Manual Combat Calculation (Triggered exclusively by the "Calculate" button) -- also
        // runs in the calc worker, same reasoning as recalculate above.
        calculateDamage: async () => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows, loopStartIndex } = get();
          const options = { startEnergy, startConcerto };

          set({ isCalculating: true });
          const { seq, result } = postToWorker('calculateDamage', { rows, team, options, enemy, loopStartIndex });
          latestSeqByType.calculateDamage = seq;
          let data: any;
          try {
            data = await result;
          } catch (err) {
            console.error('[useRotationStore] calculateDamage failed', err);
            if (seq === latestSeqByType.calculateDamage) set({ isCalculating: false });
            return;
          }
          // Only a newer calculateDamage() (e.g. a second Calculate press before the first
          // returned) supersedes this -- an interleaved recalculate() does not.
          if (seq !== latestSeqByType.calculateDamage) return;

          set({ rows: data.evaluatedRows, isStale: false, results: data.results, isCalculating: false });

          // One history row per successful Calculate press -- snapshot the exact team/rotation
          // that produced this result, matching the shape Export Rotation writes (domRef
          // stripped, same {unit,action,timing,loopStartOverride?} row shape) so a saved entry
          // can round-trip through Restore Rotation identically.
          useRotationHistoryStore.getState().addEntry({
            team: team.map(slot => {
              const { domRef, ...clean } = slot as any;
              return clean;
            }),
            rotation: rows.map(({ unit, action, timing, loopStartOverride }) => ({
              unit,
              action,
              timing,
              ...(loopStartOverride === true && { loopStartOverride: true })
            })),
            settings: options,
            results: data.results
          });
        },

        undo: () => {
          historyManager.undo();
        },

        redo: () => {
          historyManager.redo();
        },

        importRotation: (rows: RotationRow[], settings?: { startEnergy?: boolean; startConcerto?: boolean }) => {
          historyManager.clear();
          const trailingEmpty: RotationRow = { unit: '', action: '', timing: 'Auto', offset: 0 };
          const withTrailingRow = rows.length > 0 && rows[rows.length - 1].unit
            ? [...rows, trailingEmpty]
            : (rows.length > 0 ? rows : [trailingEmpty]);
          set({
            rows: withTrailingRow,
            startEnergy: settings?.startEnergy ?? get().startEnergy,
            startConcerto: settings?.startConcerto ?? get().startConcerto,
            selectedIndices: []
          });
          get().recalculate();
        }
      };
    },
    {
      name: 'wuwa_calc_rotation_cache',
      partialize: (state) => ({
        rows: state.rows.map(({ unit, action, timing, offset, manualOffset, loopStartOverride }) => ({
          unit,
          action,
          timing,
          ...(offset !== undefined && { offset }),
          ...(manualOffset !== undefined && { manualOffset }),
          ...(loopStartOverride === true && { loopStartOverride: true })
        })),
        startEnergy: state.startEnergy,
        startConcerto: state.startConcerto,
        // The last Calculate press's output -- so reopening the Calculator (or reloading the
        // page) still shows the Results tab instead of "No Results Yet" until something
        // actually changes. isStale/loop* travel with it since they describe that same result
        // (isStale in particular has to survive the reload too, or a result computed against
        // an earlier rotation would silently look fresh).
        results: state.results,
        isStale: state.isStale,
        loopStartIndex: state.loopStartIndex,
        loopStartIsOverride: state.loopStartIsOverride,
        loopErrors: state.loopErrors,
        loopWarnings: state.loopWarnings
      }),
      // No auto-recalculate here on purpose -- this fires on every page load app-wide (this
      // store module is in the static import graph regardless of route), so triggering the
      // worker from here meant it ran even on the landing page. The calculator page itself
      // (RotationBuilder's mount effect) recalculates once when the user actually opens it.
    }
  )
);