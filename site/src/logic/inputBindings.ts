// A move's input bindings (its main input plus altInputs) and which one a rotation row used.
import type { InputBinding, MechanicNode } from '../types';

/** Main input first, then altInputs. Empty for moves with no input. */
export function bindingsOf(move: MechanicNode | null | undefined): InputBinding[] {
  if (!move) return [];
  const main: InputBinding[] = move.input ? [{ input: move.input, ...(move.inputType && { inputType: move.inputType }) }] : [];
  return [...main, ...(move.altInputs || []).filter(b => b?.input)];
}

export const bindingKey = (binding: Partial<InputBinding> | null | undefined): string =>
  `${binding?.input ?? ''}|${binding?.inputType ?? ''}`;

const isHold = (binding: Partial<InputBinding> | null | undefined) => binding?.inputType === 'Hold';

/**
 * The binding a row cast its move with.
 * - `row.inputChoice`: the user's pick (an index into bindingsOf).
 * - Otherwise: carry on a hold when the unit's previous move held the same input, else the main input.
 * `prev`: the unit's previous row, with its resolved input/inputType.
 */
export function resolveRowBinding(move: MechanicNode | null | undefined, row: { inputChoice?: number }, prev?: { input?: string; inputType?: string } | null): InputBinding | null {
  const bindings = bindingsOf(move);
  if (bindings.length === 0) return null;
  const chosen = row.inputChoice !== undefined ? bindings[row.inputChoice] : undefined;
  if (chosen) return chosen;
  if (prev && isHold(prev as InputBinding)) {
    const carried = bindings.find(b => isHold(b) && b.input === prev.input);
    if (carried) return carried;
  }
  return bindings[0];
}

/** True when `row`'s hold carries on from `prev` (same unit, both held on the same input). */
export const continuesHold = (row: { unit?: string; input?: string; inputType?: string }, prev?: { unit?: string; input?: string; inputType?: string } | null): boolean =>
  !!prev && prev.unit === row.unit && isHold(row as InputBinding) && isHold(prev as InputBinding) && prev.input === row.input;

/** e.g. "Basic", "Hold Skill". */
export const describeBinding = (binding: Partial<InputBinding>, keyLabel: (input: string) => string = input => input): string =>
  `${binding.inputType ? `${binding.inputType} ` : ''}${keyLabel(binding.input || '')}`;
