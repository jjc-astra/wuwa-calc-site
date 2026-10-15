import type { Frames } from '../utils/Frames';
import type { ElementName, EchoStatKey } from '../data/gameVocab';

// --- EQUIPMENT & STAT TYPES ---
export type WeaponType = 'Broadblade' | 'Sword' | 'Rectifier' | 'Gauntlets' | 'Pistols';
export type ElementType = ElementName;
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
  // Two-mode character (e.g. Strain/Rupture).
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

export type EntityFolder = 'characters' | 'weapons' | 'sets' | 'echoes' | 'system';

// A mechanics entity: a slot's equipped item, or System.
export interface EntityRef {
  folder: EntityFolder;
  name: string;
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
  // 1pc mainSet only: sets for the other 4 echoes.
  subSet2a: string;
  subSet2b: string;
  mainEcho: string;
  echoes: EchoSlotData[];
  echoStats: Record<string, number>;
}

export interface EnemyStats {
  level: number;
  res: number;
  hp: number;
}

// --- MECHANICS & DSL TYPES ---
export interface Effect {
  type?: 'buff' | 'buffAction' | 'resource' | 'tracker' | 'time_scale' | 'cooldown' | 'procced_mechanic' | 'alwaysCheck';
  name?: string;
  target?: string;
  stat?: string;
  value?: number | string;
  stacks?: number;
  maxStacks?: number | string;
  duration?: number | string;
  stackBehavior?: 'resettable' | 'separate';
  expireBehavior?: 'clear' | 'drop_one' | 'drop_half';
  removeOnSwap?: boolean;
  applyTo?: string | string[];
  action?: 'add' | 'set' | 'copy' | 'consume' | 'detonate' | 'remove' | 'delete' | 'pause' | 'resume' | 'extend';
  provider?: string;
  source?: string;
  // Source entity (character, weapon, echo, set or System).
  sourceOwner?: string;
  // Original selector (@Team, @Next...).
  appliesTo?: string;
  linkedTracker?: string;
  isPaused?: boolean;
  maxDuration?: number;
  durations?: number[];
  // From hitResources: scaled by Energy Regen / buildup rate.
  rateScaled?: boolean;
  [key: string]: any;
}

export interface HoldConfig {
  cursorSpeed?: number;
  cursorMode?: 'pingpong' | 'clamp' | 'loop';
  // Carry the cursor into the next hold.
  retainCursor?: boolean;
  // Forte slot setting the cursor max.
  forteSlot?: string;
  windowCenter?: string;
  windowSize?: string;
}

export interface StanceChange {
  stance: 'Grounded' | 'Midair';
  time: Frames | string;
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
  // Dual-mode restriction; omitted means both.
  modeScope?: 'mode1' | 'mode2' | 'both';
  triggerRule?: string;
  castTypes?: string[];
  dmgTypes?: string[];
  castResources?: Record<string, string | number | number[]>;
  hitResources?: Record<string, string | number | number[]>;
  hitMults?: (number | string)[];
  scalar?: ScalarStat;
  // Durations are Frames, except `cooldown` (seconds).
  actionDuration?: Frames | string;
  cooldown?: number | string;
  // Independent charges, each with its own recharge. Full at combat start.
  maxCharges?: number | string;
  // Another move whose cooldown starts with this one. Kept symmetric by CooldownPanel.
  shareCooldownWith?: string;
  swapTiming?: Frames | string;
  // Pauses buffs and cooldowns while the move plays.
  freezeTime?: Frames | string;
  // Pauses other units' moves after the cast.
  motionStop?: Frames | string;
  comboWindow?: Frames | string;
  stanceReq?: 'Any' | 'Grounded' | 'Midair';
  // Read through getStanceChanges.
  stanceChanges?: StanceChange[];
  // Legacy; use stanceChanges.
  stanceResult?: 'Retain' | 'Grounded' | 'Midair';
  stanceTime?: Frames | string;
  input?: string;
  inputType?: 'Hold' | 'Repeat' | 'Release';
  priority?: number | string;
  holdConfig?: HoldConfig;
  holdGroupId?: string;
  cancelTimings?: CancelTiming[];
  effects?: Effect[];
  damageTimeframe?: { start?: Frames | string; end?: Frames | string };
  // Frames for middle hits (hitFrames[0] is hit 2); null spreads evenly.
  hitFrames?: Array<Frames | string | null>;
  allowedHits?: number;
  // Checked per hit; failing hits don't happen.
  hitCondition?: string;
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
  tuneBreakBoost: number;
  dmgTaken: number;
  multiplicativeMult: number;
  additiveMult: number;
  reduceRes: number;
  ignoreRes: number;
  reduceDef: number;
  ignoreDef: number;
}

// A move's caster, namespace and "@Owner(Move Name)" pointer.
export interface MoveOrigin {
  caster: string;
  owner: string;
  ref: string;
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
  moveRef?: string;
  gameTime?: Frames;
  // Stat-reading DSL multiplier, for `restat` pricing.
  statScaledMult?: string;
  // Sub-hit index within actionId.
  hitIndex?: number;
}

export interface DamageInstanceResult {
  title: string;
  // Crit-averaged.
  total: number;
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

export interface CalculatedStats extends Record<EchoStatKey, number> {
  baseAtk: number;
  baseHP: number;
  baseDef: number;
  atk: number;
  hp: number;
  def: number;
  talentAtkPct?: number;
  tuneBreakBoost: number;
  offTuneBuildupRate: number;
  forteBuildupRate: number;
  [key: string]: number | undefined;
}
