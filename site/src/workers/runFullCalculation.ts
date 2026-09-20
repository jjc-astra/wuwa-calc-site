// Shared one-shot calc round trip for consumers that aren't the live Rotation Calculator
// (Rankings, Comparison) -- mirrors useRotationStore.calculateDamage()'s
// checkTeamFreshness -> expandRepeatBlocks -> calculateDamage chain, including
// builder overrides, so a saved/pinned rotation with Hold-Repeat blocks or Mechanics Builder
// edits computes identically to running it live.
import { postToWorker } from './calcWorkerClient';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { expandRepeatBlocks } from '../logic/RepeatBlocks';
import { ENEMY_DEFAULTS } from '../data/db';
import type { TeamSlot } from '../types/index';
import type { RotationRow, RotationRowFields } from '../store/useRotationStore';
import type { RotationResults } from '../types/results';

export async function runFullCalculation(
  rotation: RotationRowFields[],
  team: TeamSlot[],
  options: Record<string, unknown>,
  endingRotationEnabled?: boolean,
  endRotationStartsEarlier?: boolean
): Promise<{ results: RotationResults }> {
  const staleRefs = await checkTeamFreshness(team);
  // expandRepeatBlocks never reads `.id` -- safe for saved/ranked rows, which never carry one.
  const { expanded } = expandRepeatBlocks(rotation as RotationRow[]);
  const request = { rows: expanded, team, options, enemy: ENEMY_DEFAULTS, endingRotationEnabled, endRotationStartsEarlier, staleRefs };

  // No loopStartIndex: the worker finds it on the expanded rows itself, so this doesn't need a
  // separate recalculate (with loop analysis) just to read it.
  const { result: calcResult } = postToWorker('calculateDamage', request);
  const { results } = (await calcResult) as { results: RotationResults };
  return { results };
}
