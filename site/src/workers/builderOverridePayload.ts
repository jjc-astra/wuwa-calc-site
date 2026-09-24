// Supplies cached Mechanics Builder edits to worker calc calls so the Timeline mirrors live edits instead of diverging.
import { useBuilderStore } from '../store/useBuilderStore';
import { DataLoader } from '../utils/DataLoader';
import { getTeamEntityRefs } from '../utils/TeamUtils';
import type { TeamSlot, BaseStats, MechanicNode } from '../types';

// The team's Builder edits, for a worker request.
export function buildBuilderPayload(team: TeamSlot[]) {
  const entityRefs = getTeamEntityRefs(team);
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
    const target = DataLoader.baseStatsFor(name);
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

// applyBuilderOverridesFor every entity a team equips.
export function applyBuilderOverridesForTeam(team: TeamSlot[]): void {
  applyBuilderOverridesFor(getTeamEntityRefs(team).map(r => r.name));
}
