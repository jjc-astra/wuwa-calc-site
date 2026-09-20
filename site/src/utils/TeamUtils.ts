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

// Which mechanics folder a slot field's item lives in, for the fields that name one.
export const slotFieldFolder = (field: keyof TeamSlot): EntityFolder | undefined =>
  SLOT_ENTITY_MAPPINGS.find(mapping => mapping.field === field)?.folder;

// The characters in a team, in slot order (empty slots skipped).
export const teamCharacters = (team: Array<{ character?: string }>): string[] =>
  team.map(slot => slot.character).filter((name): name is string => !!name);

// A team as plain data for saving or exporting, without the UI-only `domRef`.
export const serializableTeam = (team: TeamSlot[]): TeamSlot[] =>
  team.map(slot => {
    const copy = { ...slot };
    delete copy.domRef;
    return copy;
  });

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
