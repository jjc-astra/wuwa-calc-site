// Runs the simulation pipeline (TimelineEngine + CombatCalculator + ResultsCalculator) off the
// main thread, with its own separate DataLoader -- compiled DSL trigger-rule functions can't be
// structured-cloned, so there's no way to share one instance across postMessage anyway.
import { TimelineEngine } from '../logic/TimelineEngine';
import { buildRotationResults, buildRotationSummary, populateDamageInstances, previewEndingRotationTiming, type SharedExtendedRun } from '../logic/ResultsCalculator';
import { DataLoader, type DataSeed } from '../utils/DataLoader';
import { applyBuilderOverridesToDataLoader } from './builderOverridePayload';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import { overriddenEntities } from './builderOverridePayload';

let ready: Promise<void> | null = null;
// A seed only counts on this worker's first message.
const getReady = (seed?: DataSeed) => ready ?? (ready = DataLoader.initDatabases(seed));
// Entities the last request's Builder edits were applied to, undone before the next one.
let editedEntities: string[] = [];

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
    await getReady(payload?.seed);
    if (payload?.manifests) DataLoader.adoptManifests(payload.manifests);
    // Pre-warm: databases only, so it can overlap a real request on the same worker.
    if (type === 'warmup') {
      worker.postMessage({ id, ok: true });
      return;
    }

    // Back to as-fetched, so an edit since removed (Reset Cache, a deleted node) doesn't stick.
    editedEntities.forEach(name => DataLoader.restorePristine(name));
    // Drops the team's mechanics whose file changed since this worker loaded them (against the
    // page's manifests, adopted above), so they reload current.
    getTeamEntityRefs(payload.team, { includeSystem: true, dedupe: true }).forEach(ref => {
      if (DataLoader.mechanicChanged(ref.folder, ref.name)) DataLoader.clearMechanicCache(ref.folder, ref.name);
    });

    await DataLoader.loadTeamMechanics(payload.team);
    // The page's current Builder edits for this team, on top of the pristine data.
    applyBuilderOverridesToDataLoader(payload.builderOverrides);
    editedEntities = overriddenEntities(payload.builderOverrides);

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

      // summaryOnly returns just DPS + contribution, skipping the per-row breakdown and timeline rows.
      const summaryOnly = !!payload.summaryOnly;
      let evaluatedRows = TimelineEngine.recalculateState(rows, team, options, enemy);
      if (!summaryOnly) populateDamageInstances(evaluatedRows, enemy, team);
      // The live calculator passes the loop start it already has; one-shot callers omit it.
      const loopStartIndex: number = typeof payload.loopStartIndex === 'number'
        ? payload.loopStartIndex
        : TimelineEngine.findLoopStart(evaluatedRows, team[0]?.character).index;
      // Same re-timing as the 'recalculate' preview above, or Calculate would overwrite the
      // Ending Rotation rows' columns with the plain single-pass evaluation.
      const shared: SharedExtendedRun = {};
      if (endingRotationEnabled) {
        evaluatedRows = previewEndingRotationTiming(evaluatedRows, team, options, enemy, loopStartIndex, !summaryOnly, !!endRotationStartsEarlier, shared);
      }

      // Extended (opener + N-loop-repetition) pass -- feeds the Results panel. Reuses the Ending
      // Rotation preview's simulation when it ran the same timeline.
      const args = [rows, team, options, enemy, loopStartIndex, endingRotationEnabled, !!endRotationStartsEarlier, shared] as const;
      if (summaryOnly) {
        worker.postMessage({ id, ok: true, results: buildRotationSummary(...args) });
      } else {
        const results = buildRotationResults(...args);
        worker.postMessage({ id, ok: true, evaluatedRows: stripFunctions(evaluatedRows), loopStartIndex, results });
      }
    }
  } catch (err: any) {
    worker.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
