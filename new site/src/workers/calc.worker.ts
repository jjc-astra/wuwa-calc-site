// src/workers/calc.worker.ts
// Runs the heavy rotation-simulation pipeline (TimelineEngine + CombatCalculator +
// ResultsCalculator) off the main thread, so editing a rotation or pressing Calculate never
// freezes the UI. This worker has its own separate module graph and its own DataLoader
// instance -- it loads the same mechanics JSON independently via fetch rather than sharing the
// main thread's already-loaded copy, since neither is there a way to share it across a
// postMessage boundary anyway (compiled DSL trigger-rule functions attached to mechanic data
// can't be structured-cloned).
import { TimelineEngine } from '../logic/TimelineEngine';
import { CombatCalculator } from '../logic/CombatCalculator';
import { buildRotationResults } from '../logic/ResultsCalculator';
import { DataLoader } from '../utils/DataLoader';

let ready: Promise<void> | null = null;
const getReady = () => ready ?? (ready = DataLoader.initDatabases());

// Drops function-valued properties (those compiled trigger-rule functions) before a result
// crosses back to the main thread -- structured clone already handles the engine's circular
// prevRow/nextRow links fine on its own, functions are the only actual blocker.
function stripFunctions(value: any, seen = new WeakMap<object, any>()): any {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone: any = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === 'function') continue;
    clone[key] = v && typeof v === 'object' ? stripFunctions(v, seen) : v;
  }
  return clone;
}

const worker = self as any;

worker.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await getReady();
    await DataLoader.loadTeamMechanics(payload.team);

    if (type === 'recalculate') {
      const { rows, team, options, enemy } = payload;
      const evaluatedRows = TimelineEngine.recalculateState(rows, team, options, enemy);
      const { index: loopStartIndex, isOverride: loopStartIsOverride } = TimelineEngine.findLoopStart(evaluatedRows, team[0]?.character);
      const { errors: loopErrors, warnings: loopWarnings } = TimelineEngine.analyzeLoop(
        evaluatedRows, team, options, enemy, loopStartIndex
      );
      worker.postMessage({
        id,
        ok: true,
        evaluatedRows: stripFunctions(evaluatedRows),
        loopStartIndex,
        loopStartIsOverride,
        loopErrors,
        loopWarnings
      });
    } else if (type === 'calculateDamage') {
      const { rows, team, options, enemy, loopStartIndex } = payload;

      // Short pass over the literal authored rows -- feeds the per-row damage-breakdown
      // dropdown in the rotation table, independent of the Results panel below.
      const evaluatedRows = TimelineEngine.recalculateState(rows, team, options, enemy);
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

      // Separate extended (opener + N-loop-repetition) pass -- feeds the Results panel.
      const results = buildRotationResults(rows, team, options, enemy, loopStartIndex);

      worker.postMessage({ id, ok: true, evaluatedRows: stripFunctions(evaluatedRows), results });
    }
  } catch (err: any) {
    worker.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
