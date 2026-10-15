import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useResultsSource } from './ResultsSource';
import { TooltipManager, tip } from '../../utils/Common';
import { useRotationStore } from '../../store/useRotationStore';
import { SegmentedToggle } from '../common/SegmentedToggle';
import { UnitTabs } from '../common/UnitTabs';
import { formatStatValue } from '../../data/db';
import { teamCharacters } from '../../utils/TeamUtils';

const formatPct = (v: number) => `${v.toFixed(1)}%`;

type Direction = 'minus' | 'plus';
type Mode = 'team' | 'personal';

/** Each substat roll's worth: min-max range and the default roll. */
export const SubstatWorthChart: React.FC = () => {
  const source = useResultsSource();
  const { team, results } = source;
  const units = teamCharacters(team);
  const [activeUnit, setActiveUnit] = useState(units[0] || '');
  const [direction, setDirection] = useState<Direction>('plus');
  const [ownMode, setMode] = useState<Mode>('team');
  const mode: Mode = source.scope ?? ownMode;
  const substatWorthEnabled = useRotationStore(s => s.substatWorthEnabled);
  const setSubstatWorthEnabled = useRotationStore(s => s.setSubstatWorthEnabled);
  const unit = units.includes(activeUnit) ? activeUnit : units[0] || '';

  // Values are % DPS worth. Zero-effect rows are dropped.
  const rows = useMemo(() => {
    const raw = unit ? results?.substatWorth?.[unit] ?? [] : [];
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
  const hasRows = rows.length > 0;

  // One shared track measurement; edges snap to screen pixels for even thickness.
  const trackRef = useRef<HTMLSpanElement>(null);
  const [track, setTrack] = useState({ width: 0, left: 0, dpr: 1 });

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // Before paint; ResizeObserver also covers zoom.
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setTrack({ width: rect.width, left: rect.left, dpr: window.devicePixelRatio || 1 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [unit, hasRows]);

  const snapX = (pct: number, shiftScreenPx = 0) =>
    Math.round((track.left + (pct / 100) * track.width) * track.dpr - shiftScreenPx) / track.dpr - track.left;
  // ~3 CSS px, in whole screen pixels.
  const markerScreenPx = Math.max(2, Math.round(3 * track.dpr));

  return (
    <div className={`results-card ${source.isStale ? 'is-stale' : ''}`}>
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
          <div className="substat-tabs-row">
            <UnitTabs tabs={units} active={unit} onSelect={setActiveUnit} />
            {source.allowSubstatToggle && (
              <label className="toolbar-toggle-label" {...tip("Computes substat roll value: toggle off to speed up calculation runs.")}>
                <input type="checkbox" checked={substatWorthEnabled} onChange={e => setSubstatWorthEnabled(e.target.checked)} /> Substat Worth
              </label>
            )}
          </div>
          {results && !results.substatWorth ? (
            <div className="results-empty">Substat Worth was off for this Calculate. Turn it on and press Calculate.</div>
          ) : (
            <div className="substat-chart">
              <div className="substat-chart-headrow caps-label">
                <span className="substat-roll-col" />
                <span className="substat-label-col caps-label" />
                <span className="substat-track-col" />
                <span className="substat-col-header">Min</span>
                <span className="substat-col-header">Default</span>
                <span className="substat-col-header">Max</span>
              </div>
              {rows.map((row, idx) => {
                // min can exceed max near overcap.
                const lo = Math.min(row.min, row.max);
                const hi = Math.max(row.min, row.max);
                const minPct = (lo / scaleMax) * 100;
                const maxPct = (hi / scaleMax) * 100;
                const defPct = (row.default / scaleMax) * 100;

                const rangeLeft = track.width > 0 ? snapX(minPct) : null;
                const rangeRight = track.width > 0 ? snapX(maxPct) : null;

                return (
                  <div key={row.substat} className="substat-row">
                    <span className="substat-roll-col">{formatStatValue(row.substat, row.roll)}</span>
                    <span className="substat-label-col caps-label">{row.substat}</span>
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
          )}
        </>
      )}
    </div>
  );
};
