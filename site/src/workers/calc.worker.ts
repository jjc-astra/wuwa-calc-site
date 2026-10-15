// Runs the simulation pipeline off the main thread, with its own DataLoader.
import { TimelineEngine } from '../logic/TimelineEngine';
import { buildRotationResults, buildRotationSummary, populateDamageInstances, previewEndingRotationTiming, type SharedExtendedRun } from '../logic/ResultsCalculator';
import { DataLoader, type DataSeed } from '../utils/DataLoader';
import { applyBuilderOverridesToDataLoader, overriddenEntities } from './builderOverridePayload';
import { getTeamEntityRefs } from '../utils/TeamUtils';

let ready: Promise<void> | null = null;
const getReady = (seed?: DataSeed) => ready ?? (ready = DataLoader.initDatabases(seed));
// Entities edited by the last request; restored before the next.
let editedEntities: string[] = [];

// Last 'recalculate' run, reused by Calculate on the same inputs.
interface RecalcRun {
  key: string;
  // Before the Ending Rotation splice.
  baseRows: any[];
  rows: any[];
  loopStartIndex: number;
  shared: SharedExtendedRun;
}
let lastRecalc: RecalcRun | null = null;

// Cache key over all run inputs. Take before the run mutates them.
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

// Never sent to the page.
const WORKER_ONLY_KEYS = ['_pendingHits'];

// Snapshot keys the page never reads.
const SNAPSHOT_OMIT = ['energyLog', 'availableTimings', 'offsetReasons', 'timelineEvents', 'damageInstances'];
const HIT_DATA_OMIT = new Set([...SNAPSHOT_OMIT, 'unitCombos', 'nextUnitActions', 'cooldowns', 'chargeCooldowns', 'unitStances', 'dropdownState', 'prevRow', 'nextRow']);
const DROPDOWN_OMIT = new Set(SNAPSHOT_OMIT);

const omitWithin = (key: string, holderKey: string): ReadonlySet<string> | null =>
  key === 'data' && holderKey === 'damageInstances' ? HIT_DATA_OMIT : key === 'dropdownState' ? DROPDOWN_OMIT : null;

// Stub for links to rows outside the reply.
const linkStub = (row: any) => ({ unit: row.unit, action: row.action, moveName: row.moveName, castTypes: row.castTypes, unitCombos: row.unitCombos });

// Copies rows for postMessage: no functions, `omit` keys, or unread state; outside links stubbed.
function stripForReply(rows: any[], omit: ReadonlySet<string>): any[] {
  const inReply = new Set(rows);
  const seen = new WeakMap<object, any>();
  const stubs = new WeakMap<object, any>();
  const copy = (value: any, key: string, holderKey: string): any => {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const clone: any = Array.isArray(value) ? [] : {};
    seen.set(value, clone);
    const extraOmit = omitWithin(key, holderKey);
    const inArray = Array.isArray(value);
    for (const k of Object.keys(value)) {
      let v = value[k];
      if (typeof v === 'function' || omit.has(k) || extraOmit?.has(k)) continue;
      if ((k === 'prevRow' || k === 'nextRow') && v && typeof v === 'object' && !inReply.has(v)) {
        if (!stubs.has(v)) stubs.set(v, linkStub(v));
        v = stubs.get(v);
      }
      clone[k] = v && typeof v === 'object' ? copy(v, inArray ? key : k, inArray ? holderKey : key) : v;
    }
    return clone;
  };
  return copy(rows, '', '');
}
const REPLY_OMIT = new Set(WORKER_ONLY_KEYS);
const REPLY_OMIT_NO_DAMAGE = new Set([...WORKER_ONLY_KEYS, 'damageInstances']);

const worker = self as any;

// Table pass: rows run once, loop start found, Ending Rotation re-timed.
function runTable(payload: any, withDamage: boolean) {
  const { rows, team, options, enemy } = payload;
  const baseRows = TimelineEngine.recalculateState(rows, team, options, enemy);
  if (withDamage) populateDamageInstances(baseRows, enemy, team);
  const found = typeof payload.loopStartIndex === 'number'
    ? { index: payload.loopStartIndex, isOverride: false }
    : TimelineEngine.findLoopStart(baseRows, team[0]?.character, payload.collapseMap);
  const shared: SharedExtendedRun = {};
  const evaluatedRows = payload.endingRotationEnabled
    ? previewEndingRotationTiming(baseRows, team, options, enemy, found.index, withDamage, !!payload.endRotationStartsEarlier, shared)
    : baseRows;
  return { baseRows, evaluatedRows, loopStartIndex: found.index, loopStartIsOverride: found.isOverride, shared };
}

worker.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await getReady(payload?.seed);
    if (payload?.manifests) DataLoader.adoptManifests(payload.manifests);
    // Pre-warm databases only.
    if (type === 'warmup') {
      worker.postMessage({ id, ok: true });
      return;
    }

    editedEntities.forEach(name => DataLoader.restorePristine(name));
    // Drop changed mechanics so they reload.
    getTeamEntityRefs(payload.team, { includeSystem: true, dedupe: true }).forEach(ref => {
      if (DataLoader.mechanicChanged(ref.folder, ref.name)) DataLoader.clearMechanicCache(ref.folder, ref.name);
    });

    await DataLoader.loadTeamMechanics(payload.team);
    applyBuilderOverridesToDataLoader(payload.builderOverrides);
    editedEntities = overriddenEntities(payload.builderOverrides);

    if (type === 'recalculate') {
      const key = runKey(payload);
      // Always priced so Calculate can reuse it; damage only sent when asked.
      const { baseRows, evaluatedRows, loopStartIndex, loopStartIsOverride, shared } = runTable(payload, true);
      const { team, options, enemy } = payload;
      // Reuse the preview's second rep when it has one.
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
      const { team, options, enemy, endingRotationEnabled, endRotationStartsEarlier } = payload;

      const summaryOnly = !!payload.summaryOnly;
      const reusable = !summaryOnly && lastRecalc?.key === runKey(payload) && payload.loopStartIndex === lastRecalc.loopStartIndex
        ? lastRecalc
        : null;
      let baseRows: any[];
      let evaluatedRows: any[];
      let loopStartIndex: number;
      let shared: SharedExtendedRun;
      if (reusable) {
        ({ baseRows, rows: evaluatedRows, loopStartIndex } = reusable);
        shared = { ...reusable.shared };
      } else {
        ({ baseRows, evaluatedRows, loopStartIndex, shared } = runTable(payload, !summaryOnly));
      }

      // Extended pass for the Results panel.
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
