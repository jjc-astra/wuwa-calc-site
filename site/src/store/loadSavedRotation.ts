import { useRosterStore } from './useRosterStore';
import { useRotationStore } from './useRotationStore';
import type { RotationRowFields } from './useRotationStore';
import type { TeamSlot } from '../types';

/** Replaces the calculator's team and rotation with a saved one (a History snapshot, a Rankings
 * entry). The team goes first and is awaited: importRotation fires its own recalculate, which must
 * see the new team. */
export async function loadSavedRotation(saved: {
  team: TeamSlot[];
  rotation: RotationRowFields[];
  settings?: Parameters<ReturnType<typeof useRotationStore.getState>['importRotation']>[1];
}): Promise<void> {
  await useRosterStore.getState().importTeam(saved.team);
  useRotationStore.getState().importRotation(saved.rotation, saved.settings);
}
