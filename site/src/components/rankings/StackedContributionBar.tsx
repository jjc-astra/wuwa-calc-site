// src/components/rankings/StackedContributionBar.tsx
// Per-row leaderboard bar -- length scaled to top entry's DPS (#1 = 100% width). One segment per
// dmg source, reusing TeamContributionPanel's pie chart data/colors/hover-dim rule (hover = full
// opacity, rest fade to 0.45, see PieChart.tsx). Hovering a *unit* segment shows its cast-type
// breakdown (same as that unit's tab there); non-unit sources just show their own value.
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
  /** Team order (e.g. [Lumi, Sanhua]) -- segments draw in this order, matching TeamPreview's
   * icon order; non-unit/general sources are appended after. */
  unitNames: string[];
  /** Per-unit cast-type breakdown for this window, keyed by character name -- same shape the
   * DMG Contribution panel's per-unit tab uses. */
  unitBreakdowns: Record<string, CastTypeSlice[]>;
  /** This row's bar length as a % of the top-ranked entry's, e.g. 100 for the #1 row. */
  widthPct: number;
  dpsValue: number;
  /** Only meaningful when there's a real leaderboard to be a % of (Rankings); History has no
   * such reference and always fills to 100%, so it passes false to suppress a meaningless label. */
  showPercentage?: boolean;
}

const formatValue = (v: number) => Math.round(v).toLocaleString();

// Above this width, the % label draws inside the bar (right-aligned) instead of past its edge,
// so it never overflows the track.
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

  // Team-preview order (units first, in slot order), then any general/status-effect source
  // last -- matches the icons above the bar.
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
    // Non-unit source (e.g. "Aero Erosion") has no cast-type breakdown -- just show its share
    // of the row's total.
    const pct = total > 0 ? (seg.dmg / total) * 100 : 0;
    return `<div class="tooltip-val">${formatValue(seg.dmg)} (${pct.toFixed(1)}%)</div><div style="margin-top:2px;">${seg.label}</div>`;
  };

  // Follows the cursor (not pinned to the segment) while over the bar; disappears on leave.
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
