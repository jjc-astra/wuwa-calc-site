import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { CHARACTER_DEFAULTS, SIM_CONSTANTS, ENEMY_DEFAULTS, STAT_NAME_MAP } from '../data/db';
import type { Effect, HitConfig, DamageInstanceResult, BuffTotals, CalculatedStats } from '../types';

const DEFAULT_ECHO_STATS = {
  flatHP: 0, percentHP: 0, flatAtk: 0, percentAtk: 0, flatDef: 0, percentDef: 0,
  critRate: 0, critDamage: 0, energyRegen: 0, healingBonus: 0,
  skillDmgBonus: 0, basicDmgBonus: 0, heavyDmgBonus: 0, libDmgBonus: 0,
  glacioDmgBonus: 0, fusionDmgBonus: 0, electroDmgBonus: 0, aeroDmgBonus: 0, spectroDmgBonus: 0, havocDmgBonus: 0
};

export const CombatCalculator = {
  NEGATIVE_STATUS_MULTS: {
    Fusion:  [0, 8400, 15229, 22058, 28888, 35717, 42546, 49375, 56204, 63034, 69863, 93150, 116438, 139726],
    Electro: [0, 5000, 9065, 13130, 17195, 21260, 25325, 29390, 33455, 37520, 41585, 55447, 69308, 83170],
    Aero:    [0, 4500, 11250, 22500, 33750, 45000, 56250, 67500, 78750, 90000, 101250, 112500, 123750, 135000],
    Spectro: [0, 3000, 5439, 7878, 10317, 12756, 15195, 17634, 20073, 22512, 24951, 33268, 41585, 49902],
    Glacio:  [0, 1225, 2221, 3217, 4213, 5209, 6205, 7201, 8196, 9192, 10188, 13584, 16981, 20377],
    Havoc:   [0, -200, -400, -600, -800, -1000, -1200]
  } as Record<string, number[]>,

  getNegativeStatusMult: (type: string, stacks: number): number => {
    const table = CombatCalculator.NEGATIVE_STATUS_MULTS[type];
    if (!table || stacks <= 0) return 0;
    if (stacks < table.length) return table[stacks];
    const last = table[table.length - 1];
    const diff = last - table[table.length - 2];
    return last + (diff * (stacks - table.length + 1));
  },

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
    statusBaseDmg: number, dmgAmp: number, dmgTaken: number,
    multiMult: number, resMult: number, defMult: number
  ): number => {
    return statusBaseDmg * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult) * resMult * defMult;
  },

  calcTuneDmg: (
    baseDmg: number, dmgAmp: number, dmgTaken: number, multiMult: number
  ): number => {
    return baseDmg * (1 + dmgAmp) * (1 + dmgTaken) * (1 + multiMult);
  },

  formatDamageBreakdown: (
    calculatedTotal: number, formulaUsed: string, pctMult: number, flatMult: number,
    scalingStatVal: number, finalCritRate: number, finalCritDamage: number,
    baseDmgBonus: number, buffTotals: BuffTotals, resMultiplier: number, defMult: number,
    statBreakdown: any = null
  ) => {
    let displayMult = '';
    const totalPctMult = pctMult + buffTotals.additiveMult;
    if (totalPctMult > 0) displayMult += +(totalPctMult * 100).toFixed(6) + '%';
    if (totalPctMult > 0 && flatMult > 0) displayMult += ' + ';
    if (flatMult > 0) displayMult += +(flatMult).toFixed(6);
    if (displayMult === '') displayMult = '0';

    let statStr = `${Math.floor(scalingStatVal)}`;
    if (statBreakdown && statBreakdown.base) {
      const label = statBreakdown.label ? `(${statBreakdown.label}) ` : '';
      const pctStr = statBreakdown.pct !== 0 ? ` * ${(1 + statBreakdown.pct).toFixed(3)}` : ` * 1.000`;
      const flatStr = statBreakdown.flat > 0 ? ` + ${Math.floor(statBreakdown.flat)}` : ``;
      statStr = `[${Math.floor(statBreakdown.base)}${pctStr}${flatStr}] ${label}`;
    }

    const baseDmgStr = (totalPctMult > 0 && flatMult > 0) ? `(${+(totalPctMult * 100).toFixed(4)}% * ${statStr} + ${Math.floor(flatMult)})`
                      : (totalPctMult > 0) ? `${+(totalPctMult * 100).toFixed(4)}% * ${statStr}`
                      : `${Math.floor(flatMult)}`;

    const breakdownParts = [baseDmgStr];
    if (formulaUsed === 'Standard') {
      const cr = Math.min(1.0, Math.max(0.0, finalCritRate));
      const critMult = (1 - cr) * 1 + cr * finalCritDamage;
      const dmgBonusTotal = 1 + baseDmgBonus + buffTotals.dmgBonus;
      if (dmgBonusTotal !== 1) breakdownParts.push(`${dmgBonusTotal.toFixed(3)} (DMG%)`);
      if (critMult !== 1) breakdownParts.push(`${critMult.toFixed(3)} (Crit)`);
    }

    if (buffTotals.dmgAmp !== 0) breakdownParts.push(`${(1 + buffTotals.dmgAmp).toFixed(3)} (Amp)`);
    if (buffTotals.dmgTaken !== 0) breakdownParts.push(`${(1 + buffTotals.dmgTaken).toFixed(3)} (Taken)`);
    if (buffTotals.multiplicativeMult !== 0) breakdownParts.push(`${(1 + buffTotals.multiplicativeMult).toFixed(3)} (Multi)`);

    if (formulaUsed !== 'Tune') {
      if (resMultiplier !== 1) breakdownParts.push(`${resMultiplier.toFixed(3)} (RES)`);
      if (defMult !== 1) breakdownParts.push(`${defMult.toFixed(3)} (DEF)`);
    }

    const suffix = formulaUsed !== 'Standard' ? ` [${formulaUsed}]` : '';
    return { displayMult, calcBreakdown: `${Math.floor(calculatedTotal)} = ${breakdownParts.join(' * ')}${suffix}` };
  },

  calculateFinalStats: (unitName: string, activeBuffs: Effect[] = [], team: any[] = []): CalculatedStats => {
    const slot = team.find(t => t.character === unitName) || {};
    const dbUnit = DataLoader.characterDB[unitName] || {};
    const dbWeapon = DataLoader.weaponDB[slot.weapon] || {};
    const echoStats = slot.echoStats || { ...DEFAULT_ECHO_STATS };

    const baseAtk = (parseFloat(dbUnit.baseAtk as any) || 0) + (parseFloat(dbWeapon.baseAtk as any) || 0);
    const baseHP = (parseFloat(dbUnit.baseHP as any) || 0) + (parseFloat(dbWeapon.baseHP as any) || 0);
    const baseDef = (parseFloat(dbUnit.baseDef as any) || 0) + (parseFloat(dbWeapon.baseDef as any) || 0);

    const stats: Record<string, number> = {
      percentAtk: echoStats.percentAtk || 0,
      percentHP: echoStats.percentHP || 0,
      percentDef: echoStats.percentDef || 0,
      flatAtk: echoStats.flatAtk || 0,
      flatHP: echoStats.flatHP || 0,
      flatDef: echoStats.flatDef || 0,
      critRate: (parseFloat(dbUnit.baseCritRate as any) || CHARACTER_DEFAULTS.baseCritRate) + (echoStats.critRate || 0),
      critDamage: (parseFloat(dbUnit.baseCritDmg as any) || CHARACTER_DEFAULTS.baseCritDmg) + (echoStats.critDamage || 0),
      energyRegen: CHARACTER_DEFAULTS.energyRegen + (echoStats.energyRegen || 0),
      healingBonus: echoStats.healingBonus || 0,
      skillDmgBonus: echoStats.skillDmgBonus || 0,
      basicDmgBonus: echoStats.basicDmgBonus || 0,
      heavyDmgBonus: echoStats.heavyDmgBonus || 0,
      libDmgBonus: echoStats.libDmgBonus || 0,
      glacioDmgBonus: echoStats.glacioDmgBonus || 0,
      fusionDmgBonus: echoStats.fusionDmgBonus || 0,
      electroDmgBonus: echoStats.electroDmgBonus || 0,
      aeroDmgBonus: echoStats.aeroDmgBonus || 0,
      spectroDmgBonus: echoStats.spectroDmgBonus || 0,
      havocDmgBonus: echoStats.havocDmgBonus || 0
    };

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

    activeBuffs.forEach(buff => {
      if (buff.stat) {
        let baseStatKey = STAT_NAME_MAP[buff.stat] || buff.stat;
        if (stats[baseStatKey] === undefined) {
          const sLower = buff.stat.toLowerCase();
          if (sLower.includes('basic') && sLower.includes('dmg')) baseStatKey = 'basicDmgBonus';
          else if (sLower.includes('heavy') && sLower.includes('dmg')) baseStatKey = 'heavyDmgBonus';
          else if (sLower.includes('skill') && sLower.includes('dmg')) baseStatKey = 'skillDmgBonus';
          else if ((sLower.includes('liberation') || sLower.includes('lib')) && sLower.includes('dmg')) baseStatKey = 'libDmgBonus';
          else if (sLower.includes('glacio') && sLower.includes('dmg')) baseStatKey = 'glacioDmgBonus';
          else if (sLower.includes('fusion') && sLower.includes('dmg')) baseStatKey = 'fusionDmgBonus';
          else if (sLower.includes('electro') && sLower.includes('dmg')) baseStatKey = 'electroDmgBonus';
          else if (sLower.includes('aero') && sLower.includes('dmg')) baseStatKey = 'aeroDmgBonus';
          else if (sLower.includes('spectro') && sLower.includes('dmg')) baseStatKey = 'spectroDmgBonus';
          else if (sLower.includes('havoc') && sLower.includes('dmg')) baseStatKey = 'havocDmgBonus';
          else if (sLower.includes('physical') && sLower.includes('dmg')) baseStatKey = 'physicalDmgBonus';
        }

        let rawVal = buff.value;
        if (typeof rawVal === 'string' && rawVal.includes('/')) {
          rawVal = CommonUtils.parseRankValue(rawVal, slot.rank || 1);
        }
        const valStr = String(rawVal || '0');
        const isPct = valStr.includes('%');
        const numVal = parseFloat(valStr) || 0;

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
    const buffTotals: BuffTotals = {
      percentAtk: 0, flatAtk: 0, percentHP: 0, flatHP: 0, percentDef: 0, flatDef: 0,
      critRate: 0, critDamage: 0, dmgBonus: 0, dmgAmp: 0, dmgTaken: 0,
      multiplicativeMult: 0, additiveMult: 0, reduceRes: 0, ignoreRes: 0, reduceDef: 0, ignoreDef: 0
    };

    const appliedBuffs: Record<string, Effect> = {};
    const activeBuffs = stateData.activeBuffs || {};
    const modsSet = new Set((hitModifiers || []).map(m => String(m).toLowerCase().trim()));

    const tagSpecs = [
      { key: 'basic', tags: ['basic'] }, { key: 'heavy', tags: ['heavy'] },
      { key: 'skill', tags: ['skill'] }, { key: 'liberation', tags: ['liberation', 'lib'] },
      { key: 'lib ', tags: ['liberation', 'lib'] }, { key: 'intro', tags: ['intro'] },
      { key: 'outro', tags: ['outro'] }, { key: 'coordinated', tags: ['coordinated'] },
      { key: 'glacio', tags: ['glacio'] }, { key: 'fusion', tags: ['fusion'] },
      { key: 'electro', tags: ['electro'] }, { key: 'aero', tags: ['aero'] },
      { key: 'spectro', tags: ['spectro'] }, { key: 'havoc', tags: ['havoc'] },
      { key: 'physical', tags: ['physical'] }
    ];

    for (const [key, buff] of Object.entries(activeBuffs) as [string, Effect][]) {
      if (!buff || (buff.duration !== undefined && Number(buff.duration) <= 0 && buff.stacks !== undefined && buff.stacks <= 0) || !buff.stat) continue;
      const targetUnit = buff.target || '@Self';
      const appliesToSelf = (targetUnit === '@Self' || targetUnit === '@Equipper' || targetUnit === executingUnit) &&
                            (buff.provider === executingUnit || buff.provider === 'System' || buff.target === executingUnit);
      const appliesToTeam = targetUnit === '@Team' || targetUnit === 'Team';
      const appliesToActive = targetUnit === 'Active' && stateData.unit === executingUnit;

      if (!(appliesToSelf || appliesToTeam || appliesToActive)) continue;

      if (buff.applyTo && Array.isArray(buff.applyTo) && buff.applyTo.length > 0) {
        if (!buff.applyTo.some(reqTag => modsSet.has(String(reqTag).toLowerCase().trim()))) continue;
      }

      const sLower = buff.stat.toLowerCase().trim();
      let requiredTagFound = false;
      let tagMatched = true;

      for (const spec of tagSpecs) {
        if (sLower.includes(spec.key)) {
          requiredTagFound = true;
          if (spec.tags.some(t => modsSet.has(t))) {
            tagMatched = true;
            break;
          } else {
            tagMatched = false;
          }
        }
      }

      if (requiredTagFound && !tagMatched) continue;

      appliedBuffs[key] = buff;

      const providerUnit = buff.provider || executingUnit;
      const providerSlot = team.find(t => t.character === providerUnit);
      const rank = providerSlot ? providerSlot.rank : 1;

      let rawVal = buff.value;
      if (typeof rawVal === 'string' && rawVal.includes('/')) {
        rawVal = CommonUtils.parseRankValue(rawVal, rank);
      }

      const valStr = String(rawVal || '0');
      const isPct = valStr.includes('%');
      let numVal = parseFloat(valStr) || 0;
      if (isPct) numVal /= 100;

      const totalVal = numVal * (buff.stacks || 1);

      if (sLower.includes('amp') || sLower.includes('deepen')) buffTotals.dmgAmp += totalVal;
      else if (sLower.includes('taken')) buffTotals.dmgTaken += totalVal;
      else if (sLower.includes('multiplicative')) buffTotals.multiplicativeMult += totalVal;
      else if (sLower.includes('additive')) buffTotals.additiveMult += totalVal;
      else if (sLower.includes('reduce res') || sLower.includes('res shred')) buffTotals.reduceRes += totalVal;
      else if (sLower.includes('ignore res') || sLower.includes('res pen')) buffTotals.ignoreRes += totalVal;
      else if (sLower.includes('reduce def') || sLower.includes('def shred')) buffTotals.reduceDef += totalVal;
      else if (sLower.includes('ignore def')) buffTotals.ignoreDef += totalVal;
      else if (sLower.includes('crit rate') || sLower === 'cr rate') buffTotals.critRate += totalVal;
      else if (sLower.includes('crit dmg') || sLower === 'cr dmg') buffTotals.critDamage += totalVal;
      else if (sLower.includes('atk') && isPct) buffTotals.percentAtk += totalVal;
      else if (sLower.includes('atk') && !isPct) buffTotals.flatAtk += totalVal;
      else if (sLower.includes('hp') && isPct) buffTotals.percentHP += totalVal;
      else if (sLower.includes('hp') && !isPct) buffTotals.flatHP += totalVal;
      else if (sLower.includes('def') && isPct) buffTotals.percentDef += totalVal;
      else if (sLower.includes('def') && !isPct) buffTotals.flatDef += totalVal;
      else if (sLower.includes('dmg bonus') || sLower.includes('dmg%') || sLower.includes('damage bonus') || sLower.includes('dmg')) buffTotals.dmgBonus += totalVal;
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
    const formattedPointer = `@${executingUnit}(${moveName})`;

    const hitModifiers = Array.from(new Set([
      ...dmgTypes, ...castTypes, actionId, moveName, formattedPointer
    ].map(m => String(m).toLowerCase())));

    const scalarType = (hitConfig.scalar || 'ATK').toLowerCase();
    const baseStats = CombatCalculator.calculateFinalStats(executingUnit, [], team);
    const getBaseStat = (key: string) => (baseStats as any)[key] || 0;

    const { buffTotals, appliedBuffs } = CombatCalculator.aggregateBuffTotals(stateData, executingUnit, hitModifiers, team);

    let baseDmgBonus = 0;
    hitModifiers.forEach(type => {
      const statKey = (type === 'liberation' ? 'lib' : type) + 'DmgBonus';
      if (getBaseStat(statKey)) baseDmgBonus += (getBaseStat(statKey) / 100);
    });

    const rawBaseAtk = getBaseStat('baseAtk');
    const talentPctDecimal = (getBaseStat('talentAtkPct') || 0) / 100;
    const basePercentAtkDecimal = (getBaseStat('percentAtk') || 0) / 100;
    const generalAtkPctDecimal = (basePercentAtkDecimal - talentPctDecimal) + buffTotals.percentAtk;

    const totalAtk = Math.floor((Math.floor(rawBaseAtk) * (1 + generalAtkPctDecimal)) + Math.floor(Math.floor(rawBaseAtk) * talentPctDecimal) + getBaseStat('flatAtk'));
    const totalHP = getBaseStat('baseHP') * (1 + (getBaseStat('percentHP') / 100) + buffTotals.percentHP) + getBaseStat('flatHP') + buffTotals.flatHP;
    const totalDef = getBaseStat('baseDef') * (1 + (getBaseStat('percentDef') / 100) + buffTotals.percentDef) + getBaseStat('flatDef') + buffTotals.flatDef;

    let scalingStatVal = 0;
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
    let formulaUsed = 'Standard';

    const titleLower = titleStr.toLowerCase();

    if (hitConfig.isNegativeStatus) {
      formulaUsed = 'NegativeStatus';
      const statusBaseDmg = ENEMY_DEFAULTS.statusBaseDmg * (flatMult / 10000);
      calculatedTotal = CombatCalculator.calcNegativeStatusDmg(statusBaseDmg, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult, resMultiplier, defMult);
      nonCritDmg = calculatedTotal; critDmg = calculatedTotal;
    } else if (castTypes.some(c => c.toLowerCase().includes('tune')) || titleLower.includes('tune')) {
      formulaUsed = 'Tune';
      calculatedTotal = CombatCalculator.calcTuneDmg(baseDmg, buffTotals.dmgAmp, buffTotals.dmgTaken, buffTotals.multiplicativeMult);
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
      finalCritRate, finalCritDamage, baseDmgBonus, buffTotals, resMultiplier, defMult, statBreakdown
    );

    stateData.enemyHp = Math.max(0, (stateData.enemyHp ?? ENEMY_DEFAULTS.hp) - calculatedTotal);

    return {
      title: titleStr,
      total: Math.floor(calculatedTotal),
      avg: Math.floor(calculatedTotal),
      nonCrit: Math.floor(nonCritDmg),
      crit: Math.floor(critDmg),
      isOpen: hitConfig.isOpen ?? false,
      data: {
        ...stateData,
        activeBuffs: appliedBuffs,
        baseMult: displayMult,
        pctMult: pctMult,
        flatMult: flatMult,
        calcBreakdown: calcBreakdown,
        castTypes: castTypes.length > 0 ? castTypes.join(', ') : '-',
        dmgTypes: dmgTypes.length > 0 ? dmgTypes.join(', ') : '-',
        scalarLabel: (hitConfig.scalar || 'ATK').toUpperCase(),
        scalarValue: scalarBonusPct > 0 ? +(scalarBonusPct * 100).toFixed(2) : 0,
        critRate: +(buffTotals.critRate * 100).toFixed(2),
        critDmg: +(buffTotals.critDamage * 100).toFixed(2),
        dmgBonus: +(buffTotals.dmgBonus * 100).toFixed(2),
        multiplicativeMult: +(buffTotals.multiplicativeMult * 100).toFixed(2),
        additiveMult: +(buffTotals.additiveMult * 100).toFixed(2),
        dmgAmp: +(buffTotals.dmgAmp * 100).toFixed(2),
        dmgTaken: +(buffTotals.dmgTaken * 100).toFixed(2),
        reduceRes: +(buffTotals.reduceRes * 100).toFixed(2),
        ignoreRes: +(buffTotals.ignoreRes * 100).toFixed(2),
        reduceDef: +(buffTotals.reduceDef * 100).toFixed(2),
        ignoreDef: +(buffTotals.ignoreDef * 100).toFixed(2)
      }
    };
  }
};