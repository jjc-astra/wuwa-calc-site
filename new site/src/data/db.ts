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
  'ATK': { values: [30, 40, 50, 60], defaultIndex: 1 },
  'DEF': { values: [40, 50, 60, 70], defaultIndex: 1 }
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

// Hover-tooltip copy for DSL autocomplete dropdown options, shown in the Mechanics Builder's
// DSL inputs. Grounded in the actual formula in logic/CombatCalculator.ts and RotationUtils.ts
// (e.g. Deepen and DMG Amp share the same multiplier bucket there, so their tooltips say so).
export const DSL_TOOLTIPS: {
  events: Record<string, string>;
  modifiers: Record<string, string>;
  pointers: Record<string, string>;
  properties: Record<string, Record<string, string>>;
  statModifiers: Record<string, string>;
  sheetStats: Record<string, string>;
} = {
  events: {
    ALWAYS: 'Evaluated continuously rather than tied to a specific event.',
    OnStart: 'Fires once at the start of the rotation.',
    OnCast: 'Fires the moment this move begins casting, before any hits land. Filter with [CastType], e.g. OnCast[Skill].',
    OnHit: 'Fires each time a hit connects. Filter with [CastType/Element/Status], e.g. OnHit[Skill].',
    AfterHit: 'Fires after a hit resolves, with an optional delay in seconds, e.g. AfterHit(0.5).',
    OnSwapIn: 'Fires when this character swaps onto the field.',
    OnSwapOut: 'Fires when this character swaps off the field.',
    OnChange: 'Fires whenever the tracked value changes.',
    Detonate: 'Fires when a status effect detonates. Filter with [Status], e.g. Detonate[Spectro Frazzle].',
    OnTick: 'Fires on each periodic tick of a duration-based effect, e.g. OnTick(1) for once per second.',
    OnTrackerAdd: 'Fires when a tracker/stack is added. Filter with [TrackerName].',
    OnTrackerRemove: 'Fires when a tracker/stack is removed. Filter with [TrackerName].',
    OnTrackerConsume: 'Fires when a tracker/stack is consumed. Filter with [TrackerName].',
    OnBuffAdd: 'Fires when a buff is applied. Filter with [BuffName].',
    OnBuffRemove: 'Fires when a buff expires or is removed. Filter with [BuffName].',
    OnBuffUpdate: 'Fires when an existing buff is refreshed or its stacks change. Filter with [BuffName].'
  },
  modifiers: {
    Self: 'Restricts the event to actions performed by this character.',
    Basic: 'Matches Basic Attacks.',
    Heavy: 'Matches Heavy Attacks (held/Forte attacks).',
    Skill: 'Matches Resonance Skill casts.',
    Liberation: 'Matches Resonance Liberation casts.',
    Intro: 'Matches Intro Skill casts.',
    Outro: 'Matches Outro Skill casts.',
    Coordinated: 'Matches Coordinated Attacks.',
    TuneBreak: 'Matches Tune Break hits.',
    TuneRupture: 'Matches Tune Rupture hits.',
    Dodge: 'Matches Dodge-related actions (e.g. Dodge Counter).',
    Jump: 'Matches Jump-related actions.',
    Echo: 'Matches Echo skill casts.',
    Utility: 'Matches Utility skill casts.',
    Heal: 'Matches healing actions.',
    Spectro: 'Matches hits or effects of Spectro damage type.',
    Fusion: 'Matches hits or effects of Fusion damage type.',
    Glacio: 'Matches hits or effects of Glacio damage type.',
    Aero: 'Matches hits or effects of Aero damage type.',
    Electro: 'Matches hits or effects of Electro damage type.',
    Havoc: 'Matches hits or effects of Havoc damage type.',
    Physical: 'Matches hits or effects of Physical damage type.',
    Defense: 'Matches Defense-type actions (e.g. parries, shields).',
    HP: 'Matches HP-based effects.',
    ATK: 'Matches ATK-based effects.',
    'Spectro Frazzle': 'Matches the Spectro Frazzle status specifically (used with Detonate).',
    'Aero Erosion': 'Matches the Aero Erosion status specifically (used with Detonate).',
    'Electro Flare': 'Matches the Electro Flare status specifically (used with Detonate).',
    'Electro Rage': 'Matches the Electro Rage status specifically (used with Detonate).',
    'Fusion Burst': 'Matches the Fusion Burst status specifically (used with Detonate).',
    'Glacio Chafe': 'Matches the Glacio Chafe status specifically (used with Detonate).'
  },
  pointers: {
    Self: 'The character that owns this mechanic node.',
    Enemy: 'The target enemy.',
    Team: 'All characters currently in the team roster.',
    TeamOthers: 'All team members except Self.',
    Active: 'The character currently on-field.',
    Next: 'The character being swapped in next.',
    Prev: 'The character or action that was active previously.',
    Equipper: 'The character this weapon or echo is equipped on.',
    System: 'Global effects not tied to a specific character.',
    Move: 'The move currently being cast.',
    Default: 'Built-in game default values (timings, priorities), not a character.'
  },
  properties: {
    Self: {
      HP: "Returns Self's current HP.",
      Energy: "Returns Self's current Resonance Energy.",
      Concerto: "Returns Self's current Concerto Energy.",
      Sequence: "Returns Self's Resonance Chain (sequence) level, 0-6.",
      PrevAction: 'Returns the name of the last action Self performed.',
      Name: "Returns Self's character name.",
      'BuffStacks()': 'Method — returns the current stack count of a buff, e.g. @Self.BuffStacks(BuffName).',
      'HasBuff()': 'Method — returns true if Self currently has the given buff, e.g. @Self.HasBuff(BuffName).',
      'Tracker()': 'Method — returns the current value of a tracker/counter, e.g. @Self.Tracker(TrackerName).',
      'Memory()': 'Method — returns a previously stored value, e.g. @Self.Memory(Key).',
      'Cooldown()': 'Method — returns the remaining cooldown in seconds of a skill, e.g. @Self.Cooldown(Skill).',
      'Stat()': 'Method — returns the current value of a sheet stat, e.g. @Self.Stat(CR Rate).'
    },
    Enemy: {
      HP: "Returns the enemy's current HP.",
      MaxHP: "Returns the enemy's maximum HP.",
      HPPct: "Returns the enemy's current HP as a percentage of max.",
      'BuffStacks()': 'Method — returns the current stack count of a debuff/status on the enemy.',
      'HasBuff()': 'Method — returns true if the enemy currently has the given debuff/status.',
      Tune: "Returns the enemy's current Tune (stagger) gauge value."
    },
    Move: {
      Name: 'Returns the name of the move currently being cast.',
      CastTypes: 'Returns the list of cast-type tags for this move (e.g. Skill, Liberation).',
      DmgTypes: 'Returns the list of damage-type tags for this move (e.g. element, cast type).',
      TimeStart: 'Returns the time (seconds) this move started casting.',
      Duration: "Returns this move's total action duration, in seconds.",
      GameTime: 'Returns the current simulation time, in seconds.',
      FreezeTime: "Returns this move's hitstop/freeze-frame duration, in seconds.",
      DamageStart: "Returns the time offset (seconds) this move's damage window begins.",
      DamageEnd: "Returns the time offset (seconds) this move's damage window ends.",
      SwapTime: 'Returns the time offset (seconds) at which a swap becomes available during this move.',
      BaseMult: "Returns this move's base damage multiplier.",
      HitMults: 'Returns the list of per-hit damage multipliers for this move.'
    },
    Prev: {
      Action: 'Returns the name of the previously executed action.',
      CastTypes: 'Returns the cast-type tags of the previous action.',
      Unit: 'Returns the character who performed the previous action.'
    },
    Next: {
      Name: 'Returns the name of the character swapping in next.',
      Action: 'Returns the queued action the incoming character will perform.',
      CastTypes: "Returns the cast-type tags of the incoming character's queued action.",
      Priority: "Returns the priority value of the incoming character's queued action."
    },
    Active: {
      Name: 'Returns the name of the character currently on-field.'
    },
    Default: {
      SwapTime: "The game's default swap-cancel timing, in seconds.",
      ComboWindow: "The game's default window during which a follow-up input is buffered, in seconds.",
      EchoSummonTime: "The game's default cast time before an Echo skill's effect triggers, in seconds.",
      PermanentDuration: "A very large duration constant used for effects that shouldn't expire.",
      BasicPriority: 'Default action-priority value for Basic Attacks.',
      HeavyPriority: 'Default action-priority value for Heavy Attacks.',
      SkillPriority: 'Default action-priority value for Resonance Skills.',
      EchoPriority: 'Default action-priority value for Echo skills.',
      DodgePriority: 'Default action-priority value for Dodges.',
      JumpPriority: 'Default action-priority value for Jumps.',
      LibPriority: 'Default action-priority value for Resonance Liberations.',
      IntroPriority: 'Default action-priority value for Intro Skills.',
      OutroPriority: 'Default action-priority value for Outro Skills.'
    }
  },
  // Matches the CombatCalculator keyword buckets in logic/CombatCalculator.ts (~line 175-191):
  // damage = baseDmg * critMult * (1 + DMG Bonus) * (1 + DMG Amp/Deepen) * (1 + DMG Taken)
  //          * (1 + Multiplicative Mult) * resMult * defMult
  statModifiers: {
    'DMG Bonus': 'Adds to the additive damage-bonus multiplier (1 + Base DMG Bonus + this), applied before crit.',
    'DMG Amp': 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as Deepen.',
    Deepen: 'Multiplies final damage by (1 + this). Shares the same multiplier bucket as DMG Amp.',
    'DMG Taken': "Multiplies the target's final damage taken by (1 + this), a separate layer from DMG Amp/Deepen.",
    'Reduce RES': "Subtracted directly from the enemy's base Resistance before the resistance multiplier is computed.",
    'RES Shred': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES.",
    'Ignore RES': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES/RES Shred.",
    'RES Pen': "Subtracted directly from the enemy's base Resistance, identically to Reduce RES/RES Shred.",
    'Reduce DEF': "Multiplicatively lowers the enemy's effective Defense in the defense-multiplier formula.",
    'Ignore DEF': "Multiplicatively lowers the enemy's effective Defense, identically to Reduce DEF.",
    'Additive Mult': "Adds directly to the move's base % multiplier before it's applied to the scaling stat.",
    'Multiplicative Mult': 'A separate multiplicative layer on final damage: (1 + this), alongside DMG Amp/Deepen and DMG Taken.'
  },
  sheetStats: {
    HP: 'Flat HP stat modifier.',
    'HP %': "Percentage increase to HP, added to the character's base HP contribution.",
    ATK: 'Flat ATK stat modifier.',
    'ATK %': "Percentage increase to ATK, added to the character's base ATK contribution.",
    DEF: 'Flat DEF stat modifier.',
    'DEF %': "Percentage increase to DEF, added to the character's base DEF contribution.",
    'CR Rate': 'Critical Rate — chance for a hit to crit.',
    'CR DMG': 'Critical DMG — bonus damage multiplier applied on a crit.',
    'ER %': 'Energy Regen — increases Resonance Energy generated per hit/action.',
    'Healing Bonus': 'Increases the amount healed by healing effects.'
  }
};

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