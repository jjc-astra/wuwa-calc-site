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
  gameTime: Frames;
  total: number;
  provider: string;
  dmgTypes: string[];
  isNegativeStatus: boolean;
  // Kept for substat-worth re-simulation, which re-runs just the formula (not the engine) per
  // hit with a stat-patched team.
  config: HitConfig;
  context: any;
}

// Who/what a hit is attributed to for grouping/coloring purposes -- a status-effect tick isn't
// caused by any one unit's action, so it's labeled by its dmgType instead (e.g. "Aero Erosion").
// Shared by the team contribution pie's grouping and the dmg-over-time chart's per-segment
// coloring, so both agree on the same identity for the same hit.
function hitLabel(h: RotationHit): string {
  return h.isNegativeStatus ? h.dmgTypes[0] || 'Status Effect' : h.provider;
}

const cloneAuthored = (r: any) => ({
  unit: r.unit,
  action: r.action,
  timing: r.timing,
  ...(r.offset !== undefined && { offset: r.offset }),
  ...(r.manualOffset !== undefined && { manualOffset: r.manualOffset })
});

// Splits a rotation's content rows into opener / repeating-loop-template / (optional) Ending
// Rotation tail. Shared by buildExtendedTimeline below (the real 2-Minute calculation) and
// previewEndingRotationTiming (the cheap live-preview pass) so both agree on exactly which rows
// belong to which segment.
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

// Opener + N loop reps, run through the real (non-lightweight) engine once. N is at least
// AVG_LOOP_REPS (so the avg-loop window always has its full 3 reps available) and enough whole
// reps to cross 120s (so the 2-min window always has a full 120s of hits available) -- every
// per-window series below then clips to its own exact window, none of them need the
// simulation to run any further than this.
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

  // `rows` is the live already-recalculated pass, so its timing fields are trustworthy --
  // same trick analyzeLoop uses to avoid a throwaway baseline pass just to read them back.
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

  // With an Ending Rotation to splice in, stop repeating the loop at the last full rep that
  // still fits inside the 120s budget (floor) instead of overshooting past it (ceil) -- the
  // Ending Rotation itself fills whatever's left, rather than an arbitrarily-truncated partial
  // loop rep. Math.max(AVG_LOOP_REPS, ...) still guarantees the avg-loop window's 3 full reps
  // even if that means running past 120s before the Ending Rotation even starts (a loop longer
  // than the whole 2-minute budget) -- the Ending Rotation is a no-op there, which is fine.
  // endRotationStartsEarlier subtracts one more rep on top of that floor calc (still clamped by
  // the same Math.max(AVG_LOOP_REPS, ...) below) -- it never changes how many rows got copied
  // into the table (see useRotationStore.setEndingRotationEnabled), only how many silent reps
  // run before the splice point, so the Ending Rotation content effectively replaces/extends
  // what would have been the final loop instead of tacking on after a full one.
  const repsToSimulate = endingRows.length > 0
    ? Math.max(AVG_LOOP_REPS, Math.max(0, Math.floor((TWO_MIN - openerEndTime) / loopDuration) - (endRotationStartsEarlier ? 1 : 0)))
    : Math.max(AVG_LOOP_REPS, Math.ceil((TWO_MIN - openerEndTime) / loopDuration));
  const extendedContent: any[] = [...openerRows];
  for (let i = 0; i < repsToSimulate; i++) extendedContent.push(...loopTemplate);
  extendedContent.push(...endingRows);

  return { evaluatedRows: runSimple(extendedContent), openerEndTime, loopDuration };
}

// Live-preview counterpart to buildExtendedTimeline -- used by calc.worker.ts's cheap
// 'recalculate' pass (every rotation edit), not the real 2-Minute calculation. A plain
// TimelineEngine.recalculateState(rows, ...) call shows the Ending Rotation's rows starting
// right after the single loop rep in front of them in the table, which is wrong: for real, they
// only run after however many *whole* loops silently fill the rest of the 120s budget first (see
// buildExtendedTimeline). This re-derives that same skip-ahead timing and splices it onto the
// tail of `evaluatedRows` (the rows already returned by the normal single-pass evaluation) so the
// Time/gauge/DMG columns for the Ending Rotation rows in the editor reflect where they'd actually
// land, without disturbing the opener/loop rows' own (first-rep) preview.
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

  // Mirrors calc.worker.ts's populateDamageInstances -- the Ending Rotation's re-timed rows
  // need their own DMG column filled in too (the plain evaluatedRows passed in already has it
  // for the opener/loop rows, from the caller's own single pass). Same "fresh enemy at full HP"
  // starting point that pass already uses for the whole table, not the true post-N-loops HP --
  // an existing simplification, not something this preview needs to fix.
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

  // Walk the original evaluatedRows and overwrite just the Ending Rotation's tail positions
  // (everything after the loopEndOverride row) with their re-timed counterparts, preserving
  // loopStartOverride/loopEndOverride flags (cloneAuthored strips them, so the fresh engine
  // output doesn't carry them) and everything before that tail untouched.
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
        gameTime: toFrames(result.gameTime ?? hit.config.gameTime ?? 0),
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
  // DPS is damage/second, so each window's frame-domain length converts to seconds right at
  // the division -- a final-output-metric conversion, not internal scheduling math.
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

// Builds one window's cumulative dmg-over-time series from a list of hits already shifted to
// window-relative time (t=0 == this window's own start) and already divided down for
// averaging where that applies (see buildAvgLoopDmgOverTime) -- so this function itself never
// needs to know which window it's building.
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

// Folds AVG_LOOP_REPS reps' worth of hits into one loop-length window (each hit's time taken
// modulo loopDuration, so all 3 reps land in the same [0, loopDuration] range) and divides the
// running cumulative total by AVG_LOOP_REPS at every point -- the same "average per loop"
// treatment buildContributionForWindow gives its totals, just applied to a time series instead
// of a single sum. A hit landing exactly on a rep boundary (gameTime - openerEndTime is an
// exact multiple of loopDuration) belongs to the rep that just finished, not t=0 of the next.
function buildAvgLoopDmgOverTime(hits: RotationHit[], openerEndTime: Frames, loopDuration: Frames, bossMaxHp: number): DmgOverTimeSeries {
  const windowHits = windowedHits(hits, openerEndTime, toFrames(openerEndTime + AVG_LOOP_REPS * loopDuration));
  const folded = windowHits
    .map(h => {
      const rel = (h.gameTime - openerEndTime) % loopDuration;
      return { t: toFrames(rel === 0 ? loopDuration : rel), total: h.total, label: hitLabel(h) };
    })
    .sort((a, b) => a.t - b.t);

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
  // Object.entries(teamGroups) previously drove this array's order, which is just insertion
  // order -- i.e. whichever unit's hit happened to land first *within this specific time
  // window*. That's not stable across windows (Opener vs. First Loop vs. Avg Loop vs. 2-Min can
  // each have a different unit act first), so switching timeframe tabs visibly reordered the
  // team legend/pie every time. Roster slot order (teamNames, already in team-array order) is
  // stable across all four windows, so sort by that instead -- real team members first in
  // roster order, then anything else (a status-effect pseudo-label like an Electro Flare tick,
  // which isn't a team member and has no roster position) appended after in its original
  // insertion order.
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
