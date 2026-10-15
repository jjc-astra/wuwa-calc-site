import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
import { CHARACTER_DEFAULTS, SIM_CONSTANTS, ENEMY_DEFAULTS, STAT_NAME_MAP, BUILDUP_RATE_STATS } from '../data/db';
import { SCOPE_HIT_TAGS, sheetDmgBonusKeyForType } from './combat/combatRegistry';
import { asDslResult, modifierSet, readsSelfStats } from './engineValues';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import { ECHO_STAT_KEYS, emptyEchoStats } from '../data/gameVocab';
import { findScope, resolveMultiplierBucket, resolveSheetDmgBonusKey } from './combat/statParser';
import { NEGATIVE_STATUS_MULTS, getNegativeStatusMult } from './combat/negativeStatus';
import type { Effect, HitConfig, DamageInstanceResult, BuffTotals, CalculatedStats } from '../types';

// State for evaluating a buff's '@' value. Absent: only @Self.Stat is readable.
interface BuffValueScope {
  state: any;
  provider: string;
  team: any[];
}

// Resolves an '@' buff value. @Self.Stat reads `selfStats` to avoid recursion.
function resolveBuffValue(rawVal: any, selfStats: Record<string, number> | null, scope?: BuffValueScope): any {
  if (typeof rawVal !== 'string' || !rawVal.includes('@') || !selfStats) return rawVal;
  const getStat = (key: string) => selfStats[key] ?? 0;
  const ctx = scope && !readsOnlyStats(rawVal) ? ContextManager.buildContext(scope.state, scope.provider, scope.team) : undefined;
  if (ctx) ctx.self.getStat = getStat;
  const isPctExpr = rawVal.includes('%');
  const evaluated = DSLParser.evaluateMath(rawVal, ctx ?? { self: { getStat } }, scope?.provider);
  return isPctExpr ? `${evaluated * 100}%` : evaluated;
}

// Numeric buff value: rank-scaled, then '@' resolved.
function readBuffValue(buff: Effect, rank: number | undefined, providerStats: () => Record<string, number>, scope?: BuffValueScope): { numVal: number; isPct: boolean } {
  let rawVal = buff.value;
  if (CommonUtils.isRankValue(rawVal)) rawVal = CommonUtils.parseRankValue(rawVal, rank);
  if (typeof rawVal === 'string' && rawVal.includes('@')) rawVal = resolveBuffValue(rawVal, providerStats(), scope);
  const valStr = String(rawVal || '0');
  return { numVal: parseFloat(valStr) || 0, isPct: valStr.includes('%') };
}

// A buff's contribution: value x stacks, at the provider's weapon rank.
function readBuffTotal(buff: Effect, providerUnit: string, team: any[], providerStats: (name: string) => Record<string, number>, state?: any): { totalVal: number; isPct: boolean } {
  const rank = team.find(t => t.character === providerUnit)?.rank ?? CHARACTER_DEFAULTS.rank;
  const scope = state ? { state, provider: providerUnit, team } : undefined;
  const { numVal, isPct } = readBuffValue(buff, rank, () => providerStats(providerUnit), scope);
  return { totalVal: (isPct ? numVal / 100 : numVal) * (buff.stacks || 1), isPct };
}

/** True when `unit` has a stat-scaled buff on `state`. */
export const carriesStatScaledBuffFrom = (state: any, unit: string): boolean =>
  Object.values(state?.activeBuffs || {}).some((b: any) => b.provider === unit && readsSelfStats(b.value));

/** Buffs on `state` that reach `unit`. */
export function buffsReaching(state: any, unit: string): Effect[] {
  return Object.values(state?.activeBuffs || {}).filter((b: any) =>
    b.target === unit || b.target === '@Team' || (b.target === 'Active' && unit === state.unit)
  ) as Effect[];
}

// True when an expression reads only the provider's stats.
const readsOnlyStats = (expr: string): boolean => !expr.replace(/@Self\.Stat\([^()]*\)/g, '').includes('@');

const buffVersions = new WeakMap<object, number>();

/** Invalidates stats cached for `state`'s buffs. */
export function markBuffsChanged(state: any): void {
  const buffs = state?.activeBuffs;
  if (buffs) buffVersions.set(buffs, (buffVersions.get(buffs) ?? 0) + 1);
}

// Per-buff-set caches; cleared on change or a different team.
const buffSetCaches = new WeakMap<object, { version: number; team: any[]; caches: Record<string, Record<string, any>> }>();

function cacheForBuffs<T>(state: any, team: any[], name: string): Record<string, T> | null {
  const buffs = state?.activeBuffs;
  if (!buffs) return null;
  const version = buffVersions.get(buffs) ?? 0;
  let entry = buffSetCaches.get(buffs);
  if (!entry || entry.version !== version || entry.team !== team) buffSetCaches.set(buffs, entry = { version, team, caches: {} });
  return (entry.caches[name] ??= {});
}

// Stats per provider ("@Self" is the buff's author). With `stateData`, includes live buffs, one level deep.
function providerStatsCache(team: any[], stateData?: any): (providerName: string) => Record<string, number> {
  const stats = cacheForBuffs<Record<string, number>>(stateData, team, 'providerStats') ?? {};
  return providerName => (stats[providerName] ??= CombatCalculator.calculateFinalStats(
    providerName, stateData ? buffsReaching(stateData, providerName) : [], team
  ) as unknown as Record<string, number>);
}

/** `unit`'s stats with the buffs on `state` reaching it. */
export function buffedStats(state: any, unit: string, team: any[]): CalculatedStats {
  const buffs = buffsReaching(state, unit);
  const pure = buffs.every(buff => typeof buff.value !== 'string' || !buff.value.includes('@') || readsOnlyStats(buff.value));
  const cache = pure ? cacheForBuffs<CalculatedStats>(state, team, 'buffedStats') : null;
  if (!cache) return CombatCalculator.calculateFinalStats(unit, buffs, team, state);
  return (cache[unit] ??= CombatCalculator.calculateFinalStats(unit, buffs, team, state));
}

// Buff as shown in a hit's breakdown, with '@' values resolved.
function asApplied(buff: Effect, totalVal: number, isPct: boolean): Effect {
  if (typeof buff.value !== 'string' || !buff.value.includes('@')) return buff;
  const perStack = totalVal / (buff.stacks || 1);
  return { ...buff, value: isPct ? `${CommonUtils.trimNumber(perStack * 100, 2)}%` : CommonUtils.trimNumber(perStack, 2) };
}

/** A buff's value as a hit on `state` reads it. */
export function evaluatedBuffValue(buff: Effect, state: any, team: any[]): string | number | undefined {
  const provider = buff.provider || state?.unit;
  const { totalVal, isPct } = readBuffTotal(buff, provider, team, providerStatsCache(team, state), state);
  return asApplied(buff, totalVal, isPct).value;
}

const targetsEnemy = (buff: Effect): boolean => buff.target === '@Enemy' || buff.target === 'Enemy';

// Buckets Tune hits take, from enemy debuffs only.
const TUNE_DEBUFF_BUCKETS: ReadonlySet<keyof BuffTotals> = new Set<keyof BuffTotals>(['reduceDef', 'reduceRes', 'dmgTaken']);

function isLiveStatBuff(buff: Effect | undefined): buff is Effect & { stat: string } {
  if (!buff || !buff.stat) return false;
  return !(buff.duration !== undefined && Number(buff.duration) <= 0 && buff.stacks !== undefined && buff.stacks <= 0);
}

// Flat stat -> its % counterpart.
const PERCENT_TWIN: Record<string, string> = { flatAtk: 'percentAtk', flatHP: 'percentHP', flatDef: 'percentDef' };
const FLAT_TWIN: Record<string, string> = Object.fromEntries(Object.entries(PERCENT_TWIN).map(([flat, pct]) => [pct, flat]));

// Average crit multiplier; rate clamped to [0, 1].
const critMultiplier = (critRate: number, critDamage: number): number => {
  const cr = Math.min(1, Math.max(0, critRate));
  return (1 - cr) + cr * critDamage;
};

function emptyBuffTotals(): BuffTotals {
  return {
    percentAtk: 0, flatAtk: 0, percentHP: 0, flatHP: 0, percentDef: 0, flatDef: 0,
    critRate: 0, critDamage: 0, dmgBonus: 0, dmgAmp: 0, tuneBreakBoost: 0, dmgTaken: 0,
    multiplicativeMult: 0, additiveMult: 0, reduceRes: 0, ignoreRes: 0, reduceDef: 0, ignoreDef: 0
  };
}

function classifyBuffIntoTotals(sLower: string, totalVal: number, isPct: boolean, buffTotals: BuffTotals): void {
  const bucket = resolveMultiplierBucket(sLower, isPct);
  if (bucket) buffTotals[bucket] += totalVal;
}

const hitModifierSet = (hitModifiers: string[]): Set<string> => new Set((hitModifiers || []).map(m => String(m).toLowerCase().trim()));

// True when `buff` applies to this hit (target and scope).
function buffOnHit(buff: Effect, executingUnit: string, stateData: any, modsSet: Set<string>): buff is Effect & { stat: string } {
  if (!isLiveStatBuff(buff)) return false;
  const targetUnit = buff.target || '@Self';
  const appliesToSelf = (targetUnit === '@Self' || targetUnit === '@Equipper' || targetUnit === executingUnit) &&
                        (buff.provider === executingUnit || buff.provider === SYSTEM_NAMESPACE || buff.target === executingUnit);
  const appliesToTeam = targetUnit === '@Team' || targetUnit === 'Team';
  const appliesToActive = targetUnit === 'Active' && stateData.unit === executingUnit;

  if (!(appliesToSelf || appliesToTeam || appliesToActive || targetsEnemy(buff))) return false;

  // applyTo overrides name-based scope.
  const applyToList = Array.isArray(buff.applyTo) ? buff.applyTo : (buff.applyTo ? [buff.applyTo] : []);
  if (applyToList.length > 0) return applyToList.some(reqTag => modsSet.has(String(reqTag).toLowerCase().trim()));

  const requiredScope = findScope(buff.stat.toLowerCase().trim());
  return !requiredScope || SCOPE_HIT_TAGS[requiredScope].some(t => modsSet.has(t));
}

// A hit's caster, multiplier, tags and formula. `restat`: re-resolve stat-reading multipliers.
function hitShape(hitConfig: HitConfig, stateData: any, team: any[], restat: boolean) {
  const executingUnit: string = hitConfig.provider || stateData.unit;
  const rawMult = restat && hitConfig.statScaledMult
    ? asDslResult(hitConfig.statScaledMult, DSLParser.evaluateMath(hitConfig.statScaledMult, ContextManager.buildContext(stateData, executingUnit, team), executingUnit))
    : hitConfig.hitMult ?? 0;
  const strVal = String(rawMult).trim();
  const num = parseFloat(strVal) || 0;
  const pctMult = strVal.includes('%') ? num / 100 : 0;
  const flatMult = strVal.includes('%') ? 0 : num;

  const dmgTypes = hitConfig.dmgTypes || [];
  const castTypes = hitConfig.castTypes || [];
  const moveName = hitConfig.moveName || '';
  const formattedPointer = hitConfig.moveRef || `@${executingUnit}(${moveName})`;
  const hitModifiers = Array.from(modifierSet([...dmgTypes, ...castTypes, hitConfig.actionId || '', moveName, formattedPointer]));

  // Tune damage never scales off a stat.
  const isTuneDmg = castTypes.some(c => c.toLowerCase().includes('tune'));
  // Negative status only when the status is the sole dmgType.
  const isNegativeStatusDmg = !isTuneDmg && dmgTypes.length === 1 && dmgTypes[0] in NEGATIVE_STATUS_MULTS;
  // '' ("None") must not fall back to ATK.
  const scalarType = isTuneDmg ? '' : (hitConfig.scalar ?? 'ATK').toLowerCase();
  return { executingUnit, pctMult, flatMult, dmgTypes, castTypes, hitModifiers, isTuneDmg, isNegativeStatusDmg, scalarType };
}

function enemyMults(stateData: any, buffTotals: BuffTotals) {
  const unitLvl = SIM_CONSTANTS.LEVEL_CAP;
  const enemyLvl = stateData.enemyLevel || ENEMY_DEFAULTS.level;
  const baseRes = stateData.enemyRes !== undefined ? (stateData.enemyRes / 100) : (ENEMY_DEFAULTS.res / 100);
  const defMult = CombatCalculator.calcDefense(unitLvl, enemyLvl, buffTotals.ignoreDef, buffTotals.reduceDef);
  const resMultiplier = CombatCalculator.calcResistance(baseRes, buffTotals.ignoreRes, buffTotals.reduceRes);
  return { unitLvl, enemyLvl, baseRes, defMult, resMultiplier };
}

function hitBuffParts(stateData: any, executingUnit: string, hitModifiers: string[], team: any[]) {
  const { buffTotals, appliedBuffs } = CombatCalculator.aggregateBuffTotals(stateData, executingUnit, hitModifiers, team);
  return { buffTotals, appliedBuffs, ...enemyMults(stateData, buffTotals) };
}

// Standard formula total at crit multiplier `critMult`.
function standardDamage(
  shape: ReturnType<typeof hitShape>, parts: { buffTotals: BuffTotals; resMultiplier: number; defMult: number },
  stats: ReturnType<typeof casterStatParts>, critMult: number
): number {
  const { buffTotals } = parts;
  const baseDmg = ((shape.pctMult + buffTotals.additiveMult) * stats.scalingStatVal) + shape.flatMult;
  const dmgBonusTotal = 1 + stats.baseDmgBonus + buffTotals.dmgBonus;
  return CombatCalculator.calcStandardDmg(baseDmg, critMult, dmgBonusTotal, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, parts.resMultiplier, parts.defMult);
}

// Caster-stat parts of a hit: DMG Bonus, scaling stat, crit.
function casterStatParts(baseStats: CalculatedStats, buffTotals: BuffTotals, dmgTypes: string[], scalarType: string) {
  const getBaseStat = (key: string) => (baseStats as any)[key] || 0;

  // DMG Bonus comes from dmgTypes only, not castTypes.
  let baseDmgBonus = 0;
  dmgTypes.forEach(type => {
    const statKey = sheetDmgBonusKeyForType(type);
    if (statKey) baseDmgBonus += getBaseStat(statKey) / 100;
  });

  const rawBaseAtk = getBaseStat('baseAtk');
  const talentPctDecimal = (getBaseStat('talentAtkPct') || 0) / 100;
  const basePercentAtkDecimal = (getBaseStat('percentAtk') || 0) / 100;
  const generalAtkPctDecimal = (basePercentAtkDecimal - talentPctDecimal) + buffTotals.percentAtk;

  const totalAtk = Math.floor((Math.floor(rawBaseAtk) * (1 + generalAtkPctDecimal)) + Math.floor(Math.floor(rawBaseAtk) * talentPctDecimal) + getBaseStat('flatAtk'));
  const totalHP = getBaseStat('baseHP') * (1 + (getBaseStat('percentHP') / 100) + buffTotals.percentHP) + getBaseStat('flatHP') + buffTotals.flatHP;
  const totalDef = getBaseStat('baseDef') * (1 + (getBaseStat('percentDef') / 100) + buffTotals.percentDef) + getBaseStat('flatDef') + buffTotals.flatDef;

  // Per scaling stat: base x (1 + %) + flat.
  const scalars: Record<string, { total: number; buffPct: number; base: number; pct: number; flat: number }> = {
    atk: { total: totalAtk, buffPct: buffTotals.percentAtk, base: rawBaseAtk, pct: generalAtkPctDecimal + talentPctDecimal, flat: getBaseStat('flatAtk') + buffTotals.flatAtk },
    hp: { total: totalHP, buffPct: buffTotals.percentHP, base: getBaseStat('baseHP'), pct: getBaseStat('percentHP') / 100 + buffTotals.percentHP, flat: getBaseStat('flatHP') + buffTotals.flatHP },
    def: { total: totalDef, buffPct: buffTotals.percentDef, base: getBaseStat('baseDef'), pct: getBaseStat('percentDef') / 100 + buffTotals.percentDef, flat: getBaseStat('flatDef') + buffTotals.flatDef }
  };
  const scalar = scalars[scalarType];

  return {
    baseDmgBonus,
    scalar,
    // "None" scalar: hitMult is the damage.
    scalingStatVal: scalar?.total ?? 1,
    scalarBonusPct: scalar?.buffPct ?? 0,
    finalCritRate: (getBaseStat('critRate') / 100) + buffTotals.critRate,
    finalCritDamage: (getBaseStat('critDamage') / 100) + buffTotals.critDamage
  };
}

// Damage math: final stats, buffs reaching a hit, and hit pricing.
export const CombatCalculator = {
  calcDefense: (unitLevel: number, enemyLevel: number, ignoreDef = 0, reduceDef = 0): number => {
    const k = (800 + 8 * unitLevel) / ((792 + 8 * enemyLevel) * (1 - ignoreDef) * (1 - reduceDef) + 800 + 8 * unitLevel);
    return Math.max(0, k);
  },

  calcResistance: (baseRes: number, ignoreRes = 0, reduceRes = 0): number => {
    const effectiveRes = baseRes - ignoreRes - reduceRes;
    return effectiveRes > 0 ? 1 - effectiveRes : 1 - (effectiveRes / 2);
  },

  calcStandardDmg: (
    baseDmg: number, critMult: number, dmgBonus: number,
    dmgAmp: number, dmgTaken: number, multiMult: number,
    resMult: number, defMult: number
  ): number => {
    return baseDmg * critMult * dmgBonus * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
  },

  calcNegativeStatusDmg: (
    statusBaseDmg: number, dmgBonus: number, dmgAmp: number, dmgTaken: number,
    multiMult: number, resMult: number, defMult: number
  ): number => {
    return statusBaseDmg * (1 + dmgBonus) * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
  },

  calcTuneDmg: (
    baseDmg: number, tuneBreakBoost: number, dmgTaken: number, multiMult: number, resMult: number, defMult: number
  ): number => {
    return SIM_CONSTANTS.TUNE_BASE_DMG * baseDmg * (1 + tuneBreakBoost) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
  },

  formatDamageBreakdown: (
    calculatedTotal: number, formulaUsed: string, pctMult: number, flatMult: number,
    scalingStatVal: number, finalCritRate: number, finalCritDamage: number,
    baseDmgBonus: number, buffTotals: BuffTotals, resMultiplier: number, defMult: number,
    statBreakdown: any = null, statusBaseDmg = 0
  ) => {
    let displayMult = '';
    const totalPctMult = pctMult + buffTotals.additiveMult;
    if (totalPctMult > 0) displayMult += +(totalPctMult * 100).toFixed(6) + '%';
    if (totalPctMult > 0 && flatMult > 0) displayMult += ' + ';
    if (flatMult > 0) displayMult += +(flatMult).toFixed(6);
    if (displayMult === '') displayMult = '0';

    // Hide "* 1" when there's no scalar.
    const hasScalarStat = !!(statBreakdown && statBreakdown.label);
    let statStr = `${Math.floor(scalingStatVal)}`;
    if (statBreakdown && statBreakdown.base) {
      const label = statBreakdown.label ? `(${statBreakdown.label}) ` : '';
      const pctStr = statBreakdown.pct !== 0 ? ` * ${(1 + statBreakdown.pct).toFixed(3)}` : ` * 1.000`;
      const flatStr = statBreakdown.flat > 0 ? ` + ${Math.floor(statBreakdown.flat)}` : ``;
      statStr = `[${Math.floor(statBreakdown.base)}${pctStr}${flatStr}] ${label}`;
    }

    const baseDmgStr = !hasScalarStat
                      ? (totalPctMult > 0 && flatMult > 0) ? `(${+(totalPctMult * 100).toFixed(4)}% + ${Math.floor(flatMult)})`
                      : (totalPctMult > 0) ? `${+(totalPctMult * 100).toFixed(4)}%`
                      : `${Math.floor(flatMult)}`
                      : (totalPctMult > 0 && flatMult > 0) ? `(${+(totalPctMult * 100).toFixed(4)}% * ${statStr} + ${Math.floor(flatMult)})`
                      : (totalPctMult > 0) ? `${+(totalPctMult * 100).toFixed(4)}% * ${statStr}`
                      : `${Math.floor(flatMult)}`;

    // Tune leads with its base mult; NegativeStatus has no move mult.
    const breakdownParts = formulaUsed === 'Tune' ? [`${SIM_CONSTANTS.TUNE_BASE_DMG}`, baseDmgStr]
                          : formulaUsed === 'NegativeStatus' ? [`${Math.floor(statusBaseDmg)}`]
                          : [baseDmgStr];
    if (formulaUsed === 'Standard') {
      const critMult = critMultiplier(finalCritRate, finalCritDamage);
      const dmgBonusTotal = 1 + baseDmgBonus + buffTotals.dmgBonus;
      if (dmgBonusTotal !== 1) breakdownParts.push(`${dmgBonusTotal.toFixed(3)} (DMG%)`);
      if (critMult !== 1) breakdownParts.push(`${critMult.toFixed(3)} (Crit)`);
    } else if (formulaUsed === 'NegativeStatus' && buffTotals.dmgBonus !== 0) {
      breakdownParts.push(`${(1 + buffTotals.dmgBonus).toFixed(3)} (DMG%)`);
    }

    if (buffTotals.dmgAmp !== 0) breakdownParts.push(`${(1 + buffTotals.dmgAmp).toFixed(3)} (Amp)`);
    if (buffTotals.tuneBreakBoost !== 0) breakdownParts.push(`${(1 + buffTotals.tuneBreakBoost).toFixed(3)} (TBB)`);
    if (buffTotals.dmgTaken !== 0) breakdownParts.push(`${(1 + buffTotals.dmgTaken).toFixed(3)} (Taken)`);
    if (buffTotals.multiplicativeMult !== 0) breakdownParts.push(`${(1 + buffTotals.multiplicativeMult).toFixed(3)} (Multi)`);

    if (resMultiplier !== 1) breakdownParts.push(`${resMultiplier.toFixed(3)} (RES)`);
    if (defMult !== 1) breakdownParts.push(`${defMult.toFixed(3)} (DEF)`);

    const suffix = formulaUsed !== 'Standard' ? ` [${formulaUsed}]` : '';
    return { displayMult, calcBreakdown: `${Math.floor(calculatedTotal)} = ${breakdownParts.join(' * ')}${suffix}` };
  },

  calculateFinalStats: (unitName: string, activeBuffs: Effect[] = [], team: any[] = [], stateData?: any): CalculatedStats => {
    const slot = team.find(t => t.character === unitName) || {};
    const dbUnit = DataLoader.characterDB[unitName] || {};
    const dbWeapon = DataLoader.weaponDB[slot.weapon] || {};
    const echoStats = slot.echoStats || emptyEchoStats();

    const baseAtk = (parseFloat(dbUnit.baseAtk as any) || 0) + (parseFloat(dbWeapon.baseAtk as any) || 0);
    const baseHP = (parseFloat(dbUnit.baseHP as any) || 0) + (parseFloat(dbWeapon.baseHP as any) || 0);
    const baseDef = (parseFloat(dbUnit.baseDef as any) || 0) + (parseFloat(dbWeapon.baseDef as any) || 0);

    const stats: Record<string, number> = {};
    for (const key of ECHO_STAT_KEYS) stats[key] = echoStats[key] || 0;
    stats.critRate = (parseFloat(dbUnit.baseCritRate as any) || CHARACTER_DEFAULTS.baseCritRate) + stats.critRate;
    stats.critDamage = (parseFloat(dbUnit.baseCritDmg as any) || CHARACTER_DEFAULTS.baseCritDmg) + stats.critDamage;
    stats.energyRegen = CHARACTER_DEFAULTS.energyRegen + stats.energyRegen;
    stats.tuneBreakBoost = parseFloat(dbUnit.tuneBreakBoost as any) || 0;
    for (const key in BUILDUP_RATE_STATS) stats[key] = CHARACTER_DEFAULTS.buildupRate;

    let talentAtkPct = 0;
    const injectPassiveStat = (type?: string, val?: string | number) => {
      if (!type || !val) return;
      const statKey = STAT_NAME_MAP[type] || type;
      if (stats[statKey] !== undefined) {
        const parsedVal = parseFloat(String(val)) || 0;
        stats[statKey] += parsedVal;
        if (statKey === 'percentAtk') talentAtkPct += parsedVal;
      }
    };

    injectPassiveStat(dbWeapon.subStatType, dbWeapon.subStatValue);
    injectPassiveStat(dbUnit.talentStat1, dbUnit.talentVal1);
    injectPassiveStat(dbUnit.talentStat2, dbUnit.talentVal2);

    const getProviderStats = providerStatsCache(team, stateData);

    activeBuffs.forEach(buff => {
      if (buff.stat) {
        let baseStatKey = STAT_NAME_MAP[buff.stat] || buff.stat;
        if (stats[baseStatKey] === undefined) {
          const resolved = resolveSheetDmgBonusKey(buff.stat.toLowerCase());
          if (resolved) baseStatKey = resolved;
        }
        // Not a sheet stat.
        if (stats[baseStatKey] === undefined) return;

        const provider = buff.provider || unitName;
        const scope = stateData ? { state: stateData, provider, team } : undefined;
        const { numVal, isPct } = readBuffValue(buff, slot.rank || 1, () => getProviderStats(provider), scope);

        baseStatKey = (isPct ? PERCENT_TWIN : FLAT_TWIN)[baseStatKey] ?? baseStatKey;
        stats[baseStatKey] += numVal * (buff.stacks || 1);
      }
    });

    return {
      ...stats,
      baseAtk, baseHP, baseDef,
      talentAtkPct,
      atk: (Math.floor(baseAtk) * (1 + (stats.percentAtk - talentAtkPct) / 100)) + Math.floor(baseAtk * talentAtkPct / 100) + stats.flatAtk,
      hp: Math.floor(baseHP * (1 + stats.percentHP / 100) + stats.flatHP),
      def: Math.floor(baseDef * (1 + stats.percentDef / 100) + stats.flatDef)
    } as unknown as CalculatedStats;
  },

  // `skip`: buffs to leave out.
  aggregateBuffTotals: (stateData: any, executingUnit: string, hitModifiers: string[], team: any[] = [], skip?: (buff: Effect) => boolean) => {
    const buffTotals = emptyBuffTotals();

    const appliedBuffs: Record<string, Effect> = {};
    const activeBuffs = stateData.activeBuffs || {};
    const modsSet = hitModifierSet(hitModifiers);

    const getProviderStats = providerStatsCache(team, stateData);

    for (const [key, buff] of Object.entries(activeBuffs) as [string, Effect][]) {
      if (!buffOnHit(buff, executingUnit, stateData, modsSet) || skip?.(buff)) continue;
      const { totalVal, isPct } = readBuffTotal(buff, buff.provider || executingUnit, team, getProviderStats, stateData);
      classifyBuffIntoTotals(buff.stat.toLowerCase().trim(), totalVal, isPct, buffTotals);
      appliedBuffs[key] = asApplied(buff, totalVal, isPct);
    }

    return { buffTotals, appliedBuffs };
  },

  // Negative status: only enemy debuffs and buffs naming the status apply.
  aggregateNegativeStatusBuffTotals: (stateData: any, statusName: string, team: any[] = []): { buffTotals: BuffTotals; appliedBuffs: Record<string, Effect> } => {
    const buffTotals = emptyBuffTotals();

    const appliedBuffs: Record<string, Effect> = {};
    const activeBuffs = stateData.activeBuffs || {};
    const statusLower = statusName.toLowerCase();

    const getProviderStats = providerStatsCache(team, stateData);

    for (const [key, buff] of Object.entries(activeBuffs) as [string, Effect][]) {
      if (!isLiveStatBuff(buff)) continue;

      const sLower = buff.stat.toLowerCase().trim();
      const namesThisStatus = sLower.startsWith(statusLower);
      if (!(targetsEnemy(buff) || namesThisStatus)) continue;

      const { totalVal, isPct } = readBuffTotal(buff, buff.provider || SYSTEM_NAMESPACE, team, getProviderStats, stateData);
      classifyBuffIntoTotals(sLower, totalVal, isPct, buffTotals);
      appliedBuffs[key] = asApplied(buff, totalVal, isPct);
    }

    return { buffTotals, appliedBuffs };
  },

  // Tune: TUNE_DEBUFF_BUCKETS enemy debuffs, scope still applies.
  aggregateTuneBuffTotals: (stateData: any, executingUnit: string, hitModifiers: string[], team: any[] = []): { buffTotals: BuffTotals; appliedBuffs: Record<string, Effect> } => {
    const buffTotals = emptyBuffTotals();
    const appliedBuffs: Record<string, Effect> = {};
    const modsSet = hitModifierSet(hitModifiers);
    const getProviderStats = providerStatsCache(team, stateData);

    for (const [key, buff] of Object.entries(stateData.activeBuffs || {}) as [string, Effect][]) {
      if (!targetsEnemy(buff) || !buffOnHit(buff, executingUnit, stateData, modsSet)) continue;
      const { totalVal, isPct } = readBuffTotal(buff, buff.provider || executingUnit, team, getProviderStats, stateData);
      const bucket = resolveMultiplierBucket(buff.stat.toLowerCase().trim(), isPct);
      if (!bucket || !TUNE_DEBUFF_BUCKETS.has(bucket)) continue;
      buffTotals[bucket] += totalVal;
      appliedBuffs[key] = asApplied(buff, totalVal, isPct);
    }

    return { buffTotals, appliedBuffs };
  },

  /** Fast re-pricer for a Standard hit with `unit`'s stats changed. null for Tune/status hits
   * or `unit`'s own stat-reading hits. */
  repricer: (hitConfig: HitConfig, stateData: any, team: any[], unit: string): ((unitBaseStats: CalculatedStats, forTeam: any[]) => number) | null => {
    const shape = hitShape(hitConfig, stateData, team, false);
    const { executingUnit } = shape;
    if (shape.isTuneDmg || shape.isNegativeStatusDmg || (executingUnit === unit && hitConfig.statScaledMult)) return null;

    const modsSet = hitModifierSet(shape.hitModifiers);
    const readsUnitStats = (buff: Effect) => buff.provider === unit && readsSelfStats(buff.value);
    const varying = (Object.values(stateData.activeBuffs || {}) as Effect[])
      .filter(buff => readsUnitStats(buff) && buffOnHit(buff, executingUnit, stateData, modsSet));
    const fixed = CombatCalculator.aggregateBuffTotals(stateData, executingUnit, shape.hitModifiers, team, readsUnitStats).buffTotals;
    const fixedParts = { buffTotals: fixed, ...enemyMults(stateData, fixed) };
    const casterStats = executingUnit === unit ? null : CombatCalculator.calculateFinalStats(executingUnit, [], team);

    return (unitBaseStats, forTeam) => {
      let parts = fixedParts;
      if (varying.length > 0) {
        const buffTotals = { ...fixed };
        const getProviderStats = providerStatsCache(forTeam, stateData);
        varying.forEach(buff => {
          const { totalVal, isPct } = readBuffTotal(buff, unit, forTeam, getProviderStats, stateData);
          classifyBuffIntoTotals(buff.stat!.toLowerCase().trim(), totalVal, isPct, buffTotals);
        });
        parts = { buffTotals, ...enemyMults(stateData, buffTotals) };
      }
      const stats = casterStatParts(casterStats ?? unitBaseStats, parts.buffTotals, shape.dmgTypes, shape.scalarType);
      return Math.floor(standardDamage(shape, parts, stats, critMultiplier(stats.finalCritRate, stats.finalCritDamage)));
    };
  },

  // `restat`: re-resolve stat-reading multipliers for `team`.
  calculateDamageInstance: (hitConfig: HitConfig, stateData: any, team: any[] = [], { restat = false } = {}): DamageInstanceResult => {
    const shape = hitShape(hitConfig, stateData, team, restat);
    const { executingUnit, pctMult, flatMult, dmgTypes, castTypes, isTuneDmg, isNegativeStatusDmg, scalarType } = shape;
    const titleStr = hitConfig.title || 'Active Hit';

    const baseStats = CombatCalculator.calculateFinalStats(executingUnit, [], team);
    const parts = hitBuffParts(stateData, executingUnit, shape.hitModifiers, team);
    const { buffTotals, appliedBuffs, unitLvl, enemyLvl, baseRes, defMult, resMultiplier } = parts;
    const stats = casterStatParts(baseStats, buffTotals, dmgTypes, scalarType);
    const { baseDmgBonus, scalar, scalingStatVal, scalarBonusPct, finalCritRate, finalCritDamage } = stats;

    let calculatedTotal: number;
    let nonCritDmg: number;
    let critDmg: number;
    let formulaUsed: 'Standard' | 'Tune' | 'NegativeStatus' = 'Standard';

    // NegativeStatus and Tune override these.
    let resolvedBuffTotals = buffTotals;
    let resolvedAppliedBuffs = appliedBuffs;
    let resMult = resMultiplier;
    let def = defMult;
    let statusBaseDmg = 0;

    if (isNegativeStatusDmg) {
      formulaUsed = 'NegativeStatus';
      const statusName = dmgTypes[0];
      const stacks = stateData.activeBuffs?.[`Enemy_${statusName}`]?.stacks || 0;
      const stackMult = getNegativeStatusMult(statusName, stacks);
      const statusAgg = CombatCalculator.aggregateNegativeStatusBuffTotals(stateData, statusName, team);
      resolvedBuffTotals = statusAgg.buffTotals;
      resolvedAppliedBuffs = statusAgg.appliedBuffs;
      resMult = CombatCalculator.calcResistance(baseRes, resolvedBuffTotals.ignoreRes, resolvedBuffTotals.reduceRes);
      def = CombatCalculator.calcDefense(unitLvl, enemyLvl, resolvedBuffTotals.ignoreDef, resolvedBuffTotals.reduceDef);
      statusBaseDmg = (stackMult / SIM_CONSTANTS.NEGATIVE_STATUS_BASE_MULT) * ENEMY_DEFAULTS.statusBaseDmg;
      calculatedTotal = CombatCalculator.calcNegativeStatusDmg(statusBaseDmg, resolvedBuffTotals.dmgBonus, resolvedBuffTotals.dmgAmp, resolvedBuffTotals.dmgTaken, resolvedBuffTotals.multiplicativeMult, resMult, def);
      nonCritDmg = calculatedTotal; critDmg = calculatedTotal;
    } else if (isTuneDmg) {
      formulaUsed = 'Tune';
      const tuneAgg = CombatCalculator.aggregateTuneBuffTotals(stateData, executingUnit, shape.hitModifiers, team);
      resolvedBuffTotals = tuneAgg.buffTotals;
      resolvedAppliedBuffs = tuneAgg.appliedBuffs;
      resMult = CombatCalculator.calcResistance(baseRes, 0, resolvedBuffTotals.reduceRes);
      def = CombatCalculator.calcDefense(unitLvl, enemyLvl, 0, resolvedBuffTotals.reduceDef);
      resolvedBuffTotals.tuneBreakBoost = CombatCalculator.calculateFinalStats(executingUnit, buffsReaching(stateData, executingUnit), team, stateData).tuneBreakBoost / 100;
      calculatedTotal = CombatCalculator.calcTuneDmg(pctMult + flatMult, resolvedBuffTotals.tuneBreakBoost, resolvedBuffTotals.dmgTaken, 0, resMult, def);
      nonCritDmg = calculatedTotal; critDmg = calculatedTotal;
    } else {
      calculatedTotal = standardDamage(shape, parts, stats, critMultiplier(finalCritRate, finalCritDamage));
      nonCritDmg = standardDamage(shape, parts, stats, 1.0);
      critDmg = standardDamage(shape, parts, stats, finalCritDamage);
    }

    const statBreakdown = { label: scalarType.toUpperCase(), ...(scalar && { base: scalar.base, pct: scalar.pct, flat: scalar.flat }) };

    const { displayMult, calcBreakdown } = CombatCalculator.formatDamageBreakdown(
      calculatedTotal, formulaUsed, pctMult, flatMult, scalingStatVal,
      finalCritRate, finalCritDamage, baseDmgBonus, resolvedBuffTotals, resMult, def, statBreakdown, statusBaseDmg
    );

    stateData.enemyHp = Math.max(0, (stateData.enemyHp ?? ENEMY_DEFAULTS.hp) - calculatedTotal);

    return {
      title: titleStr,
      total: Math.floor(calculatedTotal),
      nonCrit: Math.floor(nonCritDmg),
      crit: Math.floor(critDmg),
      isOpen: hitConfig.isOpen ?? false,
      gameTime: hitConfig.gameTime,
      formulaUsed,
      data: {
        ...stateData,
        activeBuffs: resolvedAppliedBuffs,
        baseMult: displayMult,
        pctMult: pctMult,
        flatMult: flatMult,
        calcBreakdown: calcBreakdown,
        castTypes: castTypes.length > 0 ? castTypes.join(', ') : '-',
        dmgTypes: dmgTypes.length > 0 ? dmgTypes.join(', ') : '-',
        scalarLabel: scalarType ? scalarType.toUpperCase() : 'None',
        scalarValue: scalarBonusPct > 0 ? +(scalarBonusPct * 100).toFixed(2) : 0,
        critRate: +(resolvedBuffTotals.critRate * 100).toFixed(2),
        critDmg: +(resolvedBuffTotals.critDamage * 100).toFixed(2),
        dmgBonus: +(resolvedBuffTotals.dmgBonus * 100).toFixed(2),
        multiplicativeMult: +(resolvedBuffTotals.multiplicativeMult * 100).toFixed(2),
        additiveMult: +(resolvedBuffTotals.additiveMult * 100).toFixed(2),
        dmgAmp: +(resolvedBuffTotals.dmgAmp * 100).toFixed(2),
        dmgTaken: +(resolvedBuffTotals.dmgTaken * 100).toFixed(2),
        reduceRes: +(resolvedBuffTotals.reduceRes * 100).toFixed(2),
        ignoreRes: +(resolvedBuffTotals.ignoreRes * 100).toFixed(2),
        reduceDef: +(resolvedBuffTotals.reduceDef * 100).toFixed(2),
        ignoreDef: +(resolvedBuffTotals.ignoreDef * 100).toFixed(2)
      }
    };
  }
};