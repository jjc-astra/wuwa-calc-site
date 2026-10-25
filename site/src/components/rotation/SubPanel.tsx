import React from 'react';
import { PANEL_CONFIG } from '../../data/db';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { forteLabel } from '../../utils/ForteNames';
import { forteSlotOf } from '../../utils/ResourceKeys';
import { PanelInfoItem } from '../common/PanelInfoItem';
import { DamageBreakdownPanel } from './DamageBreakdownPanel';
import { toFrames, framesToSeconds, formatFramesAsSeconds, formatSignedSeconds } from '../../utils/Frames';

interface SubPanelProps {
  trigger: string;
  row: any;
}

/** A row's detail panel for the clicked cell. */
export const SubPanel: React.FC<SubPanelProps> = ({ trigger, row }) => {
  const config = PANEL_CONFIG[trigger];
  if (!config) return null;

  if (config.type === 'complex_dmg') return <DamageBreakdownPanel config={config} row={row} />;

  // Timeline
  if (config.type === 'complex_time') {
    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">{config.title}</div>
        <div className="complex-time-container">
          {config.groups.map((group, idx: number) => (
            <div key={idx} className="time-panel-group" style={{ marginBottom: '0.75rem' }}>
              <div
                className="panel-header-tiny"
                style={{ marginBottom: '0.375rem', paddingBottom: '0.25rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
              >
                {group.title}
              </div>
              <div className="panel-content-grid">
                {group.fields.map((f) => {
                  const rawVal = row[f.key] !== undefined ? row[f.key] : f.default;
                  // Frames shown as seconds.
                  const genericVal = typeof rawVal === 'number' ? CommonUtils.trimNumber(rawVal) : rawVal;
                  const displayVal =
                    typeof rawVal === 'number' && f.suffix === 's'
                      ? formatFramesAsSeconds(toFrames(rawVal))
                      : `${genericVal}${f.suffix || ''}`;
                  return <PanelInfoItem key={f.key} label={f.label} value={displayVal} extraClass={f.highlight} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Offset
  if (trigger === 'offset') {
    const reasons = row.offsetReasons || [];
    const offsetVal = framesToSeconds(toFrames(row.offset || 0));
    const offsetStr = formatSignedSeconds(offsetVal);
    const offsetClass = offsetVal > 0 ? 'text-gold' : offsetVal < 0 ? 'text-main' : 'text-dim';

    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">Offset Breakdown</div>
        <div className="panel-content-grid" style={{ gridTemplateColumns: '1fr', marginBottom: '1rem' }}>
          <div className="panel-info-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 0.875rem' }}>
            <span className="panel-info-label caps-label" style={{ marginBottom: 0 }}>Total Offset</span>
            <span className={`panel-info-value ${offsetClass} text-bold`} style={{ fontSize: '1rem' }}>{offsetStr}</span>
          </div>
        </div>
        <div className="panel-header-tiny" style={{ marginBottom: '0.5rem' }}>Offset Sources</div>
        <div className="buff-card" style={{ padding: '0.75rem' }}>
          {reasons.length > 0 ? (
            reasons.map((r: any, idx: number) => {
              const secs = framesToSeconds(toFrames(r.valueFrames));
              const str = formatSignedSeconds(secs);
              const isZero = r.valueFrames === 0;
              return (
                <div key={idx} className="buff-effect-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
                  <span className="buff-effect-label">{r.label}:</span>
                  <span className={`buff-val-box text-bold ${r.isNegative ? 'text-main' : isZero ? 'text-dim' : 'text-gold'}`}>{str}</span>
                </div>
              );
            })
          ) : (
            <div className="empty-buff-state" style={{ padding: '0.75rem' }}>Standard Execution (No Offset)</div>
          )}
        </div>
      </div>
    );
  }

  // Gauges and resources
  const u = row.unit;
  const forteSlot = forteSlotOf(trigger);
  const title = forteSlot !== null ? `${forteLabel(DataLoader.characterDB[u], forteSlot)} Breakdown` : config.title;
  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">{title}</div>
      <div className="panel-content-grid">
        {config.fields.map((f) => {
          let stateVal = row[f.key];
          if (f.key === 'tune' && row.enemyTune !== undefined) stateVal = row.enemyTune;
          if (stateVal && typeof stateVal === 'object' && !Array.isArray(stateVal)) {
            stateVal = stateVal[u];
          }

          // Per-move resource delta trackers.
          const trackerVal = row.trackers?.[f.key] ?? row.dropdownState?.trackers?.[f.key];
          const rawVal = stateVal ?? trackerVal ?? f.default;
          if (f.hideIfZero && !(typeof rawVal === 'number' && Math.abs(rawVal) > 1e-9)) return null;

          let displayVal = rawVal;
          if (typeof rawVal === 'number') {
            displayVal = CommonUtils.trimNumber(rawVal);
            if (String(f.key).toLowerCase().includes('delta') && rawVal > 0) {
              displayVal = `+${displayVal}`;
            }
          }

          return <PanelInfoItem key={f.key} label={f.label} value={`${displayVal}${f.suffix || ''}`} extraClass={f.highlight} tooltip={f.tooltip} />;
        })}
      </div>
    </div>
  );
};