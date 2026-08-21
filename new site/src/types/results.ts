// src/types/results.ts
// Shared shapes for the Rotation Calculator's Results panel, used by both the real
// calculation path (logic/ResultsCalculator.ts) and the still-mocked comparison-pin path
// (data/mockResults.ts, store/useComparisonStore.ts) so the two stay interchangeable.

export interface DpsStats {
  openerDps: number | null;
  firstLoopDps: number | null;
  avgLoopDps: number | null;
  twoMinDps: number;
}

export interface DmgOverTimePoint {
  t: number;
  dmg: number;
}

export interface DmgOverTimeSeries {
  label: string;
  points: DmgOverTimePoint[];
  bossMaxHp: number;
  killTime: number | null;
}

export interface SubstatWorthValues {
  min: number;
  max: number;
  default: number;
}

export interface SubstatWorthDirection {
  // % change of the whole team's 2-minute total damage -- how much this roll is worth to the
  // rotation as a whole.
  team: SubstatWorthValues;
  // % change of just this unit's own 2-minute damage -- how much this roll is worth to that
  // unit's personal output, ignoring everyone else's share of the total.
  personal: SubstatWorthValues;
}

export interface SubstatWorthRow {
  substat: string;
  min: number;
  max: number;
  default: number;
  // % change in the basis metric for a single roll of this substat at each roll value, in
  // both directions -- "minus" = losing a roll you have, "plus" = gaining an extra one. Each
  // direction carries both a team-relative and a personal (unit-relative) percentage.
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
  dmgOverTimeSeries: DmgOverTimeSeries;
  contribution: Record<DpsWindowKey, ContributionForWindow>;
  // Per-unit substat worth rows, keyed by character name.
  substatWorth: Record<string, SubstatWorthRow[]>;
}
