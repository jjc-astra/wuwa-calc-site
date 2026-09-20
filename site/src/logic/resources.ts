// The resource pools a move can cost, grant, cap or require: Energy, Concerto and the numbered
// Forte slots (per-unit pools on a row) plus the enemy's Tune. Every place the simulation reads
// or changes one goes through here, so a new resource key means editing one list.
import { DataLoader } from '../utils/DataLoader';
import { CombatCalculator } from './CombatCalculator';
import { CHARACTER_DEFAULTS, ENEMY_DEFAULTS } from '../data/db';
import { FORTE_KEYS, forteSlotOf, maxForteKey } from '../utils/ResourceKeys';
import { forteLabel } from '../utils/ForteNames';
import type { Effect, MechanicNode } from '../types';

// In the order they're validated, reported and diffed.
export const RESOURCE_KEYS: readonly string[] = ['energy', 'concerto', 'tune', ...FORTE_KEYS];

// Energy is the one resource a shortfall of only warns about (see the row validation), so
// nothing waits on it.
export const WAITABLE_RESOURCE_KEYS: readonly string[] = RESOURCE_KEYS.filter(key => key !== 'energy');

const isEnemyResource = (key: string): boolean => key === 'tune';

// A timed 'Enemy_TuneImmune' buff (e.g. applied by Tune Break) blocks tune gain entirely.
export const isTuneImmune = (state: any): boolean => !!state.activeBuffs?.['Enemy_TuneImmune'];

export function readResource(state: any, key: string, unit: string): number {
  return (isEnemyResource(key) ? state.enemyTune : state[key]?.[unit]) || 0;
}

// The highest a resource can go. Keys that aren't resources are uncapped.
export function resourceCap(charName: string, key: string): number {
  if (key === 'concerto' || key === 'maxConcerto') return CHARACTER_DEFAULTS.maxConcerto;
  if (key === 'tune' || key === 'maxTune') return ENEMY_DEFAULTS.maxTune;
  const dbChar = DataLoader.characterDB[charName] || {};
  if (key === 'energy' || key === 'maxEnergy') return parseFloat(String(dbChar.maxEnergy)) || CHARACTER_DEFAULTS.maxEnergy;
  if (key.startsWith('forte') || key.startsWith('maxForte')) {
    const slot = key.replace('maxForte', '').replace('forte', '');
    return parseFloat(String((dbChar as any)[maxForteKey(slot)])) || CHARACTER_DEFAULTS.maxForte;
  }
  return Infinity;
}

// Adds to a resource, clamped between 0 and `cap`. Tune gain is ignored while the enemy is TuneImmune.
export function addResource(state: any, key: string, unit: string, amount: number, cap: number): void {
  if (isEnemyResource(key)) {
    if (amount > 0 && isTuneImmune(state)) return;
    state.enemyTune = Math.min(cap, Math.max(0, (state.enemyTune || 0) + amount));
    return;
  }
  if (!state[key]) state[key] = {};
  state[key][unit] = Math.min(Math.max(0, (state[key][unit] || 0) + amount), cap);
}

// Removes from a resource, floored at 0.
export function spendResource(state: any, key: string, unit: string, amount: number): void {
  if (isEnemyResource(key)) {
    state.enemyTune = Math.max(0, (state.enemyTune || 0) - amount);
    return;
  }
  if (!state[key]) state[key] = {};
  state[key][unit] = Math.max(0, (state[key][unit] || 0) - amount);
}

// The unit's Energy Regen % with the buffs currently reaching it.
export function energyRegenPct(state: any, unit: string, team: any[]): number {
  const validBuffs = Object.values(state.activeBuffs || {}).filter((b: any) =>
    b.target === unit || b.target === '@Team' || (b.target === 'Active' && unit === state.unit)
  );
  const stats = CombatCalculator.calculateFinalStats(unit, validBuffs as Effect[], team);
  return stats.energyRegen || 100;
}

// What Energy gained by this unit is multiplied by.
export const energyRegenMult = (state: any, unit: string, team: any[]): number => energyRegenPct(state, unit, team) / 100;

// The user-facing name of a resource, as shown in warnings and wait reasons.
export function resourceLabel(key: string, stats: Record<string, any> | undefined): string {
  if (key === 'energy') return 'Resonance Energy';
  if (key === 'concerto') return 'Concerto';
  if (key === 'tune') return 'Tune';
  const slot = forteSlotOf(key);
  return slot ? forteLabel(stats, slot) : key;
}

// How much of a resource a move needs on hand: its cost plus whatever its cast spends.
export function resourceRequirement(move: MechanicNode, key: string): number {
  const costs: Record<string, any> = move.cost || {};
  const castResources: Record<string, any> = move.castResources || (move as any).resources || {};
  return (costs[key] || 0) + (castResources[key] < 0 ? Math.abs(castResources[key]) : 0);
}

// The index of the hit on which `key` first reaches its cap over this move's cast + hit gains
// (`gain` scales each amount, e.g. by Energy Regen), or -1 if it doesn't. Only for resources
// this unit actually has a pool for.
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
