// src/workers/builderOverridePayload.ts
// Shared by every postToWorker('recalculate'|'calculateDamage', ...) caller that wants the
// worker to use the Mechanics Builder's locally-cached edits (if any exist for this team's own
// characters/weapons/sets/echoes) instead of always the pristine data/mechanics JSON files --
// originally lived only in useRotationStore.ts, extracted here so the rotation Timeline
// (useRotationTimelineData.ts) can request the exact same live-edit behavior the Rotation
// Calculator's own "Calculate" press already gets, instead of silently diverging from it.
import { useBuilderStore } from '../store/useBuilderStore';
import type { TeamSlot } from '../types';

// Every entity a given team actually references (character/weapon/main+sub set/main echo per
// slot), plus 'Generic' -- always included since System mechanics apply to every rotation
// regardless of team composition. Same list serves two jobs in the payload the worker gets:
// which of the Mechanics Builder's cached edits are even relevant here (useBuilderStore's
// getTeamOverrides), and, for a real Calculate press, exactly which entities' mechanics the
// worker should force a pristine re-fetch of before reapplying those edits (see calc.worker.ts)
// -- so a Reset Cache in the builder is reflected here too, not just newly-added edits.
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
