// Client for calc.worker.ts: one main lane for interactive calcs, plus a small pool for batch work.
import CalcWorker from './calc.worker.ts?worker';
import { buildBuilderPayload } from './builderOverridePayload';
import type { TeamSlot, EntityRef } from '../types';

// One worker and its request queue. Requests run one at a time: the worker's TimelineEngine and
// DataLoader share stateful caches that concurrent calls could leave half-populated. The worker
// is created on first use, so pages that never calculate don't start one.
class WorkerLane {
  private worker: Worker | null = null;
  private queue: Promise<void> = Promise.resolve();
  pending = 0;

  private getWorker(): Worker {
    if (!this.worker) this.worker = new CalcWorker();
    return this.worker;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  // `isCancelled` is checked just before dispatch, so a queued request nobody wants is dropped.
  run(id: number, type: string, payload: unknown, isCancelled?: () => boolean): Promise<any> {
    this.pending++;
    const result = this.queue.then(
      () =>
        new Promise<any>((resolve, reject) => {
          if (isCancelled?.()) {
            reject(new CancelledError());
            return;
          }
          const w = this.getWorker();
          const handleMessage = (e: MessageEvent) => {
            if (e.data.id !== id) return;
            w.removeEventListener('message', handleMessage);
            if (e.data.ok) resolve(e.data);
            else reject(new Error(e.data.error));
          };
          w.addEventListener('message', handleMessage);
          w.postMessage({ id, type, payload });
        })
    );
    // Settle either way, so one failed request doesn't block the rest of the queue.
    this.queue = result.then(
      () => { this.pending--; },
      () => { this.pending--; }
    );
    return result;
  }
}

// Rejects a pool request that was cancelled while queued.
export class CancelledError extends Error {
  constructor() {
    super('Calculation cancelled.');
    this.name = 'CancelledError';
  }
}

// Shared by every interactive caller (Calculator, Rankings, Comparison).
const mainLane = new WorkerLane();

// Extra lanes for batch work (the Character Guide's comparisons), run in parallel and never ahead
// of the main lane. Kept small: each lane loads its own databases and mechanics.
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const poolLanes: WorkerLane[] = [];

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mainLane.terminate();
    poolLanes.forEach(lane => lane.terminate());
  });
}

let requestSeq = 0;

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

// Runs a request on the main lane.
export function postToWorker(
  type: 'recalculate' | 'calculateDamage',
  request: WorkerRequest
): { seq: number; result: Promise<any>; builderOverrides: ReturnType<typeof buildBuilderPayload>['builderOverrides'] } {
  const payload = { ...request, ...buildBuilderPayload(request.team) };
  const seq = ++requestSeq;
  return { seq, result: mainLane.run(seq, type, payload), builderOverrides: payload.builderOverrides };
}

// Runs 'calculateDamage' on the least-busy pool lane. Rejects with CancelledError if cancelled
// while queued.
export function postToWorkerPool(request: WorkerRequest & { summaryOnly?: boolean }, isCancelled?: () => boolean): Promise<any> {
  if (poolLanes.length < POOL_SIZE && poolLanes.every(lane => lane.pending > 0)) poolLanes.push(new WorkerLane());
  const lane = poolLanes.reduce((best, l) => (l.pending < best.pending ? l : best));
  const payload = { ...request, ...buildBuilderPayload(request.team) };
  return lane.run(++requestSeq, 'calculateDamage', payload, isCancelled);
}
