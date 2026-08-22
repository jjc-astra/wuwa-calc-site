// src/components/results/DmgOverTimeChart.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { DmgOverTimeSeries, DmgOverTimePoint, DpsWindowKey } from '../../types/results';
import { PinRotationControl } from './PinRotationControl';
import { CATEGORICAL_PALETTE } from './chartPalette';
import { TooltipManager } from '../../utils/Common';

const TWO_MIN = 120;
// Initial/fallback logical width, used until the first ResizeObserver measurement lands --
// the real width tracks the chart's actual rendered pixel width (see chartWidth state below),
// so a wider container reveals more horizontal plot area instead of stretching a fixed-size
// chart (which would distort the axis/label text along with the geometry).
const DEFAULT_WIDTH = 440;
const HEIGHT = 220;
const PAD = { top: 22, right: 16, bottom: 30, left: 62 };
// How close (in seconds) the cursor needs to be to a kill/2-minute intercept before the
// hover snaps to its exact time, so the tooltip reads that intercept's precise values
// instead of an approximate nearby point.
const SNAP_PX = 8;

// Safe placeholder so every hook below can run unconditionally even before results exist --
// the component still bails to `null` after the hooks, per the Rules of Hooks.
const EMPTY_SERIES: DmgOverTimeSeries = { label: '', points: [{ t: 0, dmg: 0 }], bossMaxHp: 1, killTime: null, windowEnd: 0 };

// Same 4 windows/labels as TeamContributionPanel's dropdown, so picking "First Loop" here means
// the same thing it does there.
const DPS_TYPE_OPTIONS: Array<{ key: DpsWindowKey; label: string }> = [
  { key: 'opener', label: 'Opener' },
  { key: 'firstLoop', label: 'First Loop' },
  { key: 'avgLoop', label: 'Avg Loop' },
  { key: 'twoMin', label: '2-Min' }
];

type ViewMode = 'dmg' | 'dps';
// "Rolling avg of the past 1 second" per spec.
const DPS_WINDOW = 1;

// Picks a readable tick spacing for whichever window is selected -- an Opener window might be
// 8s long, a 2-Min window is 120s+, and one fixed tick set can't read well across that range.
function pickTickStep(domainMaxT: number): number {
  if (domainMaxT <= 15) return 2;
  if (domainMaxT <= 40) return 5;
  if (domainMaxT <= 80) return 10;
  if (domainMaxT <= 150) return 30;
  return 60;
}

// A label centered/anchored right at the plot's left or right edge would render half off the
// chart (SVG text isn't clipped to the viewBox by default, it just draws past it and gets cut
// off by the container) -- flip to "start"/"end" near either edge so it draws inward instead.
const EDGE_ZONE = 22;
function edgeAnchor(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x <= PAD.left + EDGE_ZONE) return 'start';
  if (x >= width - PAD.right - EDGE_ZONE) return 'end';
  return 'middle';
}

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
function buildDpsPoints(points: DmgOverTimePoint[], domainMaxT: number): DmgOverTimePoint[] {
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
  const [dpsType, setDpsType] = useState<DpsWindowKey>('twoMin');
  const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);

  const primarydmg = results?.dmgOverTimeSeries[dpsType] ?? EMPTY_SERIES;
  const dmgSeries: DmgOverTimeSeries[] = pinned ? [primarydmg, pinned.dmgOverTimeSeries[dpsType]] : [primarydmg];
  const domainMaxT = primarydmg.windowEnd;
  const hasChart = domainMaxT > 0;

  // Tracks the svg's actual rendered pixel width so a wider results panel reveals more plot
  // area at the same crisp scale, instead of stretching the existing layout to fit (which would
  // distort the axis/label text along with the line geometry). Re-runs when the svg itself
  // mounts/unmounts (the "no opener/loop" placeholder below renders no svg at all).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasChart]);

  // In DPS mode, every series' points are replaced with the derived rolling-average line --
  // label/bossMaxHp/killTime (all time- or total-based, not shape-of-the-line-based) still
  // carry over unchanged, so the rest of the chart (kill markers, snap times, legend) doesn't
  // need to know which mode it's in.
  const series: DmgOverTimeSeries[] =
    mode === 'dmg' ? dmgSeries : dmgSeries.map(s => ({ ...s, points: buildDpsPoints(s.points, domainMaxT) }));

  // Scaled to whatever's actually visible in the current window, not always up to Boss HP --
  // a short zoomed-in window (Opener, one loop) rarely gets anywhere near full Boss HP, and
  // forcing that into the domain would waste most of the chart's height on empty space above
  // a tiny line. The Boss HP reference line below only renders when it's actually in range.
  const domainMaxDmg = Math.max(1, ...series.flatMap(s => s.points.map(p => p.dmg))) * 1.05;

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
      {!hasChart ? (
        <div className="results-empty">
          {dpsType === 'opener' ? 'No opener in this rotation.' : 'No loop content in this rotation.'}
        </div>
      ) : (
        <>
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

        {/* X axis ticks -- spacing adapts to the selected window's width (an Opener window and
            a 2-Min window need very different tick density). */}
        {(() => {
          const step = pickTickStep(domainMaxT);
          const ticks: number[] = [];
          for (let t = 0; t <= domainMaxT; t += step) ticks.push(t);
          return ticks.map(t => (
            <text key={t} x={xScale(t)} y={HEIGHT - PAD.bottom + 16} textAnchor={edgeAnchor(xScale(t), WIDTH)} className="dmg-time-axis-label">
              {formatTime(t)}
            </text>
          ));
        })()}

        {/* Boss HP reference line -- a dmg-total concept only, not a rate, and only drawn when
            it's actually within the current window's scale (a short zoomed-in window rarely
            reaches it, and forcing it into the domain would flatten the visible line). Labeled
            from the left edge rather than the right -- kill markers tend to land late in a
            window, so anchoring here on the right would routinely collide with a "Kill" label
            sitting right on top of this same line. */}
        {mode === 'dmg' && primarydmg.bossMaxHp <= domainMaxDmg && (
          <>
            <line
              x1={PAD.left} x2={WIDTH - PAD.right}
              y1={yScale(primarydmg.bossMaxHp)} y2={yScale(primarydmg.bossMaxHp)}
              className="dmg-time-reference-line"
            />
            <text x={PAD.left + 4} y={yScale(primarydmg.bossMaxHp) - 4} textAnchor="start" className="dmg-time-reference-label">
              Boss HP
            </text>
          </>
        )}

        {/* No separate "2:00" vertical reference line -- in the 2-Min window (the only mode
            this would apply to), the window itself now ends at exactly t=120, so that line
            would always sit right on the plot's own right border and its label would always
            duplicate the x-axis's own last tick. Hover-snapping to exactly 2:00 (in snapTimes
            above) still works without it. */}

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
                y={Math.max(PAD.top + 8, yScale(valueAtTime(s.points, s.killTime)) - 10 - i * 13)}
                textAnchor={edgeAnchor(xScale(s.killTime), WIDTH)}
                className="dmg-time-marker-label"
                fill={CATEGORICAL_PALETTE[i]}
              >
                Kill {formatTime(s.killTime)}
              </text>
            </g>
          ) : null
        )}

        {/* 2-minute intercept markers -- only meaningful in the 2-Min window itself */}
        {dpsType === 'twoMin' && TWO_MIN <= domainMaxT &&
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
        </>
      )}
      <div className="dmg-time-window-row">
        <select
          className="base-select text-xs results-dps-type-select"
          value={dpsType}
          onChange={e => setDpsType(e.target.value as DpsWindowKey)}
        >
          {DPS_TYPE_OPTIONS.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
};
