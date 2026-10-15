// Buff-stat scopes, sheet mappings, and classification rules.
import type { BuffTotals } from '../../types';
import { ELEMENTS, elementBonusKey } from '../../data/gameVocab';

const CAST_SCOPES = ['basic', 'heavy', 'skill', 'lib', 'intro', 'outro', 'coordinated'] as const;
const ELEMENT_SCOPES: readonly string[] = ELEMENTS.map(element => element.toLowerCase());

export const ALL_SCOPES: readonly string[] = [...CAST_SCOPES, ...ELEMENT_SCOPES];

// Scope -> hit tags.
export const SCOPE_HIT_TAGS: Record<string, string[]> = {
  ...Object.fromEntries(CAST_SCOPES.map(scope => [scope, [scope]])),
  lib: ['liberation', 'lib'],
  ...Object.fromEntries(ELEMENT_SCOPES.map(scope => [scope, [scope]]))
};

// Scope -> sheet DMG Bonus stat.
export const SHEET_DMG_BONUS_KEY: Record<string, string> = {
  ...Object.fromEntries((['basic', 'heavy', 'skill', 'lib'] as const).map(scope => [scope, `${scope}DmgBonus`])),
  ...Object.fromEntries(ELEMENTS.map(element => [element.toLowerCase(), elementBonusKey(element)]))
};

// "Liberation" -> libDmgBonus
export const sheetDmgBonusKeyForType = (dmgType: string): string | undefined => {
  const tag = dmgType.toLowerCase();
  const scope = Object.keys(SCOPE_HIT_TAGS).find(s => SCOPE_HIT_TAGS[s].includes(tag));
  return scope ? SHEET_DMG_BONUS_KEY[scope] : undefined;
};

type MultiplierBucket = keyof BuffTotals;

// First match wins; checked before bare stats and DMG_BONUS_FALLBACK.
export const MULTIPLIER_BUCKET_RULES: { aliases: string[]; bucket: MultiplierBucket }[] = [
  { aliases: ['amp', 'deepen'], bucket: 'dmgAmp' },
  { aliases: ['taken'], bucket: 'dmgTaken' },
  { aliases: ['multiplicative'], bucket: 'multiplicativeMult' },
  { aliases: ['additive'], bucket: 'additiveMult' },
  { aliases: ['reduce res', 'res shred'], bucket: 'reduceRes' },
  { aliases: ['ignore res', 'res pen'], bucket: 'ignoreRes' },
  { aliases: ['reduce def', 'def shred'], bucket: 'reduceDef' },
  { aliases: ['ignore def'], bucket: 'ignoreDef' },
  { aliases: ['crit rate', 'cr rate'], bucket: 'critRate' },
  { aliases: ['crit dmg', 'cr dmg'], bucket: 'critDamage' }
];

export const DMG_BONUS_FALLBACK_ALIASES = ['dmg bonus', 'dmg%', 'damage bonus', 'dmg'];

// eff-stat suggestions, excluding crit and base stats.
export const UNSCOPED_MOD_LABELS = [
  'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Reduce RES', 'RES Shred',
  'Ignore RES', 'RES Pen', 'Reduce DEF', 'DEF Shred', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
] as const;

export const SCOPEABLE_MOD_LABELS = [
  'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Ignore RES', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
] as const satisfies readonly (typeof UNSCOPED_MOD_LABELS[number])[];

// Tooltips for UNSCOPED_MOD_LABELS.
// Formula: baseDmg * critMult * (1+Bonus) * (1+Amp) * (1+Taken) * (1+Mult) * resMult * defMult.
export const MOD_LABEL_TOOLTIPS: Record<typeof UNSCOPED_MOD_LABELS[number], string> = {
  'DMG Bonus': 'Adds to the additive damage-bonus multiplier (1 + Base DMG Bonus + this), applied before crit.',
  'DMG Amp': 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as Deepen.',
  Deepen: 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as DMG Amp.',
  'DMG Taken': "Multiplies the target's final damage taken by (1 + this), a separate layer from DMG Amp/Deepen.",
  'Reduce RES': "Subtracted directly from the enemy's base Resistance before the resistance multiplier is computed.",
  'RES Shred': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES.",
  'Ignore RES': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES/RES Shred.",
  'RES Pen': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES/RES Shred.",
  'Reduce DEF': "Multiplicatively lowers the enemy's effective Defense in the defense-multiplier formula.",
  'DEF Shred': "Multiplicatively lowers the enemy's effective Defense, identically to Reduce DEF.",
  'Ignore DEF': "Multiplicatively lowers the enemy's effective Defense, identically to Reduce DEF.",
  'Additive Mult': "Adds directly to the move's base % multiplier before it's applied to the scaling stat.",
  'Multiplicative Mult': 'A separate multiplicative layer on final damage: (1 + this), alongside DMG Amp/Deepen and DMG Taken.'
};

// Dev check for autocomplete/parser alias drift.
if (import.meta.env?.DEV) {
  [...new Set([...UNSCOPED_MOD_LABELS, ...SCOPEABLE_MOD_LABELS])].forEach(label => {
    const sLower = label.toLowerCase();
    const matched = MULTIPLIER_BUCKET_RULES.some(rule => rule.aliases.some(a => sLower.includes(a)))
      || DMG_BONUS_FALLBACK_ALIASES.some(a => sLower.includes(a));
    if (!matched) console.warn(`[combatRegistry] "${label}" has no matching MULTIPLIER_BUCKET_RULES alias -- autocomplete/engine drift.`);
  });
}