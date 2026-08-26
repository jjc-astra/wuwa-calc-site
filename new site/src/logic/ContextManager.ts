import { DataLoader } from '../utils/DataLoader';
import { CombatCalculator } from './CombatCalculator';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS } from '../data/db';

export const ContextManager = {
  buildContext: (
    stateData: any,
    activeUnitName: string,
    team: any[] = [],
    enemyConfig: { level: number; res: number; hp: number } = ENEMY_DEFAULTS
  ) => {
    if (!activeUnitName) {
      console.warn('[ContextManager] WARNING: activeUnitName is missing.');
    }
    try {
      const activeState = stateData?.dropdownState || stateData || {};
      const teamNames = team.map(t => t.character).filter(Boolean);

      const validBuffs = Object.values(activeState.activeBuffs || {}).filter((buff: any) =>
        buff.target === activeUnitName || buff.target === '@Team' || buff.target === 'Active'
      );

      const finalStats = CombatCalculator.calculateFinalStats(activeUnitName, validBuffs as any, team);
      const comboDict = activeState.prevRow ? (activeState.prevRow.unitCombos || {}) : (activeState.unitCombos || {});
      const myCombo = comboDict[activeUnitName];

      let selfPrevAction = null;
      if (myCombo && (activeState.gameTimeStart || 0) <= myCombo.expiration) {
        selfPrevAction = myCombo.action;
      }

      const onFieldUnit = activeState.onFieldUnit || activeState.unit || activeUnitName;
      const isActive = (onFieldUnit === activeUnitName);
      const actionId = activeState.activeProcSource || activeState.action || '';

      let currentSequence = 0;
      const rosterUnit = team.find(t => t.character === activeUnitName);
      if (rosterUnit) {
        currentSequence = parseInt(rosterUnit.sequence, 10) || 0;
      }

      const dbChar = DataLoader.characterDB[activeUnitName] || {};
      const fCount = dbChar.forteCount || CHARACTER_DEFAULTS.forteCount;

      const maxHp = finalStats.hp || 10000;
      const hpPct = activeState.hp ? (activeState.hp[activeUnitName] ?? 1.0) : 1.0;

      const selfContext: Record<string, any> = {
        name: activeUnitName,
        prevAction: selfPrevAction,
        sequence: currentSequence,
        energy: activeState.energy ? (activeState.energy[activeUnitName] || 0) : 0,
        maxEnergy: dbChar.maxEnergy ? parseFloat(dbChar.maxEnergy as any) : CHARACTER_DEFAULTS.maxEnergy,
        concerto: activeState.concerto ? (activeState.concerto[activeUnitName] || 0) : 0,
        maxConcerto: CHARACTER_DEFAULTS.maxConcerto,
        hp: hpPct * maxHp,
        maxHp: maxHp,
        hpPct: hpPct,
        tune: 0,
        maxTune: 0,
        getBuffStacks: (buffName: string) => {
          const activeBuff = activeState.activeBuffs?.[`${activeUnitName}_${buffName}`] || activeState.activeBuffs?.[buffName];
          const teamBuff = activeState.activeBuffs?.[`@Team_${buffName}`];
          const auraBuff = isActive ? activeState.activeBuffs?.[`Active_${buffName}`] : null;
          return (activeBuff ? activeBuff.stacks || 1 : 0) + (teamBuff ? teamBuff.stacks || 1 : 0) + (auraBuff ? auraBuff.stacks || 1 : 0);
        },
        getBuffMaxStacks: (buffName: string) => {
          const buff = activeState.activeBuffs?.[`${activeUnitName}_${buffName}`] || activeState.activeBuffs?.[buffName];
          return buff ? (buff.maxStacks || 1) : 1;
        },
        hasBuff: (buffName: string) => {
          const activeBuff = activeState.activeBuffs?.[`${activeUnitName}_${buffName}`] || activeState.activeBuffs?.[buffName];
          const teamBuff = activeState.activeBuffs?.[`@Team_${buffName}`];
          const auraBuff = isActive ? activeState.activeBuffs?.[`Active_${buffName}`] : null;
          const check = (b: any) => b && (b.duration > 0 || b.stacks > 0);
          return (check(activeBuff) || check(teamBuff) || check(auraBuff)) ? 1 : 0;
        },
        getTracker: (trackerName: string) => activeState.trackers?.[trackerName] || 0,
        getCooldown: (actionName: string) => activeState.cooldowns?.[`${activeUnitName}_${actionName}`] || 0,
        getStat: (statKey: string) => finalStats[statKey] || 0
      };

      for (let i = 1; i <= fCount; i++) {
        const fKey = `forte${i}`;
        selfContext[fKey] = activeState[fKey] ? (activeState[fKey][activeUnitName] || 0) : 0;
        selfContext[`maxForte${i}`] = dbChar[`maxForte${i}`] !== undefined ? parseFloat(dbChar[`maxForte${i}`] as any) : 100;
      }

      const enemyMaxHp = activeState.enemyMaxHp ?? enemyConfig?.hp ?? ENEMY_DEFAULTS.hp;
      const enemyHp = activeState.enemyHp ?? enemyMaxHp;

      return {
        self: selfContext,
        active: { name: onFieldUnit },
        // timeStart/gameTimeStart/duration/gameTimePassed/freezeTime/damageTimeframe/swapTiming
        // are all frames (the row-scheduling/animation-duration domain) -- DSL authors writing
        // trigger rules or math expressions against @Move.* should treat these as frame counts,
        // not seconds. Cooldown-related pointers (@Self.Cooldown(...) etc.) stay seconds, since
        // cooldowns/buff lifetimes are a deliberate exception to the frame migration.
        move: {
          id: actionId,
          name: activeState.moveName || actionId,
          castTypes: activeState.castTypes || [],
          dmgTypes: activeState.dmgTypes || [],
          timeStart: activeState.timeStart || 0,
          gameTimeStart: activeState.gameTimeStart || 0,
          duration: activeState.duration || 0,
          gameTimePassed: activeState.gameTimePassed || 0,
          freezeTime: activeState.freezeTime || 0,
          damageTimeframe: activeState.damageTimeframe || { start: 0, end: 0 },
          swapTiming: activeState.swapTiming || 0,
          baseMult: activeState.baseMult || 0,
          hitMults: activeState.hitMults || [],
          isInHoldWindow: activeState.isInForteWindow || false
        },
        enemy: {
          hp: enemyHp,
          maxHp: enemyMaxHp,
          hpPct: enemyMaxHp > 0 ? (enemyHp / enemyMaxHp) : 1.0,
          tune: activeState.enemyTune || 0,
          maxTune: activeState.enemyMaxTune ?? ENEMY_DEFAULTS.maxTune,
          getBuffStacks: (debuffName: string) => activeState.activeBuffs?.[`Enemy_${debuffName}`]?.stacks || activeState.activeBuffs?.[debuffName]?.stacks || 0,
          getBuffMaxStacks: (buffName: string) => activeState.activeBuffs?.[`Enemy_${buffName}`]?.maxStacks || activeState.activeBuffs?.[buffName]?.maxStacks || 1,
          hasBuff: (debuffName: string) => {
            const debuff = activeState.activeBuffs?.[`Enemy_${debuffName}`] || activeState.activeBuffs?.[debuffName];
            return (debuff && (debuff.duration > 0 || debuff.stacks > 0)) ? 1 : 0;
          }
        },
        team: teamNames,
        teamOthers: teamNames.filter(c => c !== activeUnitName),
        default: GAME_DEFAULTS,
        next: (() => {
          const nextRow = activeState.nextRow;
          if (nextRow && nextRow.action) {
            const nextMove = DataLoader.mechanicsDB[nextRow.action] || {};
            return {
              name: nextRow.unit,
              action: nextRow.action,
              castTypes: nextMove.castTypes || [],
              priority: nextMove.priority || 0
            };
          }
          return { name: nextRow ? nextRow.unit : null, action: null, castTypes: [], priority: 0 };
        })(),
        prev: (() => {
          const prevRow = activeState.prevRow;
          if (prevRow) return { unit: prevRow.unit, action: prevRow.action, castTypes: prevRow.castTypes || [] };
          return { unit: null, action: null, castTypes: [] };
        })(),
        checkCooldown: (unitName: string, actionName: string) => activeState.cooldowns?.[`${unitName}_${actionName}`] || 0
      };
    } catch (err) {
      console.error('[ContextManager] Critical error during buildContext:', err);
      return undefined;
    }
  }
};