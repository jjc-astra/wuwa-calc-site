import type { WeaponType, MechanicNode } from '../types';

// Public/images subfolder names, single-sourced so every icon path builder and
// class-selection check (MechanicsBuilder, TeamBuilder, CharacterSlot, BaseStatsForm)
// stays in sync if these folders are ever renamed.
export const IMAGE_FOLDERS = {
  CHARACTERS: 'characters',
  WEAPONS: 'weapons',
  ECHOES: 'echoes',
  ECHO_SETS: 'echo sets',
  SYSTEM: 'system'
} as const;

export type ImageFolder = typeof IMAGE_FOLDERS[keyof typeof IMAGE_FOLDERS];

export const MECHANICS_NOTATION = {
  HOLD_DEFAULTS: {
    CURSOR_SPEED: 100,
    CURSOR_MODE: 'pingpong' as const,
    RETAIN_CURSOR: false,
    MAX_CURSOR_VAL: 100,
    WINDOW_CENTER: '65',
    WINDOW_SIZE: '10'
  },
  GAUGES: {
    DEFAULT_MAX: 100
  }
};

export const INPUT_BINDINGS: Record<string, string> = {
  'Basic': 'Left Click',
  'Skill': 'E',
  'Jump': 'Space',
  'Dodge': 'Right Click / Shift',
  'Liberation': 'R',
  'Utility': 'T',
  'Echo': 'Q'
};

export const SET_LAYOUTS = ['4 3 3 1 1', '4 4 1 1 1'];
export const MAIN_STATS_4_COST = ['CR Rate', 'CR DMG', 'ATK %', 'HP %', 'DEF %', 'Healing Bonus'];
export const MAIN_STATS_3_COST = ['Fusion DMG', 'Electro DMG', 'Aero DMG', 'Spectro DMG', 'Havoc DMG', 'Glacio DMG', 'ATK %', 'HP %', 'DEF %', 'ER %'];
export const MAIN_STATS_1_COST = ['ATK %', 'HP %', 'DEF %'];

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
  'ATK': { values: [30, 40, 50, 60], defaultIndex: 2 },
  'DEF': { values: [40, 50, 60, 70], defaultIndex: 2 }
};

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
  'Glacio DMG': 'glacioDmgBonus',
  'Fusion DMG': 'fusionDmgBonus',
  'Electro DMG': 'electroDmgBonus',
  'Aero DMG': 'aeroDmgBonus',
  'Spectro DMG': 'spectroDmgBonus',
  'Havoc DMG': 'havocDmgBonus'
};

export const DEFAULT_SUBSTATS = ['CR Rate', 'CR DMG', 'ATK %', 'ER %', 'ATK'];
export const CHARS_WITH_MODES = ['Lynae', 'Aemeath'];

export const COST_DISTRIBUTION: Record<string, number[]> = {
  '4 3 3 1 1': [4, 3, 3, 1, 1],
  '4 4 1 1 1': [4, 4, 1, 1, 1]
};

export const SIM_CONSTANTS = {
  DEFAULT_ROW_DURATION: 1.5,
  MAX_SEQUENCE: 6,
  MAX_WEAPON_RANK: 5,
  LEVEL_CAP: 90
};

export const GAME_DEFAULTS = {
  swapTime: 0.15,
  swapCooldown: 1.0,
  comboWindow: 0.5,
  echoSummonTime: 0.17,
  permanentDuration: 9999,
  holdLookaheadMax: 5.0,
  holdLookaheadStep: 0.01,
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
  maxEnergy: 100,
  maxConcerto: 100,
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

export const WEAPONS_BY_TYPE: Record<WeaponType, string[]> = {
  Broadblade: [],
  Sword: [],
  Rectifier: [],
  Gauntlets: [],
  Pistols: []
};

export const DSL_SCHEMA = {
  events: [
    'ALWAYS', 'OnStart', 'OnCast', 'OnHit', 'AfterHit',
    'OnSwapIn', 'OnSwapOut', 'OnChange', 'Detonate', 'OnTick',
    'OnTrackerAdd', 'OnTrackerRemove', 'OnTrackerConsume',
    'OnBuffAdd', 'OnBuffRemove', 'OnBuffUpdate'
  ],
  modifiers: [
    'Self', 'Basic', 'Heavy', 'Skill', 'Liberation',
    'Intro', 'Outro', 'Coordinated', 'TuneBreak', 'TuneRupture',
    'Dodge', 'Jump', 'Echo', 'Utility', 'Heal',
    'Spectro', 'Fusion', 'Glacio', 'Aero', 'Electro', 'Havoc', 'Physical',
    'Defense', 'HP', 'ATK',
    'Spectro Frazzle', 'Aero Erosion', 'Electro Flare', 'Electro Rage', 'Fusion Burst', 'Glacio Chafe'
  ],
  pointers: [
    'Self', 'Enemy', 'Team', 'TeamOthers', 'Active',
    'Next', 'Prev', 'Equipper', 'System', 'Move', 'Default'
  ],
  properties: {
    Self: ['HP', 'Energy', 'Concerto', 'Sequence', 'PrevAction', 'Name', 'BuffStacks()', 'HasBuff()', 'Tracker()', 'Memory()', 'Cooldown()', 'Stat()'],
    Enemy: ['HP', 'MaxHP', 'HPPct', 'BuffStacks()', 'HasBuff()', 'Tune'],
    Move: ['Name', 'CastTypes', 'DmgTypes', 'TimeStart', 'Duration', 'GameTime', 'FreezeTime', 'DamageStart', 'DamageEnd', 'SwapTime', 'BaseMult', 'HitMults'],
    Prev: ['Action', 'CastTypes', 'Unit'],
    Next: ['Name', 'Action', 'CastTypes', 'Priority'],
    Active: ['Name'],
    Default: ['SwapTime', 'ComboWindow', 'EchoSummonTime', 'PermanentDuration', 'BasicPriority', 'HeavyPriority', 'SkillPriority', 'EchoPriority', 'DodgePriority', 'JumpPriority', 'LibPriority', 'IntroPriority', 'OutroPriority']
  }
};

export const BUILDER_CATEGORIES = [
  'Basic Attack', 'Resonance Skill', 'Resonance Liberation',
  'Forte Circuit', 'Intro', 'Outro', 'Inherent Skill', 'Tune Break', 'Resonance Chain'
];

export const CAST_OPTIONS = [
  'Basic', 'Heavy', 'Skill', 'Liberation',
  'Intro', 'Outro', 'Coordinated', 'TuneBreak', 'TuneRupture',
  'Dodge', 'Jump', 'Echo', 'Utility', 'Heal'
];

export const DMG_OPTIONS = [
  'Basic', 'Heavy', 'Skill', 'Liberation', 'Intro', 'Outro', 'Coordinated',
  'Spectro', 'Fusion', 'Glacio', 'Aero', 'Electro', 'Havoc', 'Physical',
  'Spectro Frazzle', 'Aero Erosion', 'Electro Flare', 'Electro Rage',
  'Fusion Burst', 'Glacio Chafe', 'Echo', 'TuneBreak', 'TuneRupture'
];

export const STAT_OPTIONS = [
  'HP', 'HP %', 'ATK', 'ATK %', 'DEF', 'DEF %',
  'CR Rate', 'CR DMG', 'ER %', 'Healing Bonus'
];

export const BUILDER_TEMPLATES: Record<string, MechanicNode> = {
  'Basic Attack': {
    name: 'Basic Attack 1',
    castTypes: ['Basic'],
    dmgTypes: ['Glacio', 'Basic'],
    hitMults: ['50%'],
    actionDuration: 0.5,
    swapTiming: '@Default.SwapTime',
    comboWindow: '@Default.ComboWindow',
    isSwapInDefault: true,
    input: 'Basic',
    inputType: 'Press',
    stanceReq: 'Grounded'
  },
  'Resonance Skill': {
    name: 'Resonance Skill',
    castTypes: ['Skill'],
    dmgTypes: ['Glacio', 'Skill'],
    hitMults: ['100%'],
    actionDuration: 0.8,
    cooldown: 10.0,
    input: 'Skill',
    inputType: 'Press',
    priority: 100,
    stanceReq: 'Any'
  },
  'Resonance Liberation': {
    name: 'Resonance Liberation',
    castTypes: ['Liberation'],
    dmgTypes: ['Glacio', 'Liberation'],
    hitMults: ['200%'],
    actionDuration: 2.1,
    freezeTime: 2.0,
    cooldown: 25.0,
    triggerRule: 'IF (@Self.Energy >= @Self.MaxEnergy)',
    comboWindow: '@Default.ComboWindow',
    input: 'Liberation',
    inputType: 'Press',
    priority: 1000,
    stanceReq: 'Any',
    stanceResult: 'Grounded'
  },
  'Forte Circuit': {
    name: 'Forte Heavy Attack',
    castTypes: ['Heavy'],
    dmgTypes: ['Glacio', 'Heavy'],
    hitMults: ['150%'],
    actionDuration: 1.0,
    triggerRule: 'IF (@Self.Forte1 >= @Self.MaxForte1)',
    input: 'Basic',
    inputType: 'Hold',
    stanceReq: 'Grounded'
  },
  'Forte Release': {
    name: 'Forte Hold Release',
    castTypes: ['Heavy'],
    dmgTypes: ['Glacio', 'Heavy'],
    hitMults: ['200%'],
    actionDuration: 0.5,
    triggerRule: 'IF (@Self.HasBuff(Forte_Holding))',
    input: 'Basic',
    inputType: 'Release',
    stanceReq: 'Grounded',
    holdConfig: {
      cursorSpeed: 100,
      cursorMode: 'pingpong',
      retainCursor: false,
      maxCursorVal: 100,
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
    actionDuration: 1,
    comboWindow: '@Default.ComboWindow',
    stanceReq: 'Any',
    stanceResult: 'Grounded',
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
      { type: 'buff', name: 'Inherent Buff', target: '@Self', duration: 9999, stat: 'ATK %', value: '10%' }
    ]
  },
  'Resonance Chain': {
    name: 'Sequence 1',
    isPassive: true,
    triggerRule: 'IF (@Self.Sequence >= 1)',
    effects: [
      { type: 'buff', name: 'S1 Buff', target: '@Self', duration: 9999, stat: 'CR Rate', value: '10%' }
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

export const PANEL_CONFIG: Record<string, any> = {
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
  concerto: {
    title: 'Concerto Energy Breakdown',
    fields: [
      { label: 'Generated', key: 'concerto_Delta', default: '+0' },
      { label: 'Current', key: 'concerto', default: '0' }
    ]
  },
  energy: {
    title: 'Resonance Energy Breakdown',
    fields: [
      { label: 'Generated', key: 'energy_Delta', default: '+0.0' },
      { label: 'Current', key: 'energy', default: '0.0' }
    ]
  },
  tune: {
    title: 'Tune Break Build Breakdown',
    fields: [
      { label: 'Generated', key: 'tune_Delta', default: '+0', suffix: '%' },
      { label: 'Tune Progress', key: 'tune', default: '0', suffix: '%' }
    ]
  },
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
          { label: 'Time Stop / Freeze', key: 'freezeTime', default: 0, suffix: 's' }
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
    fields: [
      { label: 'Offset Value', key: 'offset', default: '0.00', highlight: 'text-main' }
    ]
  }
};

for (let i = 1; i <= 6; i++) {
  const deltaKey = i === 1 ? 'forte_Delta' : `forte${i}_Delta`;
  const staticKey = i === 1 ? 'forte' : `forte${i}`;
  PANEL_CONFIG[`forte${i}`] = {
    title: `Forte ${i} Breakdown`,
    fields: [
      { label: 'Generated', key: deltaKey, default: '+0' },
      { label: 'Current', key: staticKey, default: '0' }
    ]
  };
}