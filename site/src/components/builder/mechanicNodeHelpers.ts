// src/components/builder/mechanicNodeHelpers.ts
// Shared formatting/lookup helpers used across MechanicNodeCard and its split-out sub-panels.
import type { Effect, MechanicNode } from '../../types';
import { CAST_TYPE_COLORS } from '../../data/db';
import { ELEMENT_COLORS } from '../../utils/Common';
import { DSLParser } from '../../logic/DSLParser';
import { parseTimeInput } from '../../utils/Frames';

export { tip } from '../../utils/Common';

export const flattenDslShorthand = (v: string): string =>
  v.replace(/@([A-Za-z0-9_]+)\(([^)]+)\)/g, (_match, p1, p2) => `${p1}_${p2.trim()}`);

// Cast types: fixed non-elemental palette. Dmg types: exact elemental match, or the element
// name found in the label (e.g. "Aero Erosion" -> Aero) so status effects still get a sensible hue.
export function dmgTagColor(tag: string): string {
  if (ELEMENT_COLORS[tag]) return ELEMENT_COLORS[tag];
  const match = Object.keys(ELEMENT_COLORS).find(el => tag.includes(el));
  return match ? ELEMENT_COLORS[match] : '#999999';
}
export const castTagColor = (tag: string): string => CAST_TYPE_COLORS[tag] || '#dca54c';

// Short labels for resource-key chips/summaries (On Cast / Resources columns).
export function resAbbr(key: string): string {
  const forte = key.match(/^forte(\d+)$/i);
  if (forte) return `F${forte[1]}`;
  const map: Record<string, string> = { energy: 'ER', concerto: 'Con', tune: 'TB' };
  return map[key] || key.slice(0, 2).toUpperCase();
}

// Full name for tooltips -- resAbbr's "ER" etc. is for compact chip labels only.
export function resFullName(key: string): string {
  const forte = key.match(/^forte(\d+)$/i);
  if (forte) return `Forte ${forte[1]}`;
  const map: Record<string, string> = { energy: 'Energy', concerto: 'Concerto', tune: 'Tune' };
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

export const sumNumeric = (v: string | number | number[] | undefined): number => {
  const arr = Array.isArray(v) ? v : v !== undefined ? [v] : [];
  return arr.filter((x): x is number => typeof x === 'number').reduce((a, b) => a + b, 0);
};

export const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Adds unit suffix ("30f"/"12s") to a plain numeric value so the field reads unambiguous.
// A DSL string (e.g. "@Default.SwapTime") is shown untouched.
export const displayTimeVal = (v: number | string | undefined, unit: 'f' | 's'): string => {
  if (v === undefined || v === '') return '';
  return typeof v === 'number' ? `${v}${unit}` : v;
};

// Effects Array chip label -- every set field, ordered like TriggerRuleEffectsPanel's own
// fields, so it reads as a full summary. Unset fields are omitted to avoid empty segments.
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

// Normalizes a timing field's text ("30f"/"0.5s"/DSL) on blur, not every keystroke -- raw
// typed text is committed on onChange so mid-type values like "1." aren't clobbered.
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

// Resolves a Timing Modifiers field to a display number, evaluating DSL like
// "@Default.BasicPriority + 1". Only @Default resolves without a live rotation context.
export function resolveDefaultNum(v: number | string | undefined, dslEvalCtx: Record<string, any>): number | null {
  if (v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  try {
    return DSLParser.evaluateMath(v, dslEvalCtx);
  } catch {
    return null;
  }
}
