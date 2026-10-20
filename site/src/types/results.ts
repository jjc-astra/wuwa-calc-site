// Results panel shapes.

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
  // Character name or status label; matches TeamDmgSlice.label.
  label?: string;
}

export interface DmgOverTimeSeries {
  label: string;
  points: DmgOverTimePoint[];
  bossMaxHp: number;
  killTime: Frames | null;
  // Nominal window length; sizes the x-axis.
  windowEnd: Frames;
}

export interface SubstatWorthValues {
  min: number;
  max: number;
  default: number;
}

export interface SubstatWorthDirection {
  // % of team 2-min damage.
  team: SubstatWorthValues;
  // % of this unit's 2-min damage.
  personal: SubstatWorthValues;
}

export interface SubstatWorthRow {
  substat: string;
  min: number;
  max: number;
  default: number;
  // minus: losing a roll; plus: gaining one.
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
  units: Record<string, CastTypeSlice[]>;
  // On-field seconds per unit, and the window length.
  fieldTime?: Record<string, number>;
  duration?: number;
}

export interface RotationResults {
  dpsStats: DpsStats;
  dmgOverTimeSeries: Record<DpsWindowKey, DmgOverTimeSeries>;
  contribution: Record<DpsWindowKey, ContributionForWindow>;
  // Null when skipped.
  substatWorth: Record<string, SubstatWorthRow[]> | null;
  energyRequirements?: Record<string, EnergyRequirement>;
}

// Energy Regen needed for every Energy-spending cast; set by the bottleneck cast.
export interface EnergyRequirement {
  // Gear ER % (before buffs). null: unreachable at any ER.
  required: number | null;
  current: number;
  // `segment`: Opener, Loop N or Ending.
  bottleneck: { action: string; time: number; segment: string } | null;
}

// What Results panels read; the chart series is optional.
export type PanelResults = Omit<RotationResults, 'dmgOverTimeSeries'> & Partial<Pick<RotationResults, 'dmgOverTimeSeries'>>;

// DPS + contribution only.
export type RotationSummary = Pick<RotationResults, 'dpsStats' | 'contribution'>;

// --- Saved rotation / results files (data repo: character_results/) ---

export type RotationType = 'linear' | 'quickswap' | null;

export interface RotationSettings {
  startEnergy?: boolean;
  startConcerto?: boolean;
  endingRotationEnabled?: boolean;
  endRotationStartsEarlier?: boolean;
}

export interface CalcInput {
  rotation: any[];
  team: TeamSlot[];
  settings: RotationSettings;
  enemy: EnemyStats;
}

// rotations/<name>.json
export interface RotationFile extends CalcInput {
  format: 2;
  // Hash of rotation, team, settings, enemy; links results files.
  hash: string;
  author?: string;
  rotationType?: RotationType;
}

// results/<name>.json, generated from rotations/<name>.json by scripts/recalc-results.mjs.
export interface ResultsFile {
  format: 2;
  hash: string;
  // Recommended substats, weapon at R1, default target.
  build: 'default';
  author?: string;
  rotationType?: RotationType;
  team: TeamSlot[];
  enemy: EnemyStats;
  results: RotationSummary;
}

export type RosterSlot = Pick<TeamSlot, 'character' | 'sequence' | 'weapon' | 'rank' | 'mainSet' | 'subSet' | 'subSet2a' | 'subSet2b' | 'mainEcho' | 'layout'>;

// Dominant element and DMG Type over 2 minutes; null when none.
export interface RankingMajority {
  element: string | null;
  category: string | null;
}

// One index.json entry: only what search, filters and sort read.
export interface RankingIndexEntry {
  id: string;
  rotationFile: string;
  hash: string;
  rotationType: RotationType;
  // [main DPS, sub DPS, support]; '' for empty.
  characters: string[];
  sequences: number[];
  dpsStats: DpsStats;
  majority: RankingMajority;
}
