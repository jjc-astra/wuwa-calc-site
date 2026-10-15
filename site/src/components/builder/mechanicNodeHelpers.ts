// Helpers for MechanicNodeCard and its sub-panels.
import type { Effect, MechanicNode } from '../../types';
import { CAST_TYPE_COLORS } from '../../data/db';
import { elementColorOf } from '../../utils/Common';
import { DSLParser, NAMESPACE_REF } from '../../logic/dsl/dslParser';
import { parseTimeInput } from '../../utils/Frames';
import { forteLabel } from '../../utils/ForteNames';
import { forteSlotOf } from '../../utils/ResourceKeys';

// "@Namespace(Name)" -> "Namespace_Name"
export const flattenDslShorthand = (v: string): string =>
  v.replace(NAMESPACE_REF, (_match, p1, p2) => `${p1}_${p2.trim()}`);

export const dmgTagColor = (tag: string): string => elementColorOf(tag) ?? CAST_TYPE_COLORS[tag] ?? '#999999';
export const castTagColor = (tag: string): string => CAST_TYPE_COLORS[tag] || '#dca54c';

export function resAbbr(key: string): string {
  const slot = forteSlotOf(key);
  if (slot !== null) return `F${slot}`;
  const map: Record<string, string> = { energy: 'ER', concerto: 'Con', tune: 'TB' };
  return map[key] || key.slice(0, 2).toUpperCase();
}

export function resFullName(key: string, stats?: Record<string, any>): string {
  const slot = forteSlotOf(key);
  if (slot !== null) return forteLabel(stats, slot);
  const map: Record<string, string> = { energy: 'Energy', concerto: 'Concerto', tune: 'Tune' };
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

export const sumNumeric = (v: string | number | number[] | undefined): number => {
  const arr = Array.isArray(v) ? v : v !== undefined ? [v] : [];
  return arr.filter((x): x is number => typeof x === 'number').reduce((a, b) => a + b, 0);
};


// Adds "f"/"s" to numbers; DSL unchanged.
export const displayTimeVal = (v: number | string | undefined, unit: 'f' | 's'): string => {
  if (v === undefined || v === '') return '';
  return typeof v === 'number' ? `${v}${unit}` : v;
};

// Effect chip label summarizing every set field.
export function effectLabel(eff: Effect): string {
  const parts: string[] = [String(eff.type || '').toUpperCase()];
  if (eff.name) parts.push(eff.name);
  if (eff.action) parts.push(eff.action);
  if (eff.target) parts.push(eff.target);
  if (eff.stat) parts.push(eff.stat);
  if (eff.value !== undefined && eff.value !== '') parts.push(String(eff.value));
  if (eff.stacks !== undefined) parts.push(`Stacks: ${eff.stacks}`);
  if (eff.maxStacks !== undefined) parts.push(`Max: ${eff.maxStacks}`);
  if (eff.duration !== undefined && eff.duration !== '') parts.push(`Dur: ${displayTimeVal(eff.duration, 's')}`);
  if (eff.stackBehavior) parts.push(eff.stackBehavior === 'resettable' ? 'Refresh Timers' : 'Separate Stacks');
  if (eff.expireBehavior) {
    parts.push(eff.expireBehavior === 'clear' ? 'Clear All' : eff.expireBehavior === 'drop_one' ? 'Drop 1' : 'Drop Half');
  }
  if (eff.removeOnSwap) parts.push('Clear on Swap');
  if (eff.applyTo) parts.push(`During: ${Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : eff.applyTo}`);
  if (eff.provider) parts.push(`from ${eff.provider}`);
  if (eff.source) parts.push(`src: ${eff.source}`);
  if (eff.linkedTracker) parts.push(`Tracker: ${eff.linkedTracker}`);
  if (eff.maxDuration !== undefined) parts.push(`Max Dur: ${eff.maxDuration}s`);
  return parts.join(' | ');
}

// Normalizes timing text on blur.
export const makeTimeBlur = (
  data: MechanicNode,
  updateNode: (patch: Partial<MechanicNode>) => void,
  field: keyof MechanicNode,
  nativeUnit: 'frames' | 'seconds'
) => () => {
  const raw = (data as any)[field];
  if (typeof raw !== 'string' || raw.trim() === '') return;
  const parsed = parseTimeInput(raw, nativeUnit);
  if (parsed !== raw) updateNode({ [field]: parsed } as Partial<MechanicNode>);
};

// Display number for a timing field; only @Default DSL resolves.
export function resolveDefaultNum(v: number | string | undefined, dslEvalCtx: Record<string, any>): number | null {
  if (v === undefined || v === '') return null;
  return typeof v === 'number' ? v : DSLParser.evaluateMath(v, dslEvalCtx);
}
