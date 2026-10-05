import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
import { GAME_DEFAULTS } from '../data/db';
import { isBuffEffect, isPlaceholderProvider } from './engineValues';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import type { MechanicNode, Effect } from '../types';

export interface RegisteredListener extends MechanicNode {
  equipper: string;
  // The mechanicsDB key this listener was registered from; its namespace (the owning character,
  // weapon, set, or echo) is what @Namespace(Move) references resolve against.
  mechanicKey?: string;
  triggerEvent: string;
  evaluate: (ctx: any, equipper?: string) => boolean;
  // The `[...]` tags a move must carry (or 'self').
  requiredModifiers?: string[];
  // The `(...)` parameters of the event itself, e.g. the 2 in AfterHit(2).
  eventArgs: Array<string | number>;
  // Identifies the listener in ALWAYS_SOURCE tags (see EventManagerClass.applying).
  listenerId: string;
  // The entity it came from (a character, weapon, echo, echo set or System), stamped on its
  // effects as sourceOwner.
  ownerName?: string;
  // When an ALWAYS listener is re-checked after combat start.
  recheck?: AlwaysRecheck;
}

// Set on the effects an ALWAYS listener produces, naming that listener (see EventManagerClass.applying).
export const ALWAYS_SOURCE = '_alwaysListener';
// A queued re-check of an ALWAYS listener (EventManagerClass.checkAlways), run in its place in the
// event's effect stream.
export const ALWAYS_CHECK = 'alwaysCheck';

// The trigger rule a node actually runs under: a passive with no rule of its own is always on.
export const effectiveTriggerRule = (mechanic: MechanicNode): string | undefined => {
  const hasNoRule = !mechanic.triggerRule || mechanic.triggerRule.trim() === '';
  return hasNoRule && mechanic.isPassive ? 'ALWAYS' : mechanic.triggerRule;
};

// Buff events that mean a buff left (its own: re-checks an ALWAYS listener, so it returns).
const BUFF_LEFT_EVENTS = new Set(['OnBuffRemove', 'OnBuffConsume', 'OnBuffExpire']);
// Reads that can't change mid-run.
const STATIC_READS = new Set(['Sequence']);
// Words a condition can hold that read no state.
const CONDITION_WORDS = new Set(['IF', 'ALWAYS', 'ANY', 'ALL', 'NOT', 'AND', 'OR', 'true', 'false']);

/** When an ALWAYS listener is re-checked after combat start (EventManagerClass.emit). */
export interface AlwaysRecheck {
  // Events that re-check it whatever they carry; null: every event.
  events: Set<string> | null;
  // Its own buffs (lowercase, as buff events carry them): one leaving re-checks it.
  ownBuffs: Set<string>;
  // Its condition reads only what a context reads live (Sequence, HasBuff): one context per row
  // serves all its checks (checkAlways).
  live: boolean;
}

// The enemy's HP only drops as a hit is priced.
const isEnemyHpRead = (object: string, prop: string): boolean => object === 'Enemy' && /^hp/i.test(prop);

// A buff an ALWAYS rule keeps on by re-applying it on every event: one that runs out (a finite
// duration) or builds up (more than one stack). Only a permanent single-stack buff holds without it.
function needsEveryEvent(buff: Effect): boolean {
  const duration = buff.duration;
  const finite = duration !== undefined && duration !== '' && !String(duration).includes('PermanentDuration')
    && !(Number(duration) >= GAME_DEFAULTS.permanentDuration);
  const stacking = [buff.stacks, buff.maxStacks].some(n => n !== undefined && n !== '' && String(n) !== '1');
  return finite || stacking;
}

/**
 * When an ALWAYS listener with this rule and these effects is re-checked, by what its condition
 * reads. Static (no condition, or only Sequence): only when its own buff leaves. HasBuff: also on
 * any buff change. The enemy's HP: also on hits. Anything else, or a buff that runs out or stacks
 * (needsEveryEvent): every event.
 */
export function alwaysRecheck(rule: string | undefined, effects: Effect[] = []): AlwaysRecheck {
  const buffs = effects.filter(isBuffEffect);
  const ownBuffs = new Set(buffs.map(eff => (eff.name || '').toLowerCase()));
  const condition = (rule ?? '')
    .replace(/@[\w ]+\([^()]*\)/g, '') // @Owner(Name) references
    .replace(/(@\w+)\.HasBuff\([^()]*\)/g, '$1.HasBuff')
    .replace(/(["'`]).*?\1/g, '');
  const reads = [...condition.matchAll(/@(\w+)\.(\w+)/g)].map(m => ({ object: m[1], prop: m[2] }));
  const rest = condition.replace(/@\w+\.\w+/g, '');
  const hpReads = reads.filter(read => isEnemyHpRead(read.object, read.prop));
  const unknown = rest.includes('@') || [...rest.matchAll(/[A-Za-z_]\w*/g)].some(m => !CONDITION_WORDS.has(m[0]))
    || reads.some(read => read.prop !== 'HasBuff' && !STATIC_READS.has(read.prop) && !hpReads.includes(read));
  if (unknown || buffs.some(needsEveryEvent)) return { events: null, ownBuffs, live: false };
  const events = new Set<string>();
  // A buff dropped on a swap leaves without an event: checked again on each cast.
  if (reads.some(read => read.prop === 'HasBuff')) ['OnBuffAdd', ...BUFF_LEFT_EVENTS, 'OnCast'].forEach(e => events.add(e));
  if (hpReads.length > 0) ['OnHit', 'AfterHit', 'OnCast'].forEach(e => events.add(e));
  if (buffs.some(eff => eff.removeOnSwap)) events.add('OnCast');
  return { events, ownBuffs, live: hpReads.length === 0 };
}

// Contexts for ALWAYS checks whose condition only reads Sequence and HasBuff, per row state and
// unit: those read the row's buffs live, so one context serves every check on the row.
const liveContexts = new WeakMap<object, { team: any[]; byUnit: Map<string, any> }>();

/** Whether `eventType` (carrying `modifiers`) re-checks this ALWAYS listener. */
const rechecks = (recheck: AlwaysRecheck | undefined, eventType: string, modifiers: Set<string> | null): boolean =>
  !recheck || !recheck.events || recheck.events.has(eventType)
  || (BUFF_LEFT_EVENTS.has(eventType) && !!modifiers && [...modifiers].some(m => recheck.ownBuffs.has(m)));

// The unit a listener acts as: its equipper, or (System's) whoever is acting.
const ownerOf = (listener: RegisteredListener, activeUnitName: string): string => listener.equipper || activeUnitName;

// Taking an ALWAYS listener's buff off once its condition stops holding.
const alwaysBuffRemoval = (eff: Effect, listener: RegisteredListener, activeUnitName: string): Effect => ({
  type: 'buffAction', action: 'remove', value: 'ALL', name: eff.name,
  target: !eff.target ? '@Self' : eff.target === '@Equipper' ? listener.equipper : eff.target,
  provider: eff.provider || ownerOf(listener, activeUnitName)
});

// The event bus: compiled trigger rules registered per event, emitted as the simulation runs.
export class EventManagerClass {
  listeners: Record<string, RegisteredListener[]> = {};
  // ALWAYS listeners whose own effects are being applied right now. emit skips them, so the buff
  // events those effects fire can't re-check (and flip) the same listener -- e.g. a rule whose
  // condition reads its own buff would otherwise add it, fail, remove it, pass, add it... forever.
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

  // Copies a listener's effect, filling in its source and resolving @Equipper and the provider.
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

  // A listener that carries its own hits fires as a proc'd mechanic. Its hit mults resolve as
  // each hit lands, like a cast move's (TimelineEngine._processQueuedHits).
  private resolveProc(listener: RegisteredListener, activeUnitName: string): Effect {
    return {
      type: 'procced_mechanic',
      source: listener.name,
      provider: ownerOf(listener, activeUnitName),
      mechanicData: { ...listener }
    } as any;
  }

  // A triggered listener's cooldown, in seconds, starting when it fires.
  private cooldownEffect(listener: RegisteredListener, activeUnitName: string): Effect {
    return { type: 'cooldown', name: listener.name, target: ownerOf(listener, activeUnitName), value: parseFloat(String(listener.cooldown)) || 0 };
  }

  // A listener still on its own cooldown can't trigger again. ALWAYS listeners are continuous
  // state, not triggers, so a cooldown doesn't apply to them.
  private isOnCooldown(listener: RegisteredListener, stateData: any, activeUnitName: string): boolean {
    if (!listener.cooldown || listener.triggerEvent === 'ALWAYS') return false;
    return ContextManager.cooldownRemaining(stateData, ownerOf(listener, activeUnitName), listener.name) > 0.001;
  }

  // What a triggered listener produces: its hits (as a proc), its effects, its cooldown.
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
      // Only the ALWAYS listeners this event could change.
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
      // OnTick's interval and max ticks are its parameters -- OnTick(3, 5). The older OnTick[3]
      // spelling is still read as parameters too, so its brackets aren't tags to match.
      const tickParams = eventType === 'OnTick' ? (listener.eventArgs.length > 0 ? listener.eventArgs : (listener.requiredModifiers ?? [])) : [];
      const requiredTags = eventType === 'OnTick' && listener.eventArgs.length === 0 ? [] : (listener.requiredModifiers ?? []);

      // [Self]: only this listener's own unit acting. Every other tag must be on the event.
      if (requiredTags.includes('self') && activeUnitName !== listener.equipper) continue;
      if (!requiredTags.every(mod => mod === 'self' || actionModifiers?.has(mod))) continue;

      const isAlways = listener.triggerEvent === 'ALWAYS';
      if (isAlways && this.applying.has(listener.listenerId)) continue;
      // During another event, an ALWAYS listener is checked when its turn in the effect stream
      // comes, against the state the effects before it left -- not now, when an effect of this
      // same event (a debuff its condition reads) could still flip it.
      if (isAlways && eventType !== 'ALWAYS') {
        triggeredEffects.push({ type: ALWAYS_CHECK, [ALWAYS_SOURCE]: listener.listenerId, listener, activeUnitName } as any);
        continue;
      }

      const ctx = getCtx(ownerOf(listener, activeUnitName));
      if (!ctx) continue;
      // Where this listener's effects start, for tagging them below.
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

        // A tick every `interval` seconds (default 1), at most `maxTicks` times (default no limit).
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
        // AfterHit(n) runs once the nth hit of the move has resolved: AfterHit(all) after its last
        // hit, no number after every hit. TimelineEngine prices that hit (snapshots its buffs) before
        // firing this, so whatever the listener applies only reaches the hits after it.
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
        // Only reached on the ALWAYS event itself (combat start): elsewhere ALWAYS listeners queue a check above.
        (listener.effects || []).filter(isBuffEffect).forEach(eff => triggeredEffects.push(alwaysBuffRemoval(eff, listener, activeUnitName)));
      }

      if (isAlways) {
        for (let i = effectsBefore; i < triggeredEffects.length; i++) triggeredEffects[i][ALWAYS_SOURCE] = listener.listenerId;
      }
    }
    return triggeredEffects;
  }

  /** An ALWAYS listener's effects for the state now: its buffs while its condition holds, their
   * removal once it doesn't. */
  checkAlways(listener: RegisteredListener, stateData: any, activeUnitName: string, team: any[] = []): Effect[] {
    const unit = ownerOf(listener, activeUnitName) || SYSTEM_NAMESPACE;
    let ctx;
    if (listener.recheck?.live && stateData) {
      let cached = liveContexts.get(stateData);
      if (!cached || cached.team !== team) liveContexts.set(stateData, cached = { team, byUnit: new Map() });
      // Its on-field unit decides which aura buffs count.
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