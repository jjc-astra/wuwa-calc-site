import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor } from '../../utils/Common';
import { DPS_WINDOWS } from '../../data/dpsWindows';
import type { ChromeTabDef } from './ChromeTabs';
import { PRIMARY_DMG_TYPES } from '../../data/gameVocab';

export const DPS_WINDOW_TABS: ChromeTabDef[] = DPS_WINDOWS.map(window => ({ id: window.key, label: window.label }));
// Validated against --bg-panel for color-vision deficiency. Assign by identity; never reassign.
export const CATEGORICAL_PALETTE = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767'
];

export const OTHER_SLICE_COLOR = '#6b6b6b';

// Fixed colors for dmg-type categories.
const NAMED_SLOTS: Record<string, number> = Object.fromEntries(PRIMARY_DMG_TYPES.map((type, slot) => [type, slot]));

// Characters get their theme color; other labels a hashed palette color.
export function colorForProvider(label: string): string {
  const dbChar = DataLoader.characterDB[label];
  return dbChar ? getCharacterThemeColor(dbChar) : colorForLabel(label);
}

export function colorForLabel(label: string): string {
  if (label in NAMED_SLOTS) return CATEGORICAL_PALETTE[NAMED_SLOTS[label]];
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length];
}
