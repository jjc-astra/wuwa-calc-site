// src/components/rotation/SubPanel.tsx
import React, { useState } from 'react';
import { PANEL_CONFIG } from '../../data/db';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { PanelInfoItem } from '../common/PanelInfoItem';
import { FormulaRow } from '../common/FormulaRow';
import { BuffCard } from '../common/BuffCard';

interface SubPanelProps {
  trigger: string;
  row: any;
}

export const SubPanel: React.FC<SubPanelProps> = ({ trigger, row }) => {
  const config = PANEL_CONFIG[trigger];
  const { team } = useRosterStore();
  const [openInstances, setOpenInstances] = useState<Record<number, boolean>>({ 0: true });

  if (!config) return null;

  // --- 1. DAMAGE PANEL ---
  if (config.type === 'complex_dmg') {
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

    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">{config.title}</div>
        <div className="dmg-accordion-container">
          {instances.map((inst: any, idx: number) => {
            const instData = inst.data || { activeBuffs: {} };
            const avgVal = typeof inst.avg === 'number' ? inst.avg : (typeof inst.total === 'number' ? inst.total : parseFloat(String(inst.total || 0).replace(/,/g, '')) || 0);
            const isOpen = !!openInstances[idx];

            let nonCritVal = inst.nonCrit;
            let critVal = inst.crit;
            if (nonCritVal === undefined || critVal === undefined) {
              let cr = instData.critRate !== undefined ? instData.critRate : 0;
              let cd = instData.critDmg !== undefined ? instData.critDmg : 150;
              if (typeof cr === 'string') cr = parseFloat(cr) || 0;
              if (cr > 1) cr = cr / 100;
              cr = Math.min(1.0, Math.max(0.0, cr));
              if (typeof cd === 'string') cd = parseFloat(cd) || 150;
              if (cd > 10) cd = cd / 100;
              const critMult = (1 - cr) + cr * cd;
              if (critMult > 0) {
                nonCritVal = avgVal / critMult;
                critVal = nonCritVal * cd;
              } else {
                nonCritVal = avgVal;
                critVal = avgVal;
              }
            }

            const activeBuffs = Object.values(instData.activeBuffs || {});

            return (
              <div key={idx} className={`dmg-accordion-section ${isOpen ? 'is-open' : ''}`}>
                <div
                  className="dmg-accordion-header"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
                  onClick={() => setOpenInstances(p => ({ ...p, [idx]: !p[idx] }))}
                >
                  <div className="flex-row align-center gap-sm">
                    <svg className="dmg-accordion-icon" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span className="dmg-accordion-title">{inst.title}</span>
                  </div>
                  <div className="dmg-accordion-breakdown-values flex-row align-center" style={{ gap: '12px', marginLeft: 'auto' }}>
                    <div className="flex-row align-center" style={{ paddingRight: '12px', borderRight: '1px solid rgba(255,255,255,0.15)', gap: '6px' }}>
                      <span className="text-dim" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.5px' }}>NON-CRIT</span>
                      <span style={{ color: '#ccc', fontSize: '0.85rem', fontWeight: 700 }}>{Math.floor(nonCritVal).toLocaleString()}</span>
                    </div>
                    <div className="flex-row align-center" style={{ paddingRight: '12px', borderRight: '1px solid rgba(255,255,255,0.15)', gap: '6px' }}>
                      <span className="text-dim" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.5px' }}>CRIT</span>
                      <span style={{ color: '#e2c044', fontSize: '0.85rem', fontWeight: 700 }}>{Math.floor(critVal).toLocaleString()}</span>
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
                      {config.tags.map((t: any) => {
                        const rawVals = Array.isArray(t.keys) ? t.keys.map((k: string) => instData[k]).filter(Boolean) : [instData[t.key]].filter(Boolean);
                        const cleanVals = rawVals.map((v: any) => (typeof v === 'number' && !Number.isInteger(v)) ? parseFloat(v.toFixed(3)) : v);
                        let displayVal = cleanVals.length > 0 ? cleanVals.join(', ') : (t.default || '-');
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
                              {config.stats.map((s: any) => {
                                let label = s.label;
                                let key = s.key;
                                if (s.label === 'Scalar' || s.key === 'scalar') {
                                  label = instData.scalarLabel || 'ATK';
                                  key = 'scalarValue';
                                }
                                let val = instData[key] !== undefined ? instData[key] : '0';
                                if (typeof val === 'number' && !Number.isInteger(val)) {
                                  val = parseFloat(val.toFixed(3));
                                }
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

                            const wepName = slot.weapon ? slot.weapon.trim() : '';
                            const mainSet = slot.mainSet ? slot.mainSet.trim() : '';
                            const subSet = slot.subSet ? slot.subSet.trim() : '';
                            const mainEcho = slot.mainEcho ? slot.mainEcho.trim() : '';

                            const groupedBuffs: Record<string, { effects: any[] }> = {};

                            unitBuffs.forEach((b: any) => {
                              let sourceMech = (b.source || 'System').replace(/_/g, ' ').trim();
                              let cardHeader = sourceMech;
                              const lowerSource = sourceMech.toLowerCase();

                              if (wepName && lowerSource.includes(wepName.toLowerCase())) {
                                cardHeader = wepName;
                              } else if (DataLoader.weaponDB) {
                                const matchedWep = Object.keys(DataLoader.weaponDB).find(w => lowerSource.startsWith(w.toLowerCase()));
                                if (matchedWep) cardHeader = matchedWep;
                              }

                              const isSetEffect = lowerSource.includes('2-pc') || lowerSource.includes('3-pc') || lowerSource.includes('5-pc') ||
                                                  lowerSource.includes('2 pc') || lowerSource.includes('3 pc') || lowerSource.includes('5 pc');

                              const isMainEcho = mainEcho && (
                                lowerSource.includes(mainEcho.toLowerCase()) ||
                                (b.name && b.name.toLowerCase().includes(mainEcho.toLowerCase()))
                              );

                              if (isSetEffect) {
                                const lowerEffName = (b.name || '').toLowerCase();
                                if (subSet && (lowerSource.includes(subSet.toLowerCase()) || lowerEffName.includes(subSet.toLowerCase()))) {
                                  cardHeader = subSet;
                                } else if (mainSet && (lowerSource.includes(mainSet.toLowerCase()) || lowerEffName.includes(mainSet.toLowerCase()))) {
                                  cardHeader = mainSet;
                                } else {
                                  const is3Pc = lowerSource.includes('3-pc') || lowerSource.includes('3 pc') || lowerEffName.includes('3-pc');
                                  const is2Pc = lowerSource.includes('2-pc') || lowerSource.includes('2 pc') || lowerEffName.includes('2-pc');
                                  if (is3Pc) {
                                    cardHeader = mainSet || '3-pc Set';
                                  } else if (is2Pc && subSet) {
                                    cardHeader = subSet;
                                  } else if (mainSet) {
                                    cardHeader = mainSet;
                                  }
                                }
                              } else if (isMainEcho) {
                                cardHeader = mainSet || mainEcho;
                              }

                              if (!groupedBuffs[cardHeader]) {
                                groupedBuffs[cardHeader] = { effects: [] };
                              }

                              let displayVal = b.value !== undefined ? b.value : '-';
                              if (typeof b.value === 'number' && b.value > 0 && b.value < 1) {
                                displayVal = `${+(b.value * 100).toFixed(2)}%`;
                              }

                              const tokenize = (str: string) => (str || '')
                                .toLowerCase()
                                .replace(/_/g, ' ')
                                .replace(/\bs([1-6])\b/g, 'sequence $1')
                                .replace(/\bseq\b/g, 'sequence')
                                .replace(/[^a-z0-9\s]/g, ' ')
                                .split(/\s+/)
                                .filter(Boolean);

                              const noiseWords = new Set([
                                'buff', 'effect', 'slot', 'main', 'stat', 'bonus', 'amp', 'tier',
                                'team', 'self', 'next', 'active', 'enemy', 'others', 'all', 'group'
                              ]);

                              const knownWords = new Set([
                                ...tokenize(cardHeader),
                                ...tokenize(unitName),
                                ...tokenize(b.stat),
                                ...noiseWords
                              ]);

                              let rawEffName = (b.name || sourceMech).replace(/_/g, ' ').trim();
                              if (unitName) {
                                const unitRegex = new RegExp(`^${unitName.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\s*[-:_]?\\s*`, 'i');
                                rawEffName = rawEffName.replace(unitRegex, '').trim();
                              }

                              let cleanEffName = rawEffName;
                              if (cardHeader && cardHeader.toLowerCase() !== rawEffName.toLowerCase()) {
                                const headerRegex = new RegExp(`\\b${cardHeader.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\b`, 'gi');
                                cleanEffName = cleanEffName.replace(headerRegex, '').trim();
                              }

                              cleanEffName = cleanEffName.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();
                              let displayEffName = cleanEffName;

                              if (b.stat) {
                                const statTokens = tokenize(b.stat);
                                statTokens.forEach(st => {
                                  if (st.length > 1) {
                                    const stRegex = new RegExp(`\\b${st.replace(/[^a-zA-Z0-9]/g, '\\$&')}\\b`, 'gi');
                                    displayEffName = displayEffName.replace(stRegex, '').trim();
                                  }
                                });
                              }

                              displayEffName = displayEffName.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();

                              const effTokens = tokenize(cleanEffName);
                              const uniqueTokens = effTokens.filter(w => !knownWords.has(w));
                              const isRedundant = uniqueTokens.length === 0 || !displayEffName;

                              let rowLabel = '';
                              if (isRedundant) {
                                rowLabel = b.stat || cleanEffName || rawEffName || 'Effect';
                              } else {
                                rowLabel = b.stat ? `${displayEffName} (${b.stat})` : displayEffName;
                              }

                              groupedBuffs[cardHeader].effects.push({
                                label: rowLabel,
                                value: displayVal,
                                stacks: b.stacks || 1
                              });
                            });

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
  }

  // --- 2. ADVANCED TIMELINE PANEL ---
  if (config.type === 'complex_time') {
    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">{config.title}</div>
        <div className="complex-time-container">
          {config.groups.map((group: any, idx: number) => (
            <div key={idx} className="time-panel-group" style={{ marginBottom: '12px' }}>
              <div
                className="panel-header-tiny"
                style={{ marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#aaa' }}
              >
                {group.title}
              </div>
              <div className="panel-content-grid">
                {group.fields.map((f: any) => {
                  let rawVal = row[f.key] !== undefined ? row[f.key] : f.default;
                  let displayVal = typeof rawVal === 'number' && !Number.isInteger(rawVal) ? parseFloat(rawVal.toFixed(3)) : rawVal;
                  return <PanelInfoItem key={f.key} label={f.label} value={`${displayVal}${f.suffix || ''}`} extraClass={f.highlight} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- 3. OFFSET BREAKDOWN PANEL ---
  if (trigger === 'offset') {
    const reasons = row.offsetReasons || [];
    const offsetVal = row.offset || 0;
    const offsetStr = `${offsetVal > 0 ? '+' : ''}${offsetVal.toFixed(2)}s`;
    const offsetClass = offsetVal > 0 ? 'text-gold' : offsetVal < 0 ? 'text-main' : 'text-dim';

    return (
      <div className="sub-panel is-open">
        <div className="panel-header-main">Offset Breakdown</div>
        <div className="panel-content-grid" style={{ gridTemplateColumns: '1fr', marginBottom: '16px' }}>
          <div className="panel-info-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
            <span className="panel-info-label" style={{ marginBottom: 0 }}>Total Offset</span>
            <span className={`panel-info-value ${offsetClass} text-bold`} style={{ fontSize: '1rem' }}>{offsetStr}</span>
          </div>
        </div>
        <div className="panel-header-tiny" style={{ marginBottom: '8px' }}>Offset Sources</div>
        <div className="buff-card" style={{ padding: '12px' }}>
          {reasons.length > 0 ? (
            reasons.map((r: any, idx: number) => (
              <div key={idx} className="buff-effect-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                <span className="buff-effect-label">{r.label}:</span>
                <span className={`buff-val-box text-bold ${r.isNegative ? 'text-main' : r.value === '0.00s' ? 'text-dim' : 'text-gold'}`}>{r.value}</span>
              </div>
            ))
          ) : (
            <div className="empty-buff-state" style={{ padding: '12px' }}>Standard Execution (No Offset)</div>
          )}
        </div>
      </div>
    );
  }

  // --- 4. STANDARD GAUGE & RESOURCE PANELS ---
  const u = row.unit;
  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">{config.title}</div>
      <div className="panel-content-grid">
        {config.fields.map((f: any) => {
          let stateVal = row[f.key];
          if (f.key === 'tune' && row.enemyTune !== undefined) stateVal = row.enemyTune;
          if (stateVal && typeof stateVal === 'object' && !Array.isArray(stateVal)) {
            stateVal = stateVal[u];
          }

          let deltaVal: any;
          const lookupKeys = [`${u}_${f.key}`, f.key];
          const dataContainers = [row.trackers, row.memory, row.dropdownState?.trackers].filter(Boolean);
          outer: for (const container of dataContainers) {
            for (const key of lookupKeys) {
              if (container[key] !== undefined) {
                deltaVal = container[key];
                break outer;
              }
            }
          }
          let rawVal = stateVal !== undefined ? stateVal : deltaVal !== undefined ? deltaVal : f.default;

          let displayVal = rawVal;
          if (typeof rawVal === 'number') {
            displayVal = Number.isInteger(rawVal) ? rawVal : parseFloat(rawVal.toFixed(3));
            if (String(f.key).toLowerCase().includes('delta') && rawVal > 0) {
              displayVal = `+${displayVal}`;
            }
          }

          return <PanelInfoItem key={f.key} label={f.label} value={`${displayVal}${f.suffix || ''}`} extraClass={f.highlight} />;
        })}
      </div>
    </div>
  );
};