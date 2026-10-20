// Builds the exported rotation file, and the ranked results scripts/recalc-results.mjs generates from it.
import { runSummaryCalculation } from '../workers/runFullCalculation';
import { calculateEchoStatsForSlot, defaultSubstats, recommendedBuildFor } from '../store/useRosterStore';
import type { TeamSlot } from '../types';
import type { RotationFile, ResultsFile, RotationType, CalcInput } from '../types/results';
import { CHARACTER_DEFAULTS, defaultEnemyStats } from '../data/db';
import { CommonUtils, sha256Hex } from './Common';
import { SLOT_SET_FIELDS } from './TeamUtils';
import { DataLoader } from './DataLoader';

interface ExportOptions {
  author: string;
  rotationType: RotationType;
}

// Sync with the data repo's generate-rankings-index.mjs.
async function hashRotationInputs({ rotation, team, settings, enemy }: CalcInput): Promise<string> {
  return (await sha256Hex(JSON.stringify({ rotation, team, settings, enemy }))).slice(0, 16);
}

type SetFields = Partial<Pick<TeamSlot, typeof SLOT_SET_FIELDS[number]>>;

// The sets a slot actually wears, per field: those resolveSetPieceCounts gives pieces. A 5pc main
// set leaves any extra-set picks still on the slot unworn.
function wornSets(slot: SetFields): Record<typeof SLOT_SET_FIELDS[number], string> {
  const sets = { mainSet: slot.mainSet || '', subSet: slot.subSet || '', subSet2a: slot.subSet2a || '', subSet2b: slot.subSet2b || '' };
  const pieces = DataLoader.resolveSetPieceCounts(sets);
  return { ...sets, ...Object.fromEntries(SLOT_SET_FIELDS.filter(field => pieces[field] === 0).map(field => [field, ''])) };
}

// Initials of a slot's worn sets ("SSD+VT+RSM") when they differ from its recommended build's.
export function nonDefaultSetTag(slot: TeamSlot): string {
  const build = slot.character ? recommendedBuildFor(slot.character, slot.mode) : undefined;
  if (!build) return '';
  const worn = wornSets(slot);
  const recommended = wornSets(build);
  if (SLOT_SET_FIELDS.every(field => worn[field] === recommended[field])) return '';
  return SLOT_SET_FIELDS.map(field => worn[field]).filter(Boolean).map(CommonUtils.initials).join('+');
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

/** The rotation file for a calculator rotation: its inputs, their hash, and optional credit and type. */
export async function buildRotationFile(source: CalcInput, { author, rotationType }: ExportOptions): Promise<RotationFile> {
  const { rotation, team, settings, enemy } = source;
  const hash = await hashRotationInputs(source);
  return { format: 2, hash, rotation, team, settings, enemy, ...(rotationType ? { rotationType } : {}), ...(author ? { author } : {}) };
}

/** A rotation file's ranked results: recommended substats, weapon at R1, default target. */
export async function buildRankedResults(file: RotationFile): Promise<ResultsFile> {
  const { rotation, settings, hash, author, rotationType } = file;
  const team = withDefaultBuild(file.team);
  const enemy = defaultEnemyStats();
  const results = await runSummaryCalculation({ rotation, team, settings, enemy });
  return {
    format: 2,
    hash,
    build: 'default',
    ...(rotationType ? { rotationType } : {}),
    ...(author ? { author } : {}),
    team,
    enemy,
    results: { dpsStats: results.dpsStats, contribution: results.contribution }
  };
}
