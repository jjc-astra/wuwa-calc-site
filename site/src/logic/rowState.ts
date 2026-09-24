// How a row's carried state is copied: inherited from the previous row, backfilled into it, and
// snapshotted for the UI. One list of which fields hold what, instead of one loop per copy site.
import { FORTE_KEYS } from '../utils/ResourceKeys';

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Per-unit pools (`{ unit: value }`) a row starts from as copies of the previous row's.
const UNIT_POOL_KEYS: readonly string[] = ['energy', 'concerto', ...FORTE_KEYS];
const INHERITED_POOL_KEYS: readonly string[] = ['hp', ...UNIT_POOL_KEYS];

// What a dropdown snapshot deep-copies so later rows can't mutate it.
const SNAPSHOT_COPIED_KEYS: readonly string[] = [
  'hp', ...UNIT_POOL_KEYS, 'trackers', 'activeBuffs', 'cooldowns', 'chargeCooldowns'
];

// Fields that point back into the row list or hold other snapshots, so they never belong in a copy.
export const ROW_LINK_KEYS: readonly string[] = ['dropdownState', 'prevRow', 'nextRow'];

// A row's per-unit pools and HP, copied from the previous row.
export function inheritPools(row: any, prev: any): void {
  for (const key of INHERITED_POOL_KEYS) row[key] = { ...(prev[key] || {}) };
}

// The previous row's gauges should read as "available right before this row starts", so they're
// backfilled with this row's values once its waits are known.
export function backfillPools(prev: any, row: any): void {
  for (const key of UNIT_POOL_KEYS) prev[key] = { ...row[key] };
}

// A detached JSON copy of a row, without the given fields.
export function plainCopy(row: any, omit: readonly string[]): any {
  const copy = { ...row };
  for (const key of omit) delete copy[key];
  return cloneJson(copy);
}

// The row as the UI's per-cell dropdowns see it: live links kept, carried state deep-copied.
export function dropdownSnapshot(row: any): any {
  const snapshot = { ...row };
  for (const key of SNAPSHOT_COPIED_KEYS) snapshot[key] = cloneJson(row[key] || {});
  snapshot.unitCombos = row.unitCombos ? cloneJson(row.unitCombos) : {};
  return snapshot;
}
