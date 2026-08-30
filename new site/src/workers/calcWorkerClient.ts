// src/workers/calcWorkerClient.ts
// Thin client around calc.worker.ts, shared by every caller that needs the real
// TimelineEngine/CombatCalculator/ResultsCalculator pipeline off the main thread -- originally
// lived only inside useRotationStore.ts (the live Rotation Calculator's "Calculate" button),
// extracted here so the Rankings page's batch loader can reuse the exact same worker instance
// and queue instead of duplicating this state-management dance.
import CalcWorker from './calc.worker.ts?worker';

// Created lazily, on the first actual postToWorker() call, NOT at module load -- this module
// is in the static import graph regardless of which page is showing, so an eagerly-created
// worker here would spin up and start doing work on every single page load, including the
// landing page.
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

// Requests are sent to the worker one at a time (queued here, not in parallel) even though
// each call resolves independently. The worker's TimelineEngine/DataLoader hold shared,
// stateful caches (compiled move data, loaded mechanics) -- two calls racing through them
// concurrently can interleave mid-load and see a half-populated cache, not just a slow one.
// Queuing avoids that at essentially no cost: the worker was never able to run two
// simulations in true parallel anyway (it's one thread), so this doesn't reduce throughput,
// it just stops requests from overlapping in a way that corrupts shared state. Sharing this
// one module-level queue across every caller (live Calculator edits, a Rankings batch load,
// anything else later) is what keeps that guarantee true app-wide, not just within one store.
let workerQueue: Promise<void> = Promise.resolve();

export function postToWorker(type: 'recalculate' | 'calculateDamage', payload: any): { seq: number; result: Promise<any> } {
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
  return { seq, result };
}
