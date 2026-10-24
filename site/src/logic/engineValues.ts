// Shared simulation value helpers.
import type { Effect, MechanicNode } from '../types';
import { MechanicKey, SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import { isElement } from '../data/gameVocab';
import type { CompiledDSL } from './dsl/dslParser';

const ARITHMETIC = /[+\-*/]/;
const ARITHMETIC_OR_PERCENT = /[+\-*/%]/;

// True for a string needing evaluation (@pointer or arithmetic). `allowPercent`: "%" counts.
export function isDslExpr(value: unknown, allowPercent = false): value is string {
  return typeof value === 'string' && (value.includes('@') || (allowPercent ? ARITHMETIC_OR_PERCENT : ARITHMETIC).test(value));
}

// Remainder after spending "ALL", "HALF" or N (default 1). `whole`: integer counts.
export function stacksAfterSpending(current: number, spec: unknown, whole: boolean): number {
  if (spec === 'HALF') return Math.floor(current / 2);
  if (spec === 'ALL') return 0;
  const count = whole ? parseInt(String(spec), 10) : parseFloat(String(spec));
  return current - (count || 1);
}

// Lowercase modifier set for `OnHit[...]` matching.
export const modifierSet = (parts: unknown[]): Set<string> => new Set(parts.map(part => String(part).toLowerCase()));

// Lowercase single-name modifier set for buff/tracker events.
export const eventModifier = (name: string | undefined): Set<string> => new Set([(name || '').toLowerCase()]);

// "%" expressions return a percent string.
export const asDslResult = (expr: string, result: number): number | string =>
  expr.includes('%') ? parseFloat((result * 100).toFixed(6)) + '%' : result;

export const readsSelfStats = (value: unknown): value is string => typeof value === 'string' && value.includes('@Self.Stat(');

// Untyped effects are buffs.
export const isBuffEffect = (effect: Effect): boolean => !effect.type || effect.type === 'buff';

// Row key for a buff or cooldown: scope + name.
export const scopedKey = (scope: string, name: string | undefined): string => `${scope}_${name ?? ''}`;

// Unset, System, or @Equipper.
export const isPlaceholderProvider = (provider: string | undefined): boolean =>
  !provider || provider === SYSTEM_NAMESPACE || provider === '@Equipper';

/** An event a rule's event part can match: its type, modifiers, and the unit it's for. */
export interface RuleEvent { type: string; modifiers: Set<string>; unit: string }

/** The modifiers a cast is matched on by `OnCast[...]`. */
export function castModifiers(actionId: string, move: MechanicNode, unit: string): Set<string> {
  const origin = MechanicKey.origin(actionId, unit, move.name);
  const elements = (move.dmgTypes || []).filter(isElement);
  return modifierSet([...(move.castTypes || []), ...elements, actionId, move.name, origin.ref]);
}

/** The events a row fires as it starts: its cast, plus the swap events when the unit changes. */
export function rowStartEvents(actionId: string, move: MechanicNode, unit: string, prevUnit?: string): RuleEvent[] {
  const events: RuleEvent[] = [{ type: 'OnCast', modifiers: castModifiers(actionId, move, unit), unit }];
  if (prevUnit && prevUnit !== unit) {
    events.push(
      { type: 'OnSwapOut', modifiers: new Set(), unit: prevUnit },
      { type: 'OnSwapIn', modifiers: new Set(), unit },
      { type: 'OnUnitChange', modifiers: new Set(), unit }
    );
  }
  return events;
}

/**
 * True when a rule's event part allows one of `events`, matched like listeners are.
 * No event part (or ALWAYS): always. `owner` is whose [Self].
 */
export function ruleEventsMatch(compiled: Pick<CompiledDSL, 'triggers'> | null | undefined, events: RuleEvent[], owner: string): boolean {
  const triggers = compiled?.triggers || [];
  if (triggers.length === 0 || triggers.some(trigger => trigger.event === 'ALWAYS')) return true;
  return triggers.some(trigger => events.some(event =>
    event.type === trigger.event
    && trigger.modifiers.every(mod => (mod === 'self' ? event.unit === owner : event.modifiers.has(mod)))
  ));
}

/** A move's priorityTimeline by time (frames), ties in authored order. */
export function sortedPrioritySteps(move: MechanicNode): Array<{ time: number; priority: number | string }> {
  return (move.priorityTimeline || [])
    .map(step => ({ time: parseFloat(String(step.time)) || 0, priority: step.priority }))
    .sort((a, b) => a.time - b.time);
}
