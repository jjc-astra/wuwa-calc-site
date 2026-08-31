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
// Fixed categorical order, validated (dataviz skill) against this app's --bg-panel dark
// surface (#2b2b2b): CVD-adjacent ΔE >= 8.4, normal-vision-adjacent ΔE >= 19.3. Assign by
// series identity in this order -- never cycle or reassign on filter.
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

// Fixed name -> palette-slot mapping for the dmg-type categories a unit's own pie chart can
// bucket by (mirrors PRIMARY_DMG_TYPES in logic/ResultsCalculator.ts) -- so e.g. "Basic" is
// always the same color, instead of whichever slot it happens to land in for a given unit
// (unitGroups' insertion order depends on which categories that unit's hits actually produced
// in that window, so the same category could be index 0 for one unit and index 2 for another).
const NAMED_SLOTS: Record<string, number> = {
  Basic: 0, Heavy: 1, Skill: 2, Liberation: 3, Intro: 4, Outro: 5, Echo: 6
};

// A real team character gets its own theme color (same identity TeamContributionPanel's Team
// tab colors its slices by); anything else (a status-effect dmgType label like "Aero Erosion")
// falls through to the generic hash-based palette below.
export function colorForProvider(label: string): string {
  const dbChar = DataLoader.characterDB[label];
  return dbChar ? getCharacterThemeColor(dbChar) : colorForLabel(label);
}

export function colorForLabel(label: string): string {
  if (label in NAMED_SLOTS) return CATEGORICAL_PALETTE[NAMED_SLOTS[label]];
  // Unrecognized label (e.g. a free-form status-effect name like "Aero Erosion") -- hash the
  // string itself so its color is still fixed across renders/units, just not hand-assigned.
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length];
}
