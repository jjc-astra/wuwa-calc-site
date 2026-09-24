import { DSLParser } from './dsl/dslParser';
import { ContextManager } from './ContextManager';
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
}

// The trigger rule a node actually runs under: a passive with no rule of its own is always on.
export const effectiveTriggerRule = (mechanic: MechanicNode): string | undefined => {
  const hasNoRule = !mechanic.triggerRule || mechanic.triggerRule.trim() === '';
  return hasNoRule && mechanic.isPassive ? 'ALWAYS' : mechanic.triggerRule;
};

// The event bus: compiled trigger rules registered per event, emitted as the simulation runs.
export class EventManagerClass {
  listeners: Record<string, RegisteredListener[]> = {};

  reset(): void {
    this.listeners = {
      OnStart: [], OnCast: [], OnHit: [], AfterHit: [],
      OnSwapIn: [], OnSwapOut: [], OnUnitChange: [], OnTick: [], OnTrackerDetonate: [],
      OnTrackerAdd: [], OnTrackerRemove: [], OnTrackerConsume: [], OnTrackerChanged: [],
      OnBuffAdd: [], OnBuffRemove: [], OnBuffConsume: [], OnBuffUpdate: [], OnBuffExpire: [],
      ALWAYS: []
    };
  }

  registerMechanic(mechanic: MechanicNode, equipperName: string, mechanicKey?: string): void {
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
        eventArgs: t.args
      });
    });
  }

  // Copies a listener's effect, filling in its source and resolving @Equipper and the provider.
  private resolveEffect(eff: Effect, listener: RegisteredListener, activeUnitName: string): Effect {
    const resolved: Effect = { ...eff };
    if (!resolved.source) resolved.source = listener.name;
    if (resolved.target === '@Equipper') resolved.target = listener.equipper;
    const provider = resolved.provider;
    if (!provider || provider === 'System' || provider === '@Equipper' || provider === listener.name || provider === listener.provider) {
      resolved.provider = listener.equipper || activeUnitName;
    }
    return resolved;
  }

  // A listener that carries its own hits fires as a proc'd mechanic; MATH(...) hit mults resolve here.
  private resolveProc(listener: RegisteredListener, activeUnitName: string, ctx: any): Effect {
    const hitMults = (listener.hitMults || []).map(mult =>
      typeof mult === 'string' && mult.startsWith('MATH(')
        ? DSLParser.evaluateMath(mult.substring(5, mult.length - 1), ctx, listener.equipper)
        : mult
    );
    return {
      type: 'procced_mechanic',
      source: listener.name,
      provider: listener.equipper || activeUnitName,
      mechanicData: { ...listener, hitMults }
    } as any;
  }

  private cooldownOwner(listener: RegisteredListener, activeUnitName: string): string {
    return listener.equipper || activeUnitName;
  }

  // A triggered listener's cooldown, in seconds, starting when it fires.
  private cooldownEffect(listener: RegisteredListener, activeUnitName: string): Effect {
    return { type: 'cooldown', name: listener.name, target: this.cooldownOwner(listener, activeUnitName), value: parseFloat(String(listener.cooldown)) || 0 };
  }

  // A listener still on its own cooldown can't trigger again. ALWAYS listeners are continuous
  // state, not triggers, so a cooldown doesn't apply to them.
  private isOnCooldown(listener: RegisteredListener, stateData: any, activeUnitName: string): boolean {
    if (!listener.cooldown || listener.triggerEvent === 'ALWAYS') return false;
    return ContextManager.cooldownRemaining(stateData, this.cooldownOwner(listener, activeUnitName), listener.name) > 0.001;
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
      const alwaysBucket = this.listeners['ALWAYS'] || [];
      bucket = [...bucket, ...alwaysBucket];
    }
    if (!bucket || bucket.length === 0) return [];

    const triggeredEffects: Effect[] = [];
    const ctxCache: Record<string, any> = {};

    const getCtx = (unit: string) => {
      const key = unit || 'System';
      if (!ctxCache[key]) {
        ctxCache[key] = ContextManager.buildContext(stateData, key, team);
      }
      return ctxCache[key];
    };

    const getPrio = (item: RegisteredListener) => {
      if (typeof item.priority === 'number') return item.priority;
      if (typeof item.priority === 'string') {
        const itemCtx = getCtx(item.equipper || activeUnitName);
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

      if (requiredTags.includes('self')) {
        if (activeUnitName !== listener.equipper) continue;
      }
      if (requiredTags.length > 0) {
        let hasAll = true;
        for (const mod of requiredTags) {
          if (mod === 'self') continue;
          if (!actionModifiers || !actionModifiers.has(mod)) {
            hasAll = false;
            break;
          }
        }
        if (!hasAll) continue;
      }

      const ctx = getCtx(listener.equipper || activeUnitName);
      if (!ctx) continue;

      const isAlways = listener.triggerEvent === 'ALWAYS';

      if (eventType === 'OnTick') {
        const { gameTimePassed, getTimeScale } = extraPayload || {};
        const timePassed = gameTimePassed || 0;
        if (timePassed <= 0) continue;

        const timerKey = `__sys_timer_${listener.name}`;
        const countKey = `__sys_count_${listener.name}`;

        let currentTimer = (stateData && stateData.trackers?.[timerKey]) ? stateData.trackers[timerKey] : 0;
        let currentCount = (stateData && stateData.trackers?.[countKey]) ? stateData.trackers[countKey] : 0;

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
            if (listener.hitMults && listener.hitMults.length > 0) {
              triggeredEffects.push(this.resolveProc(listener, activeUnitName, ctx));
            }
            (listener.effects || []).forEach(eff => triggeredEffects.push(this.resolveEffect(eff, listener, activeUnitName)));
            if (listener.cooldown) triggeredEffects.push(this.cooldownEffect(listener, activeUnitName));
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
          (listener.effects || []).forEach(eff => triggeredEffects.push(this.resolveEffect(eff, listener, activeUnitName)));
          if (listener.cooldown) triggeredEffects.push(this.cooldownEffect(listener, activeUnitName));
        }
      } else {
        if (!this.isOnCooldown(listener, stateData, activeUnitName) && listener.evaluate(ctx, listener.equipper)) {
          if ((listener.hitMults && listener.hitMults.length > 0) && (!isAlways || eventType === 'ALWAYS')) {
            triggeredEffects.push(this.resolveProc(listener, activeUnitName, ctx));
          }
          (listener.effects || []).forEach(eff => {
            if (isAlways && eventType !== 'ALWAYS' && eff.type && eff.type !== 'buff') return;
            triggeredEffects.push(this.resolveEffect(eff, listener, activeUnitName));
          });
          if (listener.cooldown && (!isAlways || eventType === 'ALWAYS')) triggeredEffects.push(this.cooldownEffect(listener, activeUnitName));
        } else if (isAlways) {
          (listener.effects || []).forEach(eff => {
            if (eff.type === 'buff' || !eff.type) {
              const p = eff.provider || listener.equipper || activeUnitName;
              let t = eff.target || '@Self';
              if (t === '@Equipper') t = listener.equipper;
              triggeredEffects.push({
                type: 'buffAction',
                action: 'remove',
                value: 'ALL',
                name: eff.name,
                target: t,
                provider: p
              });
            }
          });
        }
      }
    }
    return triggeredEffects;
  }
}

export const EventManager = new EventManagerClass();