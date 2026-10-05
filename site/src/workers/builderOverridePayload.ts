// Supplies cached Mechanics Builder edits to worker calc calls so the Timeline mirrors live edits instead of diverging.
import { useBuilderStore } from '../store/useBuilderStore';
import { DataLoader } from '../utils/DataLoader';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import { MechanicKey } from '../utils/MechanicKey';
import type { TeamSlot, BaseStats, MechanicNode } from '../types';

// Every entity a team equips, by name (System included).
const teamEntityNames = (team: TeamSlot[]): string[] => getTeamEntityRefs(team).map(r => r.name);

// The team's Builder edits, for a worker request.
export function buildBuilderPayload(team: TeamSlot[]) {
  return { builderOverrides: useBuilderStore.getState().getTeamOverrides(teamEntityNames(team)) };
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
  Object.entries(overrides.editedBaseStats).forEach(([name, stats]) => DataLoader.editBaseStats(name, stats));
  Object.entries(overrides.editedMechanics).forEach(([id, node]) => {
    DataLoader.registerMechanicNode(id, node);
  });
  overrides.deletedMechanicIds.forEach(id => DataLoader.unregisterMechanicNode(id));
}

// The entities a set of overrides touches.
export function overriddenEntities(overrides: BuilderOverrides | undefined): string[] {
  if (!overrides) return [];
  const ids = [...Object.keys(overrides.editedMechanics), ...overrides.deletedMechanicIds];
  return [...new Set([...Object.keys(overrides.editedBaseStats), ...ids.map(id => MechanicKey.parse(id).namespace)])];
}

// Syncs Builder overrides into the main-thread DataLoader so custom units reflect across UI consumers, mirroring calc.worker.ts.
export function applyBuilderOverridesFor(names: string[]): void {
  applyBuilderOverridesToDataLoader(useBuilderStore.getState().getTeamOverrides(names));
}

// applyBuilderOverridesFor every entity a team equips.
export function applyBuilderOverridesForTeam(team: TeamSlot[]): void {
  applyBuilderOverridesFor(teamEntityNames(team));
}
