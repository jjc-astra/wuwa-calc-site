import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postToWorker } from '../workers/calcWorkerClient';
import { buildBuilderPayload } from '../workers/builderOverridePayload';
import type { RotationResults } from '../types/results';
import { useRosterStore } from './useRosterStore';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { useRotationHistoryStore } from './useRotationHistoryStore';
import {
  HistoryManager,
  AddRowCommand,
  DeleteRowsCommand,
  EditValueCommand,
  EditFieldsCommand,
  MoveRowsCommand,
  SetLoopStartCommand,
  SetLoopEndCommand,
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
  loopEndOverride?: boolean;
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
  endingRotationEnabled: boolean;
  // True: sim one fewer loop rep before the Ending Rotation splice, so it replaces/extends
  // the final loop instead of tacking on after it.
  endRotationStartsEarlier: boolean;
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
  setLoopEndOverride: (index: number) => void;
  resetLoopEnd: () => void;
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
  importRotation: (rows: RotationRow[], settings?: { startEnergy?: boolean; startConcerto?: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean }) => void;
}

const historyManager = new HistoryManager();

// Simulation pipeline runs in a worker (postToWorker) so long rotations never block the UI thread.

// Tracked per request type, not globally -- a background recalculate() can't invalidate a
// just-landed calculateDamage() (Calculate press).
const latestSeqByType: Record<'recalculate' | 'calculateDamage', number> = { recalculate: 0, calculateDamage: 0 };

export const useRotationStore = create<RotationState>()(
  persist(
    (set, get) => {
      historyManager.setOnChangeCallback((canUndo: boolean, canRedo: boolean) => {
        set({ canUndo, canRedo });
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

        setLoopEndOverride: (index: number) => {
          const row = get().rows[index];
          if (!row || !row.unit || row.loopEndOverride === true) return;
          const cmd = new SetLoopEndCommand(getRawRows, setRawRows, index, triggerRecalc);
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
          const flagCommand: Command = {
            execute: () => set({ endingRotationEnabled: false, endRotationStartsEarlier: false }),
            undo: () => set({ endingRotationEnabled: wasEnabled, endRotationStartsEarlier: wasStartingEarlier })
          };

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
          if (toDelete.length > 0) commands.push(new DeleteRowsCommand(getRawRows, setRawRows, toDelete, triggerRecalc));
          commands.push(new SetLoopEndCommand(getRawRows, setRawRows, null, triggerRecalc));
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
            new SetLoopEndCommand(getRawRows, setRawRows, lastContentIdx, triggerRecalc)
          ];
          const loopStart = get().loopStartIndex;
          const loopRows = rows.slice(loopStart, lastContentIdx + 1);
          loopRows.forEach((r, i) => {
            const { loopStartOverride, loopEndOverride, ...clean } = r;
            const newRow: RotationRow = { ...clean, unit: r.unit, action: r.action, timing: r.timing, offset: 0 };
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

          set({ isCalculating: true });
          const { seq, result } = postToWorker('recalculate', { rows, team, options, enemy, includeDamage, endingRotationEnabled, endRotationStartsEarlier, staleRefs, ...buildBuilderPayload(team) });
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
          const evaluatedRows = data.evaluatedRows;
          evaluatedRows.forEach((row: any, i: number) => {
            row.damageInstances = (row.damageInstances && row.damageInstances.length > 0)
              ? row.damageInstances
              : (existingDamageMap.get(i) || []);
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

        // Runs full combat damage -- only triggered by the "Calculate" button.
        calculateDamage: async () => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier } = get();
          const options = { startEnergy, startConcerto };

          // Evicts stale mechanic JSONs so Calculate runs against current data; staleRefs is
          // also passed to the worker so its own DataLoader instance drops the same entries.
          const staleRefs = await checkTeamFreshness(team);

          set({ isCalculating: true });
          const { seq, result } = postToWorker('calculateDamage', { rows, team, options, enemy, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier, staleRefs, ...buildBuilderPayload(team) });
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

          set({ rows: data.evaluatedRows, isStale: false, results: data.results, isCalculating: false });

          // One history row per successful Calculate press, in the same shape Export Rotation uses.
          useRotationHistoryStore.getState().addEntry({
            team: team.map(slot => {
              const { domRef, ...clean } = slot as any;
              return clean;
            }),
            rotation: rows.map(({ unit, action, timing, loopStartOverride, loopEndOverride }) => ({
              unit,
              action,
              timing,
              ...(loopStartOverride === true && { loopStartOverride: true }),
              ...(loopEndOverride === true && { loopEndOverride: true })
            })),
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

        importRotation: (rows: RotationRow[], settings?: { startEnergy?: boolean; startConcerto?: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean }) => {
          historyManager.clear();
          const trailingEmpty: RotationRow = { unit: '', action: '', timing: 'Auto', offset: 0 };
          const withTrailingRow = rows.length > 0 && rows[rows.length - 1].unit
            ? [...rows, trailingEmpty]
            : (rows.length > 0 ? rows : [trailingEmpty]);
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
      partialize: (state) => ({
        rows: state.rows.map(({ unit, action, timing, offset, manualOffset, loopStartOverride, loopEndOverride }) => ({
          unit,
          action,
          timing,
          ...(offset !== undefined && { offset }),
          ...(manualOffset !== undefined && { manualOffset }),
          ...(loopStartOverride === true && { loopStartOverride: true }),
          ...(loopEndOverride === true && { loopEndOverride: true })
        })),
        startEnergy: state.startEnergy,
        startConcerto: state.startConcerto,
        endingRotationEnabled: state.endingRotationEnabled,
        endRotationStartsEarlier: state.endRotationStartsEarlier,
        // Last Calculate press's output, so a reload still shows Results instead of "No Results Yet".
        results: state.results,
        isStale: state.isStale,
        loopStartIndex: state.loopStartIndex,
        loopStartIsOverride: state.loopStartIsOverride,
        loopErrors: state.loopErrors,
        loopWarnings: state.loopWarnings
      })
      // No auto-recalculate on rehydrate -- this store loads app-wide; RotationBuilder's mount
      // effect recalculates once the calculator page actually opens.
    }
  )
);