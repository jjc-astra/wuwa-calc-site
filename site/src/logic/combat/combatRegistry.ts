// Unified registry for buff-stat scopes, sheet field mappings, and classification rules.
import type { BuffTotals } from '../../types';

export const CAST_SCOPES = ['basic', 'heavy', 'skill', 'lib', 'intro', 'outro', 'coordinated'] as const;
export const ELEMENT_SCOPES = ['glacio', 'fusion', 'electro', 'aero', 'spectro', 'havoc', 'physical'] as const;

export const ALL_SCOPES: readonly string[] = [...CAST_SCOPES, ...ELEMENT_SCOPES];

// Maps scopes to hit-tags in aggregateBuffTotals; accepts both 'liberation' and 'lib'.
export const SCOPE_HIT_TAGS: Record<string, string[]> = {
  basic: ['basic'], heavy: ['heavy'], skill: ['skill'], lib: ['liberation', 'lib'],
  intro: ['intro'], outro: ['outro'], coordinated: ['coordinated'],
  glacio: ['glacio'], fusion: ['fusion'], electro: ['electro'], aero: ['aero'],
  spectro: ['spectro'], havoc: ['havoc'], physical: ['physical']
};

// Maps scopes to sheet properties for flat "<Scope> DMG Bonus" (calculateFinalStats only).
export const SHEET_DMG_BONUS_KEY: Record<string, string> = {
  basic: 'basicDmgBonus', heavy: 'heavyDmgBonus', skill: 'skillDmgBonus', lib: 'libDmgBonus',
  glacio: 'glacioDmgBonus', fusion: 'fusionDmgBonus', electro: 'electroDmgBonus', aero: 'aeroDmgBonus',
  spectro: 'spectroDmgBonus', havoc: 'havocDmgBonus', physical: 'physicalDmgBonus'
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
];

export const SCOPEABLE_MOD_LABELS = [
  'DMG Bonus', 'DMG Amp', 'Deepen', 'DMG Taken', 'Ignore RES', 'Ignore DEF', 'Additive Mult', 'Multiplicative Mult'
];

// Guards against autocomplete and parser alias drift in dev.
if (import.meta.env?.DEV) {
  [...new Set([...UNSCOPED_MOD_LABELS, ...SCOPEABLE_MOD_LABELS])].forEach(label => {
    const sLower = label.toLowerCase();
    const matched = MULTIPLIER_BUCKET_RULES.some(rule => rule.aliases.some(a => sLower.includes(a)))
      || DMG_BONUS_FALLBACK_ALIASES.some(a => sLower.includes(a));
    if (!matched) console.warn(`[combatRegistry] "${label}" has no matching MULTIPLIER_BUCKET_RULES alias -- autocomplete/engine drift.`);
  });
}