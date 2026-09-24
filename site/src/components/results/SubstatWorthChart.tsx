// src/components/results/SubstatWorthChart.tsx
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useResultsSource } from './ResultsSource';
import { TooltipManager } from '../../utils/Common';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { UnitTabs } from '../common/UnitTabs';
import { formatStatValue } from '../../data/db';

const formatPct = (v: number) => `${v.toFixed(1)}%`;

type Direction = 'minus' | 'plus';
type Mode = 'team' | 'personal';

export const SubstatWorthChart: React.FC = () => {
  const source = useResultsSource();
  const { team, results } = source;
  const units = team.filter(s => s.character).map(s => s.character);
  const [activeUnit, setActiveUnit] = useState(units[0] || '');
  const [direction, setDirection] = useState<Direction>('plus');
  const [ownMode, setMode] = useState<Mode>('team');
  const mode: Mode = source.scope ?? ownMode;
  const unit = units.includes(activeUnit) ? activeUnit : units[0] || '';

  // min/max/default are the % DPS worth of a roll at that value, in the selected direction/mode
  // -- not the substat's own raw roll values (those only pick which value was tested).
  // Rows with zero effect (overcapped stat, or one this kit never touches) are dropped
  // instead of shown as a dead 0.0% line.
  const rows = useMemo(() => {
    const raw = unit ? results?.substatWorth[unit] ?? [] : [];
    return raw
      .map(r => ({
        substat: r.substat,
        roll: r.default,
        min: r[direction][mode].min,
        max: r[direction][mode].max,
        default: r[direction][mode].default
      }))
      .filter(r => r.min !== 0 || r.max !== 0 || r.default !== 0);
  }, [unit, results, direction, mode]);
  const scaleMax = Math.max(1, ...rows.map(r => r.max)) * 1.08;

  // Every row's track shares the same CSS Grid column, so one measurement covers them all.
  // A raw `left: X%` marker lands on a different fractional pixel per row, and anti-aliasing
  // makes some read thicker than others. Edges are snapped to whole *screen* pixels -- at 125% OS
  // scaling a CSS pixel is 1.25 of them -- counted from the track's own on-screen position.
  const trackRef = useRef<HTMLSpanElement>(null);
  const [track, setTrack] = useState({ width: 0, left: 0, dpr: 1 });

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // Measured synchronously before paint so the first render is already pixel-snapped. Zoom
    // changes devicePixelRatio and the track's CSS width together, so ResizeObserver covers it.
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setTrack({ width: rect.width, left: rect.left, dpr: window.devicePixelRatio || 1 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [unit]);

  // A CSS x offset within the track, moved to the nearest screen-pixel boundary.
  const snapX = (pct: number, shiftScreenPx = 0) =>
    Math.round((track.left + (pct / 100) * track.width) * track.dpr - shiftScreenPx) / track.dpr - track.left;
  // The Default marker: a whole number of screen pixels wide (~3 CSS px), centered on its value.
  const markerScreenPx = Math.max(2, Math.round(3 * track.dpr));

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Substat Worth ({mode === 'team' ? 'Team' : 'Personal'})</span>
        <div className="results-card-header-controls">
          {!source.scope && (
            <SegmentedToggle
              ariaLabel="Substat worth scope"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'team', label: 'Team', tooltip: "Show % change of the whole team's damage" },
                { value: 'personal', label: 'Personal', tooltip: "Show % change of just this unit's own damage" }
              ]}
            />
          )}
          <SegmentedToggle
            ariaLabel="Substat worth direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'minus', label: '-1', tooltip: "Show what you'd lose without this roll" },
              { value: 'plus', label: '+1', tooltip: 'Show what an extra roll would gain' }
            ]}
          />
        </div>
      </div>
      {units.length === 0 ? (
        <div className="results-empty">Add characters to the team to see substat worth.</div>
      ) : (
        <>
          <UnitTabs tabs={units} active={unit} onSelect={setActiveUnit} />
          <div className="substat-chart">
            <div className="substat-chart-headrow">
              <span className="substat-roll-col" />
              <span className="substat-label-col" />
              <span className="substat-track-col" />
              <span className="substat-col-header">Min</span>
              <span className="substat-col-header">Default</span>
              <span className="substat-col-header">Max</span>
            </div>
            {rows.map((row, idx) => {
              // Worth doesn't strictly increase with roll size near overcap (e.g. a big Crit Rate
              // roll can be worth *less* than a smaller one past 100% crit) -- guard edges, don't assume min <= max.
              const lo = Math.min(row.min, row.max);
              const hi = Math.max(row.min, row.max);
              const minPct = (lo / scaleMax) * 100;
              const maxPct = (hi / scaleMax) * 100;
              const defPct = (row.default / scaleMax) * 100;

              // Snap the range bar's edges the same way (not raw min%/width%) to avoid the same pixel inconsistency.
              const rangeLeft = track.width > 0 ? snapX(minPct) : null;
              const rangeRight = track.width > 0 ? snapX(maxPct) : null;

              return (
                <div key={row.substat} className="substat-row">
                  <span className="substat-roll-col">{formatStatValue(row.substat, row.roll)}</span>
                  <span className="substat-label-col">{row.substat}</span>
                  <span className="substat-track-col">
                    <span className="bar-track" ref={idx === 0 ? trackRef : undefined}>
                      <span
                        className="bar-fill"
                        style={
                          rangeLeft !== null
                            ? { left: `${rangeLeft}px`, width: `${rangeRight! - rangeLeft}px` }
                            : { left: `${minPct}%`, width: `${maxPct - minPct}%` }
                        }
                      />
                      <span
                        className="substat-default-marker"
                        style={
                          track.width > 0
                            ? { left: `${snapX(defPct, markerScreenPx / 2)}px`, width: `${markerScreenPx / track.dpr}px`, marginLeft: 0 }
                            : { left: `${defPct}%` }
                        }
                        onMouseEnter={e =>
                          TooltipManager.show(
                            e.currentTarget,
                            `<div class="tooltip-val">${formatPct(row.default)}</div><div style="margin-top:2px;">Default roll worth — ${row.substat}</div>`
                          )
                        }
                        onMouseLeave={() => TooltipManager.hide()}
                      />
                    </span>
                  </span>
                  <span className="substat-col-value">{formatPct(row.min)}</span>
                  <span className="substat-col-value text-gold">{formatPct(row.default)}</span>
                  <span className="substat-col-value">{formatPct(row.max)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
