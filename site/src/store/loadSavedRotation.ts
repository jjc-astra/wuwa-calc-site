import { useRosterStore } from './useRosterStore';
import { useRotationStore } from './useRotationStore';
import type { RotationRowFields } from './useRotationStore';
import type { TeamSlot, EnemyStats } from '../types';

/** Loads a saved team, target and rotation. The team is awaited first. */
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
