// Persists a character's guide calcs, dropped if any dependency changed.
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
  // Without dmgOverTimeSeries.
  results: PanelResults;
  // Trimmed to Timeline fields.
  evaluatedRows: any[];
  loopStartIndex: number;
}

// Calc code version, data file versions, and Builder edit hashes.
export interface GuideDeps {
  calcVersion: string;
  files: Record<string, string>;
  builderEdits: Record<string, string>;
}

export interface GuideCacheRecord {
  deps: GuideDeps;
  // By GuideJob.key, LRU first.
  summaries: Record<string, RotationSummary>;
  full: Record<string, CachedFullRun>;
}

const STORE = 'guide-cache';
const DATABASE_FILES = ['db_characters.json', 'db_weapons.json', 'db_echoes.json', 'db_builds.json'];
// Full runs are ~35 KB each.
const MAX_FULL_RUNS = 20;
const MAX_SUMMARIES = 400;

// Files and Builder entities the jobs depend on.
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

export async function readDeps(files: string[], entities: string[]): Promise<GuideDeps> {
  await DataLoader.refreshManifest();
  const { getTeamOverrides } = useBuilderStore.getState();
  const fileVersions = files.map(path => [path, DataLoader.contentVersion(path)] as const);
  const editHashes = await Promise.all(entities.map(async name => [name, await sha256Hex(JSON.stringify(getTeamOverrides([name])))] as const));
  return { calcVersion, files: Object.fromEntries(fileVersions), builderEdits: Object.fromEntries(editHashes) };
}

// Changed dependencies (empty = still valid).
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
