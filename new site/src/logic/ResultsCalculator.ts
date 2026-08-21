// src/logic/ResultsCalculator.ts
// Turns one Calculate press into the Results panel's real data. Builds a single flat,
// time-ordered hit list from an extended (opener + N-loop-repetition) simulation, then every
// output -- the 4 DPS numbers, the dmg-over-time series, the contribution pies, substat worth
// -- is a pure filter/aggregation over that same list. Nothing re-runs the timing/scheduling
// engine per output.
import { TimelineEngine } from './TimelineEngine';
import { CombatCalculator } from './CombatCalculator';
import { STAT_DB, STAT_NAME_MAP } from '../data/db';
import type { HitConfig, TeamSlot } from '../types';
import type {
  DpsStats,
  DmgOverTimeSeries,
  DmgOverTimePoint,
  CastTypeSlice,
  TeamDmgSlice,
  SubstatWorthRow,
  RotationResults,
  DpsWindowKey,
  ContributionForWindow
} from '../types/results';

const TWO_MIN = 120;
// Fixed avg-loop sample size per spec: first loop + 2 more, regardless of how short/long a
// single loop is (a fast loop won't naturally reach 3 reps just from the 120s target).
const AVG_LOOP_REPS = 3;

// Primary dmgType identities the pie chart buckets a unit's own hits by; anything else folds
// into "Other" so it never has to seat more series than the categorical palette supports.
// This is deliberately dmgTypes, not castTypes -- they're separate classifications (castType
// is the input/animation category, dmgType is the damage-bonus-scaling category), and a move
// can legitimately have a castType of "Heavy" while its dmgType is "Basic" (or vice versa).
const PRIMARY_DMG_TYPES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Echo'];

interface RotationHit {
  gameTime: number;
  total: number;
  provider: string;
  dmgTypes: string[];
  isNegativeStatus: boolean;
  // Kept for substat-worth re-simulation, which re-runs just the formula (not the engine) per
  // hit with a stat-patched team.
  config: HitConfig;
  context: any;
}

const cloneAuthored = (r: any) => ({
  unit: r.unit,
  action: r.action,
  timing: r.timing,
  ...(r.offset !== undefined && { offset: r.offset }),
  ...(r.manualOffset !== undefined && { manualOffset: r.manualOffset })
});

// Opener + N loop reps, run through the real (non-lightweight) engine once. N is at least
// AVG_LOOP_REPS and enough whole reps to cross 120s -- the last rep is left to finish
// naturally rather than truncated, which is what lets the dmg-over-time graph show the final
// loop's full trajectory past the 2-minute mark, with no separate padding rep needed.
function buildExtendedTimeline(
  rows: any[],
  team: any[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: { level: number; res: number; hp: number },
  loopStartIndex: number
): { evaluatedRows: any[]; openerEndTime: number; loopDuration: number | null } {
  const contentRows = rows.filter(r => r && r.unit);
  const clampedStart = Math.max(0, Math.min(loopStartIndex, contentRows.length));
  const openerRows = contentRows.slice(0, clampedStart);
  const loopTemplate = contentRows.slice(clampedStart);

  // `rows` is the live already-recalculated pass, so its timing fields are trustworthy --
  // same trick analyzeLoop uses to avoid a throwaway baseline pass just to read them back.
  const openerEndRow = openerRows.length > 0 ? openerRows[openerRows.length - 1] : null;
  const openerEndTime = openerEndRow ? (openerEndRow.gameTimeStart || 0) + (openerEndRow.gameTimePassed || 0) : 0;

  const runSimple = (contentToRun: any[]) => {
    const extendedInput = [...contentToRun.map(cloneAuthored), { unit: '', action: '', timing: 'Auto', offset: 0 }];
    return TimelineEngine.recalculateState(extendedInput, team, options, enemyConfig);
  };

  if (loopTemplate.length === 0) {
    return { evaluatedRows: runSimple(openerRows), openerEndTime, loopDuration: null };
  }

  const loopEndRow = loopTemplate[loopTemplate.length - 1];
  const loopEndTime = (loopEndRow.gameTimeStart || 0) + (loopEndRow.gameTimePassed || 0);
  const loopDuration = loopEndTime - openerEndTime;

  if (loopDuration <= 0.01) {
    return { evaluatedRows: runSimple([...openerRows, ...loopTemplate]), openerEndTime, loopDuration: null };
  }

  const repsToSimulate = Math.max(AVG_LOOP_REPS, Math.ceil((TWO_MIN - openerEndTime) / loopDuration));
  const extendedContent: any[] = [...openerRows];
  for (let i = 0; i < repsToSimulate; i++) extendedContent.push(...loopTemplate);

  return { evaluatedRows: runSimple(extendedContent), openerEndTime, loopDuration };
}

// Walks every row's queued hits and prices them for real -- mirrors useRotationStore's
// existing calculateDamage() loop exactly, just over the extended timeline instead of the
// literal authored rows.
function buildHitList(evaluatedRows: any[], team: any[], enemyConfig: { level: number; res: number; hp: number }): RotationHit[] {
  const hits: RotationHit[] = [];
  let runningEnemyHp = enemyConfig.hp;

  evaluatedRows.forEach((row: any) => {
    if (!row._pendingHits || row._pendingHits.length === 0) return;
    row._pendingHits.forEach((hit: any) => {
      hit.context.enemyHp = runningEnemyHp;
      const result = CombatCalculator.calculateDamageInstance(hit.config, hit.context, team);
      runningEnemyHp = Math.max(0, runningEnemyHp - result.total);
      hits.push({
        gameTime: result.gameTime ?? hit.config.gameTime ?? 0,
        total: result.total,
        provider: hit.config.provider,
        dmgTypes: hit.config.dmgTypes || [],
        isNegativeStatus: !!hit.config.isNegativeStatus,
        config: hit.config,
        context: hit.context
      });
    });
  });

  // A hit's origin row (which _pendingHits it's grouped under) isn't necessarily its resolve
  // order globally -- delayed procs/DoT ticks from an earlier row can land after a later
  // row's instant hit. Every downstream consumer filters/accumulates purely by gameTime, so
  // sort once here rather than trusting row-array order.
  return hits.sort((a, b) => a.gameTime - b.gameTime);
}

const windowedHits = (hits: RotationHit[], startExclusive: number, endInclusive: number): RotationHit[] =>
  hits.filter(h => h.gameTime > startExclusive && h.gameTime <= endInclusive);

const sumTotal = (hits: RotationHit[]): number => hits.reduce((sum, h) => sum + h.total, 0);

function groupSum(hits: RotationHit[], keyFn: (h: RotationHit) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hits) {
    const key = keyFn(h);
    out[key] = (out[key] || 0) + h.total;
  }
  return out;
}

function primaryDmgType(dmgTypes: string[]): string {
  for (const p of PRIMARY_DMG_TYPES) if (dmgTypes.includes(p)) return p;
  return 'Other';
}

function buildDpsStats(hits: RotationHit[], openerEndTime: number, loopDuration: number | null): DpsStats {
  const openerDps = openerEndTime > 0 ? sumTotal(windowedHits(hits, -Infinity, openerEndTime)) / openerEndTime : null;
  const firstLoopDps =
    loopDuration !== null ? sumTotal(windowedHits(hits, openerEndTime, openerEndTime + loopDuration)) / loopDuration : null;
  const avgLoopDps =
    loopDuration !== null
      ? sumTotal(windowedHits(hits, openerEndTime, openerEndTime + AVG_LOOP_REPS * loopDuration)) / (AVG_LOOP_REPS * loopDuration)
      : null;
  const twoMinDps = sumTotal(windowedHits(hits, -Infinity, TWO_MIN)) / TWO_MIN;
  return { openerDps, firstLoopDps, avgLoopDps, twoMinDps };
}

function buildDmgOverTimeSeries(hits: RotationHit[], bossMaxHp: number, label: string): DmgOverTimeSeries {
  const points: DmgOverTimePoint[] = [{ t: 0, dmg: 0 }];
  let cumulative = 0;
  let killTime: number | null = null;

  for (const h of hits) {
    cumulative += h.total;
    points.push({ t: h.gameTime, dmg: cumulative });
    if (killTime === null && cumulative >= bossMaxHp) {
      const prev = points[points.length - 2];
      const frac = cumulative === prev.dmg ? 0 : (bossMaxHp - prev.dmg) / (cumulative - prev.dmg);
      killTime = prev.t + frac * (h.gameTime - prev.t);
    }
  }

  return { label, points, bossMaxHp, killTime };
}

function buildContributionForWindow(windowHits: RotationHit[], teamNames: string[], divisor: number): ContributionForWindow {
  const teamGroups = groupSum(windowHits, h => (h.isNegativeStatus ? h.dmgTypes[0] || 'Status Effect' : h.provider));
  const team: TeamDmgSlice[] = Object.entries(teamGroups)
    .map(([label, dmg]) => ({ label, dmg: dmg / divisor }))
    .filter(s => s.dmg > 0);

  const units: Record<string, CastTypeSlice[]> = {};
  teamNames.forEach(unit => {
    const unitGroups = groupSum(
      windowHits.filter(h => h.provider === unit && !h.isNegativeStatus),
      h => primaryDmgType(h.dmgTypes)
    );
    units[unit] = Object.entries(unitGroups)
      .map(([castType, dmg]) => ({ castType, dmg: dmg / divisor }))
      .filter(s => s.dmg > 0);
  });

  return { team, units };
}

function buildAllContribution(
  hits: RotationHit[],
  openerEndTime: number,
  loopDuration: number | null,
  teamNames: string[]
): Record<DpsWindowKey, ContributionForWindow> {
  const openerHits = windowedHits(hits, -Infinity, openerEndTime);
  const firstLoopHits = loopDuration !== null ? windowedHits(hits, openerEndTime, openerEndTime + loopDuration) : [];
  const avgLoopHits = loopDuration !== null ? windowedHits(hits, openerEndTime, openerEndTime + AVG_LOOP_REPS * loopDuration) : [];
  const twoMinHits = windowedHits(hits, -Infinity, TWO_MIN);

  return {
    opener: buildContributionForWindow(openerHits, teamNames, 1),
    firstLoop: buildContributionForWindow(firstLoopHits, teamNames, 1),
    // Averaged across the 3 sampled reps, per spec.
    avgLoop: buildContributionForWindow(avgLoopHits, teamNames, AVG_LOOP_REPS),
    // Full amount in the 2 minutes, per spec -- no averaging.
    twoMin: buildContributionForWindow(twoMinHits, teamNames, 1)
  };
}

// Basis metric confirmed with the user: 2-minute total damage, independent of whichever
// DPS-type window the user happens to be looking at elsewhere in the panel. Each roll's worth
// is expressed two ways -- "team" (% of the whole rotation's 2-min total) and "personal" (% of
// just the target unit's own 2-min total) -- so the panel can show either "how much did this
// roll move the rotation" or "how much did this roll move that unit specifically."
//
// Re-running the full engine simulation 78 times (13 substats x 3 rolls x 2 directions) would
// redo trigger-rule DSL evaluation, buff/cooldown tracking, and hit scheduling on every pass,
// none of which depend on ATK/CritRate/etc at all. Two things make a much cheaper approach
// exactly equivalent instead: CombatCalculator.calculateFinalStats is pure (fresh team.find +
// fresh object build every call, no cross-call caching or mutation), and a hit's damage
// formula never reads any other hit's outcome (calculateDamageInstance only *writes*
// stateData.enemyHp as cosmetic kill-time bookkeeping, never reads it back into the formula).
// So a stat change to one unit can only change that unit's own hits, and reproducing it is
// just re-calling calculateDamageInstance on the already-cached hit/context pairs with a
// stat-patched team clone -- no engine re-run, and only that unit's hit subset needs touching.
function buildSubstatWorth(twoMinHits: RotationHit[], team: TeamSlot[]): Record<string, SubstatWorthRow[]> {
  const baselineTotal = sumTotal(twoMinHits);
  const out: Record<string, SubstatWorthRow[]> = {};
  if (baselineTotal <= 0) return out;

  team.forEach(slot => {
    if (!slot.character) return;
    const unitHits = twoMinHits.filter(h => h.provider === slot.character);
    const unitBaseline = sumTotal(unitHits);

    const rows: SubstatWorthRow[] = Object.keys(STAT_DB).map(substat => {
      const { values, defaultIndex } = STAT_DB[substat];
      const min = values[0];
      const max = values[values.length - 1];
      const def = values[defaultIndex];
      const statKey = STAT_NAME_MAP[substat];

      // Returns [team%, personal%] -- team% is this roll's share of the whole rotation's
      // 2-min total (existing basis), personal% is its share of just this unit's own 2-min
      // total (the "how much more/less does *this unit* do" view).
      const worthFor = (rollValue: number, sign: 1 | -1): [number, number] => {
        if (unitHits.length === 0) return [0, 0];
        const modifiedTeam = team.map(s =>
          s.character === slot.character
            ? { ...s, echoStats: { ...s.echoStats, [statKey]: (s.echoStats[statKey] || 0) + sign * rollValue } }
            : s
        );
        const modifiedTotal = unitHits.reduce(
          (sum, h) => sum + CombatCalculator.calculateDamageInstance(h.config, h.context, modifiedTeam).total,
          0
        );
        const delta = modifiedTotal - unitBaseline;
        return [(delta / baselineTotal) * 100, unitBaseline > 0 ? (delta / unitBaseline) * 100 : 0];
      };

      const [minusTeamMin, minusPersonalMin] = worthFor(min, -1);
      const [minusTeamMax, minusPersonalMax] = worthFor(max, -1);
      const [minusTeamDef, minusPersonalDef] = worthFor(def, -1);
      const [plusTeamMin, plusPersonalMin] = worthFor(min, 1);
      const [plusTeamMax, plusPersonalMax] = worthFor(max, 1);
      const [plusTeamDef, plusPersonalDef] = worthFor(def, 1);

      return {
        substat,
        min,
        max,
        default: def,
        // "Lost" -- what you'd give up if you didn't have this roll. Always a non-positive
        // raw delta; shown as a magnitude.
        minus: {
          team: { min: Math.abs(minusTeamMin), max: Math.abs(minusTeamMax), default: Math.abs(minusTeamDef) },
          personal: { min: Math.abs(minusPersonalMin), max: Math.abs(minusPersonalMax), default: Math.abs(minusPersonalDef) }
        },
        // "Gained" -- what an extra roll would add. Near-zero when a stat (e.g. Crit Rate) is
        // already overcapped, since the formula clamps it and extra rolls do nothing.
        plus: {
          team: { min: plusTeamMin, max: plusTeamMax, default: plusTeamDef },
          personal: { min: plusPersonalMin, max: plusPersonalMax, default: plusPersonalDef }
        }
      };
    });

    out[slot.character] = rows;
  });

  return out;
}

export function buildRotationResults(
  rows: any[],
  team: TeamSlot[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: { level: number; res: number; hp: number },
  loopStartIndex: number
): RotationResults {
  const { evaluatedRows, openerEndTime, loopDuration } = buildExtendedTimeline(rows, team, options, enemyConfig, loopStartIndex);
  const hits = buildHitList(evaluatedRows, team, enemyConfig);
  const teamNames = team.filter(s => s.character).map(s => s.character);
  const twoMinHits = windowedHits(hits, -Infinity, TWO_MIN);

  return {
    dpsStats: buildDpsStats(hits, openerEndTime, loopDuration),
    dmgOverTimeSeries: buildDmgOverTimeSeries(hits, enemyConfig.hp, 'Current Rotation'),
    contribution: buildAllContribution(hits, openerEndTime, loopDuration, teamNames),
    substatWorth: buildSubstatWorth(twoMinHits, team)
  };
}
