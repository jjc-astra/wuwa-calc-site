// Client for calc.worker.ts: one main lane for interactive calcs, plus a small pool for batch work.
import CalcWorker from './calc.worker.ts?worker';
import { buildBuilderPayload } from './builderOverridePayload';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import { DataLoader } from '../utils/DataLoader';
import { toPersistedRow } from '../logic/rotationRows';
import type { TeamSlot, EnemyStats } from '../types';

// One worker and its request queue. Requests run one at a time: the worker's TimelineEngine and
// DataLoader share stateful caches that concurrent calls could leave half-populated. The worker
// is created on first use, so pages that never calculate don't start one.
class WorkerLane {
  private worker: Worker | null = null;
  private queue: Promise<void> = Promise.resolve();

  private getWorker(): Worker {
    if (!this.worker) this.worker = new CalcWorker();
    return this.worker;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  // Sends one request straight to the worker; callers must not overlap requests on a lane.
  dispatch(id: number, type: string, payload: unknown): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const w = this.getWorker();
      const handleMessage = (e: MessageEvent) => {
        if (e.data.id !== id) return;
        w.removeEventListener('message', handleMessage);
        if (e.data.ok) resolve(e.data);
        else reject(new Error(e.data.error));
      };
      w.addEventListener('message', handleMessage);
      w.postMessage({ id, type, payload });
    });
  }

  // Queues a request behind this lane's earlier ones.
  run(id: number, type: string, payload: unknown): Promise<any> {
    const result = this.queue.then(() => this.dispatch(id, type, payload));
    // Settle either way, so one failed request doesn't block the rest of the queue.
    this.queue = result.then(() => {}, () => {});
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
// of the main lane. Capped: each lane loads its own databases and mechanics.
// Measured: Guide throughput stops climbing past ~8 workers (each extra one only costs memory).
const POOL_SIZE = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
// A pool lane plus the entities its worker has loaded mechanics for (approximate: the worker can
// still evict some for stale data or Builder edits).
interface PoolLane {
  lane: WorkerLane;
  loaded: Set<string>;
}
const poolLanes: PoolLane[] = [];
const idleLanes: PoolLane[] = [];

// Pool requests wait here until a lane is free, so a lane that finishes early takes the next one
// instead of idling while another lane works through a backlog.
interface PoolJob {
  id: number;
  payload: unknown;
  // The job team's entities, as `folder/name`.
  entities: string[];
  isCancelled?: () => boolean;
  resolve: (value: any) => void;
  reject: (err: unknown) => void;
}
const poolQueue: PoolJob[] = [];

function spawnPoolLane(): PoolLane {
  const pooled = { lane: new WorkerLane(), loaded: new Set<string>() };
  poolLanes.push(pooled);
  return pooled;
}

// The queued job sharing the most loaded entities with this lane (earliest on ties), so lanes
// reuse mechanics they already fetched and parsed.
function takeJobFor(pooled: PoolLane): PoolJob {
  let best = 0;
  let bestScore = -1;
  poolQueue.forEach((job, i) => {
    const score = job.entities.filter(key => pooled.loaded.has(key)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return poolQueue.splice(best, 1)[0];
}

// Hands queued jobs to free lanes, adding a lane while all are busy (up to POOL_SIZE).
function pumpPool(): void {
  while (poolQueue.length > 0) {
    const pooled = idleLanes.pop() ?? (poolLanes.length < POOL_SIZE ? spawnPoolLane() : null);
    if (!pooled) return;
    const job = takeJobFor(pooled);
    // Checked at pickup, so a queued request nobody wants is dropped.
    if (job.isCancelled?.()) {
      idleLanes.push(pooled);
      job.reject(new CancelledError());
      continue;
    }
    job.entities.forEach(key => pooled.loaded.add(key));
    pooled.lane.dispatch(job.id, 'calculateDamage', job.payload)
      .then(job.resolve, job.reject)
      .finally(() => {
        idleLanes.push(pooled);
        pumpPool();
      });
  }
}

/**
 * Starts the main lane's and every pool lane's worker loading its databases ahead of the first
 * batch, seeded with the page's already-fetched files, so the batch doesn't pay each worker's
 * startup on its critical path. Safe to call repeatedly.
 */
export function warmWorkerPool(): void {
  // Spawned now so a batch arriving first still reuses them (unseeded); not marked busy, since a
  // warm-up only awaits the database load that a real request on the same worker shares.
  const fresh: PoolLane[] = [];
  while (poolLanes.length < POOL_SIZE) {
    const pooled = spawnPoolLane();
    idleLanes.push(pooled);
    fresh.push(pooled);
  }
  // Lanes live for the session, so this seeds once; later calls have nothing new to warm.
  if (fresh.length === 0) return;
  // A fresh manifest first, so the seed's file text is checked against current hashes.
  void DataLoader.ready.then(() => DataLoader.refreshManifest()).then(() => {
    const payload = { seed: DataLoader.dataSeed() };
    if (!mainLaneSeeded) {
      mainLaneSeeded = true;
      mainLane.run(++requestSeq, 'warmup', payload).catch(() => {});
    }
    fresh.forEach(pooled => pooled.lane.dispatch(++requestSeq, 'warmup', payload).catch(() => {}));
    DataLoader.releaseFileText();
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mainLane.terminate();
    poolLanes.forEach(pooled => pooled.lane.terminate());
  });
}

let requestSeq = 0;

// What the worker needs to run a rotation. The team's Builder overrides ride along on every request
// (postToWorker adds them), so callers only describe the rotation.
export interface WorkerRequest {
  rows: any[];
  team: TeamSlot[];
  options: Record<string, unknown>;
  enemy: EnemyStats;
  endingRotationEnabled?: boolean;
  endRotationStartsEarlier?: boolean;
  // 'recalculate' only: also fill each row's damage breakdown, and how to fold the expanded rows back.
  includeDamage?: boolean;
  collapseMap?: number[];
  // 'calculateDamage' only: where the loop starts, in `rows`' (expanded) index space.
  loopStartIndex?: number;
  // 'calculateDamage' only: false skips substat worth (the toolbar's Substat Worth toggle).
  substatWorth?: boolean;
}

// The page's manifests ride along on every request, so the worker reloads changed data by its
// current hash (callers just refreshed them via checkTeamFreshness). Rows go as their authored
// fields only: the engine recomputes everything else, and evaluated rows are ~40 KB each to copy.
function requestPayload(request: WorkerRequest) {
  const rows = request.rows.map(row => ({ ...(row.id && { id: row.id }), ...toPersistedRow(row) }));
  return { ...request, rows, ...buildBuilderPayload(request.team), manifests: DataLoader.currentManifests() };
}

// Whether the main lane's worker has been sent a seed (see DataLoader.dataSeed).
let mainLaneSeeded = false;

// Runs a request on the main lane. Its first request carries the seed.
export function postToWorker(
  type: 'recalculate' | 'calculateDamage',
  request: WorkerRequest
): { seq: number; result: Promise<any>; builderOverrides: ReturnType<typeof buildBuilderPayload>['builderOverrides'] } {
  const payload = { ...requestPayload(request), ...(mainLaneSeeded ? {} : { seed: DataLoader.dataSeed() }) };
  mainLaneSeeded = true;
  const seq = ++requestSeq;
  return { seq, result: mainLane.run(seq, type, payload), builderOverrides: payload.builderOverrides };
}

// Runs 'calculateDamage' on the next free pool lane. Rejects with CancelledError if cancelled
// while queued.
export function postToWorkerPool(request: WorkerRequest & { summaryOnly?: boolean }, isCancelled?: () => boolean): Promise<any> {
  const payload = requestPayload(request);
  const entities = getTeamEntityRefs(request.team, { includeSystem: false, dedupe: true }).map(ref => `${ref.folder}/${ref.name}`);
  return new Promise((resolve, reject) => {
    poolQueue.push({ id: ++requestSeq, payload, entities, isCancelled, resolve, reject });
    pumpPool();
  });
}
