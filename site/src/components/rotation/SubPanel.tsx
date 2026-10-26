import React from 'react';
import { PANEL_CONFIG } from '../../data/db';
import { DamageBreakdownPanel } from './DamageBreakdownPanel';
import { MoveTimelinePanel } from './MoveTimelinePanel';
import { ResourceGaugePanel } from './ResourceGaugePanel';
import { toFrames, framesToSeconds, formatSignedSeconds } from '../../utils/Frames';

interface SubPanelProps {
  trigger: string;
  row: any;
  /** Sets the row's input pick (undefined: auto). */
  onInputChoice?: (choice: number | undefined) => void;
}

/** A row's detail panel for the clicked cell. */
export const SubPanel: React.FC<SubPanelProps> = ({ trigger, row, onInputChoice }) => {
  const config = PANEL_CONFIG[trigger];
  if (!config) return null;

  if (config.type === 'complex_dmg') return <DamageBreakdownPanel config={config} row={row} />;

  if (config.type === 'move_timeline') return <MoveTimelinePanel row={row} onInputChoice={onInputChoice} />;

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

  if (config.type === 'resource') return <ResourceGaugePanel title={config.title} resourceKey={config.resourceKey} row={row} />;
  return null;
};