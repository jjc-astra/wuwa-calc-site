// The per-row damage breakdown: one accordion section per hit the row dealt, each with its
// crit/non-crit/average values, tags, formula, buff totals and the active buffs grouped by provider.
import React, { useState } from 'react';
import type { PanelConfig } from '../../data/db';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { toFrames, formatFramesAsSeconds } from '../../utils/Frames';
import { PanelInfoItem } from '../common/PanelInfoItem';
import { FormulaRow } from '../common/FormulaRow';
import { BuffCard } from '../common/BuffCard';
import { hitAverage, critSplit, groupBuffsBySource } from './damagePanelData';

interface DamageBreakdownPanelProps {
  config: Extract<PanelConfig, { type: 'complex_dmg' }>;
  row: any;
}

export const DamageBreakdownPanel: React.FC<DamageBreakdownPanelProps> = ({ config, row }) => {
  const { team } = useRosterStore();
  const [openInstances, setOpenInstances] = useState<Record<number, boolean>>({ 0: true });

  const instances = row.damageInstances || [];
  if (instances.length === 0) {
    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">{config.title}</div>
        <div className="empty-buff-state" style={{ padding: '20px', textAlign: 'center' }}>
          No damage instances dealt by this action.
        </div>
      </div>
    );
  }

  const weaponNames = Object.keys(DataLoader.weaponDB || {});

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">{config.title}</div>
      <div className="dmg-accordion-container">
        {instances.map((inst: any, idx: number) => {
          const instData = inst.data || { activeBuffs: {} };
          const avgVal = hitAverage(inst);
          const isOpen = !!openInstances[idx];
          const { nonCritVal, critVal } = critSplit(inst, instData, avgVal);
          const activeBuffs = Object.values(instData.activeBuffs || {});

          return (
            <div key={idx} className={`dmg-accordion-section ${isOpen ? 'is-open' : ''}`}>
              <div
                className="dmg-accordion-header"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
                onClick={() => setOpenInstances(p => ({ ...p, [idx]: !p[idx] }))}
              >
                <div className="flex-row align-center gap-sm" style={{ width: 'auto', flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
                  <svg className="dmg-accordion-icon" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <span
                    className="dmg-accordion-title"
                    style={{ flexGrow: 0, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                  >
                    {inst.title}
                  </span>
                  {typeof inst.gameTime === 'number' && (
                    <span className="dmg-accordion-time">{formatFramesAsSeconds(toFrames(inst.gameTime))}</span>
                  )}
                </div>
                <div
                  className="dmg-accordion-breakdown-values flex-row align-center"
                  style={{ gap: '12px', marginLeft: 'auto', width: 'auto', flexShrink: 0 }}
                >
                  <div className="flex-row align-center" style={{ paddingRight: '12px', borderRight: '1px solid rgba(255,255,255,0.15)', gap: '6px' }}>
                    <span className="text-dim" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.5px' }}>NON-CRIT</span>
                    <span style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 700 }}>{Math.floor(nonCritVal).toLocaleString()}</span>
                  </div>
                  <div className="flex-row align-center" style={{ paddingRight: '12px', borderRight: '1px solid rgba(255,255,255,0.15)', gap: '6px' }}>
                    <span className="text-dim" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.5px' }}>CRIT</span>
                    <span style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 700 }}>{Math.floor(critVal).toLocaleString()}</span>
                  </div>
                  <div className="flex-row align-center" style={{ gap: '6px' }}>
                    <span className="text-dim" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.5px' }}>AVG</span>
                    <span style={{ color: '#ffaa00', fontSize: '0.85rem', fontWeight: 700 }}>{Math.floor(avgVal).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {isOpen && (
                <div className="dmg-accordion-body">
                  <div className="panel-content-grid dmg-panel-top-row">
                    {config.tags.map((t) => {
                      const rawVals = Array.isArray(t.keys) ? t.keys.map((k: string) => instData[k]).filter(Boolean) : [instData[t.key ?? '']].filter(Boolean);
                      const cleanVals = rawVals.map((v: any) => (typeof v === 'number' ? CommonUtils.trimNumber(v) : v));
                      const displayVal = cleanVals.length > 0 ? cleanVals.join(', ') : (t.default || '-');
                      const formattedVal = displayVal !== '-' && t.suffix ? displayVal + t.suffix : displayVal;
                      return <PanelInfoItem key={t.key || t.label} label={t.label} value={formattedVal} extraClass={t.highlight} />;
                    })}
                  </div>

                  <FormulaRow formulaStr={instData.calcBreakdown} />

                  <div className="dmg-panel-main-grid">
                    <div className="dmg-panel-stats-col">
                      <div className="panel-header-tiny">Buff Totals</div>
                      <div className="table-wrapper">
                        <table className="dmg-stat-table">
                          <tbody>
                            {config.stats.map((s) => {
                              let label = s.label;
                              let key = s.key;
                              if (s.label === 'Scalar' || s.key === 'scalar') {
                                label = instData.scalarLabel || 'ATK';
                                key = 'scalarValue';
                              }
                              let val = instData[key] !== undefined ? instData[key] : '0';
                              if (typeof val === 'number') val = CommonUtils.trimNumber(val);
                              val += (s.suffix && val !== '0' && val !== 0) ? s.suffix : '';
                              return (
                                <tr key={s.key || s.label}>
                                  <td className="stat-table-label">{label}</td>
                                  <td className="stat-table-value">{val === '0' || val === '0%' ? <span className="text-dim">{val}</span> : val}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="dmg-panel-buffs-col">
                      <div className="panel-header-tiny">Active Buffs by Provider</div>
                      <div className="buff-provider-grid">
                        {team.map((slot, i) => {
                          const unitName = slot.character || `Slot ${i + 1}`;
                          const unitBuffs = activeBuffs.filter((b: any) => b.provider === unitName || (b.source && b.source.includes(unitName)));
                          const groupedBuffs = groupBuffsBySource(unitBuffs, slot, unitName, weaponNames);

                          return (
                            <div key={i} className="buff-provider-col">
                              <div className="buff-provider-header">{unitName}</div>
                              <div className="buff-list-container">
                                {Object.keys(groupedBuffs).length > 0 ? (
                                  Object.keys(groupedBuffs).map(source => (
                                    <BuffCard key={source} source={source} effects={groupedBuffs[source].effects} />
                                  ))
                                ) : (
                                  <div className="empty-buff-state">No buffs</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
