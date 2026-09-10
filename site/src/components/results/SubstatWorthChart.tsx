// src/components/results/SubstatWorthChart.tsx
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { TooltipManager, tip } from '../../utils/Common';
import { UnitTabs } from '../common/UnitTabs';

const formatPct = (v: number) => `${v.toFixed(1)}%`;

type Direction = 'minus' | 'plus';
type Mode = 'team' | 'personal';

export const SubstatWorthChart: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const results = useRotationStore(s => s.results);
  const units = team.filter(s => s.character).map(s => s.character);
  const [activeUnit, setActiveUnit] = useState(units[0] || '');
  const [direction, setDirection] = useState<Direction>('plus');
  const [mode, setMode] = useState<Mode>('team');
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
        min: r[direction][mode].min,
        max: r[direction][mode].max,
        default: r[direction][mode].default
      }))
      .filter(r => r.min !== 0 || r.max !== 0 || r.default !== 0);
  }, [unit, results, direction, mode]);
  const scaleMax = Math.max(1, ...rows.map(r => r.max)) * 1.08;

  // Every row's track shares the same CSS Grid width, so one measurement covers them all.
  // A raw `left: X%` marker lands on a different fractional pixel per row, and anti-aliasing
  // makes some read thicker than others. Snapping to a whole pixel fixes that.
  const trackRef = useRef<HTMLSpanElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // Measured synchronously before paint so the first render is already pixel-snapped;
    // ResizeObserver only needed for later resizes.
    setTrackWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => setTrackWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [unit]);

  const snapPct = (pct: number) => (trackWidth > 0 ? `${Math.round((pct / 100) * trackWidth)}px` : `${pct}%`);

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Substat Worth</span>
        <div className="results-card-header-controls">
          <div className="segmented-toggle" role="group" aria-label="Substat worth scope">
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'team' ? 'is-active' : ''}`}
              {...tip("Show % change of the whole team's damage")}
              onClick={() => setMode('team')}
            >
              Team
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${mode === 'personal' ? 'is-active' : ''}`}
              {...tip("Show % change of just this unit's own damage")}
              onClick={() => setMode('personal')}
            >
              Personal
            </button>
          </div>
          <div className="segmented-toggle" role="group" aria-label="Substat worth direction">
            <button
              type="button"
              className={`segmented-toggle-btn ${direction === 'minus' ? 'is-active' : ''}`}
              {...tip("Show what you'd lose without this roll")}
              onClick={() => setDirection('minus')}
            >
              -1
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${direction === 'plus' ? 'is-active' : ''}`}
              {...tip('Show what an extra roll would gain')}
              onClick={() => setDirection('plus')}
            >
              +1
            </button>
          </div>
        </div>
      </div>
      {units.length === 0 ? (
        <div className="results-empty">Add characters to the team to see substat worth.</div>
      ) : (
        <>
          <UnitTabs tabs={units} active={unit} onSelect={setActiveUnit} />
          <div className="substat-chart">
            <div className="substat-chart-headrow">
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
              const rangeLeft = trackWidth > 0 ? Math.round((minPct / 100) * trackWidth) : null;
              const rangeRight = trackWidth > 0 ? Math.round((maxPct / 100) * trackWidth) : null;

              return (
                <div key={row.substat} className="substat-row">
                  <span className="substat-label-col">{row.substat}</span>
                  <span className="substat-track-col">
                    <span className="substat-track" ref={idx === 0 ? trackRef : undefined}>
                      <span
                        className="substat-range"
                        style={
                          rangeLeft !== null
                            ? { left: `${rangeLeft}px`, width: `${rangeRight! - rangeLeft}px` }
                            : { left: `${minPct}%`, width: `${maxPct - minPct}%` }
                        }
                      />
                      <span
                        className="substat-default-marker"
                        style={{ left: snapPct(defPct) }}
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
