import { useRosterStore } from './useRosterStore';
import { useRotationStore } from './useRotationStore';
import type { RotationRowFields } from './useRotationStore';
import type { TeamSlot, EnemyStats } from '../types';

/** Replaces the calculator's team, target and rotation with a saved one (a History snapshot, a
 * Rankings entry). The team goes first and is awaited: importRotation fires its own recalculate,
 * which must see the new team. A save without a target keeps the current one. */
export async function loadSavedRotation(saved: {
  team: TeamSlot[];
  rotation: RotationRowFields[];
  settings?: Parameters<ReturnType<typeof useRotationStore.getState>['importRotation']>[1];
  enemy?: EnemyStats;
}): Promise<void> {
  if (saved.enemy) useRosterStore.getState().setEnemy(saved.enemy);
  await useRosterStore.getState().importTeam(saved.team);
  useRotationStore.getState().importRotation(saved.rotation, saved.settings);
}
