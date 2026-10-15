// Results panel data, from one time-ordered hit list over an opener + N-loop simulation.
import { TimelineEngine } from './TimelineEngine';
import { CombatCalculator, carriesStatScaledBuffFrom } from './CombatCalculator';
import { resourceCap } from './resources';
import { CHARACTER_DEFAULTS, STAT_DB, STAT_NAME_MAP } from '../data/db';
import { PRIMARY_DMG_TYPES } from '../data/gameVocab';
import { DPS_WINDOWS } from '../data/dpsWindows';
import { toRunInput, splitLoopSegments, loopTiming, repeatLoop, rowGameEnd, loopCycleBounds, endingPlacement, TWO_MIN } from './rotationRows';
import { teamCharacters } from '../utils/TeamUtils';
import type { HitConfig, TeamSlot, DamageInstanceResult, EnemyStats } from '../types';
import { type Frames, toFrames, roundFrames, framesToSeconds } from '../utils/Frames';
import type {
  DpsStats,
  DmgOverTimeSeries,
  DmgOverTimePoint,
  CastTypeSlice,
  TeamDmgSlice,
  SubstatWorthRow,
  RotationResults,
  RotationSummary,
  EnergyRequirement,
  DpsWindowKey,
  ContributionForWindow
} from '../types/results';

// Loops sampled for Avg Loop.
const AVG_LOOP_REPS = 3;

interface RotationHit {
  gameTime: Frames;
  total: number;
  provider: string;
  dmgTypes: string[];
  formulaUsed: string;
  // For substat-worth re-pricing.
  config: HitConfig;
  context: any;
}

// Chart label: non-Standard hits use their dmgType unless from the provider's own kit.
function hitLabel(h: RotationHit): string {
  if (h.formulaUsed === 'Standard' || h.config.moveRef?.startsWith(`@${h.provider}(`)) return h.provider;
  return h.dmgTypes[0] || 'Status Effect';
}

// One simulated run with loop and sub-loop end times (null without a loop).
interface SimRun { evaluatedRows: any[]; loopEnds: LoopEnds; cycleEnds: LoopEnds; cyclesPerLoop: number }

// Simulates opener + N loops.
// - loop: opener and loop windows (>= AVG_LOOP_REPS reps)
// - twoMin: the 2-minute fight; separate only if Ending Rotation starts earlier
function buildExtendedTimeline(
  rows: any[],
  team: any[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: EnemyStats,
  loopStartIndex: number,
  endingRotationEnabled: boolean,
  endRotationStartsEarlier: boolean = false,
  shared?: SharedExtendedRun
): { openerEndTime: Frames; loop: SimRun; twoMin: SimRun } {
  const contentRows = rows.filter(r => r && r.unit);
  const { openerRows, loopTemplate, endingRows } = splitLoopSegments(contentRows, loopStartIndex, endingRotationEnabled);

  const { openerEnd, loopDuration } = loopTiming(openerRows, loopTemplate);
  const openerEndTime = toFrames(openerEnd);

  const runSimple = (contentToRun: any[]) =>
    TimelineEngine.recalculateState(toRunInput(contentToRun), team, { ...options, mode: 'full' }, enemyConfig);
  const single = (evaluatedRows: any[]) => {
    const run = { evaluatedRows, loopEnds: null, cycleEnds: null, cyclesPerLoop: 1 };
    return { openerEndTime, loop: run, twoMin: run };
  };

  if (loopTemplate.length === 0) return single(runSimple(openerRows));
  if (loopDuration === 0) return single(runSimple([...openerRows, ...loopTemplate, ...endingRows]));

  const bounds = loopCycleBounds(loopTemplate, team[0]?.character);
  // Rep ends are read from the run; reps can differ in length.
  // `tail`: Ending Rotation and any partial loop before it.
  const simulate = (reps: number, tail: any[]): SimRun => {
    const content = repeatLoop(openerRows, loopTemplate, reps, tail);
    // Reuse the Ending Rotation preview's run if it matches.
    const previewRun = shared?.run;
    const reusable = previewRun && previewRun.reps === reps && previewRun.contentLength === content.length;
    const evaluatedRows = reusable ? previewRun.evaluatedRows : runSimple(content);
    const simulatedRows = evaluatedRows.filter(r => r && r.unit);
    const endOfRow = (rep: number, bound: number) => toFrames(rowGameEnd(simulatedRows[openerRows.length + rep * loopTemplate.length + bound - 1]));
    const repIndices = Array.from({ length: reps }, (_, rep) => rep);
    return {
      evaluatedRows,
      loopEnds: repIndices.map(rep => endOfRow(rep, loopTemplate.length)),
      cycleEnds: repIndices.flatMap(rep => bounds.map(bound => endOfRow(rep, bound))),
      cyclesPerLoop: bounds.length
    };
  };

  if (endingRows.length === 0) {
    const run = simulate(Math.max(AVG_LOOP_REPS, Math.ceil((TWO_MIN - openerEndTime) / loopDuration)), []);
    return { openerEndTime, loop: run, twoMin: run };
  }

  const { reps, partialRows } = endingPlacement(openerRows, loopTemplate, team[0]?.character, endRotationStartsEarlier);
  const twoMin = simulate(reps, [...loopTemplate.slice(0, partialRows), ...endingRows]);
  const loop = reps >= AVG_LOOP_REPS ? twoMin : simulate(AVG_LOOP_REPS, []);
  return { openerEndTime, loop, twoMin };
}

// Prices hits in order against the enemy's running HP.
function priceHits(
  rows: any[],
  team: any[],
  enemyConfig: { hp: number },
  onPriced: (row: any, hit: any, result: DamageInstanceResult) => void
): void {
  let runningEnemyHp = enemyConfig.hp;
  rows.forEach((row: any) => {
    (row._pendingHits || []).forEach((hit: any) => {
      hit.context.enemyHp = runningEnemyHp;
      const result = CombatCalculator.calculateDamageInstance(hit.config, hit.context, team);
      runningEnemyHp = Math.max(0, runningEnemyHp - result.total);
      onPriced(row, hit, result);
    });
  });
}

// Fills each row's `damageInstances` from the authored rows. Mutates in place.
export function populateDamageInstances(rows: any[], enemyConfig: { hp: number }, team: any[]): void {
  rows.forEach((row: any) => { row.damageInstances = []; });
  priceHits(rows, team, enemyConfig, (row, hit, result) => row.damageInstances.push({
    ...result, provider: hit.config.provider, moveName: hit.config.moveName, moveRef: hit.config.moveRef, dmgTypeList: hit.config.dmgTypes || []
  }));
}

// Ending Rotation preview run, reused by the Results pass when N matches.
export interface SharedExtendedRun {
  run?: { reps: number; contentLength: number; evaluatedRows: any[]; openerLength: number; loopLength: number };
}

// Re-times Ending Rotation for the live preview and splices it onto evaluatedRows.
export function previewEndingRotationTiming(
  evaluatedRows: any[],
  team: any[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: EnemyStats,
  loopStartIndex: number,
  populateDamage: boolean = false,
  endRotationStartsEarlier: boolean = false,
  shared?: SharedExtendedRun
): any[] {
  const contentRows = evaluatedRows.filter(r => r && r.unit);
  const { openerRows, loopTemplate, endingRows } = splitLoopSegments(contentRows, loopStartIndex, true);
  if (endingRows.length === 0) return evaluatedRows;

  const { loopDuration } = loopTiming(openerRows, loopTemplate);
  if (loopDuration <= 0) return evaluatedRows;

  const { reps: repsToSimulate, partialRows } = endingPlacement(openerRows, loopTemplate, team[0]?.character, endRotationStartsEarlier);
  const extendedContent = repeatLoop(openerRows, loopTemplate, repsToSimulate, [...loopTemplate.slice(0, partialRows), ...endingRows]);

  const previewEvaluated = TimelineEngine.recalculateState(toRunInput(extendedContent), team, { ...options, mode: 'full' }, enemyConfig);
  if (shared) shared.run = { reps: repsToSimulate, contentLength: extendedContent.length, evaluatedRows: previewEvaluated, openerLength: openerRows.length, loopLength: loopTemplate.length };

  if (populateDamage) populateDamageInstances(previewEvaluated, enemyConfig, team);

  const evaluatedEndingRows = previewEvaluated.filter((r: any) => r && r.unit).slice(-endingRows.length);

  // Replace the Ending Rotation tail, keeping loop marker flags.
  const endingStartContentIdx = openerRows.length + loopTemplate.length;
  let contentIdx = 0;
  return evaluatedRows.map(row => {
    if (!row || !row.unit) return row;
    const idx = contentIdx++;
    if (idx < endingStartContentIdx) return row;
    const replacement = evaluatedEndingRows[idx - endingStartContentIdx];
    return replacement ? { ...replacement, loopStartOverride: row.loopStartOverride, loopEndOverride: row.loopEndOverride, loopSplit: row.loopSplit } : row;
  });
}

// Prices every hit over the extended timeline.
function buildHitList(evaluatedRows: any[], team: any[], enemyConfig: EnemyStats): RotationHit[] {
  const hits: RotationHit[] = [];
  priceHits(evaluatedRows, team, enemyConfig, (_row, hit, result) => {
    hits.push({
      gameTime: toFrames(result.gameTime ?? hit.config.gameTime ?? 0),
      total: result.total,
      provider: hit.config.provider,
      dmgTypes: hit.config.dmgTypes || [],
      formulaUsed: result.formulaUsed,
      config: hit.config,
      context: hit.context
    });
  });

  // Delayed hits can land after later rows' hits.
  return hits.sort((a, b) => a.gameTime - b.gameTime);
}

const windowedHits = (hits: RotationHit[], startExclusive: number, endInclusive: Frames): RotationHit[] =>
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

// Pie bucket for a hit ("Other" if none match).
function primaryDmgType(dmgTypes: string[]): string {
  for (const p of PRIMARY_DMG_TYPES) if (dmgTypes.includes(p)) return p;
  return 'Other';
}

// DPS window: hits in (start, end] over `length`.
interface WindowSpan { start: number; end: Frames; length: Frames }

// Loop (or sub-loop) end times; null without a loop.
type LoopEnds = Frames[] | null;

// Sub-loops averaged by Avg Loop.
const avgLoopUnits = (run: SimRun): number => AVG_LOOP_REPS * run.cyclesPerLoop;

function windowSpan(key: DpsWindowKey, openerEndTime: Frames, { loopEnds, cycleEnds }: SimRun): WindowSpan | null {
  switch (key) {
    case 'opener':
      return { start: -Infinity, end: openerEndTime, length: openerEndTime };
    case 'firstLoop':
      return cycleEnds === null ? null : { start: openerEndTime, end: cycleEnds[0], length: toFrames(cycleEnds[0] - openerEndTime) };
    case 'avgLoop':
      return loopEnds === null
        ? null
        : { start: openerEndTime, end: loopEnds[AVG_LOOP_REPS - 1], length: toFrames(loopEnds[AVG_LOOP_REPS - 1] - openerEndTime) };
    case 'twoMin':
      return { start: -Infinity, end: TWO_MIN, length: TWO_MIN };
  }
}

function buildDpsStats(sim: Simulated): DpsStats {
  const stats: Record<string, number | null> = {};
  for (const window of DPS_WINDOWS) {
    const run = runFor(sim, window.key);
    const span = windowSpan(window.key, sim.openerEndTime, run);
    stats[window.dpsField] = span && span.length > 0 ? sumTotal(windowedHits(run.hits, span.start, span.end)) / framesToSeconds(span.length) : null;
  }
  return stats as unknown as DpsStats;
}

// Cumulative dmg-over-time series from window-relative, time-ordered hits.
function buildDmgOverTimeForWindow(
  relativeHits: Array<{ t: Frames; total: number; label: string }>,
  bossMaxHp: number,
  label: string,
  windowEnd: Frames
): DmgOverTimeSeries {
  const points: DmgOverTimePoint[] = [{ t: toFrames(0), dmg: 0 }];
  let cumulative = 0;
  let killTime: Frames | null = null;

  for (const h of relativeHits) {
    cumulative += h.total;
    points.push({ t: h.t, dmg: cumulative, label: h.label });
    if (killTime === null && cumulative >= bossMaxHp) {
      const prev = points[points.length - 2];
      const frac = cumulative === prev.dmg ? 0 : (bossMaxHp - prev.dmg) / (cumulative - prev.dmg);
      killTime = roundFrames(prev.t + frac * (h.t - prev.t));
    }
  }

  return { label, points, bossMaxHp, killTime, windowEnd };
}

// Chart series names per window.
const SERIES_LABELS: Record<DpsWindowKey, string> = {
  opener: 'Opener',
  firstLoop: 'First Loop',
  avgLoop: 'Avg Loop',
  twoMin: 'Current Rotation'
};

// Folds Avg Loop's sub-loops into one loop, averaging damage and timing per move.
function buildAvgLoopDmgOverTime(hits: RotationHit[], openerEndTime: Frames, periodEnds: Frames[], bossMaxHp: number): DmgOverTimeSeries {
  const periods = periodEnds.length;
  const windowHits = windowedHits(hits, openerEndTime, periodEnds[periods - 1]);
  // Periods can differ in length.
  const repStarts = [openerEndTime, ...periodEnds.slice(0, periods - 1)];
  const repIndexOf = (h: RotationHit) => {
    const idx = periodEnds.findIndex(end => h.gameTime <= end);
    return idx === -1 ? periods - 1 : Math.min(periods - 1, idx);
  };
  // Matches hits across reps by actionId + hitIndex.
  const moveKey = (h: RotationHit) => `${h.config.actionId ?? h.provider}::${h.config.hitIndex ?? 0}`;

  // Per-rep hits by move key; repeated actions match by occurrence order.
  const repGroups: Map<string, RotationHit[]>[] = Array.from({ length: periods }, () => new Map());
  for (const h of windowHits) {
    const repIndex = repIndexOf(h);
    const key = moveKey(h);
    const list = repGroups[repIndex].get(key);
    if (list) list.push(h);
    else repGroups[repIndex].set(key, [h]);
  }

  const allKeys = new Set<string>();
  repGroups.forEach(m => m.forEach((_, k) => allKeys.add(k)));

  const foldedRel = (h: RotationHit) => h.gameTime - repStarts[repIndexOf(h)];

  const folded: { t: Frames; total: number; label: string }[] = [];
  for (const key of allKeys) {
    const perRepLists = repGroups.map(m => m.get(key) ?? []);
    const occurrences = Math.max(0, ...perRepLists.map(l => l.length));
    for (let occ = 0; occ < occurrences; occ++) {
      const matched = perRepLists.map(l => l[occ]).filter((h): h is RotationHit => h !== undefined);
      if (matched.length === 0) continue;
      // Average time and damage across reps.
      const avgRel = matched.reduce((sum, h) => sum + foldedRel(h), 0) / matched.length;
      folded.push({
        t: toFrames(avgRel),
        total: matched.reduce((sum, h) => sum + h.total, 0) / periods,
        label: hitLabel(matched[0])
      });
    }
  }
  folded.sort((a, b) => a.t - b.t);

  const windowEnd = toFrames((periodEnds[periods - 1] - openerEndTime) / periods);
  return buildDmgOverTimeForWindow(folded, bossMaxHp, SERIES_LABELS.avgLoop, windowEnd);
}

function buildAllDmgOverTime(sim: Simulated, bossMaxHp: number): Record<DpsWindowKey, DmgOverTimeSeries> {
  const { openerEndTime } = sim;
  const series = {} as Record<DpsWindowKey, DmgOverTimeSeries>;
  for (const { key } of DPS_WINDOWS) {
    const run = runFor(sim, key);
    const { hits } = run;
    const span = windowSpan(key, openerEndTime, run);
    if (!span) {
      series[key] = buildDmgOverTimeForWindow([], bossMaxHp, SERIES_LABELS[key], toFrames(0));
    } else if (key === 'avgLoop') {
      series[key] = buildAvgLoopDmgOverTime(hits, openerEndTime, run.cycleEnds!.slice(0, avgLoopUnits(run)), bossMaxHp);
    } else {
      // Loop windows start at 0; others use the rotation clock.
      const points = windowedHits(hits, span.start, span.end).map(h => ({
        t: key === 'firstLoop' ? toFrames(h.gameTime - openerEndTime) : h.gameTime,
        total: h.total,
        label: hitLabel(h)
      }));
      series[key] = buildDmgOverTimeForWindow(points, bossMaxHp, SERIES_LABELS[key], span.length);
    }
  }
  return series;
}

// On-field seconds per unit within (start, end]. Simultaneous rows don't take the field.
function fieldTimeInWindow(rows: any[], start: number, end: Frames, divisor: number): Record<string, number> {
  const frames: Record<string, number> = {};
  rows.forEach((row, i) => {
    if (!row?.unit || (row.timing === 'Simultaneous' && i > 0)) return;
    const rowStart = row.gameTimeStart || 0;
    const from = Math.max(start, rowStart - (row.waitTime || 0));
    const to = Math.min(end, rowStart + (row.gameTimePassed || 0));
    if (to > from) frames[row.unit] = (frames[row.unit] || 0) + (to - from);
  });
  return Object.fromEntries(Object.entries(frames).map(([unit, f]) => [unit, framesToSeconds(toFrames(f)) / divisor]));
}

function buildContributionForWindow(windowHits: RotationHit[], teamNames: string[], divisor: number): ContributionForWindow {
  const teamGroups = groupSum(windowHits, hitLabel);
  // Roster order keeps the legend stable.
  const teamNameSet = new Set(teamNames);
  const orderedLabels = [
    ...teamNames.filter(name => teamGroups[name] !== undefined),
    ...Object.keys(teamGroups).filter(label => !teamNameSet.has(label))
  ];
  const team: TeamDmgSlice[] = orderedLabels
    .map(label => ({ label, dmg: teamGroups[label] / divisor }))
    .filter(s => s.dmg > 0);

  const units: Record<string, CastTypeSlice[]> = {};
  teamNames.forEach(unit => {
    const unitGroups = groupSum(
      windowHits.filter(h => hitLabel(h) === unit),
      h => (h.formulaUsed === 'Standard' ? primaryDmgType(h.dmgTypes) : h.dmgTypes[0] || 'Other')
    );
    units[unit] = Object.entries(unitGroups)
      .map(([castType, dmg]) => ({ castType, dmg: dmg / divisor }))
      .filter(s => s.dmg > 0);
  });

  return { team, units };
}

function buildAllContribution(sim: Simulated): Record<DpsWindowKey, ContributionForWindow> {
  const contribution = {} as Record<DpsWindowKey, ContributionForWindow>;
  for (const { key } of DPS_WINDOWS) {
    const run = runFor(sim, key);
    const { hits, evaluatedRows: rows } = run;
    const span = windowSpan(key, sim.openerEndTime, run);
    const divisor = key === 'avgLoop' ? avgLoopUnits(run) : 1;
    contribution[key] = {
      ...buildContributionForWindow(span ? windowedHits(hits, span.start, span.end) : [], sim.teamNames, divisor),
      fieldTime: span ? fieldTimeInWindow(rows, span.start, span.end, divisor) : {},
      duration: span ? framesToSeconds(span.length) / divisor : 0
    };
  }
  return contribution;
}

interface WeightedHit { hit: RotationHit; weight: number }

const weightedTotal = (sample: WeightedHit[]): number => sample.reduce((sum, s) => sum + s.hit.total * s.weight, 0);

// Substat-worth sample for the 2-min window: opener, first loop weighted to all whole loops, cut-off loop.
function substatWorthSample(hits: RotationHit[], openerEndTime: Frames, loopEnds: LoopEnds): WeightedHit[] {
  const asIs = (start: number, end: Frames) => windowedHits(hits, start, end).map(hit => ({ hit, weight: 1 }));
  if (!loopEnds || openerEndTime >= TWO_MIN) return asIs(-Infinity, TWO_MIN);
  const wholeLoopsEnd = loopEnds.filter(end => end <= TWO_MIN).pop();
  if (wholeLoopsEnd === undefined) return asIs(-Infinity, TWO_MIN);

  const firstLoop = windowedHits(hits, openerEndTime, loopEnds[0]);
  const wholeLoops = windowedHits(hits, openerEndTime, wholeLoopsEnd);
  const byUnit = (list: RotationHit[]) => groupSum(list, h => h.provider);
  const firstDmg = byUnit(firstLoop);
  const wholeDmg = byUnit(wholeLoops);
  return [
    ...asIs(-Infinity, openerEndTime),
    ...firstLoop.map(hit => ({ hit, weight: firstDmg[hit.provider] > 0 ? wholeDmg[hit.provider] / firstDmg[hit.provider] : 1 })),
    // No first-loop damage: later hits unweighted.
    ...wholeLoops.filter(h => h.gameTime > loopEnds[0] && !(firstDmg[h.provider] > 0)).map(hit => ({ hit, weight: 1 })),
    ...asIs(wholeLoopsEnd, TWO_MIN)
  ];
}

// Substat worth as % of 2-min team and personal damage.
// Re-prices only the hits a unit's stats reach, without re-simulating timing.
function buildSubstatWorth(sample: WeightedHit[], team: TeamSlot[]): Record<string, SubstatWorthRow[]> {
  const baselineTotal = weightedTotal(sample);
  const out: Record<string, SubstatWorthRow[]> = {};
  if (baselineTotal <= 0) return out;

  team.forEach(slot => {
    const unit = slot.character;
    if (!unit) return;
    const unitBaseline = weightedTotal(sample.filter(s => s.hit.provider === unit));
    const reached = sample.filter(s => s.hit.provider === unit || carriesStatScaledBuffFrom(s.hit.context, unit));
    const repricers = reached.map(({ hit }) => CombatCalculator.repricer(hit.config, hit.context, team, unit));
    // Tune/status hits are priced in full on a context copy.
    const price = (forTeam: TeamSlot[]) => {
      const baseStats = CombatCalculator.calculateFinalStats(unit, [], forTeam);
      return reached.map(({ hit, weight }, i) =>
        (repricers[i]?.(baseStats, forTeam) ?? CombatCalculator.calculateDamageInstance(hit.config, { ...hit.context }, forTeam, { restat: true }).total) * weight);
    };
    // Same pricing path, so only the stat change differs.
    const baseline = price(team);

    const rows: SubstatWorthRow[] = Object.keys(STAT_DB).map(substat => {
      const { values, defaultIndex } = STAT_DB[substat];
      const min = values[0];
      const max = values[values.length - 1];
      const def = values[defaultIndex];
      const statKey = STAT_NAME_MAP[substat];

      const worthFor = (rollValue: number, sign: 1 | -1): { team: number; personal: number } => {
        if (reached.length === 0) return { team: 0, personal: 0 };
        const modifiedTeam = team.map(s =>
          s.character === unit
            ? { ...s, echoStats: { ...s.echoStats, [statKey]: (s.echoStats[statKey] || 0) + sign * rollValue } }
            : s
        );
        let delta = 0;
        let ownDelta = 0;
        price(modifiedTeam).forEach((total, i) => {
          delta += total - baseline[i];
          if (reached[i].hit.provider === unit) ownDelta += total - baseline[i];
        });
        return { team: (delta / baselineTotal) * 100, personal: unitBaseline > 0 ? (ownDelta / unitBaseline) * 100 : 0 };
      };
      const worthsFor = (sign: 1 | -1, scale: (v: number) => number) => {
        const [lo, hi, mid] = [min, max, def].map(roll => worthFor(roll, sign));
        const pick = (part: 'team' | 'personal') => ({ min: scale(lo[part]), max: scale(hi[part]), default: scale(mid[part]) });
        return { team: pick('team'), personal: pick('personal') };
      };

      return {
        substat,
        min,
        max,
        default: def,
        minus: worthsFor(-1, Math.abs),
        plus: worthsFor(1, v => v)
      };
    });

    out[unit] = rows;
  });

  return out;
}

type ResultsArgs = [
  rows: any[],
  team: TeamSlot[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: EnemyStats,
  loopStartIndex: number,
  endingRotationEnabled?: boolean,
  endRotationStartsEarlier?: boolean,
  shared?: SharedExtendedRun
];

interface HitRun extends SimRun { hits: RotationHit[] }

// Priced buildExtendedTimeline runs.
interface Simulated { openerEndTime: Frames; loop: HitRun; twoMin: HitRun; teamNames: string[] }

const runFor = (sim: Simulated, key: DpsWindowKey): HitRun => (key === 'twoMin' ? sim.twoMin : sim.loop);

function simulateHits(...[rows, team, options, enemyConfig, loopStartIndex, endingRotationEnabled = false, endRotationStartsEarlier = false, shared]: ResultsArgs): Simulated {
  const { openerEndTime, loop, twoMin } = buildExtendedTimeline(rows, team, options, enemyConfig, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier, shared);
  const priced = (run: SimRun): HitRun => ({ ...run, hits: buildHitList(run.evaluatedRows, team, enemyConfig) });
  const loopRun = priced(loop);
  return { openerEndTime, loop: loopRun, twoMin: twoMin === loop ? loopRun : priced(twoMin), teamNames: teamCharacters(team) };
}

// DPS and contribution only.
export function buildRotationSummary(...args: ResultsArgs): RotationSummary {
  const sim = simulateHits(...args);
  return { dpsStats: buildDpsStats(sim), contribution: buildAllContribution(sim) };
}

// Required Energy Regen per unit: solves each window between spends for gear ER; the max wins.
function buildEnergyRequirements(
  rows: any[], team: TeamSlot[], startEnergy: boolean, openerEndTime: Frames, loopEnds: LoopEnds
): Record<string, EnergyRequirement> {
  const segmentOf = (t: number): string => {
    if (!loopEnds || t < openerEndTime) return loopEnds ? 'Opener' : 'Rotation';
    const loop = loopEnds.findIndex(end => t < end);
    return loop === -1 ? 'Ending' : `Loop ${loop + 1}`;
  };

  const out: Record<string, EnergyRequirement> = {};
  team.forEach(slot => {
    const unit = slot.character;
    if (!unit) return;
    const current = CombatCalculator.calculateFinalStats(unit, [], team).energyRegen || CHARACTER_DEFAULTS.energyRegen;
    // Gains before ER, and gains x ER buffs at landing.
    let base = 0;
    let buffWeighted = 0;
    let have = startEnergy ? resourceCap(unit, 'energy') : 0;
    let worst: { need: number; row: any } | null = null;
    let spent = false;

    rows.forEach(row => {
      (row?.energyLog || []).forEach((entry: any) => {
        if (entry.unit !== unit) return;
        // Flat (effect-granted) Energy.
        if (entry.flatGain > 0) {
          have += entry.flatGain;
          return;
        }
        if (entry.gain > 0) {
          base += entry.gain;
          buffWeighted += entry.gain * (entry.erPct - current);
          return;
        }
        if (!(entry.spend > 0)) return;
        spent = true;
        const missing = entry.spend - have;
        const need = missing <= 0 ? 0 : base > 0 ? (100 * missing - buffWeighted) / base : Infinity;
        if (!worst || need > worst.need) worst = { need, row };
        base = 0; buffWeighted = 0; have = 0;
      });
    });
    if (!spent || !worst) return;

    const { need, row } = worst as { need: number; row: any };
    out[unit] = {
      required: Number.isFinite(need) ? Math.max(100, need) : null,
      current,
      bottleneck: {
        action: row.moveName || row.action || '',
        time: framesToSeconds(toFrames(row.gameTimeStart || 0)),
        segment: segmentOf(row.gameTimeStart || 0)
      }
    };
  });
  return out;
}

// All Results panel data. `withSubstatWorth: false` skips the costliest part.
export function buildRotationResults(args: Readonly<ResultsArgs>, { withSubstatWorth = true }: { withSubstatWorth?: boolean } = {}): RotationResults {
  const sim = simulateHits(...args);
  const [, team, options, enemyConfig] = args;
  const { hits, evaluatedRows, loopEnds } = sim.twoMin;

  return {
    dpsStats: buildDpsStats(sim),
    dmgOverTimeSeries: buildAllDmgOverTime(sim, enemyConfig.hp),
    contribution: buildAllContribution(sim),
    substatWorth: withSubstatWorth ? buildSubstatWorth(substatWorthSample(hits, sim.openerEndTime, loopEnds), team) : null,
    energyRequirements: buildEnergyRequirements(evaluatedRows, team, !!options.startEnergy, sim.openerEndTime, sim.twoMin.cycleEnds)
  };
}
