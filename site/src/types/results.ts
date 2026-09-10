// src/types/results.ts
// Shared shapes for the Rotation Calculator's Results panel.
// Used by both the real calc path (logic/ResultsCalculator.ts) and the comparison-pin path
// (store/useComparisonStore.ts), which recalculates a pinned file through the same worker
// pipeline into these same shapes.

import type { Frames } from '../utils/Frames';

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

export type DpsWindowKey = 'opener' | 'firstLoop' | 'avgLoop' | 'twoMin';

export interface ContributionForWindow {
  team: TeamDmgSlice[];
  // Per-unit cast-type breakdown, keyed by character name.
  units: Record<string, CastTypeSlice[]>;
}

export interface RotationResults {
  dpsStats: DpsStats;
  // Same 4 windows as `contribution` below -- lets the chart zoom into one window's timeline.
  dmgOverTimeSeries: Record<DpsWindowKey, DmgOverTimeSeries>;
  contribution: Record<DpsWindowKey, ContributionForWindow>;
  // Per-unit substat worth rows, keyed by character name.
  substatWorth: Record<string, SubstatWorthRow[]>;
}
