// Builds the rotation file and optional results file for export.
import { runSummaryCalculation } from '../workers/runFullCalculation';
import { calculateEchoStatsForSlot, defaultSubstats, recommendedBuildFor } from '../store/useRosterStore';
import type { TeamSlot } from '../types';
import type { RotationFile, ResultsFile, ResultsBuild, RotationSummary, RotationType, CalcInput } from '../types/results';
import { CHARACTER_DEFAULTS, defaultEnemyStats } from '../data/db';
import { CommonUtils, sha256Hex } from './Common';
import { SLOT_SET_FIELDS, slotSets } from './TeamUtils';

export interface ExportSource extends CalcInput {
  // Current results, to skip recalculating.
  customResults?: RotationSummary;
}

interface ExportOptions {
  author: string;
  rotationType: RotationType;
  // null: rotation file only.
  results: { build: ResultsBuild } | null;
}

// Sync with the data repo's generate-rankings-index.mjs.
async function hashRotationInputs({ rotation, team, settings, enemy }: CalcInput): Promise<string> {
  return (await sha256Hex(JSON.stringify({ rotation, team, settings, enemy }))).slice(0, 16);
}

// Initials of a slot's sets ("SSD+VT+MC") when they differ from its recommended build's.
export function nonDefaultSetTag(slot: TeamSlot): string {
  const build = slot.character ? recommendedBuildFor(slot.character, slot.mode) : undefined;
  if (!build || SLOT_SET_FIELDS.every(field => (slot[field] || '') === (build[field] || ''))) return '';
  return slotSets(slot).map(CommonUtils.initials).join('+');
}

// Default substats and R1; everything else as submitted.
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

export async function buildExportFiles(
  source: ExportSource,
  { author, rotationType, results: resultsOptions }: ExportOptions
): Promise<{ rotationFile: RotationFile; resultsFile: ResultsFile | null }> {
  const { rotation, team, settings, enemy } = source;
  const hash = await hashRotationInputs(source);
  const credit = author ? { author } : {};
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
