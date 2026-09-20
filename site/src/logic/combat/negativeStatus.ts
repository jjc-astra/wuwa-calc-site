import type { NegativeStatus } from '../../data/gameVocab';

// Keyed by status NAME, not element -- "Fusion Burst" the status and "Fusion" the element
// are unrelated. Index = stack count.
export const NEGATIVE_STATUS_MULTS = {
  'Fusion Burst':    [0, 8400, 15229, 22058, 28888, 35717, 42546, 49375, 56204, 63034, 69863, 93150, 116438, 139726, 163013, 186301, 209588],
  'Electro Flare':   [0, 5000, 9065, 13130, 17195, 21260, 25325, 29390, 33455, 37520, 41585, 55447, 69308, 83170, 97032, 110893, 124755],
  'Aero Erosion':    [0, 4500, 11250, 22500, 33750, 45000, 56250, 67500, 78750, 90000, 101250, 112500, 123750, 135000, 146250, 157500],
  'Spectro Frazzle': [0, 3000, 5439, 7878, 10317, 12756, 15195, 17634, 20073, 22512, 24951, 33268, 41585, 49902, 58219, 66536, 74853],
  'Glacio Chafe':    [0, 2450, 4442, 6434, 8426, 10417, 12409, 14401, 16393, 18385, 20377, 27169, 33961, 40753, 47546, 54338, 61130],
  'Havoc Bane':      [0, -200, -400, -600, -800, -1000, -1200]
} as Partial<Record<NegativeStatus, number[]>> as Record<string, number[]>;

// The damage multiplier of a negative status at `stacks` stacks; 0 for an unknown status or no
// stacks. Past the end of its table, each extra stack adds the table's last step again.
// Damage math uses this directly, and the DSL exposes it as @StatusMult(Status Name, stacks).
export const getNegativeStatusMult = (statusName: string, stacks: number): number => {
  const table = NEGATIVE_STATUS_MULTS[statusName];
  if (!table || !(stacks > 0)) return 0;
  if (stacks < table.length) return table[stacks];
  const last = table[table.length - 1];
  const diff = last - table[table.length - 2];
  return last + (diff * (stacks - table.length + 1));
};
