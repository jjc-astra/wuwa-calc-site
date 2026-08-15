import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TimelineEngine } from '../logic/TimelineEngine';
import { CombatCalculator } from '../logic/CombatCalculator';
import { useRosterStore } from './useRosterStore';
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
  loopErrorMsg: string | null;
  loopWarningMsg: string | null;

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
  recalculate: () => void;
  calculateDamage: () => void;
  undo: () => void;
  redo: () => void;
  importRotation: (rows: RotationRow[], settings?: { startEnergy?: boolean; startConcerto?: boolean }) => void;
}

// A manual override (a row flagged `loopStartOverride`) always wins. Otherwise, auto-detect:
// the loop starts right after the main DPS's first Outro in the rotation, since that's what
// ends the opener. No Outro found, or nothing follows it, means there's no distinct opener --
// the whole rotation is the loop.
const findLoopStart = (rows: RotationRow[], mainDps: string | undefined): { index: number; isOverride: boolean } => {
  const overrideIndex = rows.findIndex(r => r.loopStartOverride === true && !!r.unit);
  if (overrideIndex !== -1) return { index: overrideIndex, isOverride: true };

  if (mainDps) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.unit === mainDps && Array.isArray(row.castTypes) && row.castTypes.includes('Outro')) {
        const next = i + 1;
        if (next < rows.length && rows[next]?.unit) return { index: next, isOverride: false };
        return { index: 0, isOverride: false };
      }
    }
  }
  return { index: 0, isOverride: false };
};

const historyManager = new HistoryManager();

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
        loopErrorMsg: null,
        loopWarningMsg: null,

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
        recalculate: () => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows } = get();
          const existingDamageMap = new Map(rows.map((r, i) => [i, r.damageInstances]));
          const evaluatedRows = TimelineEngine.recalculateState(rows, team, { startEnergy, startConcerto }, enemy);

          evaluatedRows.forEach((row: any, i: number) => {
            row.damageInstances = existingDamageMap.get(i) || row.damageInstances || [];
          });

          const { index: loopStartIndex, isOverride: loopStartIsOverride } = findLoopStart(evaluatedRows, team[0]?.character);
          const { errorMsg: loopErrorMsg, warningMsg: loopWarningMsg } = TimelineEngine.analyzeLoop(
            evaluatedRows,
            team,
            { startEnergy, startConcerto },
            enemy,
            loopStartIndex
          );

          set({ rows: evaluatedRows, isStale: true, loopStartIndex, loopStartIsOverride, loopErrorMsg, loopWarningMsg });
        },

        // Manual Combat Calculation (Triggered exclusively by the "Calculate" button)
        calculateDamage: () => {
          const team = useRosterStore.getState().team;
          const enemy = useRosterStore.getState().enemy;
          const { startEnergy, startConcerto, rows } = get();

          const evaluatedRows = TimelineEngine.recalculateState(rows, team, { startEnergy, startConcerto }, enemy);
          let runningEnemyHp = enemy.hp;

          evaluatedRows.forEach((row: any) => {
            row.damageInstances = [];
            if (row._pendingHits && row._pendingHits.length > 0) {
              row._pendingHits.forEach((hit: any) => {
                hit.context.enemyHp = runningEnemyHp;
                const result = CombatCalculator.calculateDamageInstance(hit.config, hit.context, team);
                runningEnemyHp = Math.max(0, runningEnemyHp - result.total);
                row.damageInstances.push(result);
              });
            }
          });
          set({ rows: evaluatedRows, isStale: false });
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
        startConcerto: state.startConcerto
      }),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            setTimeout(() => {
              state.recalculate();
            }, 100);
          }
        };
      }
    }
  )
);