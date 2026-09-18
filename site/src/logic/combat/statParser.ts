import { ALL_SCOPES, MULTIPLIER_BUCKET_RULES, DMG_BONUS_FALLBACK_ALIASES, SHEET_DMG_BONUS_KEY } from './combatRegistry';
import type { BuffTotals } from '../../types';

// Returns the move-type or elemental scope named in the stat string, if any.
export function findScope(sLower: string): string | null {
  return ALL_SCOPES.find(s => sLower.includes(s)) ?? null;
}

// Maps a stat string to a live combat BuffTotals bucket in priority order:
// specific multiplier rules -> base stat splits -> damage bonus fallback.
export function resolveMultiplierBucket(sLower: string, isPct: boolean): keyof BuffTotals | null {
  for (const rule of MULTIPLIER_BUCKET_RULES) {
    if (rule.aliases.some(a => sLower.includes(a))) return rule.bucket;
  }
  if (sLower.includes('atk')) return isPct ? 'percentAtk' : 'flatAtk';
  if (sLower.includes('hp')) return isPct ? 'percentHP' : 'flatHP';
  if (sLower.includes('def')) return isPct ? 'percentDef' : 'flatDef';
  if (DMG_BONUS_FALLBACK_ALIASES.some(a => sLower.includes(a))) return 'dmgBonus';
  return null;
}

// Maps a scoped damage bonus string to its static sheet property; returns null for non-sheet combat buckets.
export function resolveSheetDmgBonusKey(sLower: string): string | null {
  const scope = findScope(sLower);
  if (!scope || !sLower.includes('dmg')) return null;
  return SHEET_DMG_BONUS_KEY[scope] ?? null;
}