// src/workers/builderOverridePayload.ts
// Shared by every postToWorker('recalculate'|'calculateDamage', ...) caller that wants the
// Mechanics Builder's cached edits applied instead of pristine JSON. Lets the Timeline get the
// same live-edit behavior as a real Calculate press, instead of silently diverging.
import { useBuilderStore } from '../store/useBuilderStore';
import type { TeamSlot } from '../types';

// Entities the team references (character/weapon/main+sub set/main echo per slot), plus
// 'Generic' (System mechanics apply to every rotation). Used to pick relevant builder overrides
// (getTeamOverrides) and, on Calculate, to force a pristine re-fetch first -- so a builder
// Reset Cache is reflected too, not just new edits.
export type EntityRef = { name: string; folder: 'characters' | 'weapons' | 'sets' | 'echoes' | 'generic' };

export function buildEntityRefs(team: TeamSlot[]): EntityRef[] {
  const refs: EntityRef[] = [{ name: 'Generic', folder: 'generic' }];
  team.forEach(slot => {
    if (slot.character) refs.push({ name: slot.character, folder: 'characters' });
    if (slot.weapon) refs.push({ name: slot.weapon, folder: 'weapons' });
    if (slot.mainSet) refs.push({ name: slot.mainSet, folder: 'sets' });
    if (slot.subSet) refs.push({ name: slot.subSet, folder: 'sets' });
    if (slot.mainEcho) refs.push({ name: slot.mainEcho, folder: 'echoes' });
  });
  return refs;
}

export function buildBuilderPayload(team: TeamSlot[]) {
  const entityRefs = buildEntityRefs(team);
  const builderOverrides = useBuilderStore.getState().getTeamOverrides(entityRefs.map(r => r.name));
  return { builderEntityRefs: entityRefs, builderOverrides };
}
