#!/usr/bin/env node
// Behavior-lock harness for the simulation pipeline (TimelineEngine, CombatCalculator,
// ContextManager, ResultsCalculator). Refactors of those files must not change what they compute.
//
//   npm run engine:baseline   -- freeze the data + record what the CURRENT source produces
//   npm run engine:check      -- re-run the current source against that frozen data and diff
//
// Run `baseline` on a known-good checkout (e.g. a clean HEAD), then `check` while refactoring.
// Re-baseline only after an intentional behavior change.
//
// What it does:
//   - Loads the real src/ modules through Vite's SSR loader (like verify-dsl.mjs), with fetch
//     stubbed to serve a frozen copy of the data (data repo + local WIP overlay), so results
//     can't drift when data files are edited between runs.
//   - Generates seeded rotations for several teams (real mechanics, holds/releases, swaps,
//     echo and System moves) plus a sweep that casts every move under every timing mode. Two of
//     the teams use the synthetic HarnessA/HarnessB characters in scripts/engine-fixtures/, which
//     exist to reach engine paths the real data doesn't (forte 4-6, tracker/buff actions, charges,
//     time scales, every hold cursor mode...). It runs the same pipeline calc.worker.ts runs: recalculateState,
//     per-hit damage, findLoopStart/analyzeLoop, Ending Rotation re-timing, and the Results
//     panel's buildRotationResults.
//   - Also snapshots the vocabulary lists (cast types, elements, DSL modifiers, tooltips, DPS
//     windows...) and the DSL parser's translation of every DSL string in the data, so
//     refactors of those registries can't change them unnoticed.
//   - Drives the real rotation, roster and Builder stores (and the worker pipeline behind them, run
//     in-process) through scripted edits, undo/redo and a persist round trip -- see
//     store-scenarios.mjs.
//   - Canonicalizes every evaluated row (all fields, sorted keys), the DSL context each row
//     exposes, and the results, then compares deeply -- any changed number, message, buff or
//     ordering-sensitive array shows up with its path.
//
// Options:  --only <substring>   run only scenarios whose name contains it
//           --max-diffs <n>      diffs to print per scenario (default 12)
//           --dump <file>        (check) also write the current output there as JSON
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { storeHarnessPlugin, snapshotStores } from './store-scenarios.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRepoDir = process.env.WUWA_DATA_PATH || path.resolve(siteRoot, '../../wuwa-calc-data/data');
const wipDir = path.join(siteRoot, 'public/wip-data/data');
const fixtureDir = path.join(siteRoot, 'scripts/engine-fixtures/data');
const workDir = path.join(siteRoot, '.engine-baseline');
const frozenDir = path.join(workDir, 'data');
const baselineFile = path.join(workDir, 'baseline.json.gz');
const overlayListFile = path.join(workDir, 'overlay.json');

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const only = flag('--only', '');
const maxDiffs = parseInt(flag('--max-diffs', '12'), 10);

// ---------------------------------------------------------------------------------------------
// Frozen data
// ---------------------------------------------------------------------------------------------

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// Lays one data directory over the frozen copy the way DataLoader layers the WIP mirror in dev:
// combined db_*.json files shallow-merge over what's there, everything else is replaced.
function overlayData(srcDir, overlayFiles) {
  if (!fs.existsSync(srcDir)) return;
  for (const file of walkFiles(srcDir)) {
    if (!file.endsWith('.json')) continue;
    const rel = path.relative(srcDir, file);
    overlayFiles.add(rel.split(path.sep).join('/'));
    const target = path.join(frozenDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const isCombinedDb = !rel.includes(path.sep) && /^db_.*\.json$/.test(rel);
    if (isCombinedDb && fs.existsSync(target)) {
      const merged = { ...JSON.parse(fs.readFileSync(target, 'utf8')), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      fs.writeFileSync(target, JSON.stringify(merged));
    } else {
      fs.copyFileSync(file, target);
    }
  }
}

// data repo, then the local WIP mirror, then the synthetic fixture characters.
function freezeData() {
  if (!fs.existsSync(dataRepoDir)) throw new Error(`Data repo not found at ${dataRepoDir} (set WUWA_DATA_PATH).`);
  fs.rmSync(frozenDir, { recursive: true, force: true });
  fs.cpSync(dataRepoDir, frozenDir, { recursive: true });
  // The dev server serves these from /wip-data (ahead of the repo), which the manifest doesn't list.
  const overlayFiles = new Set();
  overlayData(wipDir, overlayFiles);
  overlayData(fixtureDir, overlayFiles);
  fs.writeFileSync(overlayListFile, JSON.stringify([...overlayFiles].sort()));
}

function fingerprintData() {
  const hash = crypto.createHash('sha1');
  for (const file of walkFiles(frozenDir).sort()) {
    hash.update(path.relative(frozenDir, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function installEnvironment() {
  // Like the dev server: the WIP mirror answers only for files that came from an overlay (WIP
  // data, fixtures); the real data repo URL answers for everything in the frozen copy.
  const overlay = new Set(fs.existsSync(overlayListFile) ? JSON.parse(fs.readFileSync(overlayListFile, 'utf8')) : []);
  globalThis.fetch = async url => {
    const clean = String(url).split('?')[0];
    const wip = clean.match(/\/wip-data\/data\/(.*)$/);
    const repo = clean.match(/\/main\/data\/(.*)$/);
    const rel = wip ? (overlay.has(wip[1]) ? wip[1] : null) : repo ? repo[1] : null;
    const file = rel ? path.join(frozenDir, rel) : null;
    if (!file || !fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => fs.readFileSync(file, 'utf8') };
  };
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: k => void store.delete(k)
  };
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness (scenario generation + the engine's own Math.random use)
// ---------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Canonicalization + diff
// ---------------------------------------------------------------------------------------------

const SKIP_KEYS = new Set(['prevRow', 'nextRow', 'domRef', '_compiledRule']);

function canon(value, key, path = new Set()) {
  if (value === null) return null;
  switch (typeof value) {
    case 'number': return Number.isFinite(value) ? value : `__${String(value)}__`;
    case 'string': case 'boolean': return value;
    case 'undefined': case 'function': return undefined;
    case 'bigint': return String(value);
  }
  if (value instanceof Set) return { __set: [...value].map(v => canon(v, undefined, path)).sort() };
  if (Array.isArray(value)) return value.map(v => canon(v, undefined, path) ?? null);
  if (path.has(value)) return '__cycle__';
  path.add(value);
  let out;
  // The engine keys time scales by Math.random(); the values are what matter.
  if (key === 'timeScales') {
    out = Object.values(value).map(v => canon(v, undefined, path));
  } else {
    out = {};
    for (const k of Object.keys(value).sort()) {
      if (SKIP_KEYS.has(k)) continue;
      const c = canon(value[k], k, path);
      if (c !== undefined) out[k] = c;
    }
  }
  path.delete(value);
  return out;
}

function diffValues(a, b, at, out, limit) {
  if (out.length >= limit) return;
  if (a === b) return;
  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
  if (!bothObjects) {
    const delta = typeof a === 'number' && typeof b === 'number' ? ` (delta ${b - a})` : '';
    out.push(`${at}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}${delta}`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diffValues(a[i], b[i], `${at}[${i}]`, out, limit);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) out.push(`${at}.${k}: (absent) -> ${JSON.stringify(b[k])?.slice(0, 120)}`);
    else if (!(k in b)) out.push(`${at}.${k}: ${JSON.stringify(a[k])?.slice(0, 120)} -> (absent)`);
    else diffValues(a[k], b[k], `${at}.${k}`, out, limit);
    if (out.length >= limit) return;
  }
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

const TEAMS = [
  {
    name: 'lumi-sanhua-youhu',
    slots: [
      { character: 'Lumi', weapon: 'Radiance Cleaver', rank: 1, sequence: 0, mainSet: 'Void Thunder', mainEcho: 'NM Thundering Mephis' },
      { character: 'Sanhua', weapon: 'Emerald of Genesis', rank: 1, sequence: 0, mainSet: 'Moonlit Clouds', mainEcho: 'Impermanence Heron' },
      { character: 'Youhu', weapon: '', rank: 1, sequence: 0, mainSet: '', mainEcho: '' }
    ]
  },
  {
    name: 'lumi-s6-sanhua-r5',
    slots: [
      { character: 'Lumi', weapon: 'Radiance Cleaver', rank: 5, sequence: 6, mainSet: 'Molten Rift', mainEcho: 'Inferno Rider' },
      { character: 'Sanhua', weapon: 'Emerald of Genesis', rank: 5, sequence: 3, mainSet: 'Moonlit Clouds', subSet: '', mainEcho: 'Impermanence Heron' }
    ]
  },
  {
    name: 'sanhua-lumi-onepc',
    slots: [
      { character: 'Sanhua', weapon: 'Emerald of Genesis', rank: 2, sequence: 1, mainSet: 'Shadow of Shattered Dreams', subSet2a: 'Moonlit Clouds', subSet2b: 'Void Thunder', mainEcho: '' },
      { character: 'Lumi', weapon: 'Radiance Cleaver', rank: 3, sequence: 5, mainSet: 'Void Thunder', mainEcho: 'Inferno Rider' }
    ]
  },
  {
    name: 'youhu-solo',
    slots: [
      { character: 'Youhu', weapon: '', rank: 1, sequence: 2, mainSet: 'Void Thunder', mainEcho: 'NM Thundering Mephis' }
    ]
  },
  // Synthetic characters (scripts/engine-fixtures) covering every resource key, effect type and
  // trigger the real data doesn't reach.
  {
    name: 'harness-ab',
    slots: [
      { character: 'HarnessA', weapon: 'HarnessBlade', rank: 3, sequence: 2, mainSet: 'HarnessSet', mainEcho: 'HarnessEcho' },
      { character: 'HarnessB', weapon: '', rank: 1, sequence: 0, mainSet: '', mainEcho: '' }
    ]
  },
  {
    name: 'harness-ba-sanhua',
    slots: [
      { character: 'HarnessB', weapon: '', rank: 1, sequence: 4, mainSet: 'HarnessSet', mainEcho: '' },
      { character: 'HarnessA', weapon: 'HarnessBlade', rank: 5, sequence: 6, mainSet: '', mainEcho: 'HarnessEcho' },
      { character: 'Sanhua', weapon: 'Emerald of Genesis', rank: 1, sequence: 0, mainSet: 'Moonlit Clouds', mainEcho: 'Impermanence Heron' }
    ]
  }
];

const SEEDS = [1, 2, 3, 4];
const ROTATION_LENGTH = 44;

function buildSlot(db, spec, index, dataLoader) {
  const layout = spec.layout || '4 3 3 1 1';
  const costs = db.COST_DISTRIBUTION[layout];
  const element = dataLoader.characterDB[spec.character]?.element;
  const echoes = costs.map(cost => {
    const options = cost === 4 ? db.MAIN_STATS_4_COST : cost === 3 ? db.MAIN_STATS_3_COST : db.MAIN_STATS_1_COST;
    const elemental = `${element} DMG`;
    const mainStat = cost === 3 && options.includes(elemental) ? elemental : options[0];
    return {
      mainStat,
      substats: db.DEFAULT_SUBSTATS.map(name => {
        const stat = db.STAT_DB[name];
        return { name, value: stat ? stat.values[stat.defaultIndex || 0] : '' };
      })
    };
  });
  const echoStats = {};
  for (const key of new Set(Object.values(db.STAT_NAME_MAP))) echoStats[key] = 0;
  return {
    index, character: spec.character, sequence: spec.sequence ?? 0, mode: spec.mode || 'None',
    weapon: spec.weapon || '', rank: spec.rank ?? 1, layout,
    mainSet: spec.mainSet || '', subSet: spec.subSet || '', subSet2a: spec.subSet2a || '', subSet2b: spec.subSet2b || '',
    mainEcho: spec.mainEcho || '', echoes, echoStats
  };
}

// Seeded rotation over a team's real mechanics: same-unit streaks, swaps onto a default swap-in,
// Outro -> Intro, Hold -> Release, and the occasional echo / System move.
function generateRotation(dataLoader, team, seed, length) {
  const rng = mulberry32(seed * 7919 + team.length);
  const pick = list => list[Math.floor(rng() * list.length)];
  const movesOf = owner => (dataLoader.mechanicsIndex[owner] || []).filter(k => dataLoader.mechanicsDB[k] && !dataLoader.mechanicsDB[k].isPassive);
  const timings = ['Auto', 'Auto', 'Auto', 'Auto', 'Full', 'Swap', 'Cancel'];

  const rows = [];
  let unit = team[0].character;
  let prev = null;
  for (let i = 0; i < length; i++) {
    const prevMove = prev ? dataLoader.mechanicsDB[prev.action] : null;
    const prevIsOutro = !!prevMove?.castTypes?.includes('Outro');
    let action = null;

    if (prevIsOutro) {
      unit = pick(team.filter(s => s.character !== prev.unit)).character;
      action = movesOf(unit).find(k => dataLoader.mechanicsDB[k].castTypes?.includes('Intro')) || null;
    } else if (prevMove?.inputType === 'Hold' && rng() < 0.75) {
      action = movesOf(prev.unit).find(k => {
        const m = dataLoader.mechanicsDB[k];
        return m.inputType === 'Release' && m.input === prevMove.input;
      }) || null;
    } else if (team.length > 1 && rng() < 0.28) {
      unit = pick(team.filter(s => s.character !== unit)).character;
      const swapIns = movesOf(unit).filter(k => dataLoader.mechanicsDB[k].isSwapInDefault);
      if (swapIns.length && rng() < 0.7) action = pick(swapIns);
    }

    if (!action) {
      const slot = team.find(s => s.character === unit);
      const roll = rng();
      let pool = movesOf(unit);
      if (roll > 0.88 && slot.mainEcho) pool = movesOf(slot.mainEcho).length ? movesOf(slot.mainEcho) : pool;
      else if (roll > 0.72) pool = movesOf('System');
      action = pick(pool.length ? pool : movesOf(unit));
    }

    prev = { unit, action };
    rows.push({ id: `r${i}`, unit, action, timing: pick(timings), offset: 0 });
  }
  rows.push({ id: 'end', unit: '', action: '', timing: 'Auto', offset: 0 });
  return rows;
}

// Every castable move of every unit (plus each unit's echo and System), cast in order -- once with
// Auto timing, then again cycling through the other timing modes, so each move and each timing
// branch runs at least once regardless of what the random generator happens to pick.
function generateSweep(dataLoader, team) {
  const movesOf = owner => (dataLoader.mechanicsIndex[owner] || []).filter(k => dataLoader.mechanicsDB[k] && !dataLoader.mechanicsDB[k].isPassive);
  const casts = [];
  for (const slot of team) {
    for (const owner of [slot.character, slot.mainEcho]) {
      if (owner) for (const action of movesOf(owner)) casts.push({ unit: slot.character, action });
    }
  }
  const systemMoves = movesOf('System');
  casts.push(...systemMoves.map(action => ({ unit: team[0].character, action })));

  const alternates = ['Full', 'Swap', 'Cancel', 'Cancel_0', 'Cancel_1', 'Cap_Energy_0', 'Cap_Concerto_0', 'Simultaneous', 'Manual'];
  const rows = [];
  const push = (cast, timing, extra = {}) => rows.push({ id: `r${rows.length}`, unit: cast.unit, action: cast.action, timing, offset: 0, ...extra });
  casts.forEach(cast => push(cast, 'Auto'));
  casts.forEach((cast, i) => {
    const timing = alternates[i % alternates.length];
    push(cast, timing, timing === 'Manual' ? { manualOffset: 12 } : {});
  });
  rows.push({ id: 'end', unit: '', action: '', timing: 'Auto', offset: 0 });
  return rows;
}

// Opens with the first unit's holds and releases, so a Hold pressed at game time 0 is exercised.
function generateHoldOpen(dataLoader, team) {
  const first = team[0].character;
  const holds = (dataLoader.mechanicsIndex[first] || []).filter(key => {
    const move = dataLoader.mechanicsDB[key];
    return move && !move.isPassive && (move.inputType === 'Hold' || move.inputType === 'Release');
  });
  const rows = holds.slice(0, 6).map((action, i) => ({ id: `r${i}`, unit: first, action, timing: 'Auto', offset: 0 }));
  rows.push({ id: 'end', unit: '', action: '', timing: 'Auto', offset: 0 });
  return rows;
}

function buildScenarios() {
  const scenarios = [];
  for (const team of TEAMS) {
    for (const seed of SEEDS) {
      scenarios.push({
        name: `${team.name}/seed${seed}`,
        team,
        seed,
        mode: 'random',
        options: seed % 2 === 1 ? { startEnergy: true, startConcerto: false } : { startEnergy: false, startConcerto: true },
        // Even seeds also run the Ending Rotation path.
        endingRotation: seed % 2 === 0,
        includeResults: true
      });
    }
    scenarios.push({ name: `${team.name}/sweep`, team, seed: 101, mode: 'sweep', options: { startEnergy: true, startConcerto: true }, endingRotation: false, includeResults: true });
    scenarios.push({ name: `${team.name}/hold-open`, team, seed: 103, mode: 'hold-open', options: { startEnergy: true, startConcerto: true }, endingRotation: false, includeResults: false });
    scenarios.push({ name: `${team.name}/sweep-cold`, team, seed: 102, mode: 'sweep', options: { startEnergy: false, startConcerto: false }, endingRotation: true, includeResults: false });
  }
  return scenarios.filter(s => s.name.includes(only));
}

// ---------------------------------------------------------------------------------------------
// Running the pipeline (mirrors calc.worker.ts)
// ---------------------------------------------------------------------------------------------

function probeContext(ctx, row, team, mods) {
  const { CombatCalculator, DataLoader } = mods;
  if (!ctx) return null;
  const probe = { ctx: canon(ctx) };
  const unit = row.unit;
  const buffNames = [...new Set(Object.values(row.activeBuffs || {}).map(b => b.name).filter(Boolean))].sort();
  const trackerNames = Object.keys(row.trackers || {}).sort();
  const moveNames = (DataLoader.mechanicsIndex[unit] || []).map(k => DataLoader.mechanicsDB[k]?.name).filter(Boolean);
  const statKeys = Object.keys(CombatCalculator.calculateFinalStats(unit, [], team)).sort();
  const self = ctx.self;
  probe.self = {
    stats: Object.fromEntries(statKeys.map(k => [k, self.getStat(k)])),
    buffs: Object.fromEntries(buffNames.map(n => [n, [self.getBuffStacks(n), self.getBuffMaxStacks(n), self.hasBuff(n)]])),
    trackers: Object.fromEntries(trackerNames.map(n => [n, self.getTracker(n)])),
    cooldowns: Object.fromEntries(moveNames.map(n => [n, self.getCooldown(n)]))
  };
  probe.enemy = Object.fromEntries(buffNames.map(n => [n, [ctx.enemy.getBuffStacks(n), ctx.enemy.getBuffMaxStacks(n), ctx.enemy.hasBuff(n)]]));
  return canon(probe);
}

function runScenario(scenario, ctx) {
  const { mods, teams } = ctx;
  const { TimelineEngine, CombatCalculator, ContextManager, ResultsCalculator, db } = mods;
  const team = teams[scenario.team.name];
  const enemy = db.ENEMY_DEFAULTS;
  const rng = mulberry32(scenario.seed);
  Math.random = rng;
  TimelineEngine._globalBuffCache = {};

  const logged = { errors: [], warnings: 0 };
  const original = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  console.warn = () => { logged.warnings++; };
  console.log = console.info = () => {};
  console.error = (...a) => { logged.errors.push(a.map(x => (typeof x === 'string' ? x : x?.message ?? String(x))).join(' ').slice(0, 300)); };

  try {
    // Fresh slot copies each scenario: the engine writes echoStats back onto the slots.
    const scenarioTeam = team.map(s => JSON.parse(JSON.stringify(s)));
    const rows = scenario.mode === 'sweep'
      ? generateSweep(mods.DataLoader, scenarioTeam)
      : scenario.mode === 'hold-open'
        ? generateHoldOpen(mods.DataLoader, scenarioTeam)
        : generateRotation(mods.DataLoader, scenarioTeam, scenario.seed, ROTATION_LENGTH);
    const out = { generatedRows: canon(rows.map(r => ({ unit: r.unit, action: r.action, timing: r.timing }))) };

    let evaluated = TimelineEngine.recalculateState(rows, scenarioTeam, scenario.options, enemy);
    ResultsCalculator.populateDamageInstances(evaluated, enemy, scenarioTeam);
    const { index: loopStartIndex, isOverride } = TimelineEngine.findLoopStart(evaluated, scenarioTeam[0].character);
    const loop = TimelineEngine.analyzeLoop(evaluated, scenarioTeam, scenario.options, enemy, loopStartIndex);
    out.loop = canon({ loopStartIndex, isOverride, ...loop });

    let endingRows = evaluated;
    if (scenario.endingRotation) {
      const lastContent = evaluated.reduce((last, r, i) => (r.unit ? i : last), -1);
      evaluated[lastContent].loopEndOverride = true;
      // Ending content = a copy of the loop tail so the preview has something to re-time.
      const tail = evaluated.slice(loopStartIndex, lastContent + 1).map(r => ({ id: `${r.id}-e`, unit: r.unit, action: r.action, timing: r.timing, offset: 0 }));
      const withEnding = [...evaluated.slice(0, lastContent + 1).map(r => ({ id: r.id, unit: r.unit, action: r.action, timing: r.timing, offset: 0, ...(r.loopEndOverride ? { loopEndOverride: true } : {}), ...(r.loopStartOverride ? { loopStartOverride: true } : {}) })), ...tail, { id: 'end', unit: '', action: '', timing: 'Auto', offset: 0 }];
      const reEvaluated = TimelineEngine.recalculateState(withEnding, scenarioTeam, scenario.options, enemy);
      ResultsCalculator.populateDamageInstances(reEvaluated, enemy, scenarioTeam);
      endingRows = ResultsCalculator.previewEndingRotationTiming(reEvaluated, scenarioTeam, scenario.options, enemy, loopStartIndex, true, false);
      evaluated = reEvaluated;
      out.endingRotation = true;
    }

    out.rows = canon(endingRows);
    out.contexts = evaluated.map(row => (row.unit ? probeContext(ContextManager.buildContext(row, row.unit, scenarioTeam), row, scenarioTeam, mods) : null));

    if (scenario.includeResults) {
      out.results = canon(ResultsCalculator.buildRotationResults(evaluated, scenarioTeam, scenario.options, enemy, loopStartIndex, !!scenario.endingRotation, false));
    }
    out.consoleErrors = logged.errors;
    out.consoleWarnings = logged.warnings;
    out.echoStats = canon(scenarioTeam.map(s => s.echoStats));
    return out;
  } finally {
    Object.assign(console, original);
  }
}

// ---------------------------------------------------------------------------------------------
// Vocabulary + DSL probes: lists and translations that no simulated row exercises directly
// ---------------------------------------------------------------------------------------------

const DSL_SNIPPETS = [
  '@Self.BuffStacks(Foo Bar)', "@Self.BuffStacks('Foo')", '@Self.BuffMaxStacks(Clarity)', '@Self.HasBuff(@Lumi(Yellow Light Form))',
  '@Self.Tracker(hits) + 1', '@Self.Stat(CR Rate) >= 50', '@Self.Cooldown(Skill) == 0', '@Self.cooldown(Skill)', '@Self.hasbuff(x)',
  '@Enemy.BuffStacks(Fusion Burst)', '@Enemy.BuffMaxStacks(Fusion Burst)', '@Enemy.HasBuff(Aero Erosion)',
  '@StatusMult(Aero Erosion, @Self.Tracker(Stacks))', "@StatusMult('Aero Erosion', 3)",
  'MATH(1 + 2) * 3', 'MATH(2 * (3 + 4)) + MATH(1)', 'MATH(MATH(1) + 2)',
  'ANY(@Self.Energy > 1, @Self.HP < 2)', 'ALL(a, b) AND NOT(c)', 'XOR(@Self.Energy > 1, @Self.Concerto > 1)',
  'ANY(ALL(a, b), XOR(c, d))', 'NOT(NOT(x))', 'NOT(ANY(a, b))',
  '@Move.CastTypes.includes("Skill")', '@Prev.CastTypes.includes(Outro)', '@Next.Priority > 5', '@Default.SwapTime + 3',
  '@Self.Sequence >= 2 && @Self.PrevAction == @Lumi(Pounce)', 'ABS(@Self.HP - 5)', '10%', '(@Self.Sequence >= 2 ? 30 : 10)%',
  '@Self.Forte2 >= @Self.MaxForte2', '@Self.Energy == 10..20', '@Team.length > 1', '@Equipper', '@System(Dodge)'
];

const DSL_RULE_SNIPPETS = [
  'OnCast[Skill, Self] IF (@Self.Energy > 1)', 'ANY(OnBuffAdd[a], OnBuffExpire[b]) IF (@Self.Sequence >= 6)', 'OnTick[2, 3]',
  'ALWAYS', 'IF (true)', 'AfterHit[Self] IF (@Self.Forte1 < 100)', 'OnHit[@Lumi(Pounce), Basic]', 'OnStart', 'ANY(OnSwapIn, OnSwapOut)'
];

function collectDslStrings() {
  const strings = new Set();
  const rules = new Set();
  const visit = (value, key) => {
    if (typeof value === 'string') {
      if (key === 'triggerRule') rules.add(value);
      if (value.includes('@')) strings.add(value);
    } else if (Array.isArray(value)) value.forEach(v => visit(v, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => visit(v, k));
  };
  for (const file of walkFiles(path.join(frozenDir, 'mechanics'))) {
    if (file.endsWith('.json')) visit(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return { strings: [...strings].sort(), rules: [...rules].sort() };
}

async function snapshotDsl(load) {
  const [{ DSLParser }, { tokenizeDSL }] = await Promise.all([load('/src/logic/dsl/dslParser.ts'), load('/src/utils/DSLHighlight.ts')]);
  const corpus = collectDslStrings();
  const strings = [...new Set([...corpus.strings, ...DSL_SNIPPETS])].sort();
  const rules = [...new Set([...corpus.rules, ...DSL_RULE_SNIPPETS])].sort();
  const attempt = fn => { try { return fn(); } catch (e) { return `THREW: ${e.message}`; } };
  const silenced = console.error;
  console.error = () => {};
  try {
    return canon({
      translations: Object.fromEntries(strings.map(s => [s, attempt(() => DSLParser._translatePointers(s))])),
      compiled: Object.fromEntries(rules.map(r => [r, attempt(() => { const c = DSLParser.compile(r); return c && { triggers: c.triggers, raw: c.raw }; })])),
      highlighted: Object.fromEntries(strings.map(s => [s, attempt(() => tokenizeDSL(s, ['FluxCore', 'MaxFluxCore']))]))
    });
  } finally {
    console.error = silenced;
  }
}

async function snapshotVocab(load) {
  const tryLoad = async p => { try { return fs.existsSync(path.join(siteRoot, p)) ? await load('/' + p) : null; } catch { return null; } };
  const [db, registry, combat, common, resolver, calc, dpsWindows] = await Promise.all([
    load('/src/data/db.ts'), load('/src/logic/dsl/dslRegistry.ts'), load('/src/logic/combat/combatRegistry.ts'),
    load('/src/utils/Common.ts'), load('/src/logic/dsl/dslResolver.ts'), load('/src/logic/CombatCalculator.ts'),
    load('/src/data/dpsWindows.ts')
  ]);
  const chart = await tryLoad('src/components/results/chartPalette.ts');
  const toolbar = await tryLoad('src/components/rankings/RankingFilterToolbar.tsx');

  const modLabels = [...new Set([...combat.UNSCOPED_MOD_LABELS, ...combat.SCOPEABLE_MOD_LABELS])];
  const optionValues = rule => (typeof rule.options === 'function' ? rule.options([]) : rule.options).map(o => [o.val, o.group, o.tooltipKey ?? null]);

  return canon({
    castOptions: db.CAST_OPTIONS,
    dmgOptions: db.DMG_OPTIONS,
    statOptions: db.STAT_OPTIONS,
    castTypeColors: db.CAST_TYPE_COLORS,
    statNameMap: db.STAT_NAME_MAP,
    elementColors: common.ELEMENT_COLORS,
    dslModifiers: [...registry.DSL_MODIFIERS],
    dslModifierTooltips: registry.DSL_MODIFIER_TOOLTIPS,
    dslMethods: Object.fromEntries(Object.entries(registry.DSL_POINTERS).map(([name, p]) => [name, p.properties.filter(x => x.isMethod).map(x => x.propName)])),
    allScopes: [...combat.ALL_SCOPES],
    scopeHitTags: combat.SCOPE_HIT_TAGS,
    sheetDmgBonusKey: combat.SHEET_DMG_BONUS_KEY,
    modLabels,
    statModifierTooltips: Object.fromEntries(modLabels.map(l => [l, combat.MOD_LABEL_TOOLTIPS[l] ?? null])),
    sheetStatTooltips: db.SHEET_STAT_TOOLTIPS,
    negativeStatusTable: Object.keys(calc.CombatCalculator.NEGATIVE_STATUS_MULTS),
    statRuleOptions: optionValues(resolver.makeStatRule([], [])),
    appliesDuringOptions: optionValues(resolver.makeAppliesDuringRule(null, {})),
    eventBracketOptions: optionValues(resolver.makeEventModifierBracketRule(null, {})),
    rankingElements: toolbar ? [...toolbar.RANKING_ELEMENTS] : null,
    rankingDmgCategories: toolbar ? [...toolbar.RANKING_DMG_CATEGORIES] : null,
    dpsWindows: dpsWindows.DPS_WINDOWS.map(({ key, label, dpsField, dpsLabel }) => ({ key, label, dpsField, dpsLabel })),
    dpsFieldOf: Object.fromEntries(dpsWindows.DPS_WINDOWS.map(w => [w.key, dpsWindows.dpsFieldOf(w.key)])),
    categoricalPalette: chart ? { named: ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Echo', 'Coordinated', 'Aero Erosion'].map(l => [l, chart.colorForLabel(l)]), tabs: chart.DPS_WINDOW_TABS } : null
  });
}

async function runAll() {
  installEnvironment();
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', plugins: [storeHarnessPlugin] });
  try {
    const load = p => server.ssrLoadModule(p);
    const [{ DataLoader }, { TimelineEngine }, { CombatCalculator }, { ContextManager }, ResultsCalculator, db] = await Promise.all([
      load('/src/utils/DataLoader.ts'), load('/src/logic/TimelineEngine.ts'), load('/src/logic/CombatCalculator.ts'),
      load('/src/logic/ContextManager.ts'), load('/src/logic/ResultsCalculator.ts'), load('/src/data/db.ts')
    ]);
    const mods = { DataLoader, TimelineEngine, CombatCalculator, ContextManager, ResultsCalculator, db };
    await DataLoader.initDatabases();

    // Some sets/echoes in the teams have no mechanics file; the DataLoader logs each miss.
    const teams = {};
    const originalError = console.error;
    console.error = () => {};
    try {
      for (const spec of TEAMS) {
        teams[spec.name] = spec.slots.map((s, i) => buildSlot(db, s, i, DataLoader));
        await DataLoader.loadTeamMechanics(teams[spec.name]);
      }
    } finally {
      console.error = originalError;
    }

    const results = {};
    for (const scenario of buildScenarios()) {
      const started = Date.now();
      results[scenario.name] = runScenario(scenario, { mods, teams });
      process.stdout.write(`  ${scenario.name.padEnd(34)} ${String(Date.now() - started).padStart(5)}ms  rows=${results[scenario.name].rows.length}\n`);
    }
    if (!only || only.startsWith('__')) {
      results.__vocab = await snapshotVocab(load);
      results.__dsl = await snapshotDsl(load);
      // Last: the store scenarios edit DataLoader state (Builder edits, rosters) the rest must not see.
      Object.assign(results, await snapshotStores({ server, canon, mulberry32, generateRotation }));
    }
    return results;
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

function readBaseline() {
  if (!fs.existsSync(baselineFile)) throw new Error('No baseline yet -- run `npm run engine:baseline` on a known-good checkout first.');
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(baselineFile)).toString('utf8'));
}

async function baseline() {
  freezeData();
  console.log(`Data frozen from ${dataRepoDir}${fs.existsSync(wipDir) ? ' + WIP overlay' : ''}.`);
  const first = await runAll();
  // A baseline that isn't reproducible would make every later check meaningless.
  console.log('Re-running to confirm the harness is deterministic...');
  const second = await runAll();
  const problems = [];
  for (const name of Object.keys(first)) diffValues(first[name], second[name], name, problems, 10);
  if (problems.length) {
    console.error('Non-deterministic results between two identical runs:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  const payload = { fingerprint: fingerprintData(), results: first };
  fs.writeFileSync(baselineFile, zlib.gzipSync(JSON.stringify(payload)));
  console.log(`\nBaseline written: ${Object.keys(first).length} scenarios (${(fs.statSync(baselineFile).size / 1024).toFixed(0)} KB).`);
}

async function check() {
  const base = readBaseline();
  if (fingerprintData() !== base.fingerprint) {
    throw new Error('Frozen data no longer matches the baseline. Re-run `npm run engine:baseline`.');
  }
  const current = await runAll();
  const dumpTo = flag('--dump', '');
  if (dumpTo) fs.writeFileSync(dumpTo, JSON.stringify(current));
  let failed = 0;
  for (const name of Object.keys(current)) {
    const expected = base.results[name];
    if (!expected) { console.error(`\nNo baseline for scenario "${name}".`); failed++; continue; }
    const diffs = [];
    diffValues(expected, current[name], name, diffs, maxDiffs);
    if (diffs.length) {
      failed++;
      console.error(`\nDIFF in ${name}:\n  ${diffs.join('\n  ')}`);
    }
  }
  if (failed) {
    console.error(`\nengine-check FAILED: ${failed} scenario(s) differ from the baseline.`);
    process.exit(1);
  }
  console.log(`\nengine-check PASSED: ${Object.keys(current).length} scenarios identical to the baseline.`);
}


// ---------------------------------------------------------------------------------------------
// Timing: where a live-preview recalculate's worker time goes (npm run engine:perf)
// ---------------------------------------------------------------------------------------------

// Same as calc.worker.ts's: drops function-valued properties before a result crosses back.
function stripFunctions(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === 'function') continue;
    clone[key] = v && typeof v === 'object' ? stripFunctions(v, seen) : v;
  }
  return clone;
}

const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

async function perf() {
  installEnvironment();
  const rowCount = parseInt(flag('--rows', '90'), 10);
  const iterations = parseInt(flag('--iterations', '5'), 10);
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const load = p => server.ssrLoadModule(p);
    const [{ DataLoader }, { TimelineEngine }, ResultsCalculator, db] = await Promise.all([
      load('/src/utils/DataLoader.ts'), load('/src/logic/TimelineEngine.ts'), load('/src/logic/ResultsCalculator.ts'), load('/src/data/db.ts')
    ]);
    await DataLoader.initDatabases();
    const silenced = { ...console };
    console.error = console.warn = console.log = console.info = () => {};
    const teams = {};
    for (const spec of TEAMS) {
      teams[spec.name] = spec.slots.map((slot, i) => buildSlot(db, slot, i, DataLoader));
      await DataLoader.loadTeamMechanics(teams[spec.name]);
    }
    const enemy = db.ENEMY_DEFAULTS;
    const options = { startEnergy: true, startConcerto: false };
    const totals = { recalculateState: 0, feedbackRecalc: 0, analyzeLoop: 0, endingPreview: 0, stripAndClone: 0 };
    const lines = [];

    for (const spec of TEAMS.filter(t => t.name.includes(only))) {
      for (const seed of [1, 2]) {
        const template = generateRotation(DataLoader, teams[spec.name], seed, rowCount);
        const times = { recalculateState: [], feedbackRecalc: [], analyzeLoop: [], endingPreview: [], stripAndClone: [] };
        for (let iteration = 0; iteration < iterations + 1; iteration++) {
          const team = teams[spec.name].map(slot => JSON.parse(JSON.stringify(slot)));
          const rows = template.map(row => ({ ...row }));
          Math.random = mulberry32(seed);
          TimelineEngine._globalBuffCache = {};

          let t = performance.now();
          const evaluated = TimelineEngine.recalculateState(rows, team, options, enemy);
          const afterRecalc = performance.now();
          const { index: loopStart } = TimelineEngine.findLoopStart(evaluated, team[0].character);
          TimelineEngine.analyzeLoop(evaluated, team, options, enemy, loopStart);
          const afterLoop = performance.now();

          // Ending Rotation on: mark the last content row as the loop end and append a copy of the loop.
          const last = evaluated.reduce((l, r, i) => (r.unit ? i : l), -1);
          const authored = r => ({ id: r.id, unit: r.unit, action: r.action, timing: r.timing, offset: 0, ...(r.loopStartOverride ? { loopStartOverride: true } : {}) });
          const withEnding = [...evaluated.slice(0, last + 1).map((r, i) => ({ ...authored(r), ...(i === last ? { loopEndOverride: true } : {}) })),
            ...evaluated.slice(loopStart, last + 1).map(r => ({ ...authored(r), id: `${r.id}-e` })), { id: 'end', unit: '', action: '', timing: 'Auto', offset: 0 }];
          const reEvaluated = TimelineEngine.recalculateState(withEnding, team, options, enemy);
          const beforePreview = performance.now();
          ResultsCalculator.previewEndingRotationTiming(reEvaluated, team, options, enemy, loopStart, false, false);
          const afterPreview = performance.now();

          const beforeClone = performance.now();
          const cloned = structuredClone(stripFunctions(evaluated));
          const afterClone = performance.now();

          // What an edit actually sends: the previously evaluated rows, cloned across postMessage.
          const beforeFeedback = performance.now();
          TimelineEngine.recalculateState(cloned, team, options, enemy);
          const afterFeedback = performance.now();

          if (iteration === 0) continue; // warm-up
          times.recalculateState.push(afterRecalc - t);
          times.feedbackRecalc.push(afterFeedback - beforeFeedback);
          times.analyzeLoop.push(afterLoop - afterRecalc);
          times.endingPreview.push(afterPreview - beforePreview);
          times.stripAndClone.push(afterClone - beforeClone);
        }
        const m = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, median(v)]));
        for (const k of Object.keys(totals)) totals[k] += m[k];
        lines.push(`  ${`${spec.name}/seed${seed}`.padEnd(30)} recalc ${m.recalculateState.toFixed(0).padStart(5)}  fed-back ${m.feedbackRecalc.toFixed(0).padStart(5)}  loop ${m.analyzeLoop.toFixed(0).padStart(5)}  ending ${m.endingPreview.toFixed(0).padStart(5)}  clone ${m.stripAndClone.toFixed(0).padStart(5)}  (ms, median of ${iterations})`);
      }
    }
    Object.assign(console, silenced);
    console.log(lines.join('\n'));
    const sum = Object.entries(totals).reduce((a, [k, b]) => (k === 'feedbackRecalc' ? a : a + b), 0);
    console.log(`\nTOTAL  recalc ${totals.recalculateState.toFixed(0)}  fed-back ${totals.feedbackRecalc.toFixed(0)}  loop ${totals.analyzeLoop.toFixed(0)}  ending ${totals.endingPreview.toFixed(0)}  clone ${totals.stripAndClone.toFixed(0)}  =  ${sum.toFixed(0)} ms  (${rowCount}-row rotations)`);
  } finally {
    await server.close();
  }
}

try {
  if (command === 'baseline') await baseline();
  else if (command === 'check') await check();
  else if (command === 'perf') await perf();
  else {
    console.error('Usage: node scripts/engine-check.mjs <baseline|check|perf> [--only <substring>] [--max-diffs <n>]');
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
