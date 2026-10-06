import type { MechanicNode, EnemyStats } from '../types';
import { toFrames } from '../utils/Frames';
import { FORTE_SLOTS, deltaKey, forteKey } from '../utils/ResourceKeys';
import { CAST_TYPES, ELEMENTS, NEGATIVE_STATUSES, elementBonusKey } from './gameVocab';
import type { CastType } from './gameVocab';

// Public/images subfolder names, single-sourced so icon path builders stay in sync.
export const IMAGE_FOLDERS = {
  CHARACTERS: 'characters',
  WEAPONS: 'weapons',
  ECHOES: 'echoes',
  ECHO_SETS: 'echo sets',
  SYSTEM: 'system'
} as const;

export type ImageFolder = typeof IMAGE_FOLDERS[keyof typeof IMAGE_FOLDERS];

export const SITE_FEATURES = {
  SHOW_DISCORD_BUTTON: false,
  SHOW_SUPPORT_BUTTON: false
};

export const SITE_LINKS = {
  DISCORD_INVITE_URL: 'https://discord.gg/REPLACE_ME',
  PATREON_URL: 'https://patreon.com/REPLACE_ME',
  KOFI_URL: 'https://ko-fi.com/REPLACE_ME'
};

export const MECHANICS_NOTATION = {
  HOLD_DEFAULTS: {
    CURSOR_SPEED: 100,
    CURSOR_MODE: 'pingpong' as const,
    RETAIN_CURSOR: false,
    FORTE_SLOT: forteKey(1),
    WINDOW_CENTER: '65',
    WINDOW_SIZE: '10'
  }
};

// A mechanic's `input` tag -> the physical key/click the Timeline's input flags label it with.
export const INPUT_KEY_MAP: Record<string, string> = {
  Basic: 'Left Click',
  Skill: 'E',
  Liberation: 'R',
  Echo: 'Q',
  Utility: 'T',
  Dodge: 'Shift',
  Jump: 'Space'
};

// Echo layouts: each slot's cost, slot by slot.
export const SET_LAYOUTS = ['4 3 3 1 1', '4 4 1 1 1', '4 1 1 1 1'];

// The main stats an echo of each cost can roll, in dropdown order, with their values.
export const MAIN_STAT_VALUES: Record<number, Record<string, number>> = {
  4: { 'CR Rate': 22.0, 'CR DMG': 44.0, 'ATK %': 33.0, 'HP %': 33.0, 'DEF %': 41.8, 'Healing Bonus': 26.4 },
  3: { 'Fusion DMG': 30.0, 'Electro DMG': 30.0, 'Aero DMG': 30.0, 'Spectro DMG': 30.0, 'Havoc DMG': 30.0, 'Glacio DMG': 30.0, 'ATK %': 30.0, 'HP %': 30.0, 'DEF %': 38.0, 'ER %': 32.0 },
  1: { 'ATK %': 18.0, 'HP %': 22.8, 'DEF %': 22.8 }
};

export const SECONDARY_MAIN_STATS: Record<number, { stat: string; value: number }> = {
  4: { stat: 'flatAtk', value: 150 },
  3: { stat: 'flatAtk', value: 100 },
  1: { stat: 'flatHP', value: 2280 }
};

const COMMON_DMG_PCT = [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6];

export const STAT_DB: Record<string, { values: number[]; defaultIndex: number }> = {
  'CR Rate': { values: [6.3, 6.9, 7.5, 8.1, 8.7, 9.3, 9.9, 10.5], defaultIndex: 2 },
  'CR DMG': { values: [12.6, 13.8, 15.0, 16.2, 17.4, 18.6, 19.8, 21.0], defaultIndex: 2 },
  'ATK %': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'HP %': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'DEF %': { values: [8.1, 9.0, 10.0, 10.9, 11.8, 12.8, 13.8, 14.7], defaultIndex: 3 },
  'ER %': { values: [6.8, 7.6, 8.4, 9.2, 10.0, 10.8, 11.6, 12.4], defaultIndex: 3 },
  'Skill DMG': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'Basic DMG': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'Heavy DMG': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'Lib DMG': { values: COMMON_DMG_PCT, defaultIndex: 3 },
  'HP': { values: [320, 360, 390, 430, 470, 510, 540, 580], defaultIndex: 3 },
  'ATK': { values: [30, 40, 50, 60], defaultIndex: 1 },
  'DEF': { values: [40, 50, 60, 70], defaultIndex: 1 }
};

// Flat ATK/HP/DEF rolls are plain numbers; every other substat is a percentage.
const FLAT_SUBSTATS = new Set(['ATK', 'HP', 'DEF']);
// A stat value as shown: "7.5%", or "40" for a flat roll.
export const formatStatValue = (stat: string, value: number): string => (FLAT_SUBSTATS.has(stat) ? `${value}` : `${value}%`);

export const STAT_NAME_MAP: Record<string, string> = {
  'HP': 'flatHP',
  'HP %': 'percentHP',
  'ATK': 'flatAtk',
  'ATK %': 'percentAtk',
  'DEF': 'flatDef',
  'DEF %': 'percentDef',
  'CR Rate': 'critRate',
  'CR DMG': 'critDamage',
  'ER %': 'energyRegen',
  'Healing Bonus': 'healingBonus',
  'Skill DMG': 'skillDmgBonus',
  'Basic DMG': 'basicDmgBonus',
  'Heavy DMG': 'heavyDmgBonus',
  'Lib DMG': 'libDmgBonus',
  'Tune Break Boost': 'tuneBreakBoost',
  'Off-Tune Buildup Rate': "offTuneBuildupRate",
  'Forte Buildup Rate': "forteBuildupRate",
  ...Object.fromEntries(ELEMENTS.map(element => [`${element} DMG`, elementBonusKey(element)]))
};

// Buildup-rate sheet stats (percent, base CHARACTER_DEFAULTS.buildupRate), each scaling a unit's
// gains of one resource -- 'forte' covers every Forte slot. Energy's equivalent is Energy Regen.
export const BUILDUP_RATE_STATS: Record<string, string> = {
  offTuneBuildupRate: 'tune',
  forteBuildupRate: 'forte'
};

export const DEFAULT_SUBSTATS = ['CR Rate', 'CR DMG', 'ATK %', 'ER %', 'ATK'];

// An empty substat slot's name.
export const EMPTY_SUBSTAT = 'N/A';

// A substat's default roll value ('' for an empty or unknown one).
export const defaultRoll = (stat: string): number | '' => {
  const entry = STAT_DB[stat];
  return entry ? entry.values[entry.defaultIndex] : '';
};

// What a slot uses until told otherwise, and for a layout name nobody recognizes.
export const DEFAULT_ECHO_LAYOUT = SET_LAYOUTS[0];

// The five echo costs of a layout, slot by slot.
export const costsForLayout = (layout?: string): number[] =>
  (layout && SET_LAYOUTS.includes(layout) ? layout : DEFAULT_ECHO_LAYOUT).split(' ').map(Number);

// The main stats an echo of this cost can roll.
export const mainStatOptionsFor = (cost: number): string[] => Object.keys(MAIN_STAT_VALUES[cost] ?? MAIN_STAT_VALUES[1]);

export const SIM_CONSTANTS = {
  MAX_SEQUENCE: 6,
  // Weapon ranks run R1..R5.
  MAX_RANK: 5,
  LEVEL_CAP: 90,
  // Tune Break/Rupture dmg = hitMults% * this base (calcTuneDmg). Also read by formatDamageBreakdown.
  TUNE_BASE_DMG: 10027,
  // Negative-status damage = (getNegativeStatusMult(status, stacks) / this) * ENEMY_DEFAULTS.statusBaseDmg.
  NEGATIVE_STATUS_BASE_MULT: 10000
};

// FRAMES @ 60fps: swapTime, comboWindow, echoSummonTime, holdLookahead*.
// SECONDS (cooldown/buff-lifetime): swapCooldown, permanentDuration.
export const GAME_DEFAULTS = {
  swapTime: 9,
  swapCooldown: 1.0,
  comboWindow: 30,
  echoSummonTime: 10,
  permanentDuration: 9999,
  holdLookaheadMax: 300,
  holdLookaheadStep: 1,
  basicPriority: 0,
  heavyPriority: 50,
  skillPriority: 100,
  echoPriority: 200,
  dodgePriority: 500,
  jumpPriority: 500,
  libPriority: 1000,
  introPriority: 2000,
  outroPriority: 3000
};

export const CHARACTER_DEFAULTS = {
  baseCritRate: 5,
  baseCritDmg: 150,
  energyRegen: 100,
  buildupRate: 100,
  maxEnergy: 100,
  maxConcerto: 100,
  maxForte: 100,
  maxTune: 100,
  rarity: 5,
  sequence: 0,
  rank: 1,
  forteCount: 1,
  defaultStance: 'Grounded'
};

export const ENEMY_DEFAULTS = {
  level: 100,
  res: 20,
  hp: 3000000,
  maxTune: 40,
  statusBaseDmg: 3674
};

// A fresh copy of the default target's user-settable stats.
export const defaultEnemyStats = (): EnemyStats => ({ level: ENEMY_DEFAULTS.level, res: ENEMY_DEFAULTS.res, hp: ENEMY_DEFAULTS.hp });

export const BUILDER_CATEGORIES = [
  'Basic Attack', 'Resonance Skill', 'Resonance Liberation',
  'Forte Circuit', 'Intro', 'Outro', 'Inherent Skill', 'Tune Break', 'Resonance Chain'
];

const CAST_OPTIONS: string[] = [...CAST_TYPES];

// Non-elemental cast-type colors, distinct from ELEMENT_COLORS (utils/Common.ts) for dmg types.
export const CAST_TYPE_COLORS: Record<string, string> = ({
  Basic: '#8fa8c9',
  Heavy: '#e0a050',
  Skill: '#5fb0e0',
  Liberation: '#b083e8',
  Intro: '#6fcf8f',
  Outro: '#e06f6f',
  Coordinated: '#e0c050',
  TuneBreak: '#e0708f',
  TuneRupture: '#c94f6f',
  TuneHack: '#b23458',
  Dodge: '#9a9a9a',
  Jump: '#9a9a9a',
  Echo: '#4fd0c0',
  Utility: '#9a9a9a',
  Heal: '#7fd68a'
} satisfies Record<CastType, string>);

// The types a hit can be tagged with: the damage-bearing cast types, elements, statuses, then the
// remaining ones.
const DMG_CAST_TYPES = ['Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Coordinated'] as const satisfies readonly CastType[];
const DMG_EXTRA_TYPES = ['Echo', 'TuneBreak', 'TuneRupture', 'TuneHack'] as const satisfies readonly CastType[];
const DMG_OPTIONS: string[] = [...DMG_CAST_TYPES, ...ELEMENTS, ...NEGATIVE_STATUSES, ...DMG_EXTRA_TYPES];

// Hover copy for the sheet stats offered by the 'eff-stat' autocomplete mode (Stat Modifier effect
// target field). The combat-modifier tooltips are beside their labels in logic/combat/combatRegistry.ts;
// the DSL pointer/event/modifier/property vocabulary's live in logic/dsl/dslRegistry.ts.
export const SHEET_STAT_TOOLTIPS: Record<string, string> = {
  HP: 'Flat HP stat modifier.',
  'HP %': "Percentage increase to HP, added to the character's base HP contribution.",
  ATK: 'Flat ATK stat modifier.',
  'ATK %': "Percentage increase to ATK, added to the character's base ATK contribution.",
  DEF: 'Flat DEF stat modifier.',
  'DEF %': "Percentage increase to DEF, added to the character's base DEF contribution.",
  'CR Rate': 'Critical Rate — chance for a hit to crit.',
  'CR DMG': 'Critical DMG — bonus damage multiplier applied on a crit.',
  'ER %': 'Energy Regen — increases Resonance Energy generated per hit/action (not Energy granted by effects).',
  'Healing Bonus': 'Increases the amount healed by healing effects.',
  'Tune Break Boost': "Flat Tune Break Boost, added to the character's base (read with @Self.Stat(tuneBreakBoost)).",
  'Off-Tune Buildup Rate': "Rate this unit builds up Off-Tune (Tune) on the enemy from its moves' casts and hits (not effects). Base 100%, like Energy Regen; a buff adds to it.",
  'Forte Buildup Rate': "Rate this unit gains every Forte resource from its moves' casts and hits (not effects). Base 100%, like Energy Regen; a buff adds to it."
};

// The sheet stats a Stat Modifier effect offers, in the order above.
const STAT_OPTIONS = Object.keys(SHEET_STAT_TOOLTIPS);

// actionDuration/freezeTime/motionStop are frames at 60fps; cooldown stays seconds.
const BUILDER_TEMPLATES: Record<string, MechanicNode> = {
  'Basic Attack': {
    name: 'Basic Attack 1',
    castTypes: ['Basic'],
    dmgTypes: ['Glacio', 'Basic'],
    hitMults: ['50%'],
    actionDuration: toFrames(30),
    swapTiming: '@Default.SwapTime',
    comboWindow: '@Default.ComboWindow',
    isSwapInDefault: true,
    input: 'Basic',
    stanceReq: 'Grounded'
  },
  'Resonance Skill': {
    name: 'Resonance Skill',
    castTypes: ['Skill'],
    dmgTypes: ['Glacio', 'Skill'],
    hitMults: ['100%'],
    actionDuration: toFrames(48),
    cooldown: 10.0,
    input: 'Skill',
    priority: 100,
    stanceReq: 'Any'
  },
  'Resonance Liberation': {
    name: 'Resonance Liberation',
    castTypes: ['Liberation'],
    dmgTypes: ['Glacio', 'Liberation'],
    hitMults: ['200%'],
    actionDuration: toFrames(126),
    freezeTime: toFrames(120),
    motionStop: toFrames(120),
    cooldown: 25.0,
    triggerRule: 'IF (@Self.Energy >= @Self.MaxEnergy)',
    comboWindow: '@Default.ComboWindow',
    input: 'Liberation',
    priority: 1000,
    stanceReq: 'Any',
    stanceChanges: [{ stance: 'Grounded', time: toFrames(0) }]
  },
  'Forte Circuit': {
    name: 'Forte Heavy Attack',
    castTypes: ['Heavy'],
    dmgTypes: ['Glacio', 'Heavy'],
    hitMults: ['150%'],
    actionDuration: toFrames(60),
    triggerRule: 'IF (@Self.Forte1 >= @Self.MaxForte1)',
    input: 'Basic',
    inputType: 'Hold',
    stanceReq: 'Grounded'
  },
  // Paired with 'Forte Release' below to demo the Press->Release hold-cursor system: this move
  // starts the hold (Hold_Start), the Release move (matched by shared `input`) carries the
  // holdConfig that TimelineEngine reads to auto-wait/track the cursor. See
  // TimelineEngine._handleTracker's 'Hold_Start' branch and HoldConfig in types/index.ts.
  'Forte Hold Press': {
    name: 'Forte Hold Press',
    castTypes: ['Heavy'],
    actionDuration: toFrames(20),
    input: 'Basic',
    inputType: 'Hold',
    stanceReq: 'Grounded',
    effects: [{ type: 'tracker', name: 'Hold_Start', action: 'set', value: '@Move.GameTimeStart' }]
  },
  'Forte Release': {
    name: 'Forte Hold Release',
    castTypes: ['Heavy'],
    dmgTypes: ['Glacio', 'Heavy'],
    hitMults: ['200%'],
    actionDuration: toFrames(30),
    input: 'Basic',
    inputType: 'Release',
    stanceReq: 'Grounded',
    effects: [{ type: 'tracker', name: 'Hold_Start', action: 'delete' }],
    holdConfig: {
      cursorSpeed: 100,
      cursorMode: 'pingpong',
      retainCursor: false,
      forteSlot: 'forte1',
      windowCenter: '50',
      windowSize: '20'
    }
  },
  'Intro Skill': {
    name: 'Intro Skill',
    isSwapInDefault: true,
    triggerRule: "IF (@Prev.CastTypes.includes('Outro'))",
    castTypes: ['Intro'],
    castResources: { concerto: 10 },
    dmgTypes: ['Glacio', 'Intro'],
    hitMults: ['100%'],
    actionDuration: toFrames(60),
    comboWindow: '@Default.ComboWindow',
    stanceReq: 'Any',
    stanceChanges: [{ stance: 'Grounded', time: toFrames(0) }],
    priority: 1000
  },
  'Outro Skill': {
    name: 'Outro Skill',
    castResources: { concerto: -100 },
    triggerRule: 'IF (@Self.Concerto >= 100)',
    effects: [
      { type: 'buff', name: 'Outro Buff', target: '@Next', duration: 14.0, stat: 'Deepen', value: '20%', removeOnSwap: true }
    ]
  },
  'Inherent Skill': {
    name: 'Inherent Skill 1',
    isPassive: true,
    triggerRule: 'ALWAYS',
    effects: [
      { type: 'buff', name: 'Inherent Buff', target: '@Self', duration: '@Default.PermanentDuration', stat: 'ATK %', value: '10%' }
    ]
  },
  // Keep castTypes/dmgTypes as ['TuneBreak']/['TuneRupture'] -- CombatCalculator routes on this to calcTuneDmg.
  'Tune Break': {
    name: 'Tune Break',
    triggerRule: 'IF (@Enemy.Tune >= 40)',
    castTypes: ['TuneBreak'],
    dmgTypes: ['TuneBreak'],
    castResources: { tune: -40 },
    hitMults: [1600],
    actionDuration: toFrames(120),
    freezeTime: toFrames(120),
    motionStop: toFrames(120),
    priority: '@Default.IntroPriority - 10'
  },
  'Resonance Chain': {
    name: 'Sequence 1',
    isPassive: true,
    triggerRule: 'IF (@Self.Sequence >= 1)',
    effects: [
      { type: 'buff', name: 'S1 Buff', target: '@Self', duration: '@Default.PermanentDuration', stat: 'CR Rate', value: '10%' }
    ]
  }
};

export const BuilderState = {
  categories: BUILDER_CATEGORIES,
  CAST_OPTIONS,
  DMG_OPTIONS,
  STAT_OPTIONS,
  templates: BUILDER_TEMPLATES
};

export interface PanelTag { label: string; key?: string; keys?: string[]; default?: string; suffix?: string; highlight?: string; }
export interface PanelStat { label: string; key: string; suffix?: string; }
export interface PanelField { label: string; key: string; default: string | number; suffix?: string; highlight?: string; }
export interface PanelFieldGroup { title: string; fields: PanelField[]; }

export type PanelConfig =
  | { title: string; type: 'complex_dmg'; tags: PanelTag[]; stats: PanelStat[] }
  | { title: string; type: 'complex_time'; groups: PanelFieldGroup[] }
  | { title: string; type: 'gauge'; fields: PanelField[] };

// A gauge panel: what the last move generated of a resource, and where it stands now.
const gaugePanel = (
  title: string,
  key: string,
  defaults: { generated: string; current: string; currentLabel?: string; suffix?: string }
): PanelConfig => ({
  title,
  type: 'gauge',
  fields: [
    { label: 'Generated', key: deltaKey(key), default: defaults.generated, suffix: defaults.suffix },
    { label: defaults.currentLabel ?? 'Current', key, default: defaults.current, suffix: defaults.suffix }
  ]
});

export const PANEL_CONFIG: Record<string, PanelConfig> = {
  dmg: {
    title: 'Detailed Damage Breakdown',
    type: 'complex_dmg',
    tags: [
      { label: 'Cast Type', key: 'castTypes' },
      { label: 'Damage Type', key: 'dmgTypes' },
      { label: 'Base Multiplier', key: 'baseMult', highlight: 'text-gold' }
    ],
    stats: [
      { label: 'Scalar', key: 'scalar', suffix: '%' },
      { label: 'Crit Rate', key: 'critRate', suffix: '%' },
      { label: 'Crit DMG', key: 'critDmg', suffix: '%' },
      { label: 'DMG Bonus', key: 'dmgBonus', suffix: '%' },
      { label: 'Multiplicative Mult', key: 'multiplicativeMult', suffix: '%' },
      { label: 'Additive Mult', key: 'additiveMult', suffix: '%' },
      { label: 'DMG Amp', key: 'dmgAmp', suffix: '%' },
      { label: 'DMG Taken Inc', key: 'dmgTaken', suffix: '%' },
      { label: 'RES Shred', key: 'reduceRes', suffix: '%' },
      { label: 'RES Ignore', key: 'ignoreRes', suffix: '%' },
      { label: 'DEF Shred', key: 'reduceDef', suffix: '%' },
      { label: 'DEF Ignore', key: 'ignoreDef', suffix: '%' }
    ]
  },
  concerto: gaugePanel('Concerto Energy Breakdown', 'concerto', { generated: '+0', current: '0' }),
  energy: gaugePanel('Resonance Energy Breakdown', 'energy', { generated: '+0.0', current: '0.0' }),
  tune: gaugePanel('Tune Break Build Breakdown', 'tune', { generated: '+0', current: '0', currentLabel: 'Tune Progress', suffix: '%' }),
  time: {
    title: 'Advanced Timeline Breakdown',
    type: 'complex_time',
    groups: [
      {
        title: 'Execution Timings',
        fields: [
          { label: 'Real Time Start', key: 'timeStart', default: 0, suffix: 's' },
          { label: 'Game Time Start', key: 'gameTimeStart', default: 0, suffix: 's' },
          { label: 'Wait Time (CD/Busy)', key: 'waitTime', default: 0, suffix: 's' }
        ]
      },
      {
        title: 'Action Duration Details',
        fields: [
          { label: 'Base Duration', key: 'baseDuration', default: 0, suffix: 's' },
          { label: 'Actual Duration', key: 'duration', default: 0, suffix: 's' },
          { label: 'Game Time Passed', key: 'gameTimePassed', default: 0, suffix: 's' },
          { label: 'Time Stop / Freeze', key: 'freezeTime', default: 0, suffix: 's' },
          { label: 'Motion Stop', key: 'motionStop', default: 0, suffix: 's' }
        ]
      },
      {
        title: 'Accumulated Timeline Cost',
        fields: [
          { label: 'Total Real Time Cost', key: 'totalRealTimeCost', default: 0, suffix: 's' },
          { label: 'Total Game Time Cost', key: 'totalGameTimeCost', default: 0, suffix: 's' }
        ]
      }
    ]
  },
  offset: {
    title: 'Action Alignment Breakdown',
    type: 'gauge',
    fields: [
      { label: 'Offset Value', key: 'offset', default: '0.00', highlight: 'text-main' }
    ]
  }
};

for (const slot of FORTE_SLOTS) {
  PANEL_CONFIG[forteKey(slot)] = gaugePanel(`Forte ${slot} Breakdown`, forteKey(slot), { generated: '+0', current: '0' });
}