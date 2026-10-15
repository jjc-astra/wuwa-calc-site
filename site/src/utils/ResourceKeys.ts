// Resource pool keys. Energy, Concerto and Forte (forte1..6) are per unit; Tune is the enemy's.
const MAX_FORTE_SLOTS = 6;

export const forteKey = (slot: number | string): string => `forte${slot}`;
export const maxForteKey = (slot: number | string): string => `maxForte${slot}`;

export const FORTE_SLOTS: readonly number[] = Array.from({ length: MAX_FORTE_SLOTS }, (_, i) => i + 1);
export const FORTE_KEYS: readonly string[] = FORTE_SLOTS.map(forteKey);

export const forteSlotOf = (key: string): number | null => {
  const match = key.match(/^forte(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
};

// Defaults to slot 1.
export const holdSlotNumber = (forteSlot: string): number => parseInt(forteSlot.replace('forte', ''), 10) || 1;

// Per-move change tracker. Slot 1 is `forte_Delta`.
export const deltaKey = (resourceKey: string): string =>
  resourceKey === forteKey(1) ? 'forte_Delta' : `${resourceKey}_Delta`;
