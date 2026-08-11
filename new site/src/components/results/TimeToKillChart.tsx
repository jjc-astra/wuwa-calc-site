// src/components/results/TimeToKillChart.tsx
import React, { useMemo, useRef, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import { generateMockTtkSeries } from '../../data/mockResults';
import type { TtkSeries, TtkPoint } from '../../data/mockResults';
import { PinRotationControl } from './PinRotationControl';
import { CATEGORICAL_PALETTE } from './chartPalette';

const TWO_MIN = 120;
const WIDTH = 440;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

const formatDmg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${(v / 1000).toFixed(0)}K`);
const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

function valueAtTime(points: TtkPoint[], t: number): number {
  if (t <= points[0].t) return points[0].dmg;
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const prev = points[i - 1];
      const cur = points[i];
      const frac = cur.t === prev.t ? 0 : (t - prev.t) / (cur.t - prev.t);
      return prev.dmg + frac * (cur.dmg - prev.dmg);
    }
  }
  return points[points.length - 1].dmg;
}

export const TimeToKillChart: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const rows = useRotationStore(s => s.rows);
  const { pinned } = useComparisonStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const teamNames = team.filter(s => s.character).map(s => s.character);
  const seed = `${teamNames.join(',')}:${rows.length}`;

  const primary = useMemo(() => generateMockTtkSeries(seed || 'empty-team', 'This Rotation'), [seed]);
  const series: TtkSeries[] = pinned ? [primary, pinned.ttkSeries] : [primary];

  const domainMaxT = Math.max(...primary.points.map(p => p.t));
  const domainMaxDmg = Math.max(primary.bossMaxHp, ...series.flatMap(s => s.points.map(p => p.dmg))) * 1.05;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const xScale = (t: number) => PAD.left + (t / domainMaxT) * plotW;
  const yScale = (v: number) => PAD.top + plotH - (v / domainMaxDmg) * plotH;

  const pathFor = (points: TtkPoint[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t)} ${yScale(p.dmg)}`).join(' ');

  const handleMove: React.MouseEventHandler<SVGSVGElement> = e => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const t = Math.min(domainMaxT, Math.max(0, ((localX - PAD.left) / plotW) * domainMaxT));
    setHoverT(t);
  };

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Time to Kill</span>
        <PinRotationControl />
      </div>
      <svg
        ref={svgRef}
        className="ttk-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverT(null)}
      >
        {/* Y gridlines / ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const v = domainMaxDmg * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(v)} y2={yScale(v)} className="ttk-gridline" />
              <text x={PAD.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" className="ttk-axis-label">
                {formatDmg(v)}
              </text>
            </g>
          );
        })}

        {/* X axis ticks */}
        {[0, 30, 60, 90, 120, 150].filter(t => t <= domainMaxT).map(t => (
          <text key={t} x={xScale(t)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className="ttk-axis-label">
            {formatTime(t)}
          </text>
        ))}

        {/* Boss HP reference line */}
        <line
          x1={PAD.left} x2={WIDTH - PAD.right}
          y1={yScale(primary.bossMaxHp)} y2={yScale(primary.bossMaxHp)}
          className="ttk-reference-line"
        />
        <text x={WIDTH - PAD.right} y={yScale(primary.bossMaxHp) - 4} textAnchor="end" className="ttk-reference-label">
          Boss HP
        </text>

        {/* 2-minute reference line */}
        {TWO_MIN <= domainMaxT && (
          <>
            <line
              x1={xScale(TWO_MIN)} x2={xScale(TWO_MIN)}
              y1={PAD.top} y2={HEIGHT - PAD.bottom}
              className="ttk-reference-line"
            />
            <text x={xScale(TWO_MIN) + 4} y={PAD.top + 10} className="ttk-reference-label">
              2:00
            </text>
          </>
        )}

        {/* Series lines */}
        {series.map((s, i) => (
          <path key={s.label} d={pathFor(s.points)} className="ttk-line" stroke={CATEGORICAL_PALETTE[i]} fill="none" />
        ))}

        {/* Kill intercept markers */}
        {series.map((s, i) =>
          s.killTime !== null && s.killTime <= domainMaxT ? (
            <g key={`kill-${s.label}`}>
              <circle cx={xScale(s.killTime)} cy={yScale(s.bossMaxHp)} r={4} className="ttk-marker" fill={CATEGORICAL_PALETTE[i]} />
              {i === 0 && (
                <text x={xScale(s.killTime)} y={yScale(s.bossMaxHp) - 10} textAnchor="middle" className="ttk-marker-label">
                  Kill {formatTime(s.killTime)}
                </text>
              )}
            </g>
          ) : null
        )}

        {/* Hover crosshair */}
        {hoverT !== null && (
          <g>
            <line x1={xScale(hoverT)} x2={xScale(hoverT)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="ttk-crosshair" />
            {series.map((s, i) => (
              <circle
                key={`hover-${s.label}`}
                cx={xScale(hoverT)}
                cy={yScale(valueAtTime(s.points, hoverT))}
                r={4}
                className="ttk-marker"
                fill={CATEGORICAL_PALETTE[i]}
              />
            ))}
          </g>
        )}
      </svg>

      {hoverT !== null && (
        <div className="ttk-tooltip">
          <span className="ttk-tooltip-time">{formatTime(hoverT)}</span>
          {series.map((s, i) => (
            <span key={s.label} className="ttk-tooltip-row">
              <span className="ttk-tooltip-key" style={{ background: CATEGORICAL_PALETTE[i] }} />
              <span className="tooltip-val">{formatDmg(valueAtTime(s.points, hoverT))}</span>
              <span className="text-dim">{s.label}</span>
            </span>
          ))}
        </div>
      )}

      {series.length > 1 && (
        <div className="pie-chart-legend">
          {series.map((s, i) => (
            <div key={s.label} className="pie-chart-legend-row">
              <span className="pie-chart-swatch" style={{ background: CATEGORICAL_PALETTE[i] }} />
              <span className="pie-chart-legend-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
