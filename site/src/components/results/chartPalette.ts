import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor } from '../../utils/Common';
import { DPS_WINDOWS } from '../../data/dpsWindows';
import type { ChromeTabDef } from './ChromeTabs';
import { PRIMARY_DMG_TYPES } from '../../data/gameVocab';

/** The DPS windows as tab definitions, for the pickers that show them as tabs. */
export const DPS_WINDOW_TABS: ChromeTabDef[] = DPS_WINDOWS.map(window => ({ id: window.key, label: window.label }));
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

// Fixed name -> palette-slot map for the pie's dmg-type categories, so e.g. "Basic" is always the
// same color -- not whatever slot unitGroups' insertion order happens to give it for a given unit.
const NAMED_SLOTS: Record<string, number> = Object.fromEntries(PRIMARY_DMG_TYPES.map((type, slot) => [type, slot]));

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
