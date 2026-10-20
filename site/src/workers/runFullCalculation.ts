// One-shot calc for saved rotations, matching useRotationStore.calculateDamage.
import { postToWorker, postToWorkerPool } from './calcWorkerClient';
import type { WorkerRequest } from './calcWorkerClient';
import { checkTeamFreshness } from '../utils/dataFreshness';
import { expandRepeatBlocks } from '../logic/RepeatBlocks';
import type { RotationRow } from '../store/useRotationStore';
import type { RotationResults, RotationSummary, CalcInput } from '../types/results';

export async function buildCalcRequest({ rotation, team, settings, enemy }: CalcInput): Promise<WorkerRequest> {
  await checkTeamFreshness(team);
  const { expanded } = expandRepeatBlocks(rotation as RotationRow[]);
  // The worker finds loopStartIndex itself.
  return {
    rows: expanded,
    team,
    options: { ...settings },
    enemy,
    endingRotationEnabled: settings.endingRotationEnabled,
    endRotationStartsEarlier: settings.endRotationStartsEarlier
  };
}

// Indices refer to the expanded rows.
export async function runFullCalculation(input: CalcInput): Promise<{ results: RotationResults; evaluatedRows: any[]; loopStartIndex: number }> {
  const { result } = postToWorker('calculateDamage', await buildCalcRequest(input));
  const { results, evaluatedRows, loopStartIndex } = await result;
  return { results, evaluatedRows, loopStartIndex };
}

// DPS + contribution only, on a pool lane. withIssues: also the run's errors and warnings.
export async function runSummaryCalculation(input: CalcInput, isCancelled?: () => boolean, withIssues = false): Promise<RotationSummary> {
  const { results } = await postToWorkerPool({ ...(await buildCalcRequest(input)), summaryOnly: true, withIssues }, isCancelled);
  return results;
}
