import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { DSLParser } from './dsl/dslParser';
import { CHARACTER_DEFAULTS, SIM_CONSTANTS, ENEMY_DEFAULTS, STAT_NAME_MAP } from '../data/db';
import { SCOPE_HIT_TAGS } from './combat/combatRegistry';
import { modifierSet } from './engineValues';
import { ECHO_STAT_KEYS, emptyEchoStats } from '../data/gameVocab';
import { findScope, resolveMultiplierBucket, resolveSheetDmgBonusKey } from './combat/statParser';
import { NEGATIVE_STATUS_MULTS, getNegativeStatusMult } from './combat/negativeStatus';
import type { Effect, HitConfig, DamageInstanceResult, BuffTotals, CalculatedStats } from '../types';

// Resolves '@' buff exprs against the provider's own unbuffed stats -- avoids recursive
// buff-context re-derivation in calculateFinalStats.
function resolveBuffValue(rawVal: any, selfStats: Record<string, number> | null): any {
  if (typeof rawVal !== 'string' || !rawVal.includes('@') || !selfStats) return rawVal;
  const ctx = { self: { getStat: (key: string) => selfStats[key] ?? 0 } };
  const isPctExpr = rawVal.includes('%');
  const evaluated = DSLParser.evaluateMath(rawVal, ctx);
  return isPctExpr ? `${evaluated * 100}%` : evaluated;
}

// A buff's value as a number: rank-scaled ("10/12/14%") for `rank`, then any '@' expression
// resolved against the provider's own unbuffed stats (fetched only when needed).
function readBuffValue(buff: Effect, rank: number | undefined, providerStats: () => Record<string, number>): { numVal: number; isPct: boolean } {
  let rawVal = buff.value;
  if (typeof rawVal === 'string' && rawVal.includes('/')) rawVal = CommonUtils.parseRankValue(rawVal, rank);
  if (typeof rawVal === 'string' && rawVal.includes('@')) rawVal = resolveBuffValue(rawVal, providerStats());
  const valStr = String(rawVal || '0');
  return { numVal: parseFloat(valStr) || 0, isPct: valStr.includes('%') };
}

// A buff's contribution to a damage bucket: its value as a fraction (if a percent) times its
// stacks, ranked by its provider's weapon rank.
function readBuffTotal(buff: Effect, providerUnit: string, team: any[], providerStats: (name: string) => Record<string, number>): { totalVal: number; isPct: boolean } {
  const providerSlot = team.find(t => t.character === providerUnit);
  const { numVal, isPct } = readBuffValue(buff, providerSlot ? providerSlot.rank : 1, () => providerStats(providerUnit));
  return { totalVal: (isPct ? numVal / 100 : numVal) * (buff.stacks || 1), isPct };
}

// Unbuffed stats per provider, computed once per call -- keyed by provider since "@Self" means
// the buff's author, not its consumer.
function providerStatsCache(team: any[]): (providerName: string) => Record<string, number> {
  const cache: Record<string, Record<string, number>> = {};
  return providerName => (cache[providerName] ??= CombatCalculator.calculateFinalStats(providerName, [], team) as unknown as Record<string, number>);
}

// A buff still in effect that carries a stat, i.e. one that can contribute to a total.
function isLiveStatBuff(buff: Effect | undefined): buff is Effect & { stat: string } {
  if (!buff || !buff.stat) return false;
  return !(buff.duration !== undefined && Number(buff.duration) <= 0 && buff.stacks !== undefined && buff.stacks <= 0);
}

function emptyBuffTotals(): BuffTotals {
  return {
    percentAtk: 0, flatAtk: 0, percentHP: 0, flatHP: 0, percentDef: 0, flatDef: 0,
    critRate: 0, critDamage: 0, dmgBonus: 0, dmgAmp: 0, dmgBoost: 0, dmgTaken: 0,
    multiplicativeMult: 0, additiveMult: 0, reduceRes: 0, ignoreRes: 0, reduceDef: 0, ignoreDef: 0
  };
}

// Shared by aggregateBuffTotals and aggregateNegativeStatusBuffTotals so their stat-name ->
// bucket rules can't drift apart. Bucket resolution itself lives in combat/statParser.ts.
function classifyBuffIntoTotals(sLower: string, totalVal: number, isPct: boolean, buffTotals: BuffTotals): void {
  const bucket = resolveMultiplierBucket(sLower, isPct);
  if (bucket) buffTotals[bucket] += totalVal;
}

export const CombatCalculator = {
  NEGATIVE_STATUS_MULTS,
  getNegativeStatusMult,

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
    baseDmg: number, dmgBoost: number, dmgTaken: number, multiMult: number, resMult: number, defMult: number
  ): number => {
    return SIM_CONSTANTS.TUNE_BASE_DMG * baseDmg * (1 + dmgBoost) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
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

    // No scalar stat (e.g. Tune Break) means scalingStatVal is the identity 1; don't show "* 1".
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

    // Tune shows its fixed base mult as its own leading term, matching calculatedTotal.
    // NegativeStatus ignores the move's own mult -- base comes from enemy stack count, so
    // there's no baseDmgStr term.
    const breakdownParts = formulaUsed === 'Tune' ? [`${SIM_CONSTANTS.TUNE_BASE_DMG}`, baseDmgStr]
                          : formulaUsed === 'NegativeStatus' ? [`${Math.floor(statusBaseDmg)}`]
                          : [baseDmgStr];
    if (formulaUsed === 'Standard') {
      const cr = Math.min(1.0, Math.max(0.0, finalCritRate));
      const critMult = (1 - cr) * 1 + cr * finalCritDamage;
      const dmgBonusTotal = 1 + baseDmgBonus + buffTotals.dmgBonus;
      if (dmgBonusTotal !== 1) breakdownParts.push(`${dmgBonusTotal.toFixed(3)} (DMG%)`);
      if (critMult !== 1) breakdownParts.push(`${critMult.toFixed(3)} (Crit)`);
    } else if (formulaUsed === 'NegativeStatus' && buffTotals.dmgBonus !== 0) {
      breakdownParts.push(`${(1 + buffTotals.dmgBonus).toFixed(3)} (DMG%)`);
    }

    if (buffTotals.dmgAmp !== 0) breakdownParts.push(`${(1 + buffTotals.dmgAmp).toFixed(3)} (Amp)`);
    if (buffTotals.dmgBoost !== 0) breakdownParts.push(`${(1 + buffTotals.dmgBoost).toFixed(3)} (Boost)`);
    if (buffTotals.dmgTaken !== 0) breakdownParts.push(`${(1 + buffTotals.dmgTaken).toFixed(3)} (Taken)`);
    if (buffTotals.multiplicativeMult !== 0) breakdownParts.push(`${(1 + buffTotals.multiplicativeMult).toFixed(3)} (Multi)`);

    if (resMultiplier !== 1) breakdownParts.push(`${resMultiplier.toFixed(3)} (RES)`);
    if (defMult !== 1) breakdownParts.push(`${defMult.toFixed(3)} (DEF)`);

    const suffix = formulaUsed !== 'Standard' ? ` [${formulaUsed}]` : '';
    return { displayMult, calcBreakdown: `${Math.floor(calculatedTotal)} = ${breakdownParts.join(' * ')}${suffix}` };
  },

  calculateFinalStats: (unitName: string, activeBuffs: Effect[] = [], team: any[] = []): CalculatedStats => {
    const slot = team.find(t => t.character === unitName) || {};
    const dbUnit = DataLoader.characterDB[unitName] || {};
    const dbWeapon = DataLoader.weaponDB[slot.weapon] || {};
    const echoStats = slot.echoStats || emptyEchoStats();

    const baseAtk = (parseFloat(dbUnit.baseAtk as any) || 0) + (parseFloat(dbWeapon.baseAtk as any) || 0);
    const baseHP = (parseFloat(dbUnit.baseHP as any) || 0) + (parseFloat(dbWeapon.baseHP as any) || 0);
    const baseDef = (parseFloat(dbUnit.baseDef as any) || 0) + (parseFloat(dbWeapon.baseDef as any) || 0);

    const stats: Record<string, number> = {};
    for (const key of ECHO_STAT_KEYS) stats[key] = echoStats[key] || 0;
    // The three stats a character has its own base for; the echoes' share is already in `stats`.
    stats.critRate = (parseFloat(dbUnit.baseCritRate as any) || CHARACTER_DEFAULTS.baseCritRate) + stats.critRate;
    stats.critDamage = (parseFloat(dbUnit.baseCritDmg as any) || CHARACTER_DEFAULTS.baseCritDmg) + stats.critDamage;
    stats.energyRegen = CHARACTER_DEFAULTS.energyRegen + stats.energyRegen;

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

    const getProviderStats = providerStatsCache(team);

    activeBuffs.forEach(buff => {
      if (buff.stat) {
        let baseStatKey = STAT_NAME_MAP[buff.stat] || buff.stat;
        if (stats[baseStatKey] === undefined) {
          const resolved = resolveSheetDmgBonusKey(buff.stat.toLowerCase());
          if (resolved) baseStatKey = resolved;
        }

        const { numVal, isPct } = readBuffValue(buff, slot.rank || 1, () => getProviderStats(buff.provider || unitName));

        if (isPct) {
          if (baseStatKey === 'flatAtk') baseStatKey = 'percentAtk';
          else if (baseStatKey === 'flatHP') baseStatKey = 'percentHP';
          else if (baseStatKey === 'flatDef') baseStatKey = 'percentDef';
        } else {
          if (baseStatKey === 'percentAtk') baseStatKey = 'flatAtk';
          else if (baseStatKey === 'percentHP') baseStatKey = 'flatHP';
          else if (baseStatKey === 'percentDef') baseStatKey = 'flatDef';
        }

        if (stats[baseStatKey] !== undefined) {
          stats[baseStatKey] += numVal * (buff.stacks || 1);
        }
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

  aggregateBuffTotals: (stateData: any, executingUnit: string, hitModifiers: string[], team: any[] = []) => {
    const buffTotals = emptyBuffTotals();

    const appliedBuffs: Record<string, Effect> = {};
    const activeBuffs = stateData.activeBuffs || {};
    const modsSet = new Set((hitModifiers || []).map(m => String(m).toLowerCase().trim()));

    const getProviderStats = providerStatsCache(team);

    for (const [key, buff] of Object.entries(activeBuffs) as [string, Effect][]) {
      if (!isLiveStatBuff(buff)) continue;
      const targetUnit = buff.target || '@Self';
      const appliesToSelf = (targetUnit === '@Self' || targetUnit === '@Equipper' || targetUnit === executingUnit) &&
                            (buff.provider === executingUnit || buff.provider === 'System' || buff.target === executingUnit);
      const appliesToTeam = targetUnit === '@Team' || targetUnit === 'Team';
      const appliesToActive = targetUnit === 'Active' && stateData.unit === executingUnit;

      if (!(appliesToSelf || appliesToTeam || appliesToActive)) continue;

      // applyTo, when set, is authoritative and overrides the name-based inference below --
      // e.g. a stat named "Skill DMG Amp" can still be scoped to Basic Attacks.
      const applyToList = Array.isArray(buff.applyTo) ? buff.applyTo : (buff.applyTo ? [buff.applyTo] : []);
      const hasExplicitApplyTo = applyToList.length > 0;
      if (hasExplicitApplyTo) {
        if (!applyToList.some(reqTag => modsSet.has(String(reqTag).toLowerCase().trim()))) continue;
      }

      const sLower = buff.stat.toLowerCase().trim();

      // Fallback for buffs with no explicit applyTo: infer scope from the stat name.
      if (!hasExplicitApplyTo) {
        const requiredScope = findScope(sLower);
        if (requiredScope && !SCOPE_HIT_TAGS[requiredScope].some(t => modsSet.has(t))) continue;
      }

      appliedBuffs[key] = buff;

      const { totalVal, isPct } = readBuffTotal(buff, buff.provider || executingUnit, team, getProviderStats);
      classifyBuffIntoTotals(sLower, totalVal, isPct, buffTotals);
    }

    return { buffTotals, appliedBuffs };
  },

  // Negative-status dmg ignores the unit's own combat buffs -- only @Enemy-targeted debuffs
  // (RES/DEF shred, dmgTaken) or buffs naming this status directly ("<Status> DMG Bonus/Amp",
  // like "Aero DMG Bonus") apply. No applyTo/hitModifiers scoping; a status tick isn't "cast"
  // by anyone.
  aggregateNegativeStatusBuffTotals: (stateData: any, statusName: string, team: any[] = []): { buffTotals: BuffTotals; appliedBuffs: Record<string, Effect> } => {
    const buffTotals = emptyBuffTotals();

    const appliedBuffs: Record<string, Effect> = {};
    const activeBuffs = stateData.activeBuffs || {};
    const statusLower = statusName.toLowerCase();

    const getProviderStats = providerStatsCache(team);

    for (const [key, buff] of Object.entries(activeBuffs) as [string, Effect][]) {
      if (!isLiveStatBuff(buff)) continue;

      const targetsEnemy = buff.target === '@Enemy' || buff.target === 'Enemy';
      const sLower = buff.stat.toLowerCase().trim();
      const namesThisStatus = sLower.startsWith(statusLower);
      if (!(targetsEnemy || namesThisStatus)) continue;

      appliedBuffs[key] = buff;

      const { totalVal, isPct } = readBuffTotal(buff, buff.provider || 'System', team, getProviderStats);
      classifyBuffIntoTotals(sLower, totalVal, isPct, buffTotals);
    }

    return { buffTotals, appliedBuffs };
  },

  calculateDamageInstance: (hitConfig: HitConfig, stateData: any, team: any[] = []): DamageInstanceResult => {
    let pctMult = 0;
    let flatMult = 0;

    const rawMult = hitConfig.hitMult ?? 0;
    const strVal = String(rawMult).trim();
    const num = parseFloat(strVal) || 0;

    if (strVal.includes('%')) {
      pctMult += (num / 100);
    } else {
      flatMult += num;
    }

    const executingUnit = hitConfig.provider || stateData.unit;
    const dmgTypes = hitConfig.dmgTypes || [];
    const castTypes = hitConfig.castTypes || [];
    const titleStr = hitConfig.title || 'Active Hit';
    const actionId = hitConfig.actionId || '';
    const moveName = hitConfig.moveName || '';
    // Names the move's owner (character, echo...), matching TimelineEngine._moveRef.
    const formattedPointer = hitConfig.moveRef || `@${executingUnit}(${moveName})`;

    const hitModifiers = Array.from(modifierSet([...dmgTypes, ...castTypes, actionId, moveName, formattedPointer]));

    const titleLower = titleStr.toLowerCase();
    // Tune Break/Rupture never scales off ATK/HP/DEF -- forced here since some Tune movesets
    // have no scalar field (would otherwise default to ATK).
    const isTuneDmg = castTypes.some(c => c.toLowerCase().includes('tune')) || titleLower.includes('tune');
    // A move is negative-status dmg only when dmgTypes names JUST a known status -- mixed in
    // with other dmgTypes (e.g. ["Heavy","Spectro Frazzle","Spectro"]) means the name is
    // cosmetic and Standard formula still applies.
    const isNegativeStatusDmg = !isTuneDmg && dmgTypes.length === 1 && dmgTypes[0] in CombatCalculator.NEGATIVE_STATUS_MULTS;
    // ?? not || -- an explicit "None" scalar is '', which is falsy but must not fall back to ATK.
    const scalarType = isTuneDmg ? '' : (hitConfig.scalar ?? 'ATK').toLowerCase();
    const baseStats = CombatCalculator.calculateFinalStats(executingUnit, [], team);
    const getBaseStat = (key: string) => (baseStats as any)[key] || 0;

    const { buffTotals, appliedBuffs } = CombatCalculator.aggregateBuffTotals(stateData, executingUnit, hitModifiers, team);

    // dmgTypes only, not hitModifiers -- dmg-bonus category can differ from cast-type category
    // (e.g. castType "Heavy" + dmgType "Basic" should only pick up basicDmgBonus).
    let baseDmgBonus = 0;
    dmgTypes.forEach(type => {
      const key = String(type).toLowerCase();
      const statKey = (key === 'liberation' ? 'lib' : key) + 'DmgBonus';
      if (getBaseStat(statKey)) baseDmgBonus += (getBaseStat(statKey) / 100);
    });

    const rawBaseAtk = getBaseStat('baseAtk');
    const talentPctDecimal = (getBaseStat('talentAtkPct') || 0) / 100;
    const basePercentAtkDecimal = (getBaseStat('percentAtk') || 0) / 100;
    const generalAtkPctDecimal = (basePercentAtkDecimal - talentPctDecimal) + buffTotals.percentAtk;

    const totalAtk = Math.floor((Math.floor(rawBaseAtk) * (1 + generalAtkPctDecimal)) + Math.floor(Math.floor(rawBaseAtk) * talentPctDecimal) + getBaseStat('flatAtk'));
    const totalHP = getBaseStat('baseHP') * (1 + (getBaseStat('percentHP') / 100) + buffTotals.percentHP) + getBaseStat('flatHP') + buffTotals.flatHP;
    const totalDef = getBaseStat('baseDef') * (1 + (getBaseStat('percentDef') / 100) + buffTotals.percentDef) + getBaseStat('flatDef') + buffTotals.flatDef;

    // 1, not 0 -- a "None" scalar means hitMult already IS the damage, not zero times a stat.
    let scalingStatVal = 1;
    let scalarBonusPct = 0;

    if (scalarType === 'atk') { scalingStatVal = totalAtk; scalarBonusPct = buffTotals.percentAtk; }
    else if (scalarType === 'hp') { scalingStatVal = totalHP; scalarBonusPct = buffTotals.percentHP; }
    else if (scalarType === 'def') { scalingStatVal = totalDef; scalarBonusPct = buffTotals.percentDef; }

    const finalCritRate = (getBaseStat('critRate') / 100) + buffTotals.critRate;
    const finalCritDamage = (getBaseStat('critDamage') / 100) + buffTotals.critDamage;

    const unitLvl = SIM_CONSTANTS.LEVEL_CAP;
    const enemyLvl = stateData.enemyLevel || ENEMY_DEFAULTS.level;
    const baseRes = stateData.enemyRes !== undefined ? (stateData.enemyRes / 100) : (ENEMY_DEFAULTS.res / 100);

    const defMult = CombatCalculator.calcDefense(unitLvl, enemyLvl, buffTotals.ignoreDef, buffTotals.reduceDef);
    const resMultiplier = CombatCalculator.calcResistance(baseRes, buffTotals.ignoreRes, buffTotals.reduceRes);

    const baseDmg = ((pctMult + buffTotals.additiveMult) * scalingStatVal) + flatMult;

    let calculatedTotal = 0;
    let nonCritDmg = 0;
    let critDmg = 0;
    let formulaUsed: 'Standard' | 'Tune' | 'NegativeStatus' = 'Standard';

    // Standard/Tune use the unit-scoped buffTotals/resMultiplier/defMult computed above as-is.
    // NegativeStatus overrides these three via aggregateNegativeStatusBuffTotals instead.
    let resolvedBuffTotals = buffTotals;
    let resolvedAppliedBuffs = appliedBuffs;
    let resMult = resMultiplier;
    let def = defMult;
    let statusBaseDmg = 0;

    if (isNegativeStatusDmg) {
      formulaUsed = 'NegativeStatus';
      const statusName = dmgTypes[0];
      const stacks = stateData.activeBuffs?.[`Enemy_${statusName}`]?.stacks || 0;
      const stackMult = CombatCalculator.getNegativeStatusMult(statusName, stacks);
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
      calculatedTotal = CombatCalculator.calcTuneDmg(baseDmg, buffTotals.dmgBoost, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
      nonCritDmg = calculatedTotal; critDmg = calculatedTotal;
    } else {
      const cr = Math.min(1.0, Math.max(0.0, finalCritRate));
      const critMult = (1 - cr) * 1 + cr * finalCritDamage;
      const dmgBonusTotal = 1 + baseDmgBonus + buffTotals.dmgBonus;
      calculatedTotal = CombatCalculator.calcStandardDmg(baseDmg, critMult, dmgBonusTotal, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
      nonCritDmg = CombatCalculator.calcStandardDmg(baseDmg, 1.0, dmgBonusTotal, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
      critDmg = CombatCalculator.calcStandardDmg(baseDmg, finalCritDamage, dmgBonusTotal, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
    }

    let statBreakdown: any = { label: scalarType.toUpperCase() };
    if (scalarType === 'atk') {
      statBreakdown = { ...statBreakdown, base: rawBaseAtk, pct: generalAtkPctDecimal + talentPctDecimal, flat: getBaseStat('flatAtk') + buffTotals.flatAtk };
    } else if (scalarType === 'hp') {
      statBreakdown = { ...statBreakdown, base: getBaseStat('baseHP'), pct: (getBaseStat('percentHP') / 100) + buffTotals.percentHP, flat: getBaseStat('flatHP') + buffTotals.flatHP };
    } else if (scalarType === 'def') {
      statBreakdown = { ...statBreakdown, base: getBaseStat('baseDef'), pct: (getBaseStat('percentDef') / 100) + buffTotals.percentDef, flat: getBaseStat('flatDef') + buffTotals.flatDef };
    }

    const { displayMult, calcBreakdown } = CombatCalculator.formatDamageBreakdown(
      calculatedTotal, formulaUsed, pctMult, flatMult, scalingStatVal,
      finalCritRate, finalCritDamage, baseDmgBonus, resolvedBuffTotals, resMult, def, statBreakdown, statusBaseDmg
    );

    stateData.enemyHp = Math.max(0, (stateData.enemyHp ?? ENEMY_DEFAULTS.hp) - calculatedTotal);

    return {
      title: titleStr,
      total: Math.floor(calculatedTotal),
      avg: Math.floor(calculatedTotal),
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
        // Uses the resolved scalarType, not hitConfig.scalar, since Tune hits force it to ''.
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