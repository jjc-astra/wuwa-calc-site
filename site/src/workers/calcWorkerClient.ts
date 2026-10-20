// calc.worker.ts client: a main lane for interactive calcs, a pool for batch work.
import CalcWorker from './calc.worker.ts?worker';
import { buildBuilderPayload } from './builderOverridePayload';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import { DataLoader } from '../utils/DataLoader';
import { toPersistedRow } from '../logic/rotationRows';
import type { TeamSlot, EnemyStats } from '../types';

// One lazily created worker running requests one at a time.
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

  // Callers must not overlap requests.
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

  run(id: number, type: string, payload: unknown): Promise<any> {
    const result = this.queue.then(() => this.dispatch(id, type, payload));
    // A failure mustn't block the queue.
    this.queue = result.then(() => {}, () => {});
    return result;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Calculation cancelled.');
    this.name = 'CancelledError';
  }
}

const mainLane = new WorkerLane();

// Batch lanes (Character Guide). Capped at 8; more adds no throughput.
const POOL_SIZE = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
// A pool lane and the entities it has loaded (approximate).
interface PoolLane {
  lane: WorkerLane;
  loaded: Set<string>;
}
const poolLanes: PoolLane[] = [];
const idleLanes: PoolLane[] = [];

// A queued pool request, taken by the next free lane.
interface PoolJob {
  id: number;
  payload: unknown;
  // `folder/name`
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

// Picks the job sharing the most loaded entities with this lane.
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

// Hands jobs to free lanes, adding lanes up to POOL_SIZE.
function pumpPool(): void {
  while (poolQueue.length > 0) {
    const pooled = idleLanes.pop() ?? (poolLanes.length < POOL_SIZE ? spawnPoolLane() : null);
    if (!pooled) return;
    const job = takeJobFor(pooled);
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

/** Pre-loads databases in every lane, seeded from the page. Idempotent. */
export function warmWorkerPool(): void {
  // Not marked busy; warm-up shares the database load with real requests.
  const fresh: PoolLane[] = [];
  while (poolLanes.length < POOL_SIZE) {
    const pooled = spawnPoolLane();
    idleLanes.push(pooled);
    fresh.push(pooled);
  }
  if (fresh.length === 0) return;
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

// A worker request. Builder overrides are added automatically.
export interface WorkerRequest {
  rows: any[];
  team: TeamSlot[];
  options: Record<string, unknown>;
  enemy: EnemyStats;
  endingRotationEnabled?: boolean;
  endRotationStartsEarlier?: boolean;
  // 'recalculate' only: also fill damage breakdowns.
  includeDamage?: boolean;
  collapseMap?: number[];
  // 'calculateDamage' only: loop start in expanded rows.
  loopStartIndex?: number;
  // 'calculateDamage' only: false skips substat worth.
  substatWorth?: boolean;
}

// Adds manifests and builder overrides; sends authored row fields only.
function requestPayload(request: WorkerRequest) {
  const rows = request.rows.map(row => ({ ...(row.id && { id: row.id }), ...toPersistedRow(row) }));
  return { ...request, rows, ...buildBuilderPayload(request.team), manifests: DataLoader.currentManifests() };
}

let mainLaneSeeded = false;

// Runs a request on the main lane.
export function postToWorker(
  type: 'recalculate' | 'calculateDamage',
  request: WorkerRequest
): { seq: number; result: Promise<any>; builderOverrides: ReturnType<typeof buildBuilderPayload>['builderOverrides'] } {
  const payload = { ...requestPayload(request), ...(mainLaneSeeded ? {} : { seed: DataLoader.dataSeed() }) };
  mainLaneSeeded = true;
  const seq = ++requestSeq;
  return { seq, result: mainLane.run(seq, type, payload), builderOverrides: payload.builderOverrides };
}

// Runs 'calculateDamage' on a pool lane. Rejects with CancelledError if cancelled while queued.
export function postToWorkerPool(request: WorkerRequest & { summaryOnly?: boolean; withIssues?: boolean }, isCancelled?: () => boolean): Promise<any> {
  const payload = requestPayload(request);
  const entities = getTeamEntityRefs(request.team, { includeSystem: false, dedupe: true }).map(ref => `${ref.folder}/${ref.name}`);
  return new Promise((resolve, reject) => {
    poolQueue.push({ id: ++requestSeq, payload, entities, isCancelled, resolve, reject });
    pumpPool();
  });
}
