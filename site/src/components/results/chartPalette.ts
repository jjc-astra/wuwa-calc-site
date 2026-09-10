// src/components/results/chartPalette.ts
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor } from '../../utils/Common';
import type { DpsWindowKey } from '../../types/results';

/** The 4 DPS windows every window-scoped results chart lets the user pick between. */
export const DPS_WINDOW_OPTIONS: Array<{ key: DpsWindowKey; label: string }> = [
  { key: 'opener', label: 'Opener' },
  { key: 'firstLoop', label: 'First Loop' },
  { key: 'avgLoop', label: 'Avg Loop' },
  { key: 'twoMin', label: '2-Min' }
];
// Fixed categorical order, validated against --bg-panel (#2b2b2b): CVD-adjacent dE >= 8.4,
// normal-vision dE >= 19.3. Assign by series identity in order -- never cycle/reassign on filter.
export const CATEGORICAL_PALETTE = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767'  // red
];

export const OTHER_SLICE_COLOR = '#6b6b6b';

// Fixed name -> palette-slot map for dmg-type categories (mirrors PRIMARY_DMG_TYPES in
// logic/ResultsCalculator.ts), so e.g. "Basic" is always the same color -- not whatever slot
// unitGroups' insertion order happens to give it for a given unit.
const NAMED_SLOTS: Record<string, number> = {
  Basic: 0, Heavy: 1, Skill: 2, Liberation: 3, Intro: 4, Outro: 5, Echo: 6
};

// A real team character gets its own theme color (same as TeamContributionPanel's Team tab).
// Anything else (a status-effect label like "Aero Erosion") falls through to the hash-based palette below.
export function colorForProvider(label: string): string {
  const dbChar = DataLoader.characterDB[label];
  return dbChar ? getCharacterThemeColor(dbChar) : colorForLabel(label);
}

export function colorForLabel(label: string): string {
  if (label in NAMED_SLOTS) return CATEGORICAL_PALETTE[NAMED_SLOTS[label]];
  // Unrecognized label (e.g. a free-form status-effect name) -- hash the string itself so its
  // color stays fixed across renders/units, just not hand-assigned.
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length];
}
