// Turns one Calculate press into the Results panel's data. Builds a single flat, time-ordered
// hit list from an extended (opener + N-loop-repetition) simulation; every output (DPS numbers,
// dmg-over-time, contribution pies, substat worth) is a pure filter/aggregation over that list.
import { TimelineEngine } from './TimelineEngine';
import { CombatCalculator } from './CombatCalculator';
import { STAT_DB, STAT_NAME_MAP } from '../data/db';
import type { HitConfig, TeamSlot } from '../types';
import { type Frames, toFrames, roundFrames, framesToSeconds } from '../utils/Frames';
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

const TWO_MIN = toFrames(120 * 60);
// Fixed avg-loop sample size: first loop + 2 more, regardless of how short a loop is.
const AVG_LOOP_REPS = 3;

// dmgType identities the pie chart buckets hits by (deliberately dmgTypes, not castTypes --
// a move's cast/animation category can differ from its damage-bonus-scaling category).
// Anything else folds into "Other".
const PRIMARY_DMG_TYPES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Echo'];

interface RotationHit {
  gameTime: Frames;
  total: number;
  provider: string;
  dmgTypes: string[];
  formulaUsed: string;
  // Kept for substat-worth re-simulation, which re-runs just the formula per hit with a
  // stat-patched team.
  config: HitConfig;
  context: any;
}

// A non-Standard-formula hit (Tune Break, negative status) isn't caused by any unit's own
// combat kit, so it's labeled by dmgType instead (e.g. "Aero Erosion", "TuneBreak"). Shared by
// the contribution pie and dmg-over-time chart for consistency.
function hitLabel(h: RotationHit): string {
  return h.formulaUsed !== 'Standard' ? (h.dmgTypes[0] || 'Status Effect') : h.provider;
}

const cloneAuthored = (r: any) => ({
  unit: r.unit,
  action: r.action,
  timing: r.timing,
  ...(r.offset !== undefined && { offset: r.offset }),
  ...(r.manualOffset !== undefined && { manualOffset: r.manualOffset })
});

// Splits a rotation's content rows into opener / loop-template / (optional) Ending Rotation
// tail. Shared by buildExtendedTimeline and previewEndingRotationTiming so both agree on segments.
function splitLoopSegments(
  contentRows: any[],
  loopStartIndex: number,
  endingRotationEnabled: boolean
): { openerRows: any[]; loopTemplate: any[]; endingRows: any[] } {
  const clampedStart = Math.max(0, Math.min(loopStartIndex, contentRows.length));
  const openerRows = contentRows.slice(0, clampedStart);
  let loopTemplate = contentRows.slice(clampedStart);

  let endingRows: any[] = [];
  if (endingRotationEnabled) {
    const endRel = loopTemplate.findIndex(r => r.loopEndOverride === true);
    if (endRel !== -1 && endRel < loopTemplate.length - 1) {
      endingRows = loopTemplate.slice(endRel + 1);
      loopTemplate = loopTemplate.slice(0, endRel + 1);
    }
  }
  return { openerRows, loopTemplate, endingRows };
}

// Opener + N loop reps, run through the real engine once. N is at least AVG_LOOP_REPS and
// enough whole reps to cross 120s; every per-window series below clips to its own window.
function buildExtendedTimeline(
  rows: any[],
  team: any[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: { level: number; res: number; hp: number },
  loopStartIndex: number,
  endingRotationEnabled: boolean,
  endRotationStartsEarlier: boolean = false
): { evaluatedRows: any[]; openerEndTime: Frames; loopDuration: Frames | null } {
  const contentRows = rows.filter(r => r && r.unit);
  const { openerRows, loopTemplate, endingRows } = splitLoopSegments(contentRows, loopStartIndex, endingRotationEnabled);

  // `rows` is already-recalculated, so its timing fields can be read directly.
  const openerEndRow = openerRows.length > 0 ? openerRows[openerRows.length - 1] : null;
  const openerEndTime = toFrames(openerEndRow ? (openerEndRow.gameTimeStart || 0) + (openerEndRow.gameTimePassed || 0) : 0);

  const runSimple = (contentToRun: any[]) => {
    const extendedInput = [...contentToRun.map(cloneAuthored), { unit: '', action: '', timing: 'Auto', offset: 0 }];
    return TimelineEngine.recalculateState(extendedInput, team, options, enemyConfig);
  };

  if (loopTemplate.length === 0) {
    return { evaluatedRows: runSimple(openerRows), openerEndTime, loopDuration: null };
  }

  const loopEndRow = loopTemplate[loopTemplate.length - 1];
  const loopEndTime = (loopEndRow.gameTimeStart || 0) + (loopEndRow.gameTimePassed || 0);
  const loopDuration = toFrames(loopEndTime - openerEndTime);

  if (loopDuration === 0) {
    return { evaluatedRows: runSimple([...openerRows, ...loopTemplate, ...endingRows]), openerEndTime, loopDuration: null };
  }

  // With an Ending Rotation, floor (not ceil) the reps so it fills whatever's left of 120s
  // rather than following an arbitrarily-truncated partial loop. endRotationStartsEarlier
  // subtracts one more rep so the Ending Rotation replaces/extends the final loop instead of
  // tacking on after it. Math.max(AVG_LOOP_REPS, ...) still guarantees 3 full reps regardless.
  const repsToSimulate = endingRows.length > 0
    ? Math.max(AVG_LOOP_REPS, Math.max(0, Math.floor((TWO_MIN - openerEndTime) / loopDuration) - (endRotationStartsEarlier ? 1 : 0)))
    : Math.max(AVG_LOOP_REPS, Math.ceil((TWO_MIN - openerEndTime) / loopDuration));
  const extendedContent: any[] = [...openerRows];
  for (let i = 0; i < repsToSimulate; i++) extendedContent.push(...loopTemplate);
  extendedContent.push(...endingRows);

  return { evaluatedRows: runSimple(extendedContent), openerEndTime, loopDuration };
}

// Live-preview counterpart to buildExtendedTimeline, used by calc.worker.ts's cheap
// 'recalculate' pass. A plain recalculateState(rows, ...) call would show the Ending Rotation
// starting right after the single loop rep in the table, which is wrong -- it only really runs
// after however many whole loops fill the rest of 120s. Re-derives that skip-ahead timing and
// splices it onto evaluatedRows' tail, without touching the opener/loop rows' own preview.
export function previewEndingRotationTiming(
  evaluatedRows: any[],
  team: any[],
  options: { startEnergy?: boolean; startConcerto?: boolean },
  enemyConfig: { level: number; res: number; hp: number },
  loopStartIndex: number,
  populateDamage: boolean = false,
  endRotationStartsEarlier: boolean = false
): any[] {
  const contentRows = evaluatedRows.filter(r => r && r.unit);
  const { openerRows, loopTemplate, endingRows } = splitLoopSegments(contentRows, loopStartIndex, true);
  if (endingRows.length === 0) return evaluatedRows;

  const openerEndRow = openerRows.length > 0 ? openerRows[openerRows.length - 1] : null;
  const openerEndTime = toFrames(openerEndRow ? (openerEndRow.gameTimeStart || 0) + (openerEndRow.gameTimePassed || 0) : 0);
  const loopEndRow = loopTemplate[loopTemplate.length - 1];
  const loopEndTime = (loopEndRow.gameTimeStart || 0) + (loopEndRow.gameTimePassed || 0);
  const loopDuration = toFrames(loopEndTime - openerEndTime);
  if (loopDuration <= 0) return evaluatedRows;

  const repsToSimulate = Math.max(1, Math.floor((TWO_MIN - openerEndTime) / loopDuration) - (endRotationStartsEarlier ? 1 : 0));
  const extendedContent: any[] = [...openerRows];
  for (let i = 0; i < repsToSimulate; i++) extendedContent.push(...loopTemplate);
  extendedContent.push(...endingRows);

  const previewInput = [...extendedContent.map(cloneAuthored), { unit: '', action: '', timing: 'Auto', offset: 0 }];
  const previewEvaluated = TimelineEngine.recalculateState(previewInput, team, options, enemyConfig);

  // Mirrors calc.worker.ts's populateDamageInstances so the Ending Rotation's re-timed rows
  // get their own DMG column filled in too (starts from full enemy HP, same simplification
  // the caller's own pass already uses).
  if (populateDamage) {
    let runningEnemyHp = enemyConfig.hp;
    previewEvaluated.forEach((row: any) => {
      row.damageInstances = [];
      if (row._pendingHits && row._pendingHits.length > 0) {
        row._pendingHits.forEach((hit: any) => {
          hit.context.enemyHp = runningEnemyHp;
          const result = CombatCalculator.calculateDamageInstance(hit.config, hit.context, team);
          runningEnemyHp = Math.max(0, runningEnemyHp - result.total);
          row.damageInstances.push(result);
        });
      }
    });
  }

  const evaluatedEndingRows = previewEvaluated.filter((r: any) => r && r.unit).slice(-endingRows.length);

  // Overwrite just the Ending Rotation's tail with its re-timed counterparts, preserving
  // loopStartOverride/loopEndOverride flags that cloneAuthored strips out.
  const endingStartContentIdx = openerRows.length + loopTemplate.length;
  let contentIdx = 0;
  return evaluatedRows.map(row => {
    if (!row || !row.unit) return row;
    const idx = contentIdx++;
    if (idx < endingStartContentIdx) return row;
    const replacement = evaluatedEndingRows[idx - endingStartContentIdx];
    return replacement ? { ...replacement, loopStartOverride: row.loopStartOverride, loopEndOverride: row.loopEndOverride } : row;
  });
}

// Walks every row's queued hits and prices them, mirroring useRotationStore's calculateDamage()
// loop but over the extended timeline instead of the literal authored rows.
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
        gameTime: toFrames(result.gameTime ?? hit.config.gameTime ?? 0),
        total: result.total,
        provider: hit.config.provider,
        dmgTypes: hit.config.dmgTypes || [],
        formulaUsed: result.formulaUsed,
        config: hit.config,
        context: hit.context
      });
    });
  });

  // A hit's origin row isn't necessarily its global resolve order (delayed procs/DoT ticks
  // can land after a later row's instant hit), so sort once here rather than trusting row order.
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

function primaryDmgType(dmgTypes: string[]): string {
  for (const p of PRIMARY_DMG_TYPES) if (dmgTypes.includes(p)) return p;
  return 'Other';
}

function buildDpsStats(hits: RotationHit[], openerEndTime: Frames, loopDuration: Frames | null): DpsStats {
  // DPS is damage/second, so each window's frame length converts to seconds at the division.
  const openerDps = openerEndTime > 0 ? sumTotal(windowedHits(hits, -Infinity, openerEndTime)) / framesToSeconds(openerEndTime) : null;
  const firstLoopDps =
    loopDuration !== null
      ? sumTotal(windowedHits(hits, openerEndTime, toFrames(openerEndTime + loopDuration))) / framesToSeconds(loopDuration)
      : null;
  const avgLoopDps =
    loopDuration !== null
      ? sumTotal(windowedHits(hits, openerEndTime, toFrames(openerEndTime + AVG_LOOP_REPS * loopDuration))) /
        framesToSeconds(toFrames(AVG_LOOP_REPS * loopDuration))
      : null;
  const twoMinDps = sumTotal(windowedHits(hits, -Infinity, TWO_MIN)) / framesToSeconds(TWO_MIN);
  return { openerDps, firstLoopDps, avgLoopDps, twoMinDps };
}

// Builds one window's cumulative dmg-over-time series from hits already shifted to
// window-relative time and already divided down for averaging where that applies.
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

// Folds AVG_LOOP_REPS reps into one loop-length window and divides the cumulative total by
// AVG_LOOP_REPS at every point. The loop template doesn't branch between repetitions, so instead
// of folding each hit independently by raw time (which scatters "the same" hit across a few
// hundredths of a second of rep-to-rep wait-time jitter into several tiny steps), hits are
// matched by which move produced them -- actionId+hitIndex identifies "the same slot" across
// reps exactly, rather than merely by chronological position (which a stray extra/dropped tick
// near a rep boundary could throw off). A repeated action within one loop is disambiguated by
// its Nth occurrence, matched in order against the other reps' Nth occurrence of that same move.
// Both the damage AND the time are averaged across whichever reps had that hit, so a move landing
// at 12.0s in one rep and 12.2s in another folds to one point at 12.1s instead of two near-
// duplicates. The line comes out as one clean step per move, and since the bar chart's per-hit
// bars are just deltas between consecutive points, that carries straight through to bar mode too.
function buildAvgLoopDmgOverTime(hits: RotationHit[], openerEndTime: Frames, loopDuration: Frames, bossMaxHp: number): DmgOverTimeSeries {
  const windowHits = windowedHits(hits, openerEndTime, toFrames(openerEndTime + AVG_LOOP_REPS * loopDuration));
  const moveKey = (h: RotationHit) => `${h.config.actionId ?? h.provider}::${h.config.hitIndex ?? 0}`;

  // One hit-list per rep, further split by move key -- so "the same" repeated action within a
  // single loop (e.g. two separate Basic Attacks) is matched by its own occurrence order, not
  // pooled together with the other occurrence.
  const repGroups: Map<string, RotationHit[]>[] = Array.from({ length: AVG_LOOP_REPS }, () => new Map());
  for (const h of windowHits) {
    const repIndex = Math.min(AVG_LOOP_REPS - 1, Math.max(0, Math.ceil((h.gameTime - openerEndTime) / loopDuration) - 1));
    const key = moveKey(h);
    const list = repGroups[repIndex].get(key);
    if (list) list.push(h);
    else repGroups[repIndex].set(key, [h]);
  }

  const allKeys = new Set<string>();
  repGroups.forEach(m => m.forEach((_, k) => allKeys.add(k)));

  const foldedRel = (h: RotationHit) => {
    const rel = (h.gameTime - openerEndTime) % loopDuration;
    return rel === 0 ? loopDuration : rel;
  };

  const folded: { t: Frames; total: number; label: string }[] = [];
  for (const key of allKeys) {
    const perRepLists = repGroups.map(m => m.get(key) ?? []);
    const occurrences = Math.max(0, ...perRepLists.map(l => l.length));
    for (let occ = 0; occ < occurrences; occ++) {
      const matched = perRepLists.map(l => l[occ]).filter((h): h is RotationHit => h !== undefined);
      if (matched.length === 0) continue;
      const avgRel = matched.reduce((sum, h) => sum + foldedRel(h), 0) / matched.length;
      folded.push({
        t: toFrames(avgRel),
        total: matched.reduce((sum, h) => sum + h.total, 0),
        label: hitLabel(matched[0])
      });
    }
  }
  folded.sort((a, b) => a.t - b.t);

  const points: DmgOverTimePoint[] = [{ t: toFrames(0), dmg: 0 }];
  let cumulative = 0;
  let killTime: Frames | null = null;

  for (const h of folded) {
    cumulative += h.total;
    const avgDmg = cumulative / AVG_LOOP_REPS;
    points.push({ t: h.t, dmg: avgDmg, label: h.label });
    if (killTime === null && avgDmg >= bossMaxHp) {
      const prev = points[points.length - 2];
      const frac = avgDmg === prev.dmg ? 0 : (bossMaxHp - prev.dmg) / (avgDmg - prev.dmg);
      killTime = roundFrames(prev.t + frac * (h.t - prev.t));
    }
  }

  return { label: 'Avg Loop', points, bossMaxHp, killTime, windowEnd: loopDuration };
}

function buildAllDmgOverTime(
  hits: RotationHit[],
  openerEndTime: Frames,
  loopDuration: Frames | null,
  bossMaxHp: number
): Record<DpsWindowKey, DmgOverTimeSeries> {
  const opener = buildDmgOverTimeForWindow(
    windowedHits(hits, -Infinity, openerEndTime).map(h => ({ t: h.gameTime, total: h.total, label: hitLabel(h) })),
    bossMaxHp,
    'Opener',
    openerEndTime
  );

  const firstLoop =
    loopDuration !== null
      ? buildDmgOverTimeForWindow(
          windowedHits(hits, openerEndTime, toFrames(openerEndTime + loopDuration)).map(h => ({ t: toFrames(h.gameTime - openerEndTime), total: h.total, label: hitLabel(h) })),
          bossMaxHp,
          'First Loop',
          loopDuration
        )
      : buildDmgOverTimeForWindow([], bossMaxHp, 'First Loop', toFrames(0));

  const avgLoop =
    loopDuration !== null
      ? buildAvgLoopDmgOverTime(hits, openerEndTime, loopDuration, bossMaxHp)
      : buildDmgOverTimeForWindow([], bossMaxHp, 'Avg Loop', toFrames(0));

  const twoMin = buildDmgOverTimeForWindow(
    windowedHits(hits, -Infinity, TWO_MIN).map(h => ({ t: h.gameTime, total: h.total, label: hitLabel(h) })),
    bossMaxHp,
    'Current Rotation',
    TWO_MIN
  );

  return { opener, firstLoop, avgLoop, twoMin };
}

function buildContributionForWindow(windowHits: RotationHit[], teamNames: string[], divisor: number): ContributionForWindow {
  const teamGroups = groupSum(windowHits, hitLabel);
  // Sort by roster slot order (stable across all windows) instead of insertion order (whichever
  // unit acted first in this window), which visibly reordered the legend when switching tabs.
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
      windowHits.filter(h => h.provider === unit && h.formulaUsed === 'Standard'),
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
  openerEndTime: Frames,
  loopDuration: Frames | null,
  teamNames: string[]
): Record<DpsWindowKey, ContributionForWindow> {
  const openerHits = windowedHits(hits, -Infinity, openerEndTime);
  const firstLoopHits = loopDuration !== null ? windowedHits(hits, openerEndTime, toFrames(openerEndTime + loopDuration)) : [];
  const avgLoopHits = loopDuration !== null ? windowedHits(hits, openerEndTime, toFrames(openerEndTime + AVG_LOOP_REPS * loopDuration)) : [];
  const twoMinHits = windowedHits(hits, -Infinity, TWO_MIN);

  return {
    opener: buildContributionForWindow(openerHits, teamNames, 1),
    firstLoop: buildContributionForWindow(firstLoopHits, teamNames, 1),
    avgLoop: buildContributionForWindow(avgLoopHits, teamNames, AVG_LOOP_REPS),
    twoMin: buildContributionForWindow(twoMinHits, teamNames, 1)
  };
}

// Basis: 2-minute total damage, independent of the DPS window the user is looking at elsewhere.
// Each roll's worth is expressed as "team" (% of the rotation's 2-min total) and "personal"
// (% of just that unit's own 2-min total).
//
// Avoids re-running the full engine simulation 78 times (13 substats x 3 rolls x 2 directions):
// calculateFinalStats is pure and a hit's damage formula never reads another hit's outcome, so
// a stat change to one unit can only change that unit's own hits. Reproducing it is just
// re-calling calculateDamageInstance on the cached hit/context pairs with a stat-patched team.
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

      // Returns [team%, personal%] of this roll's share of the rotation's / this unit's 2-min total.
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
        // What you'd give up without this roll, shown as a magnitude.
        minus: {
          team: { min: Math.abs(minusTeamMin), max: Math.abs(minusTeamMax), default: Math.abs(minusTeamDef) },
          personal: { min: Math.abs(minusPersonalMin), max: Math.abs(minusPersonalMax), default: Math.abs(minusPersonalDef) }
        },
        // What an extra roll would add; near-zero if the stat is already overcapped.
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
  loopStartIndex: number,
  endingRotationEnabled: boolean = false,
  endRotationStartsEarlier: boolean = false
): RotationResults {
  const { evaluatedRows, openerEndTime, loopDuration } = buildExtendedTimeline(rows, team, options, enemyConfig, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier);
  const hits = buildHitList(evaluatedRows, team, enemyConfig);
  const teamNames = team.filter(s => s.character).map(s => s.character);
  const twoMinHits = windowedHits(hits, -Infinity, TWO_MIN);

  return {
    dpsStats: buildDpsStats(hits, openerEndTime, loopDuration),
    dmgOverTimeSeries: buildAllDmgOverTime(hits, openerEndTime, loopDuration, enemyConfig.hp),
    contribution: buildAllContribution(hits, openerEndTime, loopDuration, teamNames),
    substatWorth: buildSubstatWorth(twoMinHits, team)
  };
}
