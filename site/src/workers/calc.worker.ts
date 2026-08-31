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

// Applies useBuilderStore's cached edits (if any) on top of whatever's currently loaded in
// this worker's DataLoader -- mirrors useBuilderStore.setActiveChar's own "replay edits after
// the pristine fetch" step exactly, just against the worker's separate DataLoader instance.
// A no-op for any entity the builder has no edits for (its overrides simply won't be present).
function applyBuilderOverrides(payload: any): void {
  const overrides = payload.builderOverrides;
  if (!overrides) return;
  Object.entries(overrides.editedBaseStats || {}).forEach(([name, stats]) => {
    const target = DataLoader.characterDB[name] || DataLoader.weaponDB[name];
    if (target) Object.assign(target, stats as object);
  });
  Object.entries(overrides.editedMechanics || {}).forEach(([id, node]) => {
    DataLoader.mechanicsDB[id] = node as any;
  });
  (overrides.deletedMechanicIds || []).forEach((id: string) => {
    delete DataLoader.mechanicsDB[id];
  });
}

worker.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await getReady();

    // Only bother forcing a pristine reset (below) when this team actually has *something*
    // cached in the builder -- otherwise every single Calculate press would pay for 4 extra
    // JSON fetches plus one per team entity for nothing, even for someone who's never opened
    // the Mechanics Builder at all.
    const overrides = payload.builderOverrides;
    const hasOverrides = !!overrides && (
      Object.keys(overrides.editedMechanics || {}).length > 0 ||
      Object.keys(overrides.editedBaseStats || {}).length > 0 ||
      (overrides.deletedMechanicIds || []).length > 0
    );

    // A real Calculate press (not the cheap live-preview recalculate) forces every entity the
    // team actually uses back to a pristine re-fetch first -- otherwise an edit *removed* in
    // the Mechanics Builder (a Reset Cache, a deleted node) would have no way to un-stick from
    // this worker's own long-lived mechanicsDB/characterDB, which only ever gets new data
    // merged in, never reverted. 'Generic' is deliberately skipped here: its cache key is
    // already correctly populated once at worker startup (getReady() above), and re-clearing
    // it hits an existing loadMechanic/clearMechanicCache casing mismatch ('Generic' vs the
    // real lowercase generic.json) that would leave System mechanics missing rather than just
    // stale -- narrow enough (an edited Generic/System node staying stuck until the page
    // reloads) that skipping it here is far safer than risking every calculation breaking.
    if (type === 'calculateDamage' && hasOverrides && payload.builderEntityRefs) {
      await DataLoader.initDatabases();
      payload.builderEntityRefs
        .filter((ref: { folder: string }) => ref.folder !== 'generic')
        .forEach((ref: { name: string; folder: string }) => DataLoader.clearMechanicCache(ref.folder, ref.name));
    }

    await DataLoader.loadTeamMechanics(payload.team);
    applyBuilderOverrides(payload);

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
