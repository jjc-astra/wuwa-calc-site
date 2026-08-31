// src/components/rankings/StackedContributionBar.tsx
// A per-row leaderboard bar: its overall length is scaled relative to the top-ranked entry's
// DPS (so #1 always reads 100% width, matching a standard DPS-leaderboard convention), and it's
// internally split into one colored segment per damage source for that window -- same data
// shape, color-resolution rule, and hover-dim interaction (hovered segment stays full opacity,
// every other segment fades to 0.45 -- PieChart.tsx's exact rule) that TeamContributionPanel's
// "DMG Contribution" pie chart already uses, reused here so this reads as the same chart, just
// reshaped into a bar. Hovering a *unit's* segment shows that unit's own cast-type breakdown
// (the same data TeamContributionPanel shows when you click that unit's own tab, not the Team
// tab) -- a non-unit/general source has no cast-type breakdown, so it just shows its own value.
import React, { useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { getCharacterThemeColor, TooltipManager } from '../../utils/Common';
import { colorForLabel, OTHER_SLICE_COLOR } from '../results/chartPalette';
import type { CastTypeSlice } from '../../types/results';

interface ContributionSlice {
  label: string;
  dmg: number;
}

interface StackedContributionBarProps {
  segments: ContributionSlice[];
  /** Team order (e.g. [Lumi, Sanhua]) -- segments are drawn in this order, matching the row's
   * own TeamPreview icon order, with any non-unit/general source appended after. */
  unitNames: string[];
  /** Per-unit cast-type breakdown for this window, keyed by character name -- same shape the
   * DMG Contribution panel's own per-unit tab uses. */
  unitBreakdowns: Record<string, CastTypeSlice[]>;
  /** This row's bar length as a % of the top-ranked entry's, e.g. 100 for the #1 row. */
  widthPct: number;
  dpsValue: number;
  /** The %-of-top-entry label only means something when there's an actual leaderboard to be a
   * percentage of (Rankings); History has no such reference point (its bar is always drawn at
   * a fixed 100% just to fill the row), so it passes false here to suppress a "100%" that
   * wouldn't be measuring anything. Defaults to true for Rankings' own usage. */
  showPercentage?: boolean;
}

const formatValue = (v: number) => Math.round(v).toLocaleString();

// Above this fill width, the row's own % label is drawn right-aligned *inside* the bar (like
// the reference leaderboard's #1 row, whose bar already fills the whole track) instead of
// past its right edge, so it never overflows past the track.
const PCT_INSIDE_THRESHOLD = 90;

export const StackedContributionBar: React.FC<StackedContributionBarProps> = ({
  segments, unitNames, unitBreakdowns, widthPct, dpsValue, showPercentage = true
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const slices = segments.filter(s => s.dmg > 0);
  const total = slices.reduce((sum, s) => sum + s.dmg, 0);
  const clampedWidth = Math.max(0, Math.min(100, widthPct));

  const colorFor = (label: string) => {
    const isUnit = unitNames.includes(label);
    return isUnit ? getCharacterThemeColor(DataLoader.characterDB[label]) : colorForLabel(label);
  };

  // Draw in team-preview order (real units first, in their team-slot order), then any
  // remaining general/status-effect source last -- matches the icons above the bar.
  const ordered = [
    ...unitNames.map(name => slices.find(s => s.label === name)).filter((s): s is ContributionSlice => !!s),
    ...slices.filter(s => !unitNames.includes(s.label))
  ];

  const buildTooltipHtml = (seg: ContributionSlice): string => {
    if (unitNames.includes(seg.label)) {
      const castSlices = (unitBreakdowns[seg.label] || []).filter(c => c.dmg > 0);
      const unitTotal = castSlices.reduce((sum, c) => sum + c.dmg, 0);
      const rows = castSlices
        .map(c => {
          const pct = unitTotal > 0 ? (c.dmg / unitTotal) * 100 : 0;
          const color = c.castType === 'Other' ? OTHER_SLICE_COLOR : colorForLabel(c.castType);
          return `<div class="ranking-tooltip-row">
            <span class="ranking-tooltip-swatch" style="background:${color}"></span>
            <span class="ranking-tooltip-label">${c.castType}</span>
            <span class="ranking-tooltip-value">${pct.toFixed(1)}%</span>
          </div>`;
        })
        .join('');
      return `<div class="tooltip-val">${formatValue(unitTotal)}</div><div class="ranking-tooltip-unit-label">${seg.label} DMG</div>${rows}`;
    }
    // Non-unit source (e.g. a status effect like "Aero Erosion") has no cast-type breakdown --
    // just show its own share of this row's total.
    const pct = total > 0 ? (seg.dmg / total) * 100 : 0;
    return `<div class="tooltip-val">${formatValue(seg.dmg)} (${pct.toFixed(1)}%)</div><div style="margin-top:2px;">${seg.label}</div>`;
  };

  // Follows the cursor (rather than staying pinned to the segment's own position) for as long
  // as the pointer stays over the bar, and only disappears once it actually leaves.
  const handleMove = (e: React.MouseEvent, seg: ContributionSlice) => {
    TooltipManager.showAtPoint(e.clientX, e.clientY, buildTooltipHtml(seg));
  };

  const pctInside = clampedWidth >= PCT_INSIDE_THRESHOLD;

  return (
    <div className="ranking-bar-track">
      <div className="ranking-bar-fill" style={{ width: `${clampedWidth}%` }}>
        {ordered.map((seg, i) => (
          <div
            key={seg.label}
            className="ranking-bar-segment"
            style={{
              width: `${total > 0 ? (seg.dmg / total) * 100 : 0}%`,
              background: colorFor(seg.label),
              opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.45
            }}
            onMouseEnter={e => {
              setHoverIdx(i);
              handleMove(e, seg);
            }}
            onMouseMove={e => handleMove(e, seg)}
            onMouseLeave={() => {
              setHoverIdx(null);
              TooltipManager.hide();
            }}
          />
        ))}
      </div>
      <div className="ranking-bar-label">
        <span className="ranking-bar-dps-value">{formatValue(dpsValue)}</span>
        <span className="ranking-bar-dps-unit">DPS</span>
      </div>
      {showPercentage && (
        <div
          className={`ranking-bar-pct ${pctInside ? 'is-inside' : 'is-outside'}`}
          style={pctInside ? undefined : { left: `${clampedWidth}%` }}
        >
          {clampedWidth.toFixed(clampedWidth >= 99.95 ? 0 : 2)}%
        </div>
      )}
    </div>
  );
};
