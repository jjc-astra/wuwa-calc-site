// src/types/results.ts
// Shared shapes for the Rotation Calculator's Results panel.
// Used by both the real calc path (logic/ResultsCalculator.ts) and the comparison-pin path
// (store/useComparisonStore.ts), which recalculates a pinned file through the same worker
// pipeline into these same shapes.

import type { Frames } from '../utils/Frames';
import type { DpsWindowKey } from '../data/dpsWindows';
import type { TeamSlot, EnemyStats } from './index';

export type { DpsWindowKey };

export interface DpsStats {
  openerDps: number | null;
  firstLoopDps: number | null;
  avgLoopDps: number | null;
  twoMinDps: number;
}

export interface DmgOverTimePoint {
  t: Frames;
  dmg: number;
  // Damage source: character name, or a status dmgType label (e.g. "Aero Erosion") for
  // non-attributable ticks. Same identity as TeamDmgSlice.label (shared color lookup).
  // Absent on the t=0 point and on DPS-mode's rolling-average points.
  label?: string;
}

export interface DmgOverTimeSeries {
  label: string;
  points: DmgOverTimePoint[];
  bossMaxHp: number;
  killTime: Frames | null;
  // Nominal window duration (openerEndTime, loopDuration, etc.) -- sizes the chart's x-axis to
  // that width, rather than wherever the last real hit landed (can undershoot near the boundary).
  windowEnd: Frames;
}

export interface SubstatWorthValues {
  min: number;
  max: number;
  default: number;
}

export interface SubstatWorthDirection {
  // % change of the whole team's 2-min total damage -- this roll's worth to the whole rotation.
  team: SubstatWorthValues;
  // % change of just this unit's own 2-min damage -- this roll's worth to that unit alone.
  personal: SubstatWorthValues;
}

export interface SubstatWorthRow {
  substat: string;
  min: number;
  max: number;
  default: number;
  // % change in the basis metric per roll of this substat. "minus" = losing a roll you have,
  // "plus" = gaining one. Each direction has a team-relative and a personal percentage.
  minus: SubstatWorthDirection;
  plus: SubstatWorthDirection;
}

export interface CastTypeSlice {
  castType: string;
  dmg: number;
}

export interface TeamDmgSlice {
  label: string;
  dmg: number;
}

export interface ContributionForWindow {
  team: TeamDmgSlice[];
  // Per-unit cast-type breakdown, keyed by character name.
  units: Record<string, CastTypeSlice[]>;
  // Seconds each unit spent on field (the controlled character), keyed by character name, and
  // the window's own length in seconds. Missing on results saved before they existed.
  fieldTime?: Record<string, number>;
  duration?: number;
}

export interface RotationResults {
  dpsStats: DpsStats;
  // Same 4 windows as `contribution` below -- lets the chart zoom into one window's timeline.
  dmgOverTimeSeries: Record<DpsWindowKey, DmgOverTimeSeries>;
  contribution: Record<DpsWindowKey, ContributionForWindow>;
  // Per-unit substat worth rows, keyed by character name.
  substatWorth: Record<string, SubstatWorthRow[]>;
  // Per unit that spends Energy, keyed by character name. Missing on results saved before it existed.
  energyRequirements?: Record<string, EnergyRequirement>;
}

// The Energy Regen a unit needs for every Energy-spending cast in the rotation (its Liberations)
// to have enough Energy -- found over the whole simulated run, so the cast with the least Energy
// gained since the one before it (the bottleneck) sets it, not just the first.
export interface EnergyRequirement {
  // Energy Regen % from gear (base 100 + stats, before temporary buffs) that's enough everywhere.
  // null: some cast can't be reached at any Energy Regen (no Energy gained before it).
  required: number | null;
  // The unit's current Energy Regen % from gear, on the same basis.
  current: number;
  // The cast that needs the most. `segment` is where it falls: Opener, Loop N or Ending.
  bottleneck: { action: string; time: number; segment: string } | null;
}

// What the Results panels read. The chart series is optional: the Character Guide has no DMG Over
// Time panel, so its cached results leave the series out.
export type PanelResults = Omit<RotationResults, 'dmgOverTimeSeries'> & Partial<Pick<RotationResults, 'dmgOverTimeSeries'>>;

// DPS + contribution only: what Rankings rows and the Character Guide's comparisons read.
export type RotationSummary = Pick<RotationResults, 'dpsStats' | 'contribution'>;

// --- Saved rotation / results files (data repo: character_results/) ---

export type RotationType = 'linear' | 'quickswap' | null;

export interface RotationSettings {
  startEnergy?: boolean;
  startConcerto?: boolean;
  endingRotationEnabled?: boolean;
  endRotationStartsEarlier?: boolean;
}

// What a calculation runs on: a rotation, a team, its settings and the target.
export interface CalcInput {
  rotation: any[];
  team: TeamSlot[];
  settings: RotationSettings;
  enemy: EnemyStats;
}

// rotations/<name>.json: the rotation, roster and target as submitted.
export interface RotationFile extends CalcInput {
  format: 2;
  // Short hash of { rotation, team, settings, enemy }; a results file repeats it to show it was
  // calculated from exactly this file.
  hash: string;
  author?: string;
}

// 'default': each unit on its recommended echo layout, main stats and substats (set, main echo
// and weapon as submitted), against the default target -- what Rankings ranks. 'custom': the
// submitted build and target, for sharing.
export type ResultsBuild = 'default' | 'custom';

// results/<name>.json: one calculation of a rotation file.
export interface ResultsFile {
  format: 2;
  rotationFile: string;
  hash: string;
  build: ResultsBuild;
  author?: string;
  rotationType?: RotationType;
  // The exact team and target the results were calculated with.
  team: TeamSlot[];
  enemy: EnemyStats;
  results: RotationSummary;
}

// A ranking row only needs who was on the team, not their echoes.
export type RosterSlot = Pick<TeamSlot, 'character' | 'sequence' | 'weapon' | 'rank' | 'mainSet' | 'subSet' | 'subSet2a' | 'subSet2b' | 'mainEcho' | 'layout'>;

// One row of the generated index.json: a default-build results file, trimmed for Rankings.
export interface RankingIndexEntry {
  // The results file's name.
  id: string;
  rotationFile: string;
  hash: string;
  rotationType: RotationType;
  author?: string;
  team: RosterSlot[];
  results: RotationSummary;
}
