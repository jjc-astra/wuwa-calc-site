// src/data/mockResults.ts
// Placeholder data generators for the still-unwired comparison-pin feature (pinning an
// imported rotation file's DPS/dmg-over-time against the current one in useComparisonStore).
// The four live Results panels (DPS, Dmg Over Time, Team Contribution, Substat Worth) read
// real data from logic/ResultsCalculator.ts -- only the pin comparison still uses these
// seeded, deterministic placeholder numbers.
import { ENEMY_DEFAULTS } from './db';
import type { DpsStats, DmgOverTimePoint, DmgOverTimeSeries, DpsWindowKey } from '../types/results';
export type { DpsStats, DmgOverTimePoint, DmgOverTimeSeries };

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

const DMG_OVER_TIME_STEP_SECONDS = 2;

function generateMockDmgOverTimeForWindow(
  seed: string,
  label: string,
  domainSeconds: number,
  dpsEstimate: number,
  bossMaxHp: number
): DmgOverTimeSeries {
  const rng = seededRng(seed + ':dmg-over-time:' + label);

  const points: DmgOverTimePoint[] = [];
  let cumulative = 0;
  let killTime: number | null = null;

  for (let t = 0; t <= domainSeconds; t += DMG_OVER_TIME_STEP_SECONDS) {
    const instantDps = dpsEstimate * range(rng, 0.85, 1.15);
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

  return { label, points, bossMaxHp, killTime, windowEnd: domainSeconds };
}

// One mock series per window, matching the real calculator's 4-window shape (opener/first
// loop/avg loop/2-min) -- the pinned-comparison feature itself stays out of scope/mocked, this
// just keeps its placeholder data type-compatible with the real per-window series.
export function generateMockAllDmgOverTime(seed: string, label: string, bossMaxHp: number = ENEMY_DEFAULTS.hp): Record<DpsWindowKey, DmgOverTimeSeries> {
  const stats = generateMockDpsStats(seed);
  return {
    opener: generateMockDmgOverTimeForWindow(seed, label, 12, stats.openerDps!, bossMaxHp),
    firstLoop: generateMockDmgOverTimeForWindow(seed, label, 40, stats.firstLoopDps!, bossMaxHp),
    avgLoop: generateMockDmgOverTimeForWindow(seed, label, 40, stats.avgLoopDps!, bossMaxHp),
    twoMin: generateMockDmgOverTimeForWindow(seed, label, 150, stats.twoMinDps, bossMaxHp)
  };
}
