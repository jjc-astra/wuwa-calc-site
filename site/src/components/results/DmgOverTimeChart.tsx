import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { DmgOverTimeSeries, DpsWindowKey } from '../../types/results';
import { PinRotationControl } from './PinRotationControl';
import { ResultsLegend } from './ResultsLegend';
import { CATEGORICAL_PALETTE, colorForProvider, DPS_WINDOW_OPTIONS } from './chartPalette';
import { Dropdown } from '../common/Dropdown';
import { TooltipManager, tip } from '../../utils/Common';
import { framesToSeconds } from '../../utils/Frames';

// This chart's domain is plain display-seconds, converted once at the boundary (toDisplaySeries)
// from the engine's Frames-typed series.
interface DisplayPoint { t: number; dmg: number; label?: string; }
interface DisplaySeries { label: string; points: DisplayPoint[]; bossMaxHp: number; killTime: number | null; windowEnd: number; }

function toDisplaySeries(s: DmgOverTimeSeries): DisplaySeries {
  return {
    label: s.label,
    points: s.points.map(p => ({ t: framesToSeconds(p.t), dmg: p.dmg, label: p.label })),
    bossMaxHp: s.bossMaxHp,
    killTime: s.killTime !== null ? framesToSeconds(s.killTime) : null,
    windowEnd: framesToSeconds(s.windowEnd)
  };
}

const TWO_MIN = 120;
// Fallback width until the first ResizeObserver measurement lands (see chartWidth state below).
const DEFAULT_WIDTH = 440;
const HEIGHT = 220;
const PAD = { top: 22, right: 16, bottom: 30, left: 62 };
// How close (in seconds) the cursor needs to be to a kill/2-minute intercept to snap to it.
const SNAP_PX = 8;

// Placeholder so every hook below can run unconditionally before results exist (Rules of Hooks).
const EMPTY_SERIES: DisplaySeries = { label: '', points: [{ t: 0, dmg: 0 }], bossMaxHp: 1, killTime: null, windowEnd: 0 };

type ViewMode = 'dmg' | 'dps';
type ChartType = 'line' | 'bar';
const DPS_WINDOW = 1;

// Picks a readable tick spacing for whichever window is selected (an Opener might be 8s, a
// 2-Min window 120s+).
function pickTickStep(domainMaxT: number): number {
  if (domainMaxT <= 15) return 2;
  if (domainMaxT <= 40) return 5;
  if (domainMaxT <= 80) return 10;
  if (domainMaxT <= 150) return 30;
  return 60;
}

// A label centered at the plot's edge draws half off-chart (SVG text isn't clipped to the
// viewBox) -- flip to "start"/"end" near either edge so it draws inward instead.
const EDGE_ZONE = 22;
function edgeAnchor(x: number, width: number): 'start' | 'middle' | 'end' {
  if (x <= PAD.left + EDGE_ZONE) return 'start';
  if (x >= width - PAD.right - EDGE_ZONE) return 'end';
  return 'middle';
}

const formatDmg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : `${(v / 1000).toFixed(0)}K`);
const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
// Full precision for tooltip content -- axis labels/ticks stay abbreviated (formatDmg/formatTime
// above) since those need to stay short, but a hovered value should read exactly.
const formatDmgPrecise = (v: number) => Math.round(v).toLocaleString();
const formatTimePrecise = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.round((t % 60) * 100) / 100;
  return `${m}:${Number.isInteger(s) ? String(s).padStart(2, '0') : s.toFixed(2).padStart(5, '0')}`;
};

function valueAtTime(points: DisplayPoint[], t: number): number {
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

// Same lookup as valueAtTime, but for the point's label, to color the hover dot/tooltip to
// match whichever unit's segment is under the cursor.
function labelAtTime(points: DisplayPoint[], t: number): string | undefined {
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) return points[i].label;
  }
  return points[points.length - 1].label;
}

// Derives a trailing-1s-average DPS line, sampled at every hit's timestamp and at that hit's
// +1s "expiry" timestamp, to capture the actual rise/decay shape instead of smearing it.
function buildDpsPoints(points: DisplayPoint[], domainMaxT: number): DisplayPoint[] {
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
  const [hoverBinIdx, setHoverBinIdx] = useState<number | null>(null);
  const [mode, setMode] = useState<ViewMode>('dmg');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [dpsType, setDpsType] = useState<DpsWindowKey>('twoMin');
  const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);

  const primarydmg = results ? toDisplaySeries(results.dmgOverTimeSeries[dpsType]) : EMPTY_SERIES;
  // A solo series keeps its engine label (e.g. "Opener"). Once pinned, both need a name that
  // identifies which rotation instead, matching DpsPanel's "Current" / pinned.label convention.
  const dmgSeries: DisplaySeries[] = pinned
    ? [{ ...primarydmg, label: 'Current' }, { ...toDisplaySeries(pinned.dmgOverTimeSeries[dpsType]), label: pinned.label }]
    : [primarydmg];
  const domainMaxT = primarydmg.windowEnd;
  const hasChart = domainMaxT > 0;

  // Tracks the svg's rendered pixel width so a wider panel reveals more plot area instead of
  // stretching the layout. Re-runs when the svg mounts/unmounts (the placeholder renders no svg).
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

  // In DPS mode, points are replaced with the rolling-average line; label/bossMaxHp/killTime
  // carry over unchanged so the rest of the chart doesn't need to know which mode it's in.
  const series: DisplaySeries[] =
    mode === 'dmg' ? dmgSeries : dmgSeries.map(s => ({ ...s, points: buildDpsPoints(s.points, domainMaxT) }));

  // Bar view is DMG-only (a DPS step chart just duplicates the rolling-average line with extra
  // steps) and single-series only (hidden whenever a comparison is pinned -- see the toggle
  // below), so either of those falls back to the line view regardless of the last chosen type.
  const effectiveChartType: ChartType = series.length > 1 || mode === 'dps' ? 'line' : chartType;
  const isBar = effectiveChartType === 'bar';

  // Bars are per-hit damage, not the cumulative total the line plots -- each bar is the delta
  // between consecutive cumulative points.
  const barHits: DisplayPoint[] = isBar
    ? series[0].points.slice(1).map((p, i) => ({ t: p.t, dmg: p.dmg - series[0].points[i].dmg, label: p.label }))
    : [];

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baselineY = PAD.top + plotH;
  const xScale = (t: number) => PAD.left + (t / domainMaxT) * plotW;

  const BAR_GAP = 1;
  const STACK_GAP = 1;
  const MIN_BAR_WIDTH = 1;
  const MAX_BAR_WIDTH = 10;
  const DESIRED_BAR_WIDTH = 3;
  const MIN_BIN_SECONDS = 1;
  const MAX_BIN_SECONDS = 2;
  // A 1-second bin alone can render too skinny on a wide/dense window (e.g. 2-Min) -- stretch
  // the bin toward DESIRED_BAR_WIDTH's worth of screen space first, capped at 2 seconds, rather
  // than settling for a 1px sliver. A short/sparse window already clears the desired width at
  // 1 second, so it stays there unchanged.
  const secondsForDesiredWidth = ((DESIRED_BAR_WIDTH + BAR_GAP) / plotW) * domainMaxT;
  const targetBinSeconds = Math.min(MAX_BIN_SECONDS, Math.max(MIN_BIN_SECONDS, secondsForDesiredWidth));
  const pxPerTargetBin = (targetBinSeconds / domainMaxT) * plotW;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(MIN_BAR_WIDTH, pxPerTargetBin - BAR_GAP));
  // A slice of time exactly as wide as one bar+gap on screen -- however many hits land inside
  // it, they stack into that one bar instead of drawing on top of each other.
  const binTimeWidth = ((barWidth + BAR_GAP) / plotW) * domainMaxT;

  interface BarBin { binIdx: number; x: number; t0: number; t1: number; hits: DisplayPoint[]; total: number; }
  const barBins: BarBin[] = [];
  if (isBar) {
    const byBin = new Map<number, DisplayPoint[]>();
    for (const hit of barHits) {
      const binIdx = Math.floor(hit.t / binTimeWidth);
      const bucket = byBin.get(binIdx);
      if (bucket) bucket.push(hit);
      else byBin.set(binIdx, [hit]);
    }
    for (const [binIdx, hits] of Array.from(byBin.entries()).sort((a, b) => a[0] - b[0])) {
      barBins.push({
        binIdx,
        x: PAD.left + binIdx * (barWidth + BAR_GAP),
        t0: binIdx * binTimeWidth,
        t1: (binIdx + 1) * binTimeWidth,
        hits,
        total: hits.reduce((sum, h) => sum + h.dmg, 0)
      });
    }
  }

  // Scaled to what's visible in the current window, not always up to Boss HP (a short zoomed-in
  // window rarely gets near it). The Boss HP reference line below only renders when in range.
  const domainMaxDmg = Math.max(1, ...series.flatMap(s => s.points.map(p => p.dmg))) * 1.05;
  // A binned stack's magnitude has nothing to do with the cumulative total, so bars get their
  // own y-domain instead of sharing domainMaxDmg (which would flatten every bar to nothing).
  const activeDomainMax = isBar ? Math.max(1, ...barBins.map(b => b.total)) * 1.05 : domainMaxDmg;
  const yScale = (v: number) => PAD.top + plotH - (v / activeDomainMax) * plotH;

  const pathFor = (points: DisplayPoint[]) => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t)} ${yScale(p.dmg)}`).join(' ');
  const formatValue = (v: number) => (mode === 'dps' ? `${formatDmg(v)}/s` : formatDmg(v));
  const formatValuePrecise = (v: number) => (mode === 'dps' ? `${formatDmgPrecise(v)}/s` : formatDmgPrecise(v));

  // Every kill intercept plus the shared 2-minute mark; hovering near one snaps to its exact time.
  const snapTimes = useMemo(() => {
    const times = series.map(s => s.killTime).filter((t): t is number => t !== null && t <= domainMaxT);
    if (TWO_MIN <= domainMaxT) times.push(TWO_MIN);
    return times;
  }, [series, domainMaxT]);

  useEffect(() => () => TooltipManager.hide(), []);

  // Matches the line's per-segment coloring for a solo series, or falls back to a fixed
  // per-series color once a pinned comparison needs two visually distinct lines.
  const colorForSeriesAt = (s: DisplaySeries, i: number, t: number): string => {
    if (series.length > 1) return CATEGORICAL_PALETTE[i];
    const label = labelAtTime(s.points, t);
    return label ? colorForProvider(label) : CATEGORICAL_PALETTE[0];
  };

  const buildTooltipHtml = (t: number) =>
    `<div class="dmg-time-tooltip-time">${formatTimePrecise(t)}</div>` +
    series
      .map(
        (s, i) =>
          `<div class="dmg-time-tooltip-row"><span class="dmg-time-tooltip-key" style="background:${colorForSeriesAt(s, i, t)}"></span>` +
          `<span class="tooltip-val">${formatValuePrecise(valueAtTime(s.points, t))}</span> <span class="text-dim">${s.label}</span></div>`
      )
      .join('');

  // A bin's tooltip breaks its stack down by unit instead of showing one line -- several hits
  // (possibly from different units) can share a bin.
  const buildBinTooltipHtml = (bin: BarBin) => {
    const byLabel = new Map<string, number>();
    for (const hit of bin.hits) {
      const key = hit.label ?? 'Other';
      byLabel.set(key, (byLabel.get(key) ?? 0) + hit.dmg);
    }
    const rows = Array.from(byLabel.entries())
      .sort((a, b) => b[1] - a[1])
      .map(
        ([label, val]) =>
          `<div class="dmg-time-tooltip-row"><span class="dmg-time-tooltip-key" style="background:${colorForProvider(label)}"></span>` +
          `<span class="tooltip-val">${formatValuePrecise(val)}</span> <span class="text-dim">${label}</span></div>`
      )
      .join('');
    const timeLabel =
      bin.t1 - bin.t0 >= 0.02 ? `${formatTimePrecise(bin.t0)}–${formatTimePrecise(bin.t1)}` : formatTimePrecise(bin.t0);
    return `<div class="dmg-time-tooltip-time">${timeLabel}</div>${rows}`;
  };

  const handleMove: React.MouseEventHandler<SVGSVGElement> = e => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;

    if (isBar) {
      setHoverT(null);
      if (barBins.length === 0) { setHoverBinIdx(null); TooltipManager.hide(); return; }
      let bestIdx = 0;
      let bestDist = Math.abs(barBins[0].x + barWidth / 2 - localX);
      for (let i = 1; i < barBins.length; i++) {
        const dist = Math.abs(barBins[i].x + barWidth / 2 - localX);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      setHoverBinIdx(bestIdx);
      TooltipManager.showAtPoint(e.clientX, e.clientY, buildBinTooltipHtml(barBins[bestIdx]));
      return;
    }

    setHoverBinIdx(null);
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
    setHoverBinIdx(null);
    TooltipManager.hide();
  };

  if (!results) return null;

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Dmg Over Time</span>
        <div className="results-card-header-controls">
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
        <ResultsLegend items={series.map((s, i) => ({ label: s.label, color: CATEGORICAL_PALETTE[i] }))} />
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
          const v = activeDomainMax * f;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yScale(v)} y2={yScale(v)} className="dmg-time-gridline" />
              <text x={PAD.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" className="dmg-time-axis-label">
                {formatValue(v)}
              </text>
            </g>
          );
        })}

        {/* X axis ticks -- spacing adapts to the selected window's width. */}
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

        {/* Boss HP reference line -- only drawn in range; labeled from the left since kill
            markers tend to land late in a window and would collide with a right-side label. */}
        {mode === 'dmg' && !isBar && primarydmg.bossMaxHp <= activeDomainMax && (
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

        {/* No separate "2:00" reference line -- the 2-Min window already ends at t=120, so it
            would just duplicate the x-axis's last tick. Hover-snapping to 2:00 still works. */}

        {/* Series lines: colored per-segment by unit for a solo series (matches the Team
            Contribution pie); one solid color per line once a pinned comparison needs them
            visually distinguishable. Bars are DMG-only and single-series only -- one bin per
            thin time slice, stacked by unit when more than one hit lands in it. */}
        {isBar
          ? barBins.map(bin => {
              let cumulative = 0;
              return bin.hits.map((hit, hi) => {
                const bottomY = baselineY - (cumulative / activeDomainMax) * plotH;
                cumulative += hit.dmg;
                const topY = baselineY - (cumulative / activeDomainMax) * plotH;
                const color = hit.label ? colorForProvider(hit.label) : CATEGORICAL_PALETTE[0];
                // Shaved off each segment's top edge so consecutive hits in a stack read as
                // distinct pieces instead of one solid blend.
                const height = Math.max(0, bottomY - topY - STACK_GAP);
                return (
                  <rect
                    key={`${bin.binIdx}-${hi}`}
                    x={bin.x} y={topY} width={barWidth} height={height}
                    fill={color} className="dmg-time-bar"
                  />
                );
              });
            })
          : series.length === 1
          ? series[0].points.slice(1).map((p, i) => {
              const prev = series[0].points[i];
              return (
                <line
                  key={i}
                  x1={xScale(prev.t)} y1={yScale(prev.dmg)}
                  x2={xScale(p.t)} y2={yScale(p.dmg)}
                  className="dmg-time-line"
                  stroke={p.label ? colorForProvider(p.label) : CATEGORICAL_PALETTE[0]}
                />
              );
            })
          : series.map((s, i) => (
              <path key={s.label} d={pathFor(s.points)} className="dmg-time-line" stroke={CATEGORICAL_PALETTE[i]} fill="none" />
            ))}

        {/* Kill intercept markers, labeled for every series. Y position reads this series'
            value at kill time (bossMaxHp in dmg mode; the DPS line's value in DPS mode) --
            skipped in bar mode, which plots per-hit deltas on a different y-domain. */}
        {!isBar && series.map((s, i) =>
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
        {!isBar && dpsType === 'twoMin' && TWO_MIN <= domainMaxT &&
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

        {/* Hover crosshair -- a bin's breakdown is in its tooltip already, so bar mode just
            marks which slice is under the cursor instead of a per-series value dot. */}
        {isBar
          ? hoverBinIdx !== null && (
              <line
                x1={barBins[hoverBinIdx].x + barWidth / 2} x2={barBins[hoverBinIdx].x + barWidth / 2}
                y1={PAD.top} y2={HEIGHT - PAD.bottom} className="dmg-time-crosshair"
              />
            )
          : hoverT !== null && (
              <g>
                <line x1={xScale(hoverT)} x2={xScale(hoverT)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="dmg-time-crosshair" />
                {series.map((s, i) => (
                  <circle
                    key={`hover-${s.label}`}
                    cx={xScale(hoverT)}
                    cy={yScale(valueAtTime(s.points, hoverT))}
                    r={4}
                    className="dmg-time-marker"
                    fill={colorForSeriesAt(s, i, hoverT)}
                  />
                ))}
              </g>
            )}
      </svg>
        </>
      )}
      <div className="dmg-time-window-row">
        <div className="dmg-time-window-col-left">
          <div className="segmented-toggle" role="group" aria-label="Dmg over time view">
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'dmg' ? 'is-active' : ''}`}
              {...tip('Total damage accumulated over time')}
              onClick={() => setMode('dmg')}
            >
              DMG
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'dps' ? 'is-active' : ''}`}
              {...tip('Rolling average DPS over the past 1 second')}
              onClick={() => setMode('dps')}
            >
              DPS
            </button>
          </div>
        </div>
        {series.length === 1 && mode === 'dmg' && (
          <div className="dmg-time-window-col-center">
            <div className="segmented-toggle" role="group" aria-label="Chart type">
              <button
                type="button"
                className={`segmented-toggle-btn ${chartType === 'line' ? 'is-active' : ''}`}
                {...tip('Connected line')}
                onClick={() => setChartType('line')}
              >
                LINE
              </button>
              <button
                type="button"
                className={`segmented-toggle-btn ${chartType === 'bar' ? 'is-active' : ''}`}
                {...tip('One bar per hit')}
                onClick={() => setChartType('bar')}
              >
                BAR
              </button>
            </div>
          </div>
        )}
        <div className="dmg-time-window-col-right">
          <Dropdown
            className="base-select text-xs results-dps-type-select"
            value={dpsType}
            onChange={v => setDpsType(v as DpsWindowKey)}
            options={DPS_WINDOW_OPTIONS.map(opt => ({ value: opt.key, label: opt.label }))}
          />
        </div>
      </div>
    </div>
  );
};
