// src/components/results/SubstatWorthChart.tsx
import React, { useMemo, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { generateMockSubstatWorth } from '../../data/mockResults';
import { TooltipManager } from '../../utils/Common';

const formatPct = (v: number) => `${v.toFixed(1)}%`;

export const SubstatWorthChart: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const units = team.filter(s => s.character).map(s => s.character);
  const [activeUnit, setActiveUnit] = useState(units[0] || '');
  const unit = units.includes(activeUnit) ? activeUnit : units[0] || '';

  const rows = useMemo(() => (unit ? generateMockSubstatWorth(unit) : []), [unit]);
  const scaleMax = Math.max(1, ...rows.map(r => r.max)) * 1.08;

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Substat Worth</span>
      </div>
      {units.length === 0 ? (
        <div className="results-empty">Add characters to the team to see substat worth.</div>
      ) : (
        <>
          <div className="unit-tabs">
            {units.map(u => (
              <button key={u} type="button" className={`unit-tab ${u === unit ? 'is-active' : ''}`} onClick={() => setActiveUnit(u)}>
                {u}
              </button>
            ))}
          </div>
          <div className="substat-chart">
            <div className="substat-chart-headrow">
              <span className="substat-label-col" />
              <span className="substat-track-col" />
              <span className="substat-col-header">Min</span>
              <span className="substat-col-header">Default</span>
              <span className="substat-col-header">Max</span>
            </div>
            {rows.map(row => {
              const minPct = (row.min / scaleMax) * 100;
              const maxPct = (row.max / scaleMax) * 100;
              const defPct = (row.default / scaleMax) * 100;
              return (
                <div key={row.substat} className="substat-row">
                  <span className="substat-label-col text-dim">{row.substat}</span>
                  <span className="substat-track-col">
                    <span className="substat-track">
                      <span className="substat-range" style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
                      <span
                        className="substat-default-marker"
                        style={{ left: `${defPct}%` }}
                        onMouseEnter={e =>
                          TooltipManager.show(
                            e.currentTarget,
                            `<div class="tooltip-val">${formatPct(row.default)}</div><div style="margin-top:2px;">Default roll — ${row.substat}</div>`
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
