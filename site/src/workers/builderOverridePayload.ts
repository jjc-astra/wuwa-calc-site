// Supplies cached Mechanics Builder edits to worker calc calls so the Timeline mirrors live edits instead of diverging.
import { useBuilderStore } from '../store/useBuilderStore';
import { DataLoader } from '../utils/DataLoader';
import type { TeamSlot, BaseStats, MechanicNode } from '../types';

// Active team entities plus 'Generic', used to resolve relevant Builder overrides and force clean re-fetches on recalculation.
export type EntityRef = { name: string; folder: 'characters' | 'weapons' | 'sets' | 'echoes' | 'generic' };

export function buildEntityRefs(team: TeamSlot[]): EntityRef[] {
  const refs: EntityRef[] = [{ name: 'Generic', folder: 'generic' }];
  team.forEach(slot => {
    if (slot.character) refs.push({ name: slot.character, folder: 'characters' });
    if (slot.weapon) refs.push({ name: slot.weapon, folder: 'weapons' });
    if (slot.mainSet) refs.push({ name: slot.mainSet, folder: 'sets' });
    if (slot.subSet) refs.push({ name: slot.subSet, folder: 'sets' });
    if (slot.subSet2a) refs.push({ name: slot.subSet2a, folder: 'sets' });
    if (slot.subSet2b) refs.push({ name: slot.subSet2b, folder: 'sets' });
    if (slot.mainEcho) refs.push({ name: slot.mainEcho, folder: 'echoes' });
  });
  return refs;
}

export function buildBuilderPayload(team: TeamSlot[]) {
  const entityRefs = buildEntityRefs(team);
  const builderOverrides = useBuilderStore.getState().getTeamOverrides(entityRefs.map(r => r.name));
  return { builderEntityRefs: entityRefs, builderOverrides };
}

export interface BuilderOverrides {
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
}

// Replays Builder overrides onto whichever DataLoader instance this runs against -- the
// main-thread singleton when called from applyBuilderOverridesFor below, or the worker's own
// separate instance when called from calc.worker.ts with a payload's already-computed overrides
// (the worker has no Zustand store access, so it can't compute these itself).
export function applyBuilderOverridesToDataLoader(overrides: BuilderOverrides | undefined): void {
  if (!overrides) return;
  Object.entries(overrides.editedBaseStats).forEach(([name, stats]) => {
    const target = DataLoader.characterDB[name] || DataLoader.weaponDB[name];
    if (target) Object.assign(target, stats);
  });
  Object.entries(overrides.editedMechanics).forEach(([id, node]) => {
    DataLoader.registerMechanicNode(id, node);
  });
  overrides.deletedMechanicIds.forEach(id => DataLoader.unregisterMechanicNode(id));
}

// Syncs Builder overrides into the main-thread DataLoader so custom units reflect across UI consumers, mirroring calc.worker.ts.
export function applyBuilderOverridesFor(names: string[]): void {
  applyBuilderOverridesToDataLoader(useBuilderStore.getState().getTeamOverrides(names));
}

export function applyBuilderOverridesForTeam(team: TeamSlot[]): void {
  applyBuilderOverridesFor(buildEntityRefs(team).map(r => r.name));
}
