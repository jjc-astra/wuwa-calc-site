// src/components/results/chartPalette.ts
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

export function colorForIndex(i: number): string {
  return CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length];
}
