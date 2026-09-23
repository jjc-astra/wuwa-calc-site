// src/components/guide/useGuideCalc.ts
// The Character Guide's calcs: a full calc for the selected config (result panels, timeline) and
// summary calcs for the comparisons, spread across the worker pool.
import { useEffect, useReducer, useRef, useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { runFullCalculation, runSummaryCalculation } from '../../workers/runFullCalculation';
import { CancelledError } from '../../workers/calcWorkerClient';
import type { RotationSummary } from '../../logic/ResultsCalculator';
import type { RotationResults } from '../../types/results';
import type { TeamSlot } from '../../types';
import type { GuideJob } from './guideModel';

// Keyed by GuideJob.key and shared across sections, so each team variant runs once. Cleared on
// unmount, so a later visit picks up Mechanics Builder edits.
const summaryCache = new Map<string, RotationSummary>();
const failedJobs = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();
// Keys the mounted page still wants; queued jobs outside it are dropped.
let wantedKeys = new Set<string>();

const errorMessage = (err: any): string => err?.message || String(err);

function settingsFor(job: GuideJob) {
  const data = DataLoader.characterResults[job.entry.id];
  if (!data) throw new Error('This rotation is no longer available.');
  return { data, settings: data.settings || {} };
}

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
    const { data, settings } = settingsFor(job);
    return runSummaryCalculation(
      data.rotation, job.team, settings, settings.endingRotationEnabled, settings.endRotationStartsEarlier,
      () => !wantedKeys.has(job.key)
    );
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
  results: RotationResults | null;
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
    setState(prev => ({ ...prev, status: 'loading', error: null }));

    const full = (async () => {
      const { data, settings } = settingsFor(job);
      return runFullCalculation(data.rotation, job.team, settings, settings.endingRotationEnabled, settings.endRotationStartsEarlier);
    })();

    if (!summaryCache.has(job.key) && !inflight.has(job.key)) {
      track(job.key, full.then(({ results }) => ({ dpsStats: results.dpsStats, contribution: results.contribution })));
    }

    full.then(
      ({ results, evaluatedRows, loopStartIndex }) => {
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
