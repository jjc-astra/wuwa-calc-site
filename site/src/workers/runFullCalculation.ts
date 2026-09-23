// Shared one-shot calc round trip for consumers that aren't the live Rotation Calculator
// (Rankings, Comparison) -- mirrors useRotationStore.calculateDamage()'s
// checkTeamFreshness -> expandRepeatBlocks -> calculateDamage chain, including
// builder overrides, so a saved/pinned rotation with Hold-Repeat blocks or Mechanics Builder
// edits computes identically to running it live.
import { postToWorker, postToWorkerPool } from './calcWorkerClient';
import type { WorkerRequest } from './calcWorkerClient';
import type { RotationSummary } from '../logic/ResultsCalculator';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { expandRepeatBlocks } from '../logic/RepeatBlocks';
import { ENEMY_DEFAULTS } from '../data/db';
import type { TeamSlot } from '../types/index';
import type { RotationRow, RotationRowFields } from '../store/useRotationStore';
import type { RotationResults } from '../types/results';

// Freshness check + Hold-Repeat expansion, shared by the full and summary calculations.
export async function buildCalcRequest(
  rotation: RotationRowFields[],
  team: TeamSlot[],
  options: Record<string, unknown>,
  endingRotationEnabled?: boolean,
  endRotationStartsEarlier?: boolean
): Promise<WorkerRequest> {
  const staleRefs = await checkTeamFreshness(team);
  // expandRepeatBlocks never reads `.id` -- safe for saved/ranked rows, which never carry one.
  const { expanded } = expandRepeatBlocks(rotation as RotationRow[]);
  // No loopStartIndex: the worker finds it on the expanded rows itself, so this doesn't need a
  // separate recalculate (with loop analysis) just to read it.
  return { rows: expanded, team, options, enemy: ENEMY_DEFAULTS, endingRotationEnabled, endRotationStartsEarlier, staleRefs };
}

// evaluatedRows/loopStartIndex index the expanded rows, as RotationTimeline expects.
export async function runFullCalculation(
  rotation: RotationRowFields[],
  team: TeamSlot[],
  options: Record<string, unknown>,
  endingRotationEnabled?: boolean,
  endRotationStartsEarlier?: boolean
): Promise<{ results: RotationResults; evaluatedRows: any[]; loopStartIndex: number }> {
  const request = await buildCalcRequest(rotation, team, options, endingRotationEnabled, endRotationStartsEarlier);
  const { result } = postToWorker('calculateDamage', request);
  const { results, evaluatedRows, loopStartIndex } = await result;
  return { results, evaluatedRows, loopStartIndex };
}

// DPS + contribution only, on a pool lane (see postToWorkerPool).
export async function runSummaryCalculation(
  rotation: RotationRowFields[],
  team: TeamSlot[],
  options: Record<string, unknown>,
  endingRotationEnabled?: boolean,
  endRotationStartsEarlier?: boolean,
  isCancelled?: () => boolean
): Promise<RotationSummary> {
  const request = await buildCalcRequest(rotation, team, options, endingRotationEnabled, endRotationStartsEarlier);
  const { results } = await postToWorkerPool({ ...request, summaryOnly: true }, isCancelled);
  return results;
}
