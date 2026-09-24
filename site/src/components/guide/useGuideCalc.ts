// The Character Guide's calcs: a full calc for the selected config (result panels, timeline) and
// summary calcs for the comparisons, spread across the worker pool.
import { useEffect, useReducer, useRef, useState } from 'react';
import { runFullCalculation, runSummaryCalculation } from '../../workers/runFullCalculation';
import { CancelledError } from '../../workers/calcWorkerClient';
import type { RotationSummary } from '../../types/results';
import type { PanelResults } from '../../types/results';
import type { TeamSlot } from '../../types';
import { DataLoader } from '../../utils/DataLoader';
import type { RankingEntry } from '../../store/useRankingsStore';
import type { GuideJob, GuideEntry } from './guideModel';
import { depsOf, readDeps, changedDeps, loadGuideCache, saveGuideCache } from './guideCache';
import type { CachedFullRun, GuideDeps } from './guideCache';

// Keyed by GuideJob.key and shared across sections, so each team variant runs once. Cleared on
// unmount; useGuideCache restores what's still valid on the next visit.
const summaryCache = new Map<string, RotationSummary>();
// Full calcs (results + timeline rows), same keying and lifetime as summaryCache.
const fullCache = new Map<string, CachedFullRun>();
const failedJobs = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();
// Keys the mounted page still wants; queued jobs outside it are dropped.
let wantedKeys = new Set<string>();

const errorMessage = (err: any): string => err?.message || String(err);
// Results tend to land in bursts; one save per burst.
const SAVE_DEBOUNCE_MS = 1000;

function track(key: string, run: Promise<RotationSummary>): Promise<void> {
  const tracked = run
    .then(summary => { summaryCache.set(key, summary); })
    .catch(err => { if (!(err instanceof CancelledError)) failedJobs.set(key, errorMessage(err)); })
    .finally(() => inflight.delete(key));
  inflight.set(key, tracked);
  return tracked;
}

function startSummary(job: GuideJob): Promise<void> {
  const existing = inflight.get(job.key);
  if (existing) return existing;
  return track(job.key, (async () => {
    return runSummaryCalculation({ ...job.entry.run, team: job.team }, () => !wantedKeys.has(job.key));
  })());
}

export interface GuideSummaries {
  get: (key: string) => RotationSummary | undefined;
  error: (key: string) => string | undefined;
  pending: number;
  total: number;
}

export function useGuideSummaries(jobs: GuideJob[]): GuideSummaries {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const signature = jobs.map(j => j.key).join('\n');

  useEffect(() => {
    wantedKeys = new Set(jobs.map(j => j.key));
    let alive = true;
    for (const job of jobs) {
      if (summaryCache.has(job.key) || failedJobs.has(job.key)) continue;
      startSummary(job).then(() => { if (alive) bump(); });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => () => {
    wantedKeys = new Set();
    summaryCache.clear();
    fullCache.clear();
    failedJobs.clear();
  }, []);

  const uniqueKeys = new Set(jobs.map(j => j.key));
  let pending = 0;
  uniqueKeys.forEach(key => { if (!summaryCache.has(key) && !failedJobs.has(key)) pending++; });

  return {
    get: key => summaryCache.get(key),
    error: key => failedJobs.get(key),
    pending,
    total: uniqueKeys.size
  };
}

export interface GuideFullCalc {
  status: 'idle' | 'loading' | 'ready' | 'error';
  // The last finished run, kept on screen (marked stale) while the next one runs.
  results: PanelResults | null;
  evaluatedRows: any[];
  loopStartIndex: number | null;
  team: TeamSlot[];
  error: string | null;
}

const IDLE: GuideFullCalc = { status: 'idle', results: null, evaluatedRows: [], loopStartIndex: null, team: [], error: null };

// Call before useGuideSummaries: effects run in call order, so the summary batch reuses this
// run for the selected config instead of starting its own.
export function useGuideFullCalc(job: GuideJob | null): GuideFullCalc {
  const [state, setState] = useState<GuideFullCalc>(IDLE);
  const requestIdRef = useRef(0);
  const key = job?.key ?? null;

  useEffect(() => {
    if (!job) {
      setState(IDLE);
      return;
    }
    const requestId = ++requestIdRef.current;
    const cached = fullCache.get(job.key);
    if (cached) {
      // Re-inserted to mark it most recently used: the saved copy keeps only the latest full runs.
      fullCache.delete(job.key);
      fullCache.set(job.key, cached);
      setState({ status: 'ready', ...cached, team: job.team, error: null });
      return;
    }
    setState(prev => ({ ...prev, status: 'loading', error: null }));

    const full = (async () => {
      return runFullCalculation({ ...job.entry.run, team: job.team });
    })();

    if (!summaryCache.has(job.key) && !inflight.has(job.key)) {
      track(job.key, full.then(({ results }) => ({ dpsStats: results.dpsStats, contribution: results.contribution })));
    }

    full.then(
      ({ results, evaluatedRows, loopStartIndex }) => {
        fullCache.set(job.key, { results, evaluatedRows, loopStartIndex });
        if (requestIdRef.current !== requestId) return;
        setState({ status: 'ready', results, evaluatedRows, loopStartIndex, team: job.team, error: null });
      },
      err => {
        if (requestIdRef.current !== requestId) return;
        setState(prev => ({ ...prev, status: 'error', error: errorMessage(err) }));
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

// Restores this character's saved results before any calc starts (false until that check is
// done), then keeps saving new results as they come in, from any view (debounced, and flushed on
// unmount). Each save re-reads the versions of everything the results were calculated from; if
// any changed during the session, saving stops -- the next visit's load check drops the stale copy.
export function useGuideCache(character: string, entries: GuideEntry[], jobs: GuideJob[]): boolean {
  const [ready, setReady] = useState(false);
  // Every job seen this session, to look up the team a cached result was calculated for.
  const jobsSeenRef = useRef(new Map<string, GuideJob>());
  // The dependency versions the in-memory results are known to be calculated from.
  const baselineRef = useRef<GuideDeps | null>(null);
  const savedCountRef = useRef(0);
  const stoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const cacheSize = () => summaryCache.size + fullCache.size;

  // Snapshots the caches now (the page may be unmounting, which clears them), saves after.
  const saveNow = () => {
    const snapshot = { summaries: Object.fromEntries(summaryCache), full: Object.fromEntries(fullCache), size: cacheSize() };
    chainRef.current = chainRef.current.then(async () => {
      if (stoppedRef.current) return;
      const cached = [...jobsSeenRef.current.values()].filter(j => j.key in snapshot.summaries || j.key in snapshot.full);
      const { files, entities } = depsOf(entries, cached);
      const baseline = baselineRef.current;
      const current = await readDeps(
        [...new Set([...files, ...Object.keys(baseline?.files ?? {})])],
        [...new Set([...entities, ...Object.keys(baseline?.builderEdits ?? {})])]
      );
      const changed = baseline ? changedDeps(baseline, current) : [];
      if (changed.length > 0) {
        stoppedRef.current = true;
        console.info(`[guide cache] Not saving ${character}: changed since the results were calculated (${changed.join(', ')}).`);
        return;
      }
      baselineRef.current = current;
      await saveGuideCache(character, { deps: current, summaries: snapshot.summaries, full: snapshot.full });
      savedCountRef.current = Math.max(savedCountRef.current, snapshot.size);
    }).catch(err => console.warn('[guide cache] Could not save the guide results.', err));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const record = await loadGuideCache(character);
      const atMount = depsOf(entries, jobs);
      const current = await readDeps(
        [...new Set([...atMount.files, ...Object.keys(record?.deps?.files ?? {})])],
        [...new Set([...atMount.entities, ...Object.keys(record?.deps?.builderEdits ?? {})])]
      );
      if (!alive) return;
      baselineRef.current = current;
      if (!record) return;
      // Saves from before dependencies were recorded can't be checked, so they're dropped too.
      const changed = record.deps ? changedDeps(record.deps, current) : ['unknown (old save format)'];
      if (changed.length > 0) {
        console.info(`[guide cache] Recalculating ${character}: changed since saved (${changed.join(', ')}).`);
        return;
      }
      Object.entries(record.summaries).forEach(([key, summary]) => summaryCache.set(key, summary));
      Object.entries(record.full).forEach(([key, run]) => fullCache.set(key, run));
      savedCountRef.current = cacheSize();
    })()
      .catch(err => console.warn('[guide cache] Could not check the saved guide results.', err))
      .finally(() => { if (alive) setReady(true); });
    return () => {
      alive = false;
      // Flush a pending save before useGuideSummaries' unmount cleanup clears the caches.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        saveNow();
      }
    };
    // Mount-only: restores once, before the page's first calcs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs after every render -- the page re-renders as each result lands.
  useEffect(() => {
    jobs.forEach(j => jobsSeenRef.current.set(j.key, j));
    if (!ready || stoppedRef.current || cacheSize() <= savedCountRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  });

  return ready;
}

export interface GuideEntries {
  status: 'loading' | 'ready';
  entries: GuideEntry[];
}

// Loads the run (rotation + calculated team) of every ranked entry with this character. An entry
// whose files fail to load is left out rather than blocking the rest.
export function useGuideEntries(entries: RankingEntry[], character: string): GuideEntries {
  const [state, setState] = useState<GuideEntries>({ status: 'loading', entries: [] });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', entries: [] });
    const withUnit = entries.filter(e => e.team.some(s => s.character === character));
    Promise.allSettled(withUnit.map(e => DataLoader.loadRankedRun(e))).then(results => {
      if (!alive) return;
      const loaded = withUnit.flatMap((entry, i) => {
        const result = results[i];
        return result.status === 'fulfilled' ? [{ ...entry, run: result.value }] : [];
      });
      setState({ status: 'ready', entries: loaded });
    });
    return () => { alive = false; };
  }, [entries, character]);

  return state;
}
