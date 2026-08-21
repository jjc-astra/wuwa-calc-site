// src/components/results/DmgOverTimeChart.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { DmgOverTimeSeries, DmgOverTimePoint } from '../../types/results';
import { PinRotationControl } from './PinRotationControl';
import { CATEGORICAL_PALETTE } from './chartPalette';
import { TooltipManager } from '../../utils/Common';

const TWO_MIN = 120;
const WIDTH = 440;
const HEIGHT = 220;
const PAD = { top: 22, right: 16, bottom: 30, left: 62 };
// How close (in seconds) the cursor needs to be to a kill/2-minute intercept before the
// hover snaps to its exact time, so the tooltip reads that intercept's precise values
// instead of an approximate nearby point.
const SNAP_PX = 8;

// Safe placeholder so every hook below can run unconditionally even before results exist --
// the component still bails to `null` after the hooks, per the Rules of Hooks.
const EMPTY_SERIES: DmgOverTimeSeries = { label: '', points: [{ t: 0, dmg: 0 }], bossMaxHp: 1, killTime: null };

type ViewMode = 'dmg' | 'dps';
// "Rolling avg of the past 1 second" per spec.
const DPS_WINDOW = 1;

const formatDmg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${(v / 1000).toFixed(0)}K`);
const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

function valueAtTime(points: DmgOverTimePoint[], t: number): number {
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

// Derives a trailing-1s-average DPS line from the dmg dmg points, sampled at every real
// hit's own timestamp (where the average jumps up) AND at that hit's +1s "expiry" timestamp
// (where it drops back out of the window) -- capturing the actual rise/decay shape a rolling
// average produces, rather than just linearly bridging between whatever hit timestamps happen
// to exist (which would smear a burst's decay into a random later sample).
function buildDpsPoints(points: DmgOverTimePoint[]): DmgOverTimePoint[] {
  const domainMaxT = points[points.length - 1].t;
  const criticalTimes = new Set<number>([0, domainMaxT]);
  points.forEach(p => {
    criticalTimes.add(p.t);
    if (p.t + DPS_WINDOW <= domainMaxT) criticalTimes.add(p.t + DPS_WINDOW);
  });
  return Array.from(criticalTimes)
    .sort((a, b) => a - b)
    .map(t => {
      const windowStart = Math.max(0, t - DPS_WINDOW);
      const windowLen = t - windowStart;
      const dmg = windowLen > 0 ? (valueAtTime(points, t) - valueAtTime(points, windowStart)) / windowLen : 0;
      return { t, dmg };
    });
}

export const DmgOverTimeChart: React.FC = () => {
  const results = useRotationStore(s => s.results);
  const { pinned } = useComparisonStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>('dmg');

  const primarydmg = results?.dmgOverTimeSeries ?? EMPTY_SERIES;
  const dmgSeries: DmgOverTimeSeries[] = pinned ? [primarydmg, pinned.dmgOverTimeSeries] : [primarydmg];
  // In DPS mode, every series' points are replaced with the derived rolling-average line --
  // label/bossMaxHp/killTime (all time- or total-based, not shape-of-the-line-based) still
  // carry over unchanged, so the rest of the chart (kill markers, snap times, legend) doesn't
  // need to know which mode it's in.
  const series: DmgOverTimeSeries[] =
    mode === 'dmg' ? dmgSeries : dmgSeries.map(s => ({ ...s, points: buildDpsPoints(s.points) }));

  const domainMaxT = Math.max(...primarydmg.points.map(p => p.t));
  const domainMaxDmg =
    mode === 'dmg'
      ? Math.max(primarydmg.bossMaxHp, ...series.flatMap(s => s.points.map(p => p.dmg))) * 1.05
      : Math.max(1, ...series.flatMap(s => s.points.map(p => p.dmg))) * 1.05;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const xScale = (t: number) => PAD.left + (t / domainMaxT) * plotW;
  const yScale = (v: number) => PAD.top + plotH - (v / domainMaxDmg) * plotH;

  const pathFor = (points: DmgOverTimePoint[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t)} ${yScale(p.dmg)}`).join(' ');
  const formatValue = (v: number) => (mode === 'dps' ? `${formatDmg(v)}/s` : formatDmg(v));

  // Every kill intercept (one per series) plus the shared 2-minute mark -- hovering near any
  // of these snaps the cursor to its exact time, so the tooltip reads its precise value
  // instead of whatever's approximately nearby.
  const snapTimes = useMemo(() => {
    const times = series.map(s => s.killTime).filter((t): t is number => t !== null && t <= domainMaxT);
    if (TWO_MIN <= domainMaxT) times.push(TWO_MIN);
    return times;
  }, [series, domainMaxT]);

  // Tooltip follows the cursor rather than sitting in a fixed spot, so it stays readable at
  // whatever point along the line the reader is actually looking at.
  useEffect(() => () => TooltipManager.hide(), []);

  const buildTooltipHtml = (t: number) =>
    `<div class="dmg-time-tooltip-time">${formatTime(t)}</div>` +
    series
      .map(
        (s, i) =>
          `<div class="dmg-time-tooltip-row"><span class="dmg-time-tooltip-key" style="background:${CATEGORICAL_PALETTE[i]}"></span>` +
          `<span class="tooltip-val">${formatValue(valueAtTime(s.points, t))}</span> <span class="text-dim">${s.label}</span></div>`
      )
      .join('');

  const handleMove: React.MouseEventHandler<SVGSVGElement> = e => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    let t = Math.min(domainMaxT, Math.max(0, ((localX - PAD.left) / plotW) * domainMaxT));

    const snapThresholdT = (SNAP_PX / plotW) * domainMaxT;
    const nearestSnap = snapTimes.reduce<{ time: number; dist: number } | null>((best, snapT) => {
      const dist = Math.abs(snapT - t);
      return !best || dist < best.dist ? { time: snapT, dist } : best;
    }, null);
    if (nearestSnap && nearestSnap.dist <= snapThresholdT) t = nearestSnap.time;

    setHoverT(t);
    TooltipManager.showAtPoint(e.clientX, e.clientY, buildTooltipHtml(t));
  };

  const handleLeave = () => {
    setHoverT(null);
    TooltipManager.hide();
  };

  if (!results) return null;

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Dmg Over Time</span>
        <div className="results-card-header-controls">
          <div className="segmented-toggle" role="group" aria-label="Dmg over time view">
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'dmg' ? 'is-active' : ''}`}
              title="Total damage accumulated over time"
              onClick={() => setMode('dmg')}
            >
              DMG
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'dps' ? 'is-active' : ''}`}
              title="Rolling average DPS over the past 1 second"
              onClick={() => setMode('dps')}
            >
              DPS
            </button>
          </div>
          <PinRotationControl />
        </div>
      </div>
      {series.length > 1 && (
        <div className="results-legend">
          {series.map((s, i) => (
            <span key={s.label} className="results-legend-item">
              <span className="results-legend-swatch" style={{ background: CATEGORICAL_PALETTE[i] }} />
              <span className="text-dim">{s.label}</span>
            </span>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        className="dmg-time-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {/* Y gridlines / ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const v = domainMaxDmg * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(v)} y2={yScale(v)} className="dmg-time-gridline" />
              <text x={PAD.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" className="dmg-time-axis-label">
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* X axis ticks */}
        {[0, 30, 60, 90, 120, 150].filter(t => t <= domainMaxT).map(t => (
          <text key={t} x={xScale(t)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" className="dmg-time-axis-label">
            {formatTime(t)}
          </text>
        ))}

        {/* Boss HP reference line -- a dmg-total concept only, not a rate */}
        {mode === 'dmg' && (
          <>
            <line
              x1={PAD.left} x2={WIDTH - PAD.right}
              y1={yScale(primarydmg.bossMaxHp)} y2={yScale(primarydmg.bossMaxHp)}
              className="dmg-time-reference-line"
            />
            <text x={WIDTH - PAD.right} y={yScale(primarydmg.bossMaxHp) - 4} textAnchor="end" className="dmg-time-reference-label">
              Boss HP
            </text>
          </>
        )}

        {/* 2-minute reference line */}
        {TWO_MIN <= domainMaxT && (
          <>
            <line
              x1={xScale(TWO_MIN)} x2={xScale(TWO_MIN)}
              y1={PAD.top} y2={HEIGHT - PAD.bottom}
              className="dmg-time-reference-line"
            />
            <text x={xScale(TWO_MIN) + 4} y={PAD.top + 10} className="dmg-time-reference-label">
              2:00
            </text>
          </>
        )}

        {/* Series lines */}
        {series.map((s, i) => (
          <path key={s.label} d={pathFor(s.points)} className="dmg-time-line" stroke={CATEGORICAL_PALETTE[i]} fill="none" />
        ))}

        {/* Kill intercept markers -- labeled for every series, not just the primary one. Y
            position reads this series' own value at kill time -- in dmg mode that's
            just bossMaxHp again (kill time is defined as exactly when dmg crosses it),
            in DPS mode it's wherever the rolling-average line happens to sit at that instant. */}
        {series.map((s, i) =>
          s.killTime !== null && s.killTime <= domainMaxT ? (
            <g key={`kill-${s.label}`}>
              <circle cx={xScale(s.killTime)} cy={yScale(valueAtTime(s.points, s.killTime))} r={4} className="dmg-time-marker" fill={CATEGORICAL_PALETTE[i]} />
              <text
                x={xScale(s.killTime)}
                y={yScale(valueAtTime(s.points, s.killTime)) - 10 - i * 13}
                textAnchor="middle"
                className="dmg-time-marker-label"
                fill={CATEGORICAL_PALETTE[i]}
              >
                Kill {formatTime(s.killTime)}
              </text>
            </g>
          ) : null
        )}

        {/* 2-minute intercept markers */}
        {TWO_MIN <= domainMaxT &&
          series.map((s, i) => (
            <circle
              key={`two-min-${s.label}`}
              cx={xScale(TWO_MIN)}
              cy={yScale(valueAtTime(s.points, TWO_MIN))}
              r={4}
              className="dmg-time-marker"
              fill={CATEGORICAL_PALETTE[i]}
            />
          ))}

        {/* Hover crosshair */}
        {hoverT !== null && (
          <g>
            <line x1={xScale(hoverT)} x2={xScale(hoverT)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="dmg-time-crosshair" />
            {series.map((s, i) => (
              <circle
                key={`hover-${s.label}`}
                cx={xScale(hoverT)}
                cy={yScale(valueAtTime(s.points, hoverT))}
                r={4}
                className="dmg-time-marker"
                fill={CATEGORICAL_PALETTE[i]}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
};
