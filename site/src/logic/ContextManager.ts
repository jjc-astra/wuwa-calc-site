import { DataLoader } from '../utils/DataLoader';
import { teamCharacters } from '../utils/TeamUtils';
import { CombatCalculator } from './CombatCalculator';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, GAME_DEFAULTS } from '../data/db';
import { forteAlias } from '../utils/ForteNames';
import { forteKey, maxForteKey } from '../utils/ResourceKeys';
import { forteMax, readResource, resourceCap } from './resources';
import { isDslExpr, rowStartEvents, ruleEventsMatch, scopedKey } from './engineValues';
import { DSLParser } from './dsl/dslParser';
import { MechanicKey } from '../utils/MechanicKey';

const isBuffLive = (buff: any): boolean => !!buff && (buff.duration > 0 || buff.stacks > 0);

// In-progress IsNextInCombo checks, to prevent recursion.
const comboChecks = new Set<string>();

// Builds the `ctx` that DSL rules evaluate against.
export const ContextManager = {
  // Seconds until a use is available (0 if now). Sync with TimelineEngine._startCooldown.
  cooldownRemaining: (
    state: { cooldowns?: Record<string, number>; chargeCooldowns?: Record<string, number[]> } | undefined,
    unitName: string,
    actionName: string
  ): number => {
    const key = scopedKey(unitName, actionName);
    const maxCharges = Math.max(1, parseInt(String(DataLoader.mechanicsDB[key]?.maxCharges ?? 1), 10) || 1);
    if (maxCharges > 1) {
      const pending = state?.chargeCooldowns?.[key];
      if (!pending || pending.length < maxCharges) return 0;
      return Math.max(0, Math.min(...pending));
    }
    return Math.max(0, state?.cooldowns?.[key] || 0);
  },

  /** @Move.IsNextInCombo: no higher-priority move on the same input is castable. */
  isNextInCombo: (state: any, unit: string, team: any[]): boolean => {
    const currentKey = state.action || '';
    const current = DataLoader.mechanicsDB[currentKey];
    const guardKey = `${unit}|${currentKey}`;
    if (!current?.input || comboChecks.has(guardKey)) return true;
    comboChecks.add(guardKey);
    try {
      const ctx = () => ContextManager.buildContext(state, unit, team);
      const priorityOf = (move: any): number => {
        const raw = move?.priority ?? 0;
        return parseFloat(String(isDslExpr(raw) ? DSLParser.evaluateMath(raw, ctx(), unit) : raw)) || 0;
      };
      const currentPriority = priorityOf(current);
      const inputType = current.inputType ?? null;
      const stance = state.entryStance || state.stance || CHARACTER_DEFAULTS.defaultStance;
      return !Object.entries(DataLoader.mechanicsDB).some(([key, move]: [string, any]) => {
        if (key === currentKey || !MechanicKey.belongsTo(key, unit) || move.isPassive) return false;
        if (move.input !== current.input || (move.inputType ?? null) !== inputType) return false;
        if (move.stanceReq && move.stanceReq !== 'Any' && move.stanceReq !== stance) return false;
        if (priorityOf(move) <= currentPriority) return false;
        if (!move.triggerRule) return true;
        if (!move._compiledRule || typeof move._compiledRule.evaluate !== 'function') move._compiledRule = DSLParser.compile(move.triggerRule);
        if (!move._compiledRule || typeof move._compiledRule.evaluate !== 'function') return false;
        if (!ruleEventsMatch(move._compiledRule, rowStartEvents(key, move, unit, unit), unit)) return false;
        return !!move._compiledRule.evaluate(ContextManager.buildContext({ ...state, action: key }, unit, team), unit);
      });
    } finally {
      comboChecks.delete(guardKey);
    }
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
      const activeState = stateData || {};
      const teamNames = teamCharacters(team);

      const validBuffs = Object.values(activeState.activeBuffs || {}).filter((buff: any) =>
        buff.target === activeUnitName || buff.target === '@Team' || buff.target === 'Active'
      );

      // Lazy: only computed when a rule reads stats or HP.
      let finalStatsMemo: ReturnType<typeof CombatCalculator.calculateFinalStats> | undefined;
      const finalStats = () => (finalStatsMemo ??= CombatCalculator.calculateFinalStats(activeUnitName, validBuffs as any, team, activeState));
      const comboDict = activeState.prevRow ? (activeState.prevRow.unitCombos || {}) : (activeState.unitCombos || {});
      const myCombo = comboDict[activeUnitName];

      let selfPrevAction = null;
      if (myCombo && (activeState.gameTimeStart || 0) <= myCombo.expiration) {
        selfPrevAction = myCombo.action;
      }

      const onFieldUnit = activeState.onFieldUnit || activeState.unit || activeUnitName;
      const isActive = (onFieldUnit === activeUnitName);
      const lookupBuff = (owner: string, buffName: string) =>
        activeState.activeBuffs?.[scopedKey(owner, buffName)] || activeState.activeBuffs?.[buffName];
      // Own, team-wide, and on-field aura copies of a buff.
      const reachingCopies = (buffName: string) => [
        lookupBuff(activeUnitName, buffName),
        activeState.activeBuffs?.[scopedKey('@Team', buffName)],
        isActive ? activeState.activeBuffs?.[scopedKey('Active', buffName)] : undefined
      ];
      const actionId = activeState.activeProcSource || activeState.action || '';

      let currentSequence = 0;
      const rosterUnit = team.find(t => t.character === activeUnitName);
      if (rosterUnit) {
        currentSequence = parseInt(rosterUnit.sequence, 10) || 0;
      }

      const dbChar = DataLoader.characterDB[activeUnitName] || {};
      const fCount = dbChar.forteCount || CHARACTER_DEFAULTS.forteCount;

      const maxHp = () => finalStats().hp || 10000;
      const hpPct = activeState.hp ? (activeState.hp[activeUnitName] ?? 1.0) : 1.0;

      const selfContext: Record<string, any> = {
        name: activeUnitName,
        prevAction: selfPrevAction,
        nextAction: activeState.nextUnitActions?.[activeUnitName] ?? null,
        sequence: currentSequence,
        energy: readResource(activeState, 'energy', activeUnitName),
        maxEnergy: resourceCap(activeUnitName, 'energy'),
        concerto: readResource(activeState, 'concerto', activeUnitName),
        maxConcerto: resourceCap(activeUnitName, 'concerto'),
        get hp() { return hpPct * maxHp(); },
        get maxHp() { return maxHp(); },
        hpPct: hpPct,
        tune: 0,
        maxTune: 0,
        canTuneBreak: (activeState.tuneReadyUnits || []).includes(activeUnitName),
        getBuffStacks: (buffName: string) => reachingCopies(buffName).reduce((sum, buff) => sum + (buff ? buff.stacks || 1 : 0), 0),
        getBuffMaxStacks: (buffName: string) => lookupBuff(activeUnitName, buffName)?.maxStacks || 1,
        hasBuff: (buffName: string) => (reachingCopies(buffName).some(isBuffLive) ? 1 : 0),
        getTracker: (trackerName: string) => activeState.trackers?.[trackerName] || 0,
        getCooldown: (actionName: string) => ContextManager.cooldownRemaining(activeState, activeUnitName, actionName),
        getStat: (statKey: string) => (finalStats() as Record<string, any>)[statKey] || 0
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
        // Times are frames; cooldowns are seconds.
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
          motionStop: activeState.motionStop || 0,
          damageTimeframe: activeState.damageTimeframe || { start: 0, end: 0 },
          swapTiming: activeState.swapTiming || 0,
          baseMult: activeState.baseMult || 0,
          hitMults: activeState.hitMults || [],
          isInHoldWindow: activeState.isInForteWindow || false,
          // Lazy
          get isNextInCombo() { return ContextManager.isNextInCombo(activeState, activeUnitName, team); }
        },
        enemy: {
          hp: enemyHp,
          maxHp: enemyMaxHp,
          hpPct: enemyMaxHp > 0 ? (enemyHp / enemyMaxHp) : 1.0,
          tune: activeState.enemyTune || 0,
          maxTune: activeState.enemyMaxTune ?? ENEMY_DEFAULTS.maxTune,
          getBuffStacks: (debuffName: string) => lookupBuff('Enemy', debuffName)?.stacks || 0,
          getBuffMaxStacks: (debuffName: string) => lookupBuff('Enemy', debuffName)?.maxStacks || 1,
          hasBuff: (debuffName: string) => isBuffLive(lookupBuff('Enemy', debuffName)) ? 1 : 0
        },
        // Roster names, plus HasBuff across the team.
        team: Object.assign([...teamNames], {
          hasBuff: (buffName: string) => ([
            ...teamNames.map(name => lookupBuff(name, buffName)),
            activeState.activeBuffs?.[scopedKey('@Team', buffName)],
            activeState.activeBuffs?.[scopedKey('Active', buffName)]
          ].some(isBuffLive) ? 1 : 0)
        }),
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