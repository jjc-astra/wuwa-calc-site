import { DataLoader } from '../utils/DataLoader';
import { teamCharacters } from '../utils/TeamUtils';
import { CombatCalculator } from './CombatCalculator';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS } from '../data/db';
import { forteAlias } from '../utils/ForteNames';
import { forteKey, maxForteKey } from '../utils/ResourceKeys';
import { forteMax, readResource } from './resources';

// A buff still in effect: it has time left or stacks.
const isBuffLive = (buff: any): boolean => !!buff && (buff.duration > 0 || buff.stacks > 0);

export const ContextManager = {
  // Seconds until `actionName` (bare move name) next has a use available for `unitName`, given
  // TimelineEngine's cooldown state (`cooldowns` for a plain single-timer move, `chargeCooldowns`
  // for maxCharges > 1) -- 0 if available right now. Shared by TimelineEngine's own pre-cast wait
  // and this file's own @Self.Cooldown()/checkCooldown DSL reads, so both agree on availability.
  // Keep in sync with TimelineEngine's _startCooldown, which writes the state this reads.
  cooldownRemaining: (
    state: { cooldowns?: Record<string, number>; chargeCooldowns?: Record<string, number[]> } | undefined,
    unitName: string,
    actionName: string
  ): number => {
    const key = `${unitName}_${actionName}`;
    const maxCharges = Math.max(1, parseInt(String(DataLoader.mechanicsDB[key]?.maxCharges ?? 1), 10) || 1);
    if (maxCharges > 1) {
      const pending = state?.chargeCooldowns?.[key];
      if (!pending || pending.length < maxCharges) return 0;
      return Math.max(0, Math.min(...pending));
    }
    return Math.max(0, state?.cooldowns?.[key] || 0);
  },

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
      const teamNames = teamCharacters(team);

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
      // A buff by its owner-prefixed key, falling back to the bare name.
      const lookupBuff = (owner: string, buffName: string) =>
        activeState.activeBuffs?.[`${owner}_${buffName}`] || activeState.activeBuffs?.[buffName];
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
        energy: readResource(activeState, 'energy', activeUnitName),
        maxEnergy: dbChar.maxEnergy ? parseFloat(dbChar.maxEnergy as any) : CHARACTER_DEFAULTS.maxEnergy,
        concerto: readResource(activeState, 'concerto', activeUnitName),
        maxConcerto: CHARACTER_DEFAULTS.maxConcerto,
        hp: hpPct * maxHp,
        maxHp: maxHp,
        hpPct: hpPct,
        tune: 0,
        maxTune: 0,
        getBuffStacks: (buffName: string) => {
          const activeBuff = lookupBuff(activeUnitName, buffName);
          const teamBuff = activeState.activeBuffs?.[`@Team_${buffName}`];
          const auraBuff = isActive ? activeState.activeBuffs?.[`Active_${buffName}`] : null;
          return (activeBuff ? activeBuff.stacks || 1 : 0) + (teamBuff ? teamBuff.stacks || 1 : 0) + (auraBuff ? auraBuff.stacks || 1 : 0);
        },
        getBuffMaxStacks: (buffName: string) => {
          const buff = lookupBuff(activeUnitName, buffName);
          return buff ? (buff.maxStacks || 1) : 1;
        },
        hasBuff: (buffName: string) => {
          const activeBuff = lookupBuff(activeUnitName, buffName);
          const teamBuff = activeState.activeBuffs?.[`@Team_${buffName}`];
          const auraBuff = isActive ? activeState.activeBuffs?.[`Active_${buffName}`] : null;
          return (isBuffLive(activeBuff) || isBuffLive(teamBuff) || isBuffLive(auraBuff)) ? 1 : 0;
        },
        getTracker: (trackerName: string) => activeState.trackers?.[trackerName] || 0,
        getCooldown: (actionName: string) => ContextManager.cooldownRemaining(activeState, activeUnitName, actionName),
        getStat: (statKey: string) => finalStats[statKey] || 0
      };

      for (let i = 1; i <= fCount; i++) {
        const fKey = forteKey(i);
        const maxKey = maxForteKey(i);
        selfContext[fKey] = readResource(activeState, fKey, activeUnitName);
        selfContext[maxKey] = forteMax(dbChar, i);
        const alias = forteAlias(dbChar, i);
        if (alias) {
          selfContext[alias] = selfContext[fKey];
          selfContext[`Max${alias}`] = selfContext[maxKey];
        }
      }

      const enemyMaxHp = activeState.enemyMaxHp ?? enemyConfig?.hp ?? ENEMY_DEFAULTS.hp;
      const enemyHp = activeState.enemyHp ?? enemyMaxHp;

      return {
        self: selfContext,
        active: { name: onFieldUnit },
        // timeStart/gameTimeStart/duration/gameTimePassed/freezeTime/damageTimeframe/swapTiming
        // are all FRAMES, not seconds -- DSL math against @Move.* should treat them as frame
        // counts. Cooldown pointers (@Self.Cooldown etc) stay SECONDS -- a deliberate exception.
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
          hasBuff: (debuffName: string) => isBuffLive(lookupBuff('Enemy', debuffName)) ? 1 : 0
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
        checkCooldown: (unitName: string, actionName: string) => ContextManager.cooldownRemaining(activeState, unitName, actionName)
      };
    } catch (err) {
      console.error('[ContextManager] Critical error during buildContext:', err);
      return undefined;
    }
  }
};