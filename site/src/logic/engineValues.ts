// Shared simulation value helpers.
import type { Effect } from '../types';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';

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
