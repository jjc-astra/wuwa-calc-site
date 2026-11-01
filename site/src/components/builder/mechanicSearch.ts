// Mechanics Builder search: the terms a node is found by, grouped for the autocomplete.
import type { Effect, MechanicNode } from '../../types';
import { resFullName, sumNumeric } from './mechanicNodeHelpers';

export interface SearchTerm {
  group: string;
  label: string;
}

/** Autocomplete group order. */
export const SEARCH_GROUPS = ['Mechanics', 'Effects', 'Resources', 'Cast Types', 'Dmg Types', 'Inputs', 'Flags'] as const;

const isSet = (v: unknown) => v !== undefined && v !== null && v !== '';

// "Suoming_Deep Mind" -> "Deep Mind"
const effectName = (name: string) => name.replace(/^[^_]+_/, '');

// Uses/Adds by sign; DSL amounts can go either way.
function resourceTerms(key: string, amount: unknown, stats?: Record<string, any>): string[] {
  const name = resFullName(key, stats);
  const n = typeof amount === 'number' || Array.isArray(amount) ? sumNumeric(amount as number | number[]) : parseFloat(String(amount));
  if (n > 0) return [`Adds ${name}`];
  if (n < 0) return [`Uses ${name}`];
  return [`Adds ${name}`, `Uses ${name}`];
}

function effectResourceTerms(eff: Effect, stats?: Record<string, any>): string[] {
  if (eff.type !== 'resource' || !eff.name) return [];
  if (eff.action === 'consume') return [`Uses ${resFullName(eff.name, stats)}`];
  return resourceTerms(eff.name, eff.value, stats);
}

/** Every term `node` is found by. */
export function searchTermsOf(node: MechanicNode, stats?: Record<string, any>): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const add = (group: string, labels: string[]) => labels.forEach(label => terms.push({ group, label }));

  add('Mechanics', [node.name || 'New Mechanic']);
  add('Cast Types', node.castTypes || []);
  add('Dmg Types', node.dmgTypes || []);

  const inputs = [node, ...(node.altInputs || [])].filter(b => b.input).map(b => `${b.inputType ? `${b.inputType} ` : ''}${b.input}`);
  add('Inputs', inputs);

  add('Resources', [
    ...Object.entries(node.castResources || {}).flatMap(([k, v]) => resourceTerms(k, v, stats)),
    ...Object.entries(node.hitResources || {}).flatMap(([k, v]) => resourceTerms(k, v, stats)),
    ...(node.effects || []).flatMap(eff => effectResourceTerms(eff, stats))
  ]);

  add('Effects', (node.effects || []).flatMap(eff => [
    ...(eff.name && eff.type !== 'resource' ? [effectName(eff.name)] : []),
    ...(eff.stat ? [eff.stat] : [])
  ]));

  add('Flags', [
    ...(node.isPassive ? ['Passive'] : []),
    ...(node.isSwapInDefault ? ['Default Swap-In'] : []),
    ...(node.simultaneous ? ['Simultaneous'] : []),
    ...(node.actsForUnit ? ['Acts For Unit'] : []),
    ...(node.modeScope === 'mode1' ? [stats?.mode1Name || 'Mode 1'] : []),
    ...(node.modeScope === 'mode2' ? [stats?.mode2Name || 'Mode 2'] : []),
    ...(node.holdConfig ? ['Hold Cursor'] : []),
    ...((node.cancelTimings?.length ?? 0) > 0 ? ['Cancel'] : []),
    ...(isSet(node.freezeTime) ? ['Freeze'] : []),
    ...(isSet(node.motionStop) ? ['Motion Stop'] : []),
    ...(isSet(node.swapTiming) ? ['Swap'] : []),
    ...(isSet(node.comboWindow) ? ['Combo'] : []),
    ...((node.priorityTimeline?.length ?? 0) > 0 ? ['Priority Timeline'] : []),
    ...(isSet(node.cooldown) ? ['Cooldown'] : []),
    ...(Number(node.maxCharges) > 1 ? ['Charges'] : []),
    ...(isSet(node.hitCondition) ? ['Hit Condition'] : [])
  ]);

  // Duplicates (e.g. a stat set by two effects) list once.
  const seen = new Set<string>();
  return terms.filter(t => {
    const key = `${t.group}|${t.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether `label` has every word of `query` (so "uses energy" doesn't match Adds Energy + Uses Forte). */
export const termMatches = (label: string, query: string): boolean => {
  const lower = label.toLowerCase();
  return queryWords(query).every(w => lower.includes(w));
};

/** Some term has every word of `query`; an empty query matches all. */
export const matchesSearch = (terms: SearchTerm[], query: string): boolean =>
  queryWords(query).length === 0 || terms.some(t => termMatches(t.label, query));
