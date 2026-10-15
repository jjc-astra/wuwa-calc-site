// Leaderboard bar scaled to the top entry, one segment per damage source.
import React, { useEffect, useRef, useState } from 'react';
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
  /** Segment order; other sources go last. */
  unitNames: string[];
  /** Per-unit cast-type breakdown; null while loading. */
  unitBreakdowns: Record<string, CastTypeSlice[]> | null;
  /** % of the top entry. */
  widthPct: number;
  dpsValue: number;
  showPercentage?: boolean;
  /** Overrides the % label only. */
  percentLabel?: number;
}

const formatValue = (v: number) => Math.round(v).toLocaleString();
const formatPct = (v: number) => `${v.toFixed(Math.abs(v - 100) < 0.05 ? 0 : 2)}%`;

// Above this, the % label draws inside the bar.
const PCT_INSIDE_THRESHOLD = 90;

export const StackedContributionBar: React.FC<StackedContributionBarProps> = ({
  segments, unitNames, unitBreakdowns, widthPct, dpsValue, showPercentage = true, percentLabel
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hovered = useRef<{ x: number; y: number; seg: ContributionSlice } | null>(null);
  const slices = segments.filter(s => s.dmg > 0);
  const total = slices.reduce((sum, s) => sum + s.dmg, 0);
  const clampedWidth = Math.max(0, Math.min(100, widthPct));

  const colorFor = (label: string) => {
    const isUnit = unitNames.includes(label);
    return isUnit ? getCharacterThemeColor(DataLoader.characterDB[label]) : colorForLabel(label);
  };

  // Units in slot order, then other sources.
  const ordered = [
    ...unitNames.map(name => slices.find(s => s.label === name)).filter((s): s is ContributionSlice => !!s),
    ...slices.filter(s => !unitNames.includes(s.label))
  ];

  const buildTooltipHtml = (seg: ContributionSlice): string => {
    if (unitNames.includes(seg.label) && !unitBreakdowns) {
      return `<div class="tooltip-val">${formatValue(seg.dmg)}</div><div class="ranking-tooltip-unit-label caps-tag">${seg.label} DMG</div><div>Loading breakdown...</div>`;
    }
    if (unitNames.includes(seg.label) && unitBreakdowns) {
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
      return `<div class="tooltip-val">${formatValue(unitTotal)}</div><div class="ranking-tooltip-unit-label caps-tag">${seg.label} DMG</div>${rows}`;
    }
    // Non-unit sources show their share only.
    const pct = total > 0 ? (seg.dmg / total) * 100 : 0;
    return `<div class="tooltip-val">${formatValue(seg.dmg)} (${pct.toFixed(1)}%)</div><div style="margin-top:2px;">${seg.label}</div>`;
  };

  const handleMove = (e: React.MouseEvent, seg: ContributionSlice) => {
    hovered.current = { x: e.clientX, y: e.clientY, seg };
    TooltipManager.showAtPoint(e.clientX, e.clientY, buildTooltipHtml(seg));
  };

  // Refresh an open tooltip when breakdowns arrive.
  useEffect(() => {
    const h = hovered.current;
    if (h && unitBreakdowns) TooltipManager.showAtPoint(h.x, h.y, buildTooltipHtml(h.seg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitBreakdowns]);

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
              hovered.current = null;
              TooltipManager.hide();
            }}
          />
        ))}
      </div>
      <div className="ranking-bar-label">
        <span className="ranking-bar-dps-value">{formatValue(dpsValue)}</span>
        <span className="ranking-bar-dps-unit caps-tag">DPS</span>
      </div>
      {showPercentage && (
        <div
          className={`ranking-bar-pct ${pctInside ? 'is-inside' : 'is-outside'}`}
          style={pctInside ? undefined : { left: `${clampedWidth}%` }}
        >
          {formatPct(percentLabel ?? clampedWidth)}
        </div>
      )}
    </div>
  );
};
