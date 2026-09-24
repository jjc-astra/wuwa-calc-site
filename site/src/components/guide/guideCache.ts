// src/components/guide/guideCache.ts
// Persists a character's guide calcs -- every view opened, not just the default -- so coming
// back to the page reuses them instead of rerunning them. A saved copy records exactly what its
// results were calculated from (GuideDeps) and is dropped whole if any of it has changed since.
import calcVersion from 'virtual:calc-version';
import { DataLoader, RANKINGS_DIR } from '../../utils/DataLoader';
import { getTeamEntityRefs } from '../../utils/TeamUtils';
import { sha256Hex } from '../../utils/Common';
import { idbGet, idbPut } from '../../utils/idbStore';
import { useBuilderStore } from '../../store/useBuilderStore';
import { trimRowsForTimeline } from '../timeline/timelineLayout';
import type { PanelResults, RotationSummary } from '../../types/results';
import type { GuideEntry, GuideJob } from './guideModel';

export interface CachedFullRun {
  // Saved without dmgOverTimeSeries: the guide has no DMG Over Time panel.
  results: PanelResults;
  // Only drawn by the Timeline, so saved trimmed to its fields (trimRowsForTimeline).
  evaluatedRows: any[];
  loopStartIndex: number;
}

// What a set of results was calculated from: the calc code, each data file's content version
// (ranked runs, databases, mechanics) and a hash of the local Mechanics Builder edits per entity.
export interface GuideDeps {
  calcVersion: string;
  files: Record<string, string>;
  builderEdits: Record<string, string>;
}

export interface GuideCacheRecord {
  deps: GuideDeps;
  // Keyed by GuideJob.key, least recently used first.
  summaries: Record<string, RotationSummary>;
  full: Record<string, CachedFullRun>;
}

const STORE = 'guide-cache';
// Base stats, weapon stats, set/echo data and recommended builds.
const DATABASE_FILES = ['db_characters.json', 'db_weapons.json', 'db_echoes.json', 'db_builds.json'];
// Full runs are ~35 KB each (summaries ~2.5 KB); only the most recently used are kept.
const MAX_FULL_RUNS = 20;
const MAX_SUMMARIES = 400;

// The data files and Builder entities the given jobs are calculated from. The character's ranked
// runs (and the index the default team is picked from) always count: they decide what every job is.
export function depsOf(entries: GuideEntry[], jobs: GuideJob[]): { files: string[]; entities: string[] } {
  const refs = getTeamEntityRefs(jobs.flatMap(j => j.team), { includeSystem: true, dedupe: true });
  const files = [
    `${RANKINGS_DIR}/index.json`,
    ...entries.flatMap(e => [`${RANKINGS_DIR}/results/${e.id}`, `${RANKINGS_DIR}/rotations/${e.rotationFile}`]),
    ...DATABASE_FILES,
    ...refs.map(r => DataLoader.mechanicPath(r.folder, r.name))
  ];
  return { files: [...new Set(files)], entities: [...new Set(refs.map(r => r.name))] };
}

// The current versions of the given dependencies.
export async function readDeps(files: string[], entities: string[]): Promise<GuideDeps> {
  await DataLoader.refreshManifest();
  const { getTeamOverrides } = useBuilderStore.getState();
  const [fileVersions, editHashes] = await Promise.all([
    Promise.all(files.map(async path => [path, await DataLoader.contentVersion(path)] as const)),
    Promise.all(entities.map(async name => [name, await sha256Hex(JSON.stringify(getTeamOverrides([name])))] as const))
  ]);
  return { calcVersion, files: Object.fromEntries(fileVersions), builderEdits: Object.fromEntries(editHashes) };
}

// Which of `saved`'s dependencies `current` has a different version of (empty = still valid).
export function changedDeps(saved: GuideDeps, current: GuideDeps): string[] {
  const changed = saved.calcVersion !== current.calcVersion ? ['calc code'] : [];
  Object.entries(saved.files).forEach(([path, v]) => { if (current.files[path] !== v) changed.push(path); });
  Object.entries(saved.builderEdits).forEach(([name, v]) => { if (current.builderEdits[name] !== v) changed.push(`Builder edits to ${name}`); });
  return changed;
}

export const loadGuideCache = (character: string): Promise<GuideCacheRecord | undefined> =>
  idbGet<GuideCacheRecord>(STORE, character);

const mostRecent = <T,>(record: Record<string, T>, max: number): Record<string, T> =>
  Object.fromEntries(Object.entries(record).slice(-max));

export const saveGuideCache = (character: string, record: GuideCacheRecord): Promise<void> =>
  idbPut(STORE, character, {
    deps: record.deps,
    summaries: mostRecent(record.summaries, MAX_SUMMARIES),
    full: Object.fromEntries(Object.entries(mostRecent(record.full, MAX_FULL_RUNS)).map(([key, run]) => {
      const results = { ...run.results };
      delete results.dmgOverTimeSeries;
      return [key, { ...run, results, evaluatedRows: trimRowsForTimeline(run.evaluatedRows) }];
    }))
  });
