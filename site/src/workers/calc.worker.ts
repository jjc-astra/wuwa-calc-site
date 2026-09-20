// Runs the simulation pipeline (TimelineEngine + CombatCalculator + ResultsCalculator) off the
// main thread, with its own separate DataLoader -- compiled DSL trigger-rule functions can't be
// structured-cloned, so there's no way to share one instance across postMessage anyway.
import { TimelineEngine } from '../logic/TimelineEngine';
import { buildRotationResults, populateDamageInstances, previewEndingRotationTiming, type SharedExtendedRun } from '../logic/ResultsCalculator';
import { DataLoader } from '../utils/DataLoader';
import { applyBuilderOverridesToDataLoader } from './builderOverridePayload';

let ready: Promise<void> | null = null;
const getReady = () => ready ?? (ready = DataLoader.initDatabases());

// Drops function-valued properties (compiled trigger-rule functions) before a result crosses
// back to the main thread -- structured clone handles the circular prevRow/nextRow links fine.
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

    // Only force a pristine reset below when this team actually has something cached in the
    // builder, or every Calculate press pays for extra JSON fetches for nothing.
    const overrides = payload.builderOverrides;
    const hasOverrides = !!overrides && (
      Object.keys(overrides.editedMechanics || {}).length > 0 ||
      Object.keys(overrides.editedBaseStats || {}).length > 0 ||
      (overrides.deletedMechanicIds || []).length > 0
    );

    // Calculate press forces every entity to a pristine re-fetch -- otherwise a Builder edit
    // removal (Reset Cache, a deleted node) can't un-stick from this worker's long-lived cache.
    if (type === 'calculateDamage' && hasOverrides && payload.builderEntityRefs) {
      await DataLoader.initDatabases();
      payload.builderEntityRefs.forEach((ref: { name: string; folder: string }) =>
        DataLoader.clearMechanicCache(ref.folder, ref.name));
    }

    // Mirrors whatever the main thread's dataFreshness.ts check already evicted from its own
    // DataLoader, which this worker's separate instance never saw.
    if (Array.isArray(payload.staleRefs) && payload.staleRefs.length > 0) {
      payload.staleRefs.forEach((ref: { folder: string; name: string }) =>
        DataLoader.clearMechanicCache(ref.folder, ref.name));
    }

    await DataLoader.loadTeamMechanics(payload.team);
    // Mirrors useBuilderStore.setActiveChar's "replay edits after the pristine fetch" step,
    // against this worker's separate DataLoader instance -- a no-op with no cached edits.
    applyBuilderOverridesToDataLoader(payload.builderOverrides);

    if (type === 'recalculate') {
      const { rows, team, options, enemy } = payload;
      let evaluatedRows = TimelineEngine.recalculateState(rows, team, options, enemy);
      // Optional -- plain live-preview recalculate skips this to stay cheap; RotationBuilder's
      // mount-effect refresh asks for it to populate the DMG column on load too.
      if (payload.includeDamage) populateDamageInstances(evaluatedRows, enemy, team);
      const { index: loopStartIndex, isOverride: loopStartIsOverride } = TimelineEngine.findLoopStart(evaluatedRows, team[0]?.character, payload.collapseMap);
      const { errors: loopErrors, warnings: loopWarnings } = TimelineEngine.analyzeLoop(
        evaluatedRows, team, options, enemy, loopStartIndex
      );
      // A plain single pass shows the Ending Rotation's rows right after the one loop rep in
      // front of them -- re-time just that tail to reflect where it actually lands.
      if (payload.endingRotationEnabled) {
        evaluatedRows = previewEndingRotationTiming(evaluatedRows, team, options, enemy, loopStartIndex, !!payload.includeDamage, !!payload.endRotationStartsEarlier);
      }
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
      const { rows, team, options, enemy, endingRotationEnabled, endRotationStartsEarlier } = payload;

      let evaluatedRows = TimelineEngine.recalculateState(rows, team, options, enemy);
      populateDamageInstances(evaluatedRows, enemy, team);
      // The live calculator passes the loop start it already has; one-shot callers omit it.
      const loopStartIndex: number = typeof payload.loopStartIndex === 'number'
        ? payload.loopStartIndex
        : TimelineEngine.findLoopStart(evaluatedRows, team[0]?.character).index;
      // Same re-timing as the 'recalculate' preview above, or Calculate would overwrite the
      // Ending Rotation rows' columns with the plain single-pass evaluation.
      const shared: SharedExtendedRun = {};
      if (endingRotationEnabled) {
        evaluatedRows = previewEndingRotationTiming(evaluatedRows, team, options, enemy, loopStartIndex, true, !!endRotationStartsEarlier, shared);
      }

      // Extended (opener + N-loop-repetition) pass -- feeds the Results panel. Reuses the Ending
      // Rotation preview's simulation when it ran the same timeline.
      const results = buildRotationResults(rows, team, options, enemy, loopStartIndex, endingRotationEnabled, !!endRotationStartsEarlier, shared);

      worker.postMessage({ id, ok: true, evaluatedRows: stripFunctions(evaluatedRows), results });
    }
  } catch (err: any) {
    worker.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
