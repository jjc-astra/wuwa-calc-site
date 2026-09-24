// Names for the resource pools the simulation tracks. Energy, Concerto and Forte are per-unit
// pools on a row (`{ unit: value }`); Forte comes in numbered slots (forte1..forte6). Tune is the
// enemy's, not any unit's.
const MAX_FORTE_SLOTS = 6;

export const forteKey = (slot: number | string): string => `forte${slot}`;
export const maxForteKey = (slot: number | string): string => `maxForte${slot}`;

export const FORTE_SLOTS: readonly number[] = Array.from({ length: MAX_FORTE_SLOTS }, (_, i) => i + 1);
export const FORTE_KEYS: readonly string[] = FORTE_SLOTS.map(forteKey);

// The slot number in a `forteN` key, or null for any other key.
export const forteSlotOf = (key: string): number | null => {
  const match = key.match(/^forte(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
};

// The slot a hold's `forteSlot` names, falling back to slot 1 for anything unreadable.
export const holdSlotNumber = (forteSlot: string): number => parseInt(forteSlot.replace('forte', ''), 10) || 1;

// The row tracker holding how much a resource changed over one move. Slot 1 predates the numbered
// slots, so its tracker is `forte_Delta`.
export const deltaKey = (resourceKey: string): string =>
  resourceKey === forteKey(1) ? 'forte_Delta' : `${resourceKey}_Delta`;
