// src/workers/calcWorkerClient.ts
// Thin client around calc.worker.ts. Shared by every caller needing the simulation pipeline
// off the main thread, so the Rankings batch loader reuses the same worker instance and queue
// instead of duplicating this state management.
import CalcWorker from './calc.worker.ts?worker';
import { buildBuilderPayload } from './builderOverridePayload';
import type { TeamSlot, EntityRef } from '../types';

// Created lazily on the first postToWorker() call, not at module load -- this module is in
// the static import graph regardless of page, so eager creation would spin up a worker on
// every page load, including the landing page.
let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) worker = new CalcWorker();
  return worker;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    worker?.terminate();
    worker = null;
  });
}

let requestSeq = 0;

// Queued one at a time, not run in parallel, even though each call resolves independently --
// the worker's TimelineEngine/DataLoader share stateful caches, and concurrent calls could
// interleave mid-load into a half-populated cache. No throughput cost (one thread anyway);
// this single module-level queue is what keeps the guarantee app-wide, not just per-store.
let workerQueue: Promise<void> = Promise.resolve();

// What the worker needs to run a rotation. The team's Builder overrides ride along on every request
// (postToWorker adds them), so callers only describe the rotation.
export interface WorkerRequest {
  rows: any[];
  team: TeamSlot[];
  options: Record<string, unknown>;
  enemy: { level: number; res: number; hp: number };
  endingRotationEnabled?: boolean;
  endRotationStartsEarlier?: boolean;
  // Mechanics the main thread just evicted as stale, so the worker's own DataLoader drops them too.
  staleRefs?: EntityRef[];
  // 'recalculate' only: also fill each row's damage breakdown, and how to fold the expanded rows back.
  includeDamage?: boolean;
  collapseMap?: number[];
  // 'calculateDamage' only: where the loop starts, in `rows`' (expanded) index space.
  loopStartIndex?: number;
}

export function postToWorker(
  type: 'recalculate' | 'calculateDamage',
  request: WorkerRequest
): { seq: number; result: Promise<any>; builderOverrides: ReturnType<typeof buildBuilderPayload>['builderOverrides'] } {
  const payload = { ...request, ...buildBuilderPayload(request.team) };
  const seq = ++requestSeq;
  const result = workerQueue.then(
    () =>
      new Promise<any>((resolve, reject) => {
        const w = getWorker();
        const handleMessage = (e: MessageEvent) => {
          if (e.data.id !== seq) return;
          w.removeEventListener('message', handleMessage);
          if (e.data.ok) resolve(e.data);
          else reject(new Error(e.data.error));
        };
        w.addEventListener('message', handleMessage);
        w.postMessage({ id: seq, type, payload });
      })
  );
  // Chain the queue on this request's settling regardless of outcome, so one failed request
  // doesn't wedge every request queued after it.
  workerQueue = result.then(
    () => undefined,
    () => undefined
  );
  return { seq, result, builderOverrides: payload.builderOverrides };
}
