// Single source of truth for walking a team's equipped items as EntityRefs. Used by
// builderOverridePayload.ts (override lookup), dataFreshness.ts (staleness checks), and
// DataLoader.ts (mechanics loading).
import type { TeamSlot, EntityRef, EntityFolder } from '../types';
import { SYSTEM_NAMESPACE } from './MechanicKey';

// A slot's echo set fields: the main set and the extra sets a 3pc/1pc main set leaves room for.
export const SLOT_SET_FIELDS = ['mainSet', 'subSet', 'subSet2a', 'subSet2b'] as const;

// The echo sets a slot wears.
export const slotSets = (slot: Pick<TeamSlot, typeof SLOT_SET_FIELDS[number]>): string[] =>
  SLOT_SET_FIELDS.map(field => slot[field]).filter(Boolean);

const SLOT_ENTITY_MAPPINGS: { field: keyof TeamSlot; folder: EntityFolder }[] = [
  { field: 'character', folder: 'characters' },
  { field: 'weapon', folder: 'weapons' },
  ...SLOT_SET_FIELDS.map(field => ({ field, folder: 'sets' as const })),
  { field: 'mainEcho', folder: 'echoes' }
];

// Which mechanics folder a slot field's item lives in, for the fields that name one.
export const slotFieldFolder = (field: keyof TeamSlot): EntityFolder | undefined =>
  SLOT_ENTITY_MAPPINGS.find(mapping => mapping.field === field)?.folder;

// The characters in a team, in slot order (empty slots skipped).
export const teamCharacters = (team: Array<{ character?: string }>): string[] =>
  team.map(slot => slot.character).filter((name): name is string => !!name);

// Every entity a team equips, as EntityRefs (System first, unless excluded).
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
