// Unified registry for buff-stat scopes, sheet field mappings, and classification rules.
import type { BuffTotals } from '../../types';
import { ELEMENTS, elementBonusKey } from '../../data/gameVocab';

export const CAST_SCOPES = ['basic', 'heavy', 'skill', 'lib', 'intro', 'outro', 'coordinated'] as const;
export const ELEMENT_SCOPES: readonly string[] = ELEMENTS.map(element => element.toLowerCase());

export const ALL_SCOPES: readonly string[] = [...CAST_SCOPES, ...ELEMENT_SCOPES];

// Maps scopes to hit-tags in aggregateBuffTotals; accepts both 'liberation' and 'lib'.
export const SCOPE_HIT_TAGS: Record<string, string[]> = {
  ...Object.fromEntries(CAST_SCOPES.map(scope => [scope, [scope]])),
  lib: ['liberation', 'lib'],
  ...Object.fromEntries(ELEMENT_SCOPES.map(scope => [scope, [scope]]))
};

// Maps scopes to sheet properties for flat "<Scope> DMG Bonus" (calculateFinalStats only). Intro,
// Outro and Coordinated have no sheet stat -- only a buff can scope to them.
export const SHEET_DMG_BONUS_KEY: Record<string, string> = {
  ...Object.fromEntries((['basic', 'heavy', 'skill', 'lib'] as const).map(scope => [scope, `${scope}DmgBonus`])),
  ...Object.fromEntries(ELEMENTS.map(element => [element.toLowerCase(), elementBonusKey(element)]))
};

type MultiplierBucket = keyof BuffTotals;

// First match wins. Must precede bare atk/hp/def and DMG_BONUS_FALLBACK checks (e.g. DEF Shred -> reduceDef).
export const MULTIPLIER_BUCKET_RULES: { aliases: string[]; bucket: MultiplierBucket }[] = [
  { aliases: ['amp', 'deepen'], bucket: 'dmgAmp' },
  { aliases: ['dmg boost'], bucket: 'dmgBoost' },
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

// Builder autocomplete suggestions (eff-stat mode). Excludes crit and base stats.
export const UNSCOPED_MOD_LABELS = [
  'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Boost', 'DMG Taken', 'Reduce RES', 'RES Shred',
  'Ignore RES', 'RES Pen', 'Reduce DEF', 'DEF Shred', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
] as const;

export const SCOPEABLE_MOD_LABELS = [
  'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Ignore RES', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
] as const satisfies readonly (typeof UNSCOPED_MOD_LABELS[number])[];

// Hover copy for those labels. Typed against UNSCOPED_MOD_LABELS (which already includes every
// scopeable one), so a label can't be offered without a tooltip.
// Formula (CombatCalculator.ts): baseDmg * critMult * (1+DMG Bonus) * (1+DMG Amp/Deepen) *
// (1+DMG Taken) * (1+Multiplicative Mult) * resMult * defMult.
// Any cast type containing "tune" (TuneBreak/TuneRupture/TuneHack/...) routes to calcTuneDmg:
// skips DMG Bonus/crit/scalar; uses DMG Boost instead of Amp/Deepen.
export const MOD_LABEL_TOOLTIPS: Record<typeof UNSCOPED_MOD_LABELS[number], string> = {
  'DMG Bonus': 'Adds to the additive damage-bonus multiplier (1 + Base DMG Bonus + this), applied before crit.',
  'DMG Amp': 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as Deepen.',
  Deepen: 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as DMG Amp.',
  'DMG Boost': 'Tune-only multiplier bucket (TuneBreak/TuneRupture/TuneHack/...): multiplies final Tune damage by (1 + this). Separate from DMG Amp/Deepen, which Tune damage does not use.',
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

// Guards against autocomplete and parser alias drift in dev.
if (import.meta.env?.DEV) {
  [...new Set([...UNSCOPED_MOD_LABELS, ...SCOPEABLE_MOD_LABELS])].forEach(label => {
    const sLower = label.toLowerCase();
    const matched = MULTIPLIER_BUCKET_RULES.some(rule => rule.aliases.some(a => sLower.includes(a)))
      || DMG_BONUS_FALLBACK_ALIASES.some(a => sLower.includes(a));
    if (!matched) console.warn(`[combatRegistry] "${label}" has no matching MULTIPLIER_BUCKET_RULES alias -- autocomplete/engine drift.`);
  });
}