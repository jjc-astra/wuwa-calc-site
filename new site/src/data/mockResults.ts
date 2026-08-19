// src/data/mockResults.ts
// Placeholder data generators for the Rotation Calculator's Results panel. The real
// CombatCalculator/TimelineEngine output isn't wired up yet -- these produce plausible,
// deterministic (seeded, not random-per-render) numbers so the charts/tables have something
// to render now, shaped like what the real calculation will eventually provide.
import { STAT_OPTIONS, ENEMY_DEFAULTS } from './db';

// djb2 string hash -> mulberry32 PRNG, so the same seed always produces the same numbers.
function seededRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  let state = h >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rng: () => number, min: number, max: number) => min + rng() * (max - min);

export interface DpsStats {
  openerDps: number;
  firstLoopDps: number;
  avgLoopDps: number;
  twoMinDps: number;
}

export function generateMockDpsStats(seed: string): DpsStats {
  const rng = seededRng(seed + ':dps');
  const base = range(rng, 30000, 70000);
  return {
    openerDps: base * range(rng, 1.3, 1.6),
    firstLoopDps: base * range(rng, 0.9, 1.1),
    avgLoopDps: base * range(rng, 0.85, 1.05),
    twoMinDps: base * range(rng, 0.8, 1.0)
  };
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

const DMG_OVER_TIME_DOMAIN_SECONDS = 150;
const DMG_OVER_TIME_STEP_SECONDS = 2;

export function generateMockDmgOverTimeSeries(seed: string, label: string, bossMaxHp: number = ENEMY_DEFAULTS.hp): DmgOverTimeSeries {
  const rng = seededRng(seed + ':dmg-over-time');
  const stats = generateMockDpsStats(seed);

  const points: DmgOverTimePoint[] = [];
  let cumulative = 0;
  let killTime: number | null = null;

  for (let t = 0; t <= DMG_OVER_TIME_DOMAIN_SECONDS; t += DMG_OVER_TIME_STEP_SECONDS) {
    const instantDps = t < 10 ? stats.openerDps * range(rng, 0.9, 1.1) : stats.avgLoopDps * range(rng, 0.85, 1.15);
    cumulative += instantDps * DMG_OVER_TIME_STEP_SECONDS;
    points.push({ t, dmg: cumulative });

    if (killTime === null && cumulative >= bossMaxHp) {
      const prev = points[points.length - 2];
      if (prev) {
        const frac = (bossMaxHp - prev.dmg) / (cumulative - prev.dmg);
        killTime = prev.t + frac * DMG_OVER_TIME_STEP_SECONDS;
      } else {
        killTime = t;
      }
    }
  }

  return { label, points, bossMaxHp, killTime };
}

export interface SubstatWorthRow {
  substat: string;
  min: number;
  max: number;
  default: number;
}

// "Worth" = the DPS% this substat contributes to this specific unit's build across its
// possible roll range, not the substat's own (unit-agnostic) roll values.
export function generateMockSubstatWorth(unitName: string): SubstatWorthRow[] {
  const rng = seededRng(unitName + ':substat-worth');
  return STAT_OPTIONS.map(substat => {
    const ceiling = range(rng, 1.5, 6.5);
    const floor = ceiling * range(rng, 0.45, 0.7);
    const def = floor + (ceiling - floor) * range(rng, 0.4, 0.6);
    return { substat, min: floor, max: ceiling, default: def };
  });
}

export interface CastTypeSlice {
  castType: string;
  dmg: number;
}

// Primary cast-type identities the user called out; anything else folds into "Other" so a
// pie never has to seat more series than the categorical palette supports.
const PRIMARY_CAST_TYPES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Echo'];

export function generateMockUnitContribution(unitName: string): CastTypeSlice[] {
  const rng = seededRng(unitName + ':contribution');
  const weights = PRIMARY_CAST_TYPES.map(() => range(rng, 0.4, 1));
  const otherWeight = range(rng, 0.1, 0.35);
  const totalWeight = weights.reduce((a, b) => a + b, 0) + otherWeight;
  const unitTotal = range(rng, 150000, 500000);

  const slices: CastTypeSlice[] = PRIMARY_CAST_TYPES.map((castType, i) => ({
    castType,
    dmg: (weights[i] / totalWeight) * unitTotal
  }));
  slices.push({ castType: 'Other', dmg: (otherWeight / totalWeight) * unitTotal });
  return slices.filter(s => s.dmg > 0);
}

export interface TeamDmgSlice {
  label: string;
  dmg: number;
}

const MOCK_GLOBAL_MECHANICS = ['Aero Erosion', 'Tune Break',];

export function generateMockTeamContribution(teamNames: string[]): TeamDmgSlice[] {
  const rng = seededRng(teamNames.join('|') + ':team-contribution');
  const unitSlices: TeamDmgSlice[] = teamNames.map(name => ({
    label: name,
    dmg: range(rng, 200000, 600000)
  }));
  const mechanicSlices: TeamDmgSlice[] = MOCK_GLOBAL_MECHANICS.map(name => ({
    label: name,
    dmg: range(rng, 20000, 120000)
  }));
  return [...unitSlices, ...mechanicSlices];
}
