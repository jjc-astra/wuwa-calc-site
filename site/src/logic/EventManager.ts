import { DSLParser } from './DSLParser';
import { ContextManager } from './ContextManager';
import type { MechanicNode, Effect } from '../types';

export interface RegisteredListener extends MechanicNode {
  equipper: string;
  triggerEvent: string;
  evaluate: (ctx: any, equipper?: string) => boolean;
  requiredModifiers?: string[];
}

export class EventManagerClass {
  listeners: Record<string, RegisteredListener[]> = {};

  reset(): void {
    this.listeners = {
      OnStart: [], OnCast: [], OnHit: [], AfterHit: [],
      OnSwapIn: [], OnSwapOut: [], OnChange: [], OnTick: [], Detonate: [],
      OnTrackerAdd: [], OnTrackerRemove: [], OnTrackerConsume: [],
      OnBuffAdd: [], OnBuffRemove: [], OnBuffUpdate: [], OnBuffExpire: [],
      ALWAYS: []
    };
  }

  registerMechanic(mechanic: MechanicNode, equipperName: string): void {
    const hasNoRule = !mechanic.triggerRule || mechanic.triggerRule.trim() === '';
    const ruleToCompile = hasNoRule && mechanic.isPassive ? 'ALWAYS' : mechanic.triggerRule;
    if (!ruleToCompile) return;

    const compiledRule = DSLParser.compile(ruleToCompile);
    if (!compiledRule) return;

    compiledRule.triggers.forEach(t => {
      if (!this.listeners[t.event]) this.listeners[t.event] = [];
      this.listeners[t.event].push({
        ...mechanic,
        equipper: equipperName,
        triggerEvent: t.event,
        evaluate: compiledRule.evaluate,
        requiredModifiers: t.modifiers
      });
    });
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
      if (listener.requiredModifiers && listener.requiredModifiers.includes('self')) {
        if (activeUnitName !== listener.equipper) continue;
      }
      if (listener.requiredModifiers && listener.requiredModifiers.length > 0) {
        let hasAll = true;
        for (const mod of listener.requiredModifiers) {
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

        let interval = 1.0;
        let maxTicks = Infinity;
        if (listener.requiredModifiers && listener.requiredModifiers.length > 0) {
          const parsedInterval = parseFloat(listener.requiredModifiers[0]);
          if (!isNaN(parsedInterval)) interval = parsedInterval;
          if (listener.requiredModifiers.length > 1) {
            const parsedMax = parseInt(listener.requiredModifiers[1], 10);
            if (!isNaN(parsedMax)) maxTicks = parsedMax;
          }
        }

        while (currentTimer >= interval && currentCount < maxTicks) {
          currentTimer -= interval;
          currentCount++;
          if (listener.evaluate(ctx, listener.equipper)) {
            if (listener.hitMults && listener.hitMults.length > 0) {
              const finalHitMults = listener.hitMults.map(mult => {
                if (typeof mult === 'string' && mult.startsWith('MATH(')) {
                  const mathStr = mult.substring(5, mult.length - 1);
                  return DSLParser.evaluateMath(mathStr, ctx, listener.equipper);
                }
                return mult;
              });
              triggeredEffects.push({
                type: 'procced_mechanic',
                source: listener.name,
                provider: listener.equipper || activeUnitName,
                mechanicData: { ...listener, hitMults: finalHitMults }
              } as any);
            }
            (listener.effects || []).forEach(eff => {
              const resolvedEffect: Effect = { ...eff };
              if (!resolvedEffect.source) resolvedEffect.source = listener.name;
              if (resolvedEffect.target === '@Equipper') resolvedEffect.target = listener.equipper;
              const p = resolvedEffect.provider;
              if (!p || p === 'System' || p === '@Equipper' || p === listener.name || p === listener.provider) {
                resolvedEffect.provider = listener.equipper || activeUnitName;
              }
              triggeredEffects.push(resolvedEffect);
            });
          }
        }

        if (stateData) {
          if (!stateData.trackers) stateData.trackers = {};
          stateData.trackers[timerKey] = currentTimer;
          stateData.trackers[countKey] = currentCount;
        }
      } else if (eventType === 'AfterHit') {
        // NOTE: db.ts's tooltip docs AfterHit(n) as a seconds delay, but this treats it as a
        // hit-index/count filter instead -- pre-existing discrepancy, left as-is.
        const reqHit = (listener.requiredModifiers && listener.requiredModifiers.length > 0) ? listener.requiredModifiers[0] : null;
        const { hitIndex, totalHits } = extraPayload || { hitIndex: 1, totalHits: 1 };
        let matchesHit = true;
        if (reqHit !== null && reqHit !== undefined && reqHit !== 'self') {
          const reqHitStr = String(reqHit).toLowerCase();
          if (reqHitStr === 'all') {
            matchesHit = (hitIndex === totalHits);
          } else {
            matchesHit = (hitIndex === parseInt(reqHit, 10));
          }
        }

        if (matchesHit && listener.evaluate(ctx, listener.equipper)) {
          (listener.effects || []).forEach(eff => {
            const resolvedEffect: Effect = { ...eff };
            if (!resolvedEffect.source) resolvedEffect.source = listener.name;
            if (resolvedEffect.target === '@Equipper') resolvedEffect.target = listener.equipper;
            const p = resolvedEffect.provider;
            if (!p || p === 'System' || p === '@Equipper' || p === listener.name || p === listener.provider) {
              resolvedEffect.provider = listener.equipper || activeUnitName;
            }
            triggeredEffects.push(resolvedEffect);
          });
          if (listener.cooldown) {
            triggeredEffects.push({
              type: 'cooldown',
              name: listener.name,
              target: listener.equipper,
              value: listener.cooldown
            });
          }
        }
      } else {
        if (listener.evaluate(ctx, listener.equipper)) {
          if ((listener.hitMults && listener.hitMults.length > 0) && (!isAlways || eventType === 'ALWAYS')) {
            const finalHitMults = listener.hitMults.map(mult => {
              if (typeof mult === 'string' && mult.startsWith('MATH(')) {
                const mathStr = mult.substring(5, mult.length - 1);
                return DSLParser.evaluateMath(mathStr, ctx, listener.equipper);
              }
              return mult;
            });
            triggeredEffects.push({
              type: 'procced_mechanic',
              source: listener.name,
              provider: listener.equipper || activeUnitName,
              mechanicData: { ...listener, hitMults: finalHitMults }
            } as any);
          }
          (listener.effects || []).forEach(eff => {
            if (isAlways && eventType !== 'ALWAYS' && eff.type && eff.type !== 'buff') return;
            const resolvedEffect: Effect = { ...eff };
            if (!resolvedEffect.source) resolvedEffect.source = listener.name;
            if (resolvedEffect.target === '@Equipper') resolvedEffect.target = listener.equipper;
            const p = resolvedEffect.provider;
            if (!p || p === 'System' || p === '@Equipper' || p === listener.name || p === listener.provider) {
              resolvedEffect.provider = listener.equipper || activeUnitName;
            }
            triggeredEffects.push(resolvedEffect);
          });
          if (listener.cooldown && (!isAlways || eventType === 'ALWAYS')) {
            triggeredEffects.push({
              type: 'cooldown',
              name: listener.name,
              target: listener.equipper,
              value: listener.cooldown
            });
          }
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