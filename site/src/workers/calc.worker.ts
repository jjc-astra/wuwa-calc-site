// Runs the simulation pipeline (TimelineEngine + CombatCalculator + ResultsCalculator) off the
// main thread, with its own separate DataLoader -- compiled DSL trigger-rule functions can't be
// structured-cloned, so there's no way to share one instance across postMessage anyway.
import { TimelineEngine } from '../logic/TimelineEngine';
import { buildRotationResults, buildRotationSummary, populateDamageInstances, previewEndingRotationTiming, type SharedExtendedRun } from '../logic/ResultsCalculator';
import { DataLoader, type DataSeed } from '../utils/DataLoader';
import { applyBuilderOverridesToDataLoader, overriddenEntities } from './builderOverridePayload';
import { getTeamEntityRefs } from '../utils/TeamUtils';

let ready: Promise<void> | null = null;
// A seed only counts on this worker's first message.
const getReady = (seed?: DataSeed) => ready ?? (ready = DataLoader.initDatabases(seed));
// Entities the last request's Builder edits were applied to, undone before the next one.
let editedEntities: string[] = [];

// The last 'recalculate' run, which a Calculate press on the same inputs reuses instead of
// simulating the table and Ending Rotation preview again.
interface RecalcRun {
  key: string;
  // The table pass, before the Ending Rotation tail is spliced in (what the results pass reads).
  baseRows: any[];
  rows: any[];
  loopStartIndex: number;
  shared: SharedExtendedRun;
}
let lastRecalc: RecalcRun | null = null;

// Everything a run's output depends on: the rotation, team, settings, Builder edits, and the
// content versions of the data files it reads. Taken before the run, which mutates rows and team.
function runKey(payload: any): string {
  const files = [
    ...DATABASE_FILES,
    ...getTeamEntityRefs(payload.team, { includeSystem: true, dedupe: true }).map(ref => DataLoader.mechanicPath(ref.folder, ref.name))
  ].map(path => DataLoader.currentHash(path) ?? '');
  return JSON.stringify([
    payload.rows, payload.team, payload.options, payload.enemy,
    !!payload.endingRotationEnabled, !!payload.endRotationStartsEarlier, payload.builderOverrides, files
  ]);
}
const DATABASE_FILES = ['db_characters.json', 'db_weapons.json', 'db_builds.json', 'db_echoes.json'];

// Main-thread-only reply data: never read on the page, and each queued hit carries a full
// state snapshot, so it would roughly double what crosses back.
const WORKER_ONLY_KEYS = ['_pendingHits'];

// Drops function-valued properties (compiled trigger-rule functions) and `omit` keys before a
// result crosses back to the main thread -- structured clone handles the circular
// prevRow/nextRow links fine.
function stripForReply(value: any, omit: ReadonlySet<string>, seen = new WeakMap<object, any>()): any {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone: any = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === 'function' || omit.has(key)) continue;
    clone[key] = v && typeof v === 'object' ? stripForReply(v, omit, seen) : v;
  }
  return clone;
}
const REPLY_OMIT = new Set(WORKER_ONLY_KEYS);
// A plain recalculate's reply leaves damage out too; the page keeps the rows' last damage.
const REPLY_OMIT_NO_DAMAGE = new Set([...WORKER_ONLY_KEYS, 'damageInstances']);

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
      const key = runKey(payload);
      const baseRows = TimelineEngine.recalculateState(rows, team, options, enemy);
      // Always priced (it's cheap) so a Calculate press can reuse this run; only sent back when
      // asked for (the Timeline's hit dots, RotationBuilder's mount-effect refresh).
      populateDamageInstances(baseRows, enemy, team);
      const { index: loopStartIndex, isOverride: loopStartIsOverride } = TimelineEngine.findLoopStart(baseRows, team[0]?.character, payload.collapseMap);
      // A plain single pass shows the Ending Rotation's rows right after the one loop rep in
      // front of them -- re-time just that tail to reflect where it actually lands.
      const shared: SharedExtendedRun = {};
      const evaluatedRows = payload.endingRotationEnabled
        ? previewEndingRotationTiming(baseRows, team, options, enemy, loopStartIndex, true, !!payload.endRotationStartsEarlier, shared)
        : baseRows;
      // The loop check reads a second loop rep: the preview already simulated one (opener + N
      // reps + ending) when N >= 2, otherwise analyzeLoop runs opener + 2 reps itself.
      const preview = shared.run;
      const { errors: loopErrors, warnings: loopWarnings } = preview && preview.reps >= 2
        ? TimelineEngine.loopIssues(preview.evaluatedRows, preview.openerLength + preview.loopLength, preview.openerLength + 2 * preview.loopLength)
        : TimelineEngine.analyzeLoop(baseRows, team, options, enemy, loopStartIndex);
      lastRecalc = { key, baseRows, rows: evaluatedRows, loopStartIndex, shared };
      worker.postMessage({
        id,
        ok: true,
        evaluatedRows: stripForReply(evaluatedRows, payload.includeDamage ? REPLY_OMIT : REPLY_OMIT_NO_DAMAGE),
        loopStartIndex,
        loopStartIsOverride,
        loopErrors,
        loopWarnings
      });
    } else if (type === 'calculateDamage') {
      const { rows, team, options, enemy, endingRotationEnabled, endRotationStartsEarlier } = payload;

      // summaryOnly returns just DPS + contribution, skipping the per-row breakdown and timeline rows.
      const summaryOnly = !!payload.summaryOnly;
      // The live calculator's last recalculate already ran these exact inputs (and the loop start
      // it passes is that run's).
      const reusable = !summaryOnly && lastRecalc?.key === runKey(payload) && payload.loopStartIndex === lastRecalc.loopStartIndex
        ? lastRecalc
        : null;
      let baseRows: any[];
      let evaluatedRows: any[];
      let loopStartIndex: number;
      let shared: SharedExtendedRun;
      if (reusable) {
        ({ baseRows, rows: evaluatedRows, loopStartIndex } = reusable);
        // A copy: the results pass may record its own run here.
        shared = { ...reusable.shared };
      } else {
        baseRows = TimelineEngine.recalculateState(rows, team, options, enemy);
        if (!summaryOnly) populateDamageInstances(baseRows, enemy, team);
        // The live calculator passes the loop start it already has; one-shot callers omit it.
        loopStartIndex = typeof payload.loopStartIndex === 'number'
          ? payload.loopStartIndex
          : TimelineEngine.findLoopStart(baseRows, team[0]?.character).index;
        // Same re-timing as the 'recalculate' preview above, or Calculate would overwrite the
        // Ending Rotation rows' columns with the plain single-pass evaluation.
        shared = {};
        evaluatedRows = endingRotationEnabled
          ? previewEndingRotationTiming(baseRows, team, options, enemy, loopStartIndex, !summaryOnly, !!endRotationStartsEarlier, shared)
          : baseRows;
      }

      // Extended (opener + N-loop-repetition) pass -- feeds the Results panel. Reuses the Ending
      // Rotation preview's simulation when it ran the same timeline.
      const args = [baseRows, team, options, enemy, loopStartIndex, endingRotationEnabled, !!endRotationStartsEarlier, shared] as const;
      if (summaryOnly) {
        worker.postMessage({ id, ok: true, results: buildRotationSummary(...args) });
      } else {
        const results = buildRotationResults(args, { withSubstatWorth: payload.substatWorth !== false });
        worker.postMessage({ id, ok: true, evaluatedRows: stripForReply(evaluatedRows, REPLY_OMIT), loopStartIndex, results });
      }
    }
  } catch (err: any) {
    worker.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
