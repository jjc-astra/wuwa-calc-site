// Single source of truth for walking a team's equipped items as EntityRefs. Used by
// builderOverridePayload.ts (override lookup), dataFreshness.ts (staleness checks), and
// DataLoader.ts (mechanics loading).
import type { TeamSlot, EntityRef, EntityFolder } from '../types';
import { SYSTEM_NAMESPACE } from './MechanicKey';

const SLOT_ENTITY_MAPPINGS: { field: keyof TeamSlot; folder: EntityFolder }[] = [
  { field: 'character', folder: 'characters' },
  { field: 'weapon', folder: 'weapons' },
  { field: 'mainSet', folder: 'sets' },
  { field: 'subSet', folder: 'sets' },
  { field: 'subSet2a', folder: 'sets' },
  { field: 'subSet2b', folder: 'sets' },
  { field: 'mainEcho', folder: 'echoes' }
];

export function getTeamEntityRefs(
  team: TeamSlot[],
  options: { includeSystem?: boolean; dedupe?: boolean } = {}
): EntityRef[] {
  const { includeSystem = true, dedupe = false } = options;
  const refs: EntityRef[] = [];
  if (includeSystem) refs.push({ folder: 'system', name: SYSTEM_NAMESPACE });
  team.forEach(slot => {
    SLOT_ENTITY_MAPPINGS.forEach(({ field, folder }) => {
      const name = slot[field];
      if (typeof name === 'string' && name) refs.push({ folder, name });
    });
  });
  if (!dedupe) return refs;

  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = `${ref.folder}/${ref.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Streaming visitor over the same mapping, for callers (e.g. sequential mechanics loading) that
// want to act on each ref in place rather than allocate an intermediate array.
export async function forEachTeamEntity(
  team: TeamSlot[],
  callback: (ref: EntityRef, slotIndex: number, field: keyof TeamSlot) => void | Promise<void>
): Promise<void> {
  for (let slotIndex = 0; slotIndex < team.length; slotIndex++) {
    const slot = team[slotIndex];
    for (const { field, folder } of SLOT_ENTITY_MAPPINGS) {
      const name = slot[field];
      if (typeof name === 'string' && name) await callback({ folder, name }, slotIndex, field);
    }
  }
}
