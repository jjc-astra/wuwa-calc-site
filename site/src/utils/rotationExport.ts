// Builds the exported files: the rotation file (the rotation, roster and target as submitted) and,
// optionally, a results file calculated from it, on either the default build and target or the submitted ones.
import { runSummaryCalculation } from '../workers/runFullCalculation';
import { calculateEchoStatsForSlot, defaultSubstats, recommendedBuildFor } from '../store/useRosterStore';
import type { TeamSlot } from '../types';
import type { RotationFile, ResultsFile, ResultsBuild, RotationSummary, RotationType, CalcInput } from '../types/results';
import { CHARACTER_DEFAULTS, defaultEnemyStats } from '../data/db';
import { sha256Hex } from './Common';

export interface ExportSource extends CalcInput {
  // Already-calculated results for the submitted build and target, when current -- saves a recalculation.
  customResults?: RotationSummary;
}

interface ExportOptions {
  rotationFilename: string;
  author: string;
  rotationType: RotationType;
  // null: the rotation file only, with no calculation.
  results: { build: ResultsBuild } | null;
}

// Short hash of what a results file is calculated from. The data repo's index script recomputes
// it from the rotation file (same JSON.stringify of the same fields), so both must stay in sync.
async function hashRotationInputs({ rotation, team, settings, enemy }: CalcInput): Promise<string> {
  return (await sha256Hex(JSON.stringify({ rotation, team, settings, enemy }))).slice(0, 16);
}

// Each unit on its recommended build's default substats (for its mode) and its weapon at R1. The
// rest stays as submitted -- sequence, weapon, sets, main echo, echo layout and main stats are all
// differences Rankings compares.
function withDefaultBuild(team: TeamSlot[]): TeamSlot[] {
  return team.map(slot => {
    if (!slot.character) return slot;
    const build = recommendedBuildFor(slot.character, slot.mode);
    const next = { ...slot, rank: CHARACTER_DEFAULTS.rank };
    if (build) next.echoes = defaultSubstats(slot, build);
    next.echoStats = calculateEchoStatsForSlot(next);
    return next;
  });
}

// An export's rotation file and, when asked for, its results file (on the default or submitted build).
export async function buildExportFiles(
  source: ExportSource,
  { rotationFilename, author, rotationType, results: resultsOptions }: ExportOptions
): Promise<{ rotationFile: RotationFile; resultsFile: ResultsFile | null }> {
  const { rotation, team, settings, enemy } = source;
  const hash = await hashRotationInputs(source);
  const credit = author ? { author } : {};
  // Left out when unclassified; the rankings index reads a missing one as null.
  const classified = rotationType ? { rotationType } : {};
  const rotationFile: RotationFile = { format: 2, hash, rotation, team, settings, enemy, ...classified, ...credit };
  if (!resultsOptions) return { rotationFile, resultsFile: null };

  const { build } = resultsOptions;

  const resultsTeam = build === 'default' ? withDefaultBuild(team) : team;
  const resultsEnemy = build === 'default' ? defaultEnemyStats() : enemy;
  const results = build === 'custom' && source.customResults
    ? source.customResults
    : await runSummaryCalculation({ rotation, team: resultsTeam, settings, enemy: resultsEnemy });

  return {
    rotationFile,
    resultsFile: {
      format: 2,
      rotationFile: rotationFilename,
      hash,
      build,
      ...classified,
      ...credit,
      team: resultsTeam,
      enemy: resultsEnemy,
      results: { dpsStats: results.dpsStats, contribution: results.contribution }
    }
  };
}
