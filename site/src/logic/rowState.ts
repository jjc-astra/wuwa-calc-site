// Copying a row's carried state: inherit, backfill, snapshot.
import { FORTE_KEYS } from '../utils/ResourceKeys';

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Per-unit pools (`{ unit: value }`).
const UNIT_POOL_KEYS: readonly string[] = ['energy', 'concerto', ...FORTE_KEYS];
const INHERITED_POOL_KEYS: readonly string[] = ['hp', ...UNIT_POOL_KEYS];

const SNAPSHOT_COPIED_KEYS: readonly string[] = [
  'hp', ...UNIT_POOL_KEYS, 'trackers', 'activeBuffs', 'cooldowns', 'chargeCooldowns'
];

// Never copied.
export const ROW_LINK_KEYS: readonly string[] = ['dropdownState', 'prevRow', 'nextRow', 'timelineEvents'];

export function inheritPools(row: any, prev: any): void {
  for (const key of INHERITED_POOL_KEYS) row[key] = { ...(prev[key] || {}) };
}

// Backfills the previous row's gauges with this row's pre-cast values.
export function backfillPools(prev: any, row: any): void {
  for (const key of UNIT_POOL_KEYS) prev[key] = { ...row[key] };
}

export function plainCopy(row: any, omit: readonly string[]): any {
  const copy = { ...row };
  for (const key of omit) delete copy[key];
  return cloneJson(copy);
}

// Fields describing a row's move (read by @Move, @Prev, @Next).
const MOVE_KEYS: readonly string[] = [
  'action', 'moveName', 'castTypes', 'dmgTypes', 'timeStart', 'gameTimeStart', 'duration', 'gameTimePassed',
  'freezeTime', 'motionStop', 'damageTimeframe', 'swapTiming', 'baseMult', 'hitMults', 'isInForteWindow',
  'prevRow', 'nextRow', 'nextUnitActions'
];

// Live state, with @Move as the move that queued the hit.
export function hitState(live: any, origin: any): any {
  if (origin === live) return live;
  const state = { ...live };
  for (const key of MOVE_KEYS) state[key] = origin[key];
  return state;
}

// Snapshot for the UI dropdowns: links kept, state deep-copied.
export function dropdownSnapshot(row: any): any {
  const snapshot = { ...row };
  for (const key of SNAPSHOT_COPIED_KEYS) snapshot[key] = cloneJson(row[key] || {});
  snapshot.unitCombos = row.unitCombos ? cloneJson(row.unitCombos) : {};
  return snapshot;
}
