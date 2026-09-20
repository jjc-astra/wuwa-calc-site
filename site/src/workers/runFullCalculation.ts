// Shared one-shot calc round trip for consumers that aren't the live Rotation Calculator
// (Rankings, Comparison) -- mirrors useRotationStore.calculateDamage()'s
// checkTeamFreshness -> expandRepeatBlocks -> recalculate -> calculateDamage chain, including
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

  const { result: recalcResult } = postToWorker('recalculate', request);
  const { loopStartIndex } = await recalcResult;

  // Both calls share this same expandRepeatBlocks pass, so loopStartIndex (already in
  // expanded-row-index space) needs no collapseMap translation, unlike calculateDamage()'s
  // reuse of a loopStartIndex computed against a separate, earlier expansion.
  const { result: calcResult } = postToWorker('calculateDamage', { ...request, loopStartIndex });
  const { results } = (await calcResult) as { results: RotationResults };
  return { results };
}
