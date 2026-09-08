import type { Frames } from '../utils/Frames';

// --- EQUIPMENT & STAT TYPES ---
export type WeaponType = 'Broadblade' | 'Sword' | 'Rectifier' | 'Gauntlets' | 'Pistols';
export type ElementType = 'Glacio' | 'Fusion' | 'Electro' | 'Aero' | 'Spectro' | 'Havoc' | 'Physical';
export type ScalarStat = 'ATK' | 'DEF' | 'HP';

export interface BaseStats {
  baseAtk?: number;
  baseHP?: number;
  baseDef?: number;
  baseCritRate?: number;
  baseCritDmg?: number;
  maxEnergy?: number;
  forteCount?: number;
  [key: string]: any;
}

export interface CharacterData extends BaseStats {
  weaponType: WeaponType;
  element: ElementType;
  rarity: number;
  talentStat1?: string;
  talentVal1?: string;
  talentStat2?: string;
  talentVal2?: string;
  skillGroupNames?: Record<string, string>;
  forteCount?: number;
  // A character with two named modes (e.g. Strain/Rupture) -- mode1Name/mode2Name label the
  // roster's mode dropdown and MechanicNode.modeScope's toggle for this character specifically.
  isDualMode?: boolean;
  mode1Name?: string;
  mode2Name?: string;
  [key: string]: any;
}

export interface WeaponData {
  weaponType: WeaponType;
  rarity: number;
  baseAtk: number;
  subStatType?: string;
  subStatValue?: string;
  [key: string]: any;
}

export interface SubstatEntry {
  name: string;
  value: number | string;
}

export interface EchoSlotData {
  mainStat: string;
  substats: SubstatEntry[];
}

export interface TeamSlot {
  index: number;
  character: string;
  sequence: number;
  mode: string;
  weapon: string;
  rank: number;
  layout: string;
  mainSet: string;
  subSet: string;
  mainEcho: string;
  echoes: EchoSlotData[];
  echoStats: Record<string, number>;
  domRef?: any;
}

// --- MECHANICS & DSL TYPES ---
export interface Effect {
  type?: 'buff' | 'buffAction' | 'resource' | 'tracker' | 'time_scale' | 'cooldown' | 'procced_mechanic';
  name?: string;
  target?: string;
  stat?: string;
  value?: number | string;
  stacks?: number;
  maxStacks?: number;
  duration?: number | string;
  stackBehavior?: 'resettable' | 'separate';
  expireBehavior?: 'clear' | 'drop_one' | 'drop_half';
  removeOnSwap?: boolean;
  // "Applies During" in the Builder UI -- gates which hits this buff's stat counts toward, by
  // cast type (e.g. "Basic") or specific move (e.g. "@Lumi(Pounce)"). Never a dmg type/element --
  // that's scoped by the Stat Modifier's own name instead (e.g. "Fusion DMG Bonus"), a separate
  // mechanism (see CombatCalculator.ts's baseDmgBonus). When set, this is the sole gate in
  // CombatCalculator.ts's aggregateBuffTotals and fully overrides the name-based auto-inference
  // (a stat containing "skill" no longer forces a 'skill'-tagged hit once applyTo is explicit).
  // Left unset, that inference is still the fallback -- most existing buffs predate this field
  // and rely on it for correct cast/dmg-type scoping.
  applyTo?: string | string[];
  action?: 'add' | 'set' | 'copy' | 'consume' | 'detonate' | 'remove' | 'pause' | 'resume' | 'extend';
  provider?: string;
  source?: string;
  linkedTracker?: string;
  isPaused?: boolean;
  maxDuration?: number;
  durations?: number[];
  [key: string]: any;
}

export interface HoldConfig {
  cursorSpeed?: number;
  cursorMode?: 'pingpong' | 'clamp' | 'loop';
  retainCursor?: boolean;
  maxCursorVal?: number;
  windowCenter?: string;
  windowSize?: string;
}

export interface CancelTiming {
  time: Frames;
  hits?: number;
  triggerRule?: string;
  _compiledRule?: any;
}

export interface MechanicNode {
  name: string;
  category?: string;
  provider?: string;
  isPassive?: boolean;
  isSwapInDefault?: boolean;
  // Restricts this mechanic to one of a dual-mode character's two modes (see
  // CharacterData.isDualMode). Omitted/'both' means it's available in either.
  modeScope?: 'mode1' | 'mode2' | 'both';
  triggerRule?: string;
  castTypes?: string[];
  dmgTypes?: string[];
  cost?: Record<string, number>;
  castResources?: Record<string, string | number | number[]>;
  hitResources?: Record<string, string | number | number[]>;
  hitMults?: (number | string)[];
  scalar?: ScalarStat;
  // Duration-domain fields (how long the move/animation takes) -- Frames, per the frame-based
  // timing migration. `cooldown` is a deliberate exception and stays in seconds (see
  // TimelineEngine.ts's _processGameTimeDecay for the one place these two domains cross).
  actionDuration?: Frames | string;
  cooldown?: number | string;
  swapTiming?: Frames | string;
  freezeTime?: Frames | string;
  comboWindow?: Frames | string;
  stanceReq?: 'Any' | 'Grounded' | 'Midair';
  stanceResult?: 'Retain' | 'Grounded' | 'Midair';
  stanceTime?: Frames | string;
  input?: string;
  inputType?: 'Press' | 'Hold' | 'Release';
  priority?: number | string;
  holdConfig?: HoldConfig;
  cancelTimings?: CancelTiming[];
  effects?: Effect[];
  damageTimeframe?: { start?: Frames | string; end?: Frames | string };
  allowedHits?: number;
  _compiledRule?: any;
}

// --- COMBAT CALCULATOR TYPES ---
export interface BuffTotals {
  percentAtk: number;
  flatAtk: number;
  percentHP: number;
  flatHP: number;
  percentDef: number;
  flatDef: number;
  critRate: number;
  critDamage: number;
  dmgBonus: number;
  dmgAmp: number;
  dmgBoost: number;
  dmgTaken: number;
  multiplicativeMult: number;
  additiveMult: number;
  reduceRes: number;
  ignoreRes: number;
  reduceDef: number;
  ignoreDef: number;
}

export interface HitConfig {
  hitMult: number | string;
  provider: string;
  dmgTypes?: string[];
  castTypes?: string[];
  scalar?: ScalarStat | string;
  title?: string;
  isOpen?: boolean;
  actionId?: string;
  moveName?: string;
  gameTime?: Frames;
  // Which sub-hit of actionId this is (0 for a single-hit move, 0/1/2/... for a multi-hit one).
  // Together, actionId+hitIndex identify "the same move slot" across an Avg Loop's repeated reps.
  hitIndex?: number;
}

export interface DamageInstanceResult {
  title: string;
  total: number;
  avg: number;
  nonCrit: number;
  crit: number;
  isOpen: boolean;
  gameTime?: Frames;
  formulaUsed: 'Standard' | 'Tune' | 'NegativeStatus';
  data: {
    activeBuffs: Record<string, Effect>;
    baseMult: string;
    pctMult: number;
    flatMult: number;
    calcBreakdown: string;
    castTypes: string;
    dmgTypes: string;
    scalarLabel: string;
    scalarValue: number;
    critRate: number;
    critDmg: number;
    dmgBonus: number;
    multiplicativeMult: number;
    additiveMult: number;
    dmgAmp: number;
    dmgTaken: number;
    reduceRes: number;
    ignoreRes: number;
    reduceDef: number;
    ignoreDef: number;
    [key: string]: any;
  };
}

export interface CalculatedStats {
  baseAtk: number;
  baseHP: number;
  baseDef: number;
  atk: number;
  hp: number;
  def: number;
  critRate: number;
  critDamage: number;
  percentAtk: number;
  percentHP: number;
  percentDef: number;
  flatAtk: number;
  flatHP: number;
  flatDef: number;
  energyRegen: number;
  healingBonus: number;
  skillDmgBonus: number;
  basicDmgBonus: number;
  heavyDmgBonus: number;
  libDmgBonus: number;
  glacioDmgBonus: number;
  fusionDmgBonus: number;
  electroDmgBonus: number;
  aeroDmgBonus: number;
  spectroDmgBonus: number;
  havocDmgBonus: number;
  talentAtkPct?: number;
  [key: string]: number | undefined;
}