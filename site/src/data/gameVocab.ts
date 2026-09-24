// The game's fixed vocabulary, each list written once: damage elements, negative statuses, cast
// types and the sheet stat keys they generate. Everything that offers, colors, validates or
// documents these (DSL modifiers, dropdowns, tooltips, stat maps) derives from here, so adding
// one is an edit in this file plus the typed tables the compiler then points out.

export const ELEMENTS = ['Spectro', 'Fusion', 'Glacio', 'Aero', 'Electro', 'Havoc', 'Physical'] as const;
export type ElementName = typeof ELEMENTS[number];

export const isElement = (value: string): value is ElementName => (ELEMENTS as readonly string[]).includes(value);

export const NEGATIVE_STATUSES = [
  'Spectro Frazzle', 'Aero Erosion', 'Electro Flare', 'Electro Rage', 'Fusion Burst', 'Glacio Chafe', 'Havoc Bane'
] as const;
export type NegativeStatus = typeof NEGATIVE_STATUSES[number];

export const CAST_TYPES = [
  'Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Coordinated',
  'TuneBreak', 'TuneRupture', 'TuneHack', 'Dodge', 'Jump', 'Echo', 'Utility', 'Heal'
] as const;
export type CastType = typeof CAST_TYPES[number];

// The cast types a hit's damage is bucketed by in the Results pie (deliberately dmgTypes, not
// castTypes -- a move's cast/animation category can differ from its dmg-bonus-scaling one).
export const PRIMARY_DMG_TYPES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Echo'] as const satisfies readonly CastType[];

// Sheet damage-bonus stats: one per element and one per move type ("Liberation" is "lib").
export type ElementBonusKey = `${Lowercase<ElementName>}DmgBonus`;
export const elementBonusKey = (element: ElementName): ElementBonusKey => `${element.toLowerCase() as Lowercase<ElementName>}DmgBonus`;

const MOVE_BONUS_KEYS = ['skillDmgBonus', 'basicDmgBonus', 'heavyDmgBonus', 'libDmgBonus'] as const;

// Every stat an echo build can grant, as the keys of a slot's `echoStats` and of the sheet.
export type EchoStatKey =
  | 'flatHP' | 'percentHP' | 'flatAtk' | 'percentAtk' | 'flatDef' | 'percentDef'
  | 'critRate' | 'critDamage' | 'energyRegen' | 'healingBonus'
  | typeof MOVE_BONUS_KEYS[number] | ElementBonusKey;

export const ECHO_STAT_KEYS: readonly EchoStatKey[] = [
  'flatHP', 'percentHP', 'flatAtk', 'percentAtk', 'flatDef', 'percentDef',
  'critRate', 'critDamage', 'energyRegen', 'healingBonus',
  ...MOVE_BONUS_KEYS,
  ...ELEMENTS.map(elementBonusKey)
];

export function emptyEchoStats(): Record<EchoStatKey, number> {
  return Object.fromEntries(ECHO_STAT_KEYS.map(key => [key, 0])) as Record<EchoStatKey, number>;
}
