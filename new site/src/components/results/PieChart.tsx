// src/components/results/PieChart.tsx
import React, { useState } from 'react';
import { TooltipManager } from '../../utils/Common';

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieSlice[];
  size?: number;
  totalLabel?: string;
  formatValue?: (v: number) => string;
}

const GAP_DEG = 1.5;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeDonutSlice(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, startAngle);
  const endInner = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    'M', startOuter.x, startOuter.y,
    'A', rOuter, rOuter, 0, largeArc, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', rInner, rInner, 0, largeArc, 1, endInner.x, endInner.y,
    'Z'
  ].join(' ');
}

const defaultFormat = (v: number) => Math.round(v).toLocaleString();

export const PieChart: React.FC<PieChartProps> = ({ data, size = 170, totalLabel = 'Total', formatValue = defaultFormat }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const slices = data.filter(d => d.value > 0);
  const total = slices.reduce((sum, d) => sum + d.value, 0);

  const r = size / 2;
  const rInner = r * 0.62;
  const gap = slices.length > 1 ? GAP_DEG : 0;

  let cursor = 0;
  const arcs = slices.map(slice => {
    const span = total > 0 ? (slice.value / total) * 360 : 0;
    const start = cursor + gap / 2;
    const end = cursor + span - gap / 2;
    cursor += span;
    return { ...slice, start: Math.min(start, end), end: Math.max(start, end), pct: total > 0 ? (slice.value / total) * 100 : 0 };
  });

  return (
    <div className="pie-chart">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((arc, i) => (
          <path
            key={arc.label}
            d={describeDonutSlice(r, r, r, rInner, arc.start, arc.end)}
            fill={arc.color}
            opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
            style={{ transition: 'opacity 0.15s' }}
            onMouseEnter={e => {
              setHoverIdx(i);
              TooltipManager.show(
                e.currentTarget,
                `<div class="tooltip-val">${formatValue(arc.value)} (${arc.pct.toFixed(1)}%)</div><div style="margin-top:2px;">${arc.label}</div>`
              );
            }}
            onMouseLeave={() => {
              setHoverIdx(null);
              TooltipManager.hide();
            }}
          />
        ))}
        <text x={r} y={r - 6} textAnchor="middle" className="pie-chart-total-value">
          {formatValue(total)}
        </text>
        <text x={r} y={r + 14} textAnchor="middle" className="pie-chart-total-label">
          {totalLabel}
        </text>
      </svg>
      <div className="pie-chart-legend">
        {arcs.map((arc, i) => (
          <div
            key={arc.label}
            className={`pie-chart-legend-row ${hoverIdx === i ? 'is-hovered' : ''}`}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <span className="pie-chart-swatch" style={{ background: arc.color }} />
            <span className="pie-chart-legend-label">{arc.label}</span>
            <span className="pie-chart-legend-value">{arc.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
