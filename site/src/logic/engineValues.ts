// Small value helpers the simulation shares: telling DSL expressions from plain values, the
// ALL/HALF/N spend rule, the lowercase modifier sets events are matched on, and effect/key shapes.
import type { Effect } from '../types';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';

const ARITHMETIC = /[+\-*/]/;
const ARITHMETIC_OR_PERCENT = /[+\-*/%]/;

// A string that has to be evaluated against the row (an @pointer or arithmetic) rather than
// read as a literal. `allowPercent` also treats a bare "%" as arithmetic, for fields where
// "50%" is itself an expression.
export function isDslExpr(value: unknown, allowPercent = false): value is string {
  return typeof value === 'string' && (value.includes('@') || (allowPercent ? ARITHMETIC_OR_PERCENT : ARITHMETIC).test(value));
}

// What's left of `current` after spending `spec` ("ALL", "HALF", or a count -- 1 if unreadable).
// `whole` reads a count as an integer, for stacks; trackers allow fractions.
export function stacksAfterSpending(current: number, spec: unknown, whole: boolean): number {
  if (spec === 'HALF') return Math.floor(current / 2);
  if (spec === 'ALL') return 0;
  const count = whole ? parseInt(String(spec), 10) : parseFloat(String(spec));
  return current - (count || 1);
}

// The lowercase set a hit/cast/proc is matched against by `OnHit[...]`-style modifiers.
export const modifierSet = (parts: unknown[]): Set<string> => new Set(parts.map(part => String(part).toLowerCase()));

// The one-name set a buff or tracker event fires with. Lowercase, since `Event[Name]` brackets
// are lowercased when the DSL is parsed (dslParser.ts).
export const eventModifier = (name: string | undefined): Set<string> => new Set([(name || '').toLowerCase()]);

// A DSL math result in its expression's form: a "%" expression gives back a percent string ("12.5%").
export const asDslResult = (expr: string, result: number): number | string =>
  expr.includes('%') ? parseFloat((result * 100).toFixed(6)) + '%' : result;

// A DSL value reading a unit's own sheet stats (@Self.Stat(...)).
export const readsSelfStats = (value: unknown): value is string => typeof value === 'string' && value.includes('@Self.Stat(');

// A buff effect (an effect with no type is one).
export const isBuffEffect = (effect: Effect): boolean => !effect.type || effect.type === 'buff';

// The key a buff or cooldown is kept under on a row: whose it is (a unit, Enemy, @Team...) and its name.
export const scopedKey = (scope: string, name: string | undefined): string => `${scope}_${name ?? ''}`;

// A provider that names no unit: unset, System, or the @Equipper placeholder. The effect is then
// credited to whoever it resolves on.
export const isPlaceholderProvider = (provider: string | undefined): boolean =>
  !provider || provider === SYSTEM_NAMESPACE || provider === '@Equipper';
