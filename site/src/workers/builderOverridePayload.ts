// Sends Builder edits with worker calcs.
import { useBuilderStore } from '../store/useBuilderStore';
import { DataLoader } from '../utils/DataLoader';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import { MechanicKey } from '../utils/MechanicKey';
import type { TeamSlot, BaseStats, MechanicNode } from '../types';

const teamEntityNames = (team: TeamSlot[]): string[] => getTeamEntityRefs(team).map(r => r.name);

export function buildBuilderPayload(team: TeamSlot[]) {
  return { builderOverrides: useBuilderStore.getState().getTeamOverrides(teamEntityNames(team)) };
}

export interface BuilderOverrides {
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
}

// Replays overrides onto this thread's DataLoader.
export function applyBuilderOverridesToDataLoader(overrides: BuilderOverrides | undefined): void {
  if (!overrides) return;
  Object.entries(overrides.editedBaseStats).forEach(([name, stats]) => DataLoader.editBaseStats(name, stats));
  Object.entries(overrides.editedMechanics).forEach(([id, node]) => {
    DataLoader.registerMechanicNode(id, node);
  });
  overrides.deletedMechanicIds.forEach(id => DataLoader.unregisterMechanicNode(id));
}

export function overriddenEntities(overrides: BuilderOverrides | undefined): string[] {
  if (!overrides) return [];
  const ids = [...Object.keys(overrides.editedMechanics), ...overrides.deletedMechanicIds];
  return [...new Set([...Object.keys(overrides.editedBaseStats), ...ids.map(id => MechanicKey.parse(id).namespace)])];
}

// Applies Builder overrides to the main-thread DataLoader.
export function applyBuilderOverridesFor(names: string[]): void {
  applyBuilderOverridesToDataLoader(useBuilderStore.getState().getTeamOverrides(names));
}

export function applyBuilderOverridesForTeam(team: TeamSlot[]): void {
  applyBuilderOverridesFor(teamEntityNames(team));
}
