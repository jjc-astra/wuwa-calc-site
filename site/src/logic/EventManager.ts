import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
import { GAME_DEFAULTS } from '../data/db';
import { isBuffEffect, isPlaceholderProvider } from './engineValues';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import type { MechanicNode, Effect } from '../types';

export interface RegisteredListener extends MechanicNode {
  equipper: string;
  // Source mechanicsDB key; its namespace resolves @Namespace(Move).
  mechanicKey?: string;
  triggerEvent: string;
  evaluate: (ctx: any, equipper?: string) => boolean;
  requiredModifiers?: string[];
  // Event parameters, e.g. the 2 in AfterHit(2).
  eventArgs: Array<string | number>;
  listenerId: string;
  // Stamped on effects as sourceOwner.
  ownerName?: string;
  recheck?: AlwaysRecheck;
}

// Tags an ALWAYS listener's effects with its id.
export const ALWAYS_SOURCE = '_alwaysListener';
// Queued ALWAYS re-check in the effect stream.
export const ALWAYS_CHECK = 'alwaysCheck';

// Passives without a rule are always on.
export const effectiveTriggerRule = (mechanic: MechanicNode): string | undefined => {
  const hasNoRule = !mechanic.triggerRule || mechanic.triggerRule.trim() === '';
  return hasNoRule && mechanic.isPassive ? 'ALWAYS' : mechanic.triggerRule;
};

const BUFF_LEFT_EVENTS = new Set(['OnBuffRemove', 'OnBuffConsume', 'OnBuffExpire']);
const STATIC_READS = new Set(['Sequence']);
const CONDITION_WORDS = new Set(['IF', 'ALWAYS', 'ANY', 'ALL', 'NOT', 'AND', 'OR', 'true', 'false']);

/** When an ALWAYS listener is re-checked. */
export interface AlwaysRecheck {
  // null: every event.
  events: Set<string> | null;
  // Own buffs (lowercase); one leaving re-checks.
  ownBuffs: Set<string>;
  // Reads only live values; one context per row suffices.
  live: boolean;
}

const isEnemyHpRead = (object: string, prop: string): boolean => object === 'Enemy' && /^hp/i.test(prop);

// Finite or stacking buffs need re-applying on every event.
function needsEveryEvent(buff: Effect): boolean {
  const duration = buff.duration;
  const finite = duration !== undefined && duration !== '' && !String(duration).includes('PermanentDuration')
    && !(Number(duration) >= GAME_DEFAULTS.permanentDuration);
  const stacking = [buff.stacks, buff.maxStacks].some(n => n !== undefined && n !== '' && String(n) !== '1');
  return finite || stacking;
}

/**
 * When an ALWAYS listener is re-checked, by what its condition reads:
 * - static: when its own buff leaves
 * - HasBuff: any buff change
 * - enemy HP: hits
 * - anything else: every event
 */
export function alwaysRecheck(rule: string | undefined, effects: Effect[] = []): AlwaysRecheck {
  const buffs = effects.filter(isBuffEffect);
  const ownBuffs = new Set(buffs.map(eff => (eff.name || '').toLowerCase()));
  const condition = (rule ?? '')
    .replace(/@[\w ]+\([^()]*\)/g, '')
    .replace(/(@\w+)\.HasBuff\([^()]*\)/g, '$1.HasBuff')
    .replace(/(["'`]).*?\1/g, '');
  const reads = [...condition.matchAll(/@(\w+)\.(\w+)/g)].map(m => ({ object: m[1], prop: m[2] }));
  const rest = condition.replace(/@\w+\.\w+/g, '');
  const hpReads = reads.filter(read => isEnemyHpRead(read.object, read.prop));
  const unknown = rest.includes('@') || [...rest.matchAll(/[A-Za-z_]\w*/g)].some(m => !CONDITION_WORDS.has(m[0]))
    || reads.some(read => read.prop !== 'HasBuff' && !STATIC_READS.has(read.prop) && !hpReads.includes(read));
  if (unknown || buffs.some(needsEveryEvent)) return { events: null, ownBuffs, live: false };
  const events = new Set<string>();
  // Swap-dropped buffs fire no event; re-check on cast.
  if (reads.some(read => read.prop === 'HasBuff')) ['OnBuffAdd', ...BUFF_LEFT_EVENTS, 'OnCast'].forEach(e => events.add(e));
  if (hpReads.length > 0) ['OnHit', 'AfterHit', 'OnCast'].forEach(e => events.add(e));
  if (buffs.some(eff => eff.removeOnSwap)) events.add('OnCast');
  return { events, ownBuffs, live: hpReads.length === 0 };
}

// Shared contexts for live-only ALWAYS checks, per row and unit.
const liveContexts = new WeakMap<object, { team: any[]; byUnit: Map<string, any> }>();

const rechecks = (recheck: AlwaysRecheck | undefined, eventType: string, modifiers: Set<string> | null): boolean =>
  !recheck || !recheck.events || recheck.events.has(eventType)
  || (BUFF_LEFT_EVENTS.has(eventType) && !!modifiers && [...modifiers].some(m => recheck.ownBuffs.has(m)));

// Equipper, or the acting unit for System.
const ownerOf = (listener: RegisteredListener, activeUnitName: string): string => listener.equipper || activeUnitName;

const alwaysBuffRemoval = (eff: Effect, listener: RegisteredListener, activeUnitName: string): Effect => ({
  type: 'buffAction', action: 'remove', value: 'ALL', name: eff.name,
  target: !eff.target ? '@Self' : eff.target === '@Equipper' ? listener.equipper : eff.target,
  provider: eff.provider || ownerOf(listener, activeUnitName)
});

// Event bus: compiled trigger rules per event.
export class EventManagerClass {
  listeners: Record<string, RegisteredListener[]> = {};
  // ALWAYS listeners mid-apply; skipped by emit to prevent self-flipping loops.
  applying = new Set<string>();

  reset(): void {
    this.applying.clear();
    this.listeners = {
      OnStart: [], OnCast: [], OnHit: [], AfterHit: [],
      OnSwapIn: [], OnSwapOut: [], OnUnitChange: [], OnTick: [], OnTrackerDetonate: [],
      OnTrackerAdd: [], OnTrackerRemove: [], OnTrackerConsume: [], OnTrackerChanged: [],
      OnBuffAdd: [], OnBuffRemove: [], OnBuffConsume: [], OnBuffUpdate: [], OnBuffExpire: [],
      ALWAYS: []
    };
  }

  registerMechanic(mechanic: MechanicNode, equipperName: string, mechanicKey?: string, ownerName?: string): void {
    const ruleToCompile = effectiveTriggerRule(mechanic);
    if (!ruleToCompile) return;

    const compiledRule = DSLParser.compile(ruleToCompile);
    if (!compiledRule) return;

    compiledRule.triggers.forEach(t => {
      if (!this.listeners[t.event]) this.listeners[t.event] = [];
      this.listeners[t.event].push({
        ...mechanic,
        equipper: equipperName,
        mechanicKey,
        triggerEvent: t.event,
        evaluate: compiledRule.evaluate,
        requiredModifiers: t.modifiers,
        eventArgs: t.args,
        listenerId: `${mechanicKey ?? mechanic.name}#${t.event}`,
        ownerName,
        recheck: t.event === 'ALWAYS' ? alwaysRecheck(ruleToCompile, mechanic.effects) : undefined
      });
    });
  }

  private resolveEffect(eff: Effect, listener: RegisteredListener, activeUnitName: string): Effect {
    const resolved: Effect = { ...eff };
    if (!resolved.source) resolved.source = listener.name;
    if (!resolved.sourceOwner && listener.ownerName) resolved.sourceOwner = listener.ownerName;
    if (resolved.target === '@Equipper') resolved.target = listener.equipper;
    const provider = resolved.provider;
    if (isPlaceholderProvider(provider) || provider === listener.name || provider === listener.provider) {
      resolved.provider = ownerOf(listener, activeUnitName);
    }
    return resolved;
  }

  // A listener with hits fires as a proc.
  private resolveProc(listener: RegisteredListener, activeUnitName: string): Effect {
    return {
      type: 'procced_mechanic',
      source: listener.name,
      provider: ownerOf(listener, activeUnitName),
      mechanicData: { ...listener }
    } as any;
  }

  // Listener cooldown in seconds.
  private cooldownEffect(listener: RegisteredListener, activeUnitName: string): Effect {
    return { type: 'cooldown', name: listener.name, target: ownerOf(listener, activeUnitName), value: parseFloat(String(listener.cooldown)) || 0 };
  }

  // ALWAYS listeners ignore cooldowns.
  private isOnCooldown(listener: RegisteredListener, stateData: any, activeUnitName: string): boolean {
    if (!listener.cooldown || listener.triggerEvent === 'ALWAYS') return false;
    return ContextManager.cooldownRemaining(stateData, ownerOf(listener, activeUnitName), listener.name) > 0.001;
  }

  private fireListener(listener: RegisteredListener, activeUnitName: string, out: Effect[], withHits = true): void {
    if (withHits && listener.hitMults && listener.hitMults.length > 0) out.push(this.resolveProc(listener, activeUnitName));
    (listener.effects || []).forEach(eff => out.push(this.resolveEffect(eff, listener, activeUnitName)));
    if (listener.cooldown) out.push(this.cooldownEffect(listener, activeUnitName));
  }

  emit(
    eventType: string,
    actionModifiers: Set<string> | null,
    stateData: any,
    activeUnitName: string,
    team: any[] = [],
    extraPayload: any = null
  ): Effect[] {
    let bucket = this.listeners[eventType] || [];
    if (eventType !== 'ALWAYS' && eventType !== 'OnStart') {
      const alwaysBucket = (this.listeners['ALWAYS'] || []).filter(l => rechecks(l.recheck, eventType, actionModifiers));
      bucket = [...bucket, ...alwaysBucket];
    }
    if (!bucket || bucket.length === 0) return [];

    const triggeredEffects: Effect[] = [];
    const ctxCache: Record<string, any> = {};

    const getCtx = (unit: string) => {
      const key = unit || SYSTEM_NAMESPACE;
      if (!ctxCache[key]) {
        ctxCache[key] = ContextManager.buildContext(stateData, key, team);
      }
      return ctxCache[key];
    };

    const getPrio = (item: RegisteredListener) => {
      if (typeof item.priority === 'number') return item.priority;
      if (typeof item.priority === 'string') {
        const itemCtx = getCtx(ownerOf(item, activeUnitName));
        return DSLParser.evaluateMath(item.priority, itemCtx, item.equipper);
      }
      return 0;
    };

    bucket.sort((a, b) => getPrio(b) - getPrio(a));

    for (const listener of bucket) {
      // OnTick(interval, maxTicks); OnTick[3] is also accepted.
      const tickParams = eventType === 'OnTick' ? (listener.eventArgs.length > 0 ? listener.eventArgs : (listener.requiredModifiers ?? [])) : [];
      const requiredTags = eventType === 'OnTick' && listener.eventArgs.length === 0 ? [] : (listener.requiredModifiers ?? []);

      // [Self]: only the listener's own unit.
      if (requiredTags.includes('self') && activeUnitName !== listener.equipper) continue;
      if (!requiredTags.every(mod => mod === 'self' || actionModifiers?.has(mod))) continue;

      const isAlways = listener.triggerEvent === 'ALWAYS';
      if (isAlways && this.applying.has(listener.listenerId)) continue;
      // Defer ALWAYS checks to their turn in the effect stream.
      if (isAlways && eventType !== 'ALWAYS') {
        triggeredEffects.push({ type: ALWAYS_CHECK, [ALWAYS_SOURCE]: listener.listenerId, listener, activeUnitName } as any);
        continue;
      }

      const ctx = getCtx(ownerOf(listener, activeUnitName));
      if (!ctx) continue;
      const effectsBefore = triggeredEffects.length;

      if (eventType === 'OnTick') {
        const { gameTimePassed, getTimeScale } = extraPayload || {};
        const timePassed = gameTimePassed || 0;
        if (timePassed <= 0) continue;

        const timerKey = `__sys_timer_${listener.name}`;
        const countKey = `__sys_count_${listener.name}`;

        let currentTimer = stateData?.trackers?.[timerKey] || 0;
        let currentCount = stateData?.trackers?.[countKey] || 0;

        const speedMult = getTimeScale ? getTimeScale(listener.name) : 1.0;
        currentTimer += (timePassed * speedMult);

        // Defaults: 1s interval, no tick limit.
        let interval = 1.0;
        let maxTicks = Infinity;
        const parsedInterval = parseFloat(String(tickParams[0]));
        if (!isNaN(parsedInterval) && parsedInterval > 0) interval = parsedInterval;
        const parsedMax = parseInt(String(tickParams[1]), 10);
        if (!isNaN(parsedMax)) maxTicks = parsedMax;

        while (currentTimer >= interval && currentCount < maxTicks) {
          currentTimer -= interval;
          currentCount++;
          if (!this.isOnCooldown(listener, stateData, activeUnitName) && listener.evaluate(ctx, listener.equipper)) {
            this.fireListener(listener, activeUnitName, triggeredEffects);
          }
        }

        if (stateData) {
          if (!stateData.trackers) stateData.trackers = {};
          stateData.trackers[timerKey] = currentTimer;
          stateData.trackers[countKey] = currentCount;
        }
      } else if (eventType === 'AfterHit') {
        // AfterHit(n): after the nth hit; (all): after the last; none: every hit.
        const which = listener.eventArgs[0];
        const { hitIndex, totalHits } = extraPayload || { hitIndex: 1, totalHits: 1 };
        const matchesHit = which === undefined
          || (String(which).toLowerCase() === 'all' ? hitIndex === totalHits : hitIndex === Number(which));

        if (matchesHit && !this.isOnCooldown(listener, stateData, activeUnitName) && listener.evaluate(ctx, listener.equipper)) {
          this.fireListener(listener, activeUnitName, triggeredEffects, false);
        }
      } else if (!this.isOnCooldown(listener, stateData, activeUnitName) && listener.evaluate(ctx, listener.equipper)) {
        this.fireListener(listener, activeUnitName, triggeredEffects);
      } else if (isAlways) {
        // Only on the ALWAYS event itself (combat start).
        (listener.effects || []).filter(isBuffEffect).forEach(eff => triggeredEffects.push(alwaysBuffRemoval(eff, listener, activeUnitName)));
      }

      if (isAlways) {
        for (let i = effectsBefore; i < triggeredEffects.length; i++) triggeredEffects[i][ALWAYS_SOURCE] = listener.listenerId;
      }
    }
    return triggeredEffects;
  }

  /** An ALWAYS listener's buffs while its condition holds, else their removal. */
  checkAlways(listener: RegisteredListener, stateData: any, activeUnitName: string, team: any[] = []): Effect[] {
    const unit = ownerOf(listener, activeUnitName) || SYSTEM_NAMESPACE;
    let ctx;
    if (listener.recheck?.live && stateData) {
      let cached = liveContexts.get(stateData);
      if (!cached || cached.team !== team) liveContexts.set(stateData, cached = { team, byUnit: new Map() });
      const key = `${unit}|${stateData.onFieldUnit || stateData.unit || unit}`;
      ctx = cached.byUnit.get(key);
      if (!ctx) cached.byUnit.set(key, ctx = ContextManager.buildContext(stateData, unit, team));
    } else {
      ctx = ContextManager.buildContext(stateData, unit, team);
    }
    if (!ctx) return [];
    const holds = listener.evaluate(ctx, listener.equipper);
    return (listener.effects || [])
      .filter(isBuffEffect)
      .map(eff => ({
        ...(holds ? this.resolveEffect(eff, listener, activeUnitName) : alwaysBuffRemoval(eff, listener, activeUnitName)),
        [ALWAYS_SOURCE]: listener.listenerId
      }));
  }
}

export const EventManager = new EventManagerClass();