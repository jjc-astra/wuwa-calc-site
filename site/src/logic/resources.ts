// Resource pools: Energy, Concerto, Forte slots (per unit) and the enemy's Tune.
import { DataLoader } from '../utils/DataLoader';
import { buffedStats, buffsReaching } from './CombatCalculator';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS, STAT_NAME_MAP, BUILDUP_RATE_STATS } from '../data/db';
import { FORTE_KEYS, forteSlotOf, maxForteKey } from '../utils/ResourceKeys';
import { forteLabel } from '../utils/ForteNames';
import type { MechanicNode } from '../types';

// In validation order.
export const RESOURCE_KEYS: readonly string[] = ['energy', 'concerto', 'tune', ...FORTE_KEYS];

// Energy shortfalls only warn, so nothing waits on Energy.
export const WAITABLE_RESOURCE_KEYS: readonly string[] = RESOURCE_KEYS.filter(key => key !== 'energy');

export const isEnemyResource = (key: string): boolean => key === 'tune';

// Enemy_TuneImmune blocks Tune gain.
const isTuneImmune = (state: any): boolean => !!state.activeBuffs?.['Enemy_TuneImmune'];

export function readResource(state: any, key: string, unit: string): number {
  return (isEnemyResource(key) ? state.enemyTune : state[key]?.[unit]) || 0;
}

// Forte slot max, falling back to the default.
export function forteMax(stats: Record<string, any> | undefined, slot: number | string): number {
  return parseFloat(String(stats?.[maxForteKey(slot)])) || CHARACTER_DEFAULTS.maxForte;
}

// Non-resource keys are uncapped.
export function resourceCap(charName: string, key: string): number {
  if (key === 'concerto' || key === 'maxConcerto') return CHARACTER_DEFAULTS.maxConcerto;
  if (key === 'tune' || key === 'maxTune') return ENEMY_DEFAULTS.maxTune;
  const dbChar = DataLoader.characterDB[charName] || {};
  if (key === 'energy' || key === 'maxEnergy') return parseFloat(String(dbChar.maxEnergy)) || CHARACTER_DEFAULTS.maxEnergy;
  if (key.startsWith('forte') || key.startsWith('maxForte')) {
    const slot = key.replace('maxForte', '').replace('forte', '');
    return forteMax(dbChar, slot);
  }
  return Infinity;
}

// Adds clamped to [0, cap].
export function addResource(state: any, key: string, unit: string, amount: number, cap: number): void {
  if (isEnemyResource(key)) {
    if (amount > 0 && isTuneImmune(state)) return;
    state.enemyTune = Math.min(cap, Math.max(0, (state.enemyTune || 0) + amount));
    return;
  }
  if (!state[key]) state[key] = {};
  state[key][unit] = Math.min(Math.max(0, (state[key][unit] || 0) + amount), cap);
}

export function energyRegenPct(state: any, unit: string, team: any[]): number {
  return buffedStats(state, unit, team).energyRegen || CHARACTER_DEFAULTS.energyRegen;
}

export const energyRegenMult = (state: any, unit: string, team: any[]): number => energyRegenPct(state, unit, team) / 100;

const buildupRateCovers = (rateResource: string, key: string): boolean =>
  rateResource === key || (rateResource === 'forte' && forteSlotOf(key) !== null);

// Buildup rate multiplier for `key`; 1 when none applies.
export function buildupRateMult(state: any, unit: string, key: string, team: any[]): number {
  const statKeys = Object.keys(BUILDUP_RATE_STATS).filter(statKey => buildupRateCovers(BUILDUP_RATE_STATS[statKey], key));
  if (statKeys.length === 0) return 1;
  const buffs = buffsReaching(state, unit);
  // Fast path: no buildup buffs.
  if (!buffs.some(b => b.stat && statKeys.includes(STAT_NAME_MAP[b.stat]))) return 1;
  const stats = buffedStats(state, unit, team);
  // Bonuses over base stack additively.
  return 1 + statKeys.reduce((sum, statKey) => sum + (stats[statKey] ?? CHARACTER_DEFAULTS.buildupRate) - CHARACTER_DEFAULTS.buildupRate, 0) / 100;
}

export function resourceLabel(key: string, stats: Record<string, any> | undefined): string {
  if (key === 'energy') return 'Resonance Energy';
  if (key === 'concerto') return 'Concerto';
  if (key === 'tune') return 'Tune';
  const slot = forteSlotOf(key);
  return slot ? forteLabel(stats, slot) : key;
}

// A move's required amount: what its cast spends.
export function resourceRequirement(move: MechanicNode, key: string): number {
  const castAmount = Number(move.castResources?.[key]);
  return castAmount < 0 ? -castAmount : 0;
}

// Index of the hit where `key` reaches its cap, or -1.
export function capHitIndex(
  state: any, unit: string, key: string, move: MechanicNode, hitCount: number, gain: (amount: number) => number
): number {
  const perHit = move.hitResources?.[key];
  const start = state[key]?.[unit];
  if (!perHit || start === undefined) return -1;

  let current = start;
  const cap = resourceCap(unit, key);
  if (move.castResources?.[key]) current += gain(parseFloat(String(move.castResources[key])) || 0);
  if (!Array.isArray(perHit)) return -1;
  for (let i = 0; i < hitCount; i++) {
    if (current >= cap) break;
    current += gain(parseFloat(String(perHit[i])) || 0);
    if (current >= cap) return i;
  }
  return -1;
}
