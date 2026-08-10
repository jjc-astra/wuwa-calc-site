import React, { useState, useRef, useEffect } from 'react';
import type { MechanicNode, Effect } from '../../types';
import { useBuilderStore } from '../../store/useBuilderStore';
import { TypeTag } from '../common/TypeTag';
import { AutocompleteInput } from '../common/AutocompleteInput';
import { BuilderState } from '../../data/db';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { BuilderUtils } from '../../utils/BuilderUtils';

interface MechanicNodeCardProps {
  nodeId: string;
  data: MechanicNode;
}

// Mirrors the old site's makeInput/makeSelect wrapper: each effect field gets its own
// labeled, min-width-protected flex slot so fields share row space evenly instead of
// one AutocompleteInput's 100%-width wrapper swallowing its siblings.
const EffField: React.FC<{ label: string; minWidth: number; children: React.ReactNode }> = ({ label, minWidth, children }) => (
  <div className="form-group flex-1" style={{ minWidth: `${minWidth}px`, margin: 0 }}>
    <label className="form-label text-dim">{label}</label>
    {children}
  </div>
);

const flattenDslShorthand = (v: string): string =>
  v.replace(/@([A-Za-z0-9_]+)\(([^)]+)\)/g, (_match, p1, p2) => `${p1}_${p2.trim()}`);

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({ nodeId, data }) => {
  const { setMechanicNode, renameMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId } = useBuilderStore();
  const [collapsed, setCollapsed] = useState(true);
  const [effectType, setEffectType] = useState<string>('buff');
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Raw text mirror of hitMults — kept separate from the parsed store value so
  // typing (e.g. "[50%, 100%]") isn't clobbered by the round-tripped parse on every keystroke.
  const [multText, setMultText] = useState<string>(() => (data.hitMults ? JSON.stringify(data.hitMults) : ''));
  useEffect(() => {
    setMultText(data.hitMults ? JSON.stringify(data.hitMults) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Sub-section collapsed state (starts all sections collapsed)
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>({
    identity: true,
    combat: true,
    physics: true,
    timeline: true,
    effects: true,
  });

  const toggleSection = (key: string) => {
    setSectionsCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Tag Add Controls State
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [resTiming, setResTiming] = useState<'cast' | 'hit'>('cast');
  const [resType, setResType] = useState('energy');
  const [resAmt, setResAmt] = useState('');
  const [cancelTime, setCancelTime] = useState('');
  const [cancelHits, setCancelHits] = useState('');
  const [cancelRule, setCancelRule] = useState('');

  // Effect Input State
  const [effName, setEffName] = useState('');
  const [effTarget, setEffTarget] = useState('@Self');
  const [effApplyTo, setEffApplyTo] = useState('');
  const [effStat, setEffStat] = useState('');
  const [effVal, setEffVal] = useState('');
  const [effStacks, setEffStacks] = useState('1');
  const [effMax, setEffMax] = useState('');
  const [effDur, setEffDur] = useState('');
  const [effStackBeh, setEffStackBeh] = useState<'resettable' | 'separate'>('resettable');
  const [effExpBeh, setEffExpBeh] = useState<'clear' | 'drop_one' | 'drop_half'>('clear');
  const [effRemSwap, setEffRemSwap] = useState(false);
  const [effAction, setEffAction] = useState('add');

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHighlightedNodeId(nodeId);
    }, 50);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHighlightedNodeId(null);
  };

  const updateNode = (patch: Partial<MechanicNode>) => {
    setMechanicNode(nodeId, { ...data, ...patch });
  };

  // Renaming a node regenerates its ID (provider is always the active char, matching
  // the old site's ID = `${activeChar}_${name}` derivation). The re-key only happens on
  // blur -- doing it on every keystroke would change the store key (and thus this card's
  // React list key) mid-typing, remounting the input and dropping keyboard focus.
  const handleNameChange = (newName: string) => {
    updateNode({ name: newName });
  };

  const handleNameBlur = () => {
    const currentName = data.name || '';
    const owner = activeChar === 'Generic' ? 'System' : (activeChar || '');
    const newId = currentName.trim() ? BuilderUtils.generateId(owner, currentName) : nodeId;
    const collides = newId !== nodeId && useBuilderStore.getState().mechanics[newId];
    if (newId !== nodeId && !collides) {
      renameMechanicNode(nodeId, newId, data);
    }
  };

  const dbC = (activeChar && DataLoader.characterDB[activeChar]) 
    ? DataLoader.characterDB[activeChar] 
    : ({} as Record<string, any>);

  // Check live baseStats first, fallback to DB
  const forteCount = parseInt((baseStats.forteCount as any) || dbC.forteCount || 1, 10);
  const forteOptions = [];
  for (let i = 1; i <= forteCount; i++) {
    forteOptions.push(<option key={i} value={`forte${i}`}>Forte {i}</option>);
  }

  const handleAddCastTag = () => {
    if (!castSelect) return;
    const castTypes = Array.from(new Set([...(data.castTypes || []), castSelect]));
    updateNode({ castTypes });
  };

  const handleAddDmgTag = () => {
    if (!dmgSelect) return;
    const dmgTypes = Array.from(new Set([...(data.dmgTypes || []), dmgSelect]));
    updateNode({ dmgTypes });
  };

  const handleAddResource = () => {
    if (!resAmt) return;
    const parsedMult = CommonUtils.parseMultiplierString(multText);
    const hitCount = Array.isArray(parsedMult) ? parsedMult.length : 1;
    const parts = resAmt.split(',').map(s => parseFloat(s.trim()) || 0);

    if (resTiming === 'hit') {
      const valArr = parts.length === 1
        ? Array(hitCount).fill(parts[0])
        : Array.from({ length: Math.max(hitCount, parts.length) }, (_, i) => parts[i] || 0);
      const hitResources = { ...(data.hitResources || {}), [resType]: valArr };
      updateNode({ hitResources });
    } else {
      const castResources = { ...(data.castResources || {}), [resType]: parts[0] };
      updateNode({ castResources });
    }
    setResAmt('');
  };

  const handleAddCancelTiming = () => {
    if (!cancelTime) return;
    const obj: any = { time: parseFloat(cancelTime) };
    if (cancelHits) obj.hits = parseInt(cancelHits, 10);
    if (cancelRule.trim()) obj.triggerRule = cancelRule.trim();

    const cancelTimings = [...(data.cancelTimings || []), obj];
    updateNode({ cancelTimings });

    setCancelTime('');
    setCancelHits('');
    setCancelRule('');
  };

  const handleAddEffect = () => {
    const newEff: Effect = { type: effectType as any, name: flattenDslShorthand(effName.trim()) };
    if (effTarget && effTarget !== '@Self') newEff.target = effTarget;

    if (effectType === 'buff') {
      if (effApplyTo) newEff.applyTo = effApplyTo.split(',').map(s => s.trim()).filter(Boolean);
      if (effStat) newEff.stat = effStat;
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effStacks && parseInt(effStacks, 10) !== 1) newEff.stacks = parseInt(effStacks, 10);
      if (effDur) newEff.duration = parseFloat(effDur);
      if (effMax) newEff.maxStacks = parseInt(effMax, 10);
      if (effStackBeh === 'separate') newEff.stackBehavior = effStackBeh;
      if (effExpBeh && effExpBeh !== 'clear') newEff.expireBehavior = effExpBeh;
      if (effRemSwap) newEff.removeOnSwap = true;
    } else if (effectType === 'tracker' || effectType === 'buffAction') {
      newEff.action = effAction as any;
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effectType === 'tracker' && effMax) newEff.max = parseInt(effMax, 10);
    } else if (effectType === 'resource' || effectType === 'time_scale') {
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effectType === 'time_scale' && effDur) newEff.duration = parseFloat(effDur);
    }

    const effects = [...(data.effects || []), newEff];
    updateNode({ effects });

    setEffName('');
    setEffTarget('@Self');
    setEffApplyTo('');
    setEffStat('');
    setEffVal('');
    setEffStacks('1');
    setEffMax('');
    setEffDur('');
    setEffRemSwap(false);
  };

  const chevronIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );

  const closeIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );

  const holdCfg = data.holdConfig || {};

  return (
    <div className={`mechanic-card ${collapsed ? 'collapsed' : ''}`}>
      <div
        className="mechanic-card-header collapsible-header"
        onClick={() => setCollapsed(!collapsed)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex-row gap-sm align-center" style={{ pointerEvents: 'none' }}>
          <span className="collapse-icon">{chevronIcon}</span>
          <span className="mech-banner-name">{data.name || 'New Mechanic'}</span>
        </div>
        <button
          type="button"
          className="base-btn icon-btn remove-node-btn btn-danger icon-btn-sm"
          title="Delete Node"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            removeMechanicNode(nodeId);
          }}
        >
          {closeIcon}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Identity Section */}
          <div className={`node-section ${sectionsCollapsed.identity ? '' : 'collapsed'}`}>
            <div className="node-section-title collapsible-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleSection('identity')}>
              <span>Identity</span>
              <span className="collapse-icon">{chevronIcon}</span>
            </div>
            <div className="section-content">
              <div className="form-row">
                <div className="form-group flex-05">
                  <label className="form-label">Provider</label>
                  <input type="text" className="form-input" value={data.provider || activeChar || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ provider: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Display Name</label>
                  <input type="text" className="form-input" value={data.name || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleNameChange(e.target.value)} onBlur={handleNameBlur} />
                </div>
                <div className="form-group">
                  <label className="form-label text-accent">ID (Read-Only)</label>
                  <input type="text" className="form-input input-readonly" value={nodeId} readOnly />
                </div>
              </div>
              <div className="form-row flags-row m-0 mt-4px">
                <label className="checkbox-label">
                  <input type="checkbox" checked={!!data.isPassive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isPassive: e.target.checked })} />
                  <span>Is Passive</span>
                </label>
                <label className="checkbox-label" style={{ marginLeft: '12px' }}>
                  <input type="checkbox" checked={!!data.isSwapInDefault} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isSwapInDefault: e.target.checked })} />
                  <span>Default Swap-In</span>
                </label>
              </div>
            </div>
          </div>

          {/* Combat Stats */}
          <div className={`node-section section-combat ${sectionsCollapsed.combat ? '' : 'collapsed'}`}>
            <div className="node-section-title collapsible-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleSection('combat')}>
              <span>Combat Stats</span>
              <span className="collapse-icon">{chevronIcon}</span>
            </div>
            <div className="section-content">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Cast Types</label>
                  <div className="type-tag-container">
                    {(data.castTypes || []).map((t, i) => (
                      <TypeTag
                        key={i}
                        val={t}
                        label={t}
                        onClick={() => { setCastSelect(t); updateNode({ castTypes: data.castTypes?.filter((_, idx) => idx !== i) }); }}
                        onRemove={() => updateNode({ castTypes: data.castTypes?.filter((_, idx) => idx !== i) })}
                      />
                    ))}
                  </div>
                  <div className="flex-row gap-sm mt-4px">
                    <select className="base-select flex-1" value={castSelect} onChange={e => setCastSelect(e.target.value)}>
                      {BuilderState.CAST_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button type="button" className="base-btn icon-btn icon-btn-sm" onClick={handleAddCastTag}>+</button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Damage Types</label>
                  <div className="type-tag-container">
                    {(data.dmgTypes || []).map((t, i) => (
                      <TypeTag
                        key={i}
                        val={t}
                        label={t}
                        onClick={() => { setDmgSelect(t); updateNode({ dmgTypes: data.dmgTypes?.filter((_, idx) => idx !== i) }); }}
                        onRemove={() => updateNode({ dmgTypes: data.dmgTypes?.filter((_, idx) => idx !== i) })}
                      />
                    ))}
                  </div>
                  <div className="flex-row gap-sm mt-4px">
                    <select className="base-select flex-1" value={dmgSelect} onChange={e => setDmgSelect(e.target.value)}>
                      {BuilderState.DMG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button type="button" className="base-btn icon-btn icon-btn-sm" onClick={handleAddDmgTag}>+</button>
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-05">
                  <label className="form-label">Scalar Stat</label>
                  <select className="base-select" value={data.scalar || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ scalar: e.target.value as any })}>
                    <option value="">None</option>
                    <option value="ATK">ATK</option>
                    <option value="DEF">DEF</option>
                    <option value="HP">HP</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Multiplier String</label>
                  <input
                    type="text"
                    className="form-input"
                    value={multText}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setMultText(e.target.value);
                      updateNode({ hitMults: CommonUtils.parseMultiplierString(e.target.value) });
                    }}
                    placeholder="e.g. 150% or [50%, 100%]"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label className="form-label">Resources</label>
                  <div className="type-tag-container">
                    {Object.entries(data.castResources || {}).map(([k, v]) => (
                      <TypeTag
                        key={`cast_${k}`}
                        val={JSON.stringify(v)}
                        label={`[CAST] ${k}: ${Array.isArray(v) ? JSON.stringify(v) : (Number(v) > 0 ? '+' + v : v)}`}
                        onClick={() => {
                          setResTiming('cast'); setResType(k);
                          setResAmt(Array.isArray(v) ? v.join(', ') : String(v));
                          const updated = { ...(data.castResources || {}) };
                          delete updated[k];
                          updateNode({ castResources: updated });
                        }}
                        onRemove={() => {
                          const updated = { ...(data.castResources || {}) };
                          delete updated[k];
                          updateNode({ castResources: updated });
                        }}
                      />
                    ))}
                    {Object.entries(data.hitResources || {}).map(([k, v]) => (
                      <TypeTag
                        key={`hit_${k}`}
                        val={JSON.stringify(v)}
                        label={`[HIT] ${k}: ${Array.isArray(v) ? JSON.stringify(v) : (Number(v) > 0 ? '+' + v : v)}`}
                        onClick={() => {
                          setResTiming('hit'); setResType(k);
                          setResAmt(Array.isArray(v) ? v.join(', ') : String(v));
                          const updated = { ...(data.hitResources || {}) };
                          delete updated[k];
                          updateNode({ hitResources: updated });
                        }}
                        onRemove={() => {
                          const updated = { ...(data.hitResources || {}) };
                          delete updated[k];
                          updateNode({ hitResources: updated });
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex-row gap-sm mt-4px">
                    <select className="base-select w-100px" value={resTiming} onChange={e => setResTiming(e.target.value as any)}>
                      <option value="cast">On Cast</option>
                      <option value="hit">Per Hit</option>
                    </select>
                    <select className="base-select w-110px" value={resType} onChange={e => setResType(e.target.value)}>
                      <option value="energy">Energy</option>
                      <option value="concerto">Concerto</option>
                      {forteOptions}
                      <option value="tune">Tune</option>
                    </select>
                    <input type="text" className="form-input flex-1" value={resAmt} onChange={e => setResAmt(e.target.value)} placeholder="e.g. 10, -5" />
                    <button type="button" className="base-btn icon-btn icon-btn-sm" onClick={handleAddResource}>+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Priority & Physics */}
          {!data.isPassive && (
            <div className={`node-section section-physics ${sectionsCollapsed.physics ? '' : 'collapsed'}`}>
              <div className="node-section-title collapsible-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleSection('physics')} >
                <span>Priority & Physics</span>
                <span className="collapse-icon">{chevronIcon}</span>
              </div>
              <div className="section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Input Binding</label>
                    <select className="base-select" value={data.input || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ input: e.target.value })}>
                      <option value="">None</option>
                      <option value="Basic">Basic</option>
                      <option value="Skill">Skill</option>
                      <option value="Jump">Jump</option>
                      <option value="Dodge">Dodge</option>
                      <option value="Liberation">Liberation</option>
                      <option value="Utility">Utility</option>
                      <option value="Echo">Echo</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Input Type</label>
                    <select className="base-select" value={data.inputType || 'Press'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ inputType: e.target.value as any })}>
                      <option value="Press">Press</option>
                      <option value="Hold">Hold</option>
                      <option value="Release">Release</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Priority</label>
                    <input type="text" className="form-input w-100" value={data.priority ?? 0} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ priority: e.target.value })} placeholder="@Default.basicPriority" />
                  </div>
                  <div className="form-group relative">
                    <label className="form-label">Combo Window</label>
                    <input type="text" className="form-input w-100" value={data.comboWindow ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ comboWindow: e.target.value })} placeholder="@Default.ComboWindow" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Stance Required</label>
                    <select className="base-select" value={data.stanceReq || 'Any'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ stanceReq: e.target.value as any })}>
                      <option value="Any">Any</option>
                      <option value="Grounded">Grounded</option>
                      <option value="Midair">Midair</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Stance Result</label>
                    <select className="base-select" value={data.stanceResult || 'Retain'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ stanceResult: e.target.value as any, stanceTime: e.target.value === 'Retain' ? '' : data.stanceTime })}>
                      <option value="Retain">Retain</option>
                      <option value="Grounded">Grounded</option>
                      <option value="Midair">Midair</option>
                    </select>
                  </div>
                  <div className="form-group relative">
                    <label className="form-label">Transition Time</label>
                    <input type="text" className="form-input w-100" value={data.stanceTime ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ stanceTime: e.target.value })} placeholder="0.0" disabled={data.stanceResult === 'Retain'} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hold Physics Configuration */}
          {data.inputType === 'Release' && (
            <div className="form-row hold-config-row mt-sm" style={{ display: 'flex', background: 'rgba(212,175,55,0.05)', padding: '8px', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '4px', flexDirection: 'column', gap: '8px' }}>
              <div className="w-100 text-gold text-bold" style={{ fontSize: '0.8rem' }}>Hold Physics Configuration</div>
              <div className="flex-row gap-sm w-100 flex-wrap">
                <div className="form-group flex-1">
                  <label className="form-label">Cursor Mode</label>
                  <select className="base-select" value={holdCfg.cursorMode || 'pingpong'} onChange={e => updateNode({ holdConfig: { ...holdCfg, cursorMode: e.target.value as any } })}>
                    <option value="pingpong">Ping-Pong</option>
                    <option value="clamp">Clamp</option>
                    <option value="loop">Loop</option>
                  </select>
                </div>
                <div className="form-group flex-1">
                  <label className="form-label">Speed</label>
                  <input type="number" className="form-input" value={holdCfg.cursorSpeed ?? 100} onChange={e => updateNode({ holdConfig: { ...holdCfg, cursorSpeed: parseFloat(e.target.value) || 100 } })} />
                </div>
                <div className="form-group flex-1">
                  <label className="form-label">Max Value</label>
                  <input type="number" className="form-input" value={holdCfg.maxCursorVal ?? 100} onChange={e => updateNode({ holdConfig: { ...holdCfg, maxCursorVal: parseFloat(e.target.value) || 100 } })} />
                </div>
                <label className="checkbox-label align-self-end" style={{ height: '32px', display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" checked={!!holdCfg.retainCursor} onChange={e => updateNode({ holdConfig: { ...holdCfg, retainCursor: e.target.checked } })} />
                  <span>Retain Cursor</span>
                </label>
              </div>
              <div className="flex-row gap-sm w-100">
                <div className="form-group relative flex-1">
                  <label className="form-label">Window Center (DSL)</label>
                  <AutocompleteInput mode="general" value={holdCfg.windowCenter ?? '65'} onValueChange={val => updateNode({ holdConfig: { ...holdCfg, windowCenter: val } })} placeholder="e.g. 65" />
                </div>
                <div className="form-group relative flex-1">
                  <label className="form-label">Window Size (DSL)</label>
                  <AutocompleteInput mode="general" value={holdCfg.windowSize ?? '10'} onValueChange={val => updateNode({ holdConfig: { ...holdCfg, windowSize: val } })} placeholder="e.g. 10" />
                </div>
              </div>
            </div>
          )}

          {/* Timeline Logic */}
          <div className={`node-section section-timeline ${sectionsCollapsed.timeline ? '' : 'collapsed'}`}>
            <div className="node-section-title collapsible-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleSection('timeline')}>
              <span>Timeline Logic</span>
              <span className="collapse-icon">{chevronIcon}</span>
            </div>
            <div className="section-content">
              <div className="form-row">
                <div className="form-group flex-1">
                  <label className="form-label">Trigger Rule (DSL)</label>
                  <AutocompleteInput mode="general" value={data.triggerRule || ''} onValueChange={val => updateNode({ triggerRule: val })} placeholder="e.g. IF (@Self.Energy > 50)" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group relative">
                  <label className="form-label">Action Duration</label>
                  <input type="text" className="form-input w-100" value={data.actionDuration ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ actionDuration: e.target.value })} placeholder="e.g. 1.2" />
                </div>

                <div className="form-group">
                  <label className="form-label split-label">
                    <span>DMG Start</span><span>/</span><span>End Time</span>
                  </label>
                  <div className="timeframe-split-box">
                    <div className="relative flex-1">
                      <input type="text" className="form-input w-100" value={data.damageTimeframe?.start ?? ''} onChange={e => updateNode({ damageTimeframe: { ...(data.damageTimeframe || {}), start: e.target.value } })} placeholder="0.2" />
                    </div>
                    <div className="relative flex-1">
                      <input type="text" className="form-input w-100" value={data.damageTimeframe?.end ?? ''} onChange={e => updateNode({ damageTimeframe: { ...(data.damageTimeframe || {}), end: e.target.value } })} placeholder="0.8" />
                    </div>
                  </div>
                </div>

                <div className="form-group relative">
                  <label className="form-label">Freeze Time</label>
                  <input type="text" className="form-input w-100" value={data.freezeTime ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ freezeTime: e.target.value })} placeholder="e.g. 0.5" />
                </div>
                <div className="form-group relative">
                  <label className="form-label">Swap Time</label>
                  <input type="text" className="form-input w-100" value={data.swapTiming ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ swapTiming: e.target.value })} placeholder="e.g. @Default.SwapTime" />
                </div>
                <div className="form-group relative">
                  <label className="form-label">Cooldown</label>
                  <input type="text" className="form-input w-100" value={data.cooldown ?? ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ cooldown: e.target.value })} placeholder="e.g. 12.0" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group flex-1">
                  <label className="form-label">Cancel Timings</label>
                  <div className="type-tag-container">
                    {(data.cancelTimings || []).map((ct, idx) => (
                      <TypeTag
                        key={idx}
                        val={JSON.stringify(ct)}
                        label={`${ct.time}s${ct.hits ? ` | Hits: ${ct.hits}` : ''}${ct.triggerRule ? ` | Rule: ${ct.triggerRule}` : ''}`}
                        onClick={() => {
                          setCancelTime(ct.time !== undefined ? String(ct.time) : '');
                          setCancelHits(ct.hits !== undefined ? String(ct.hits) : '');
                          setCancelRule(ct.triggerRule || '');
                          updateNode({ cancelTimings: data.cancelTimings?.filter((_, i) => i !== idx) });
                        }}
                        onRemove={() => updateNode({ cancelTimings: data.cancelTimings?.filter((_, i) => i !== idx) })}
                      />
                    ))}
                  </div>
                  <div className="flex-row gap-sm mt-4px">
                    <input type="number" step="0.01" className="form-input w-80px" value={cancelTime} onChange={e => setCancelTime(e.target.value)} placeholder="0.3" />
                    <input type="number" step="1" className="form-input w-120px" value={cancelHits} onChange={e => setCancelHits(e.target.value)} placeholder="Hits (opt)" />
                    <div className="relative flex-1 m-0">
                      <input type="text" className="form-input w-100" value={cancelRule} onChange={e => setCancelRule(e.target.value)} placeholder="Rule (opt)" />
                    </div>
                    <button type="button" className="base-btn icon-btn icon-btn-sm" onClick={handleAddCancelTiming}>+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Effects Array */}
          <div className={`node-section section-effects ${sectionsCollapsed.effects ? '' : 'collapsed'}`}>
            <div className="node-section-title text-gold collapsible-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={() => toggleSection('effects')}>
              <span>Effects Array</span>
              <span className="collapse-icon">{chevronIcon}</span>
            </div>
            <div className="section-content">
              <div className="type-tag-container mech-effects-container mb-4px">
                {(data.effects || []).map((eff, idx) => (
                  <TypeTag
                    key={idx}
                    val={JSON.stringify(eff)}
                    label={`${eff.type?.toUpperCase()} | ${eff.name || ''} | ${eff.stat || eff.action || ''}`}
                    onClick={() => {
                      setEffectType(eff.type || 'buff');
                      setEffName(eff.name || '');
                      setEffTarget(eff.target || '@Self');
                      setEffApplyTo(Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : (eff.applyTo as any) || '');
                      setEffStat(eff.stat || '');
                      setEffVal(eff.value !== undefined ? String(eff.value) : '');
                      setEffStacks(eff.stacks !== undefined ? String(eff.stacks) : '1');
                      setEffMax(eff.maxStacks !== undefined ? String(eff.maxStacks) : (eff.max !== undefined ? String(eff.max) : ''));
                      setEffDur(eff.duration !== undefined ? String(eff.duration) : '');
                      setEffStackBeh((eff.stackBehavior as any) || 'resettable');
                      setEffExpBeh((eff.expireBehavior as any) || 'clear');
                      setEffRemSwap(!!eff.removeOnSwap);
                      setEffAction((eff.action as any) || 'add');
                      updateNode({ effects: data.effects?.filter((_, i) => i !== idx) });
                    }}
                    onRemove={() => updateNode({ effects: data.effects?.filter((_, i) => i !== idx) })}
                  />
                ))}
              </div>

              <div className="flex-col gap-sm mt-4px w-100">
                <div className="flex-row gap-sm w-100 align-start">
                  <select className="base-select w-105px" value={effectType} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffectType(e.target.value)}>
                    <option value="buff">Buff</option>
                    <option value="buffAction">Buff Control</option>
                    <option value="resource">Resource</option>
                    <option value="tracker">Tracker</option>
                    <option value="time_scale">Time Scale</option>
                  </select>

                  <div className="flex-col gap-sm flex-1 flex-wrap">
                    {effectType === 'buff' && (
                      <>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Effect ID" minWidth={90}>
                            <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Fusion Burst" />
                          </EffField>
                          <EffField label="Target Entity" minWidth={90}>
                            <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                          </EffField>
                          <EffField label="Limit to Tags" minWidth={90}>
                            <input type="text" className="form-input w-100" value={effApplyTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffApplyTo(e.target.value)} placeholder="e.g. Skill, Heavy" />
                          </EffField>
                        </div>

                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Stat Modifier" minWidth={90}>
                            <AutocompleteInput mode="eff-stat" value={effStat} onValueChange={setEffStat} placeholder="e.g. reduceDef" statOptions={BuilderState.STAT_OPTIONS} dmgOptions={BuilderState.DMG_OPTIONS} />
                          </EffField>
                          <EffField label="Stat Value" minWidth={90}>
                            <input type="text" className="form-input w-100" value={effVal} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)} placeholder="e.g. 5% or 0.2" />
                          </EffField>
                          <EffField label="Stacks Applied" minWidth={90}>
                            <input type="number" step="1" className="form-input w-100" value={effStacks} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffStacks(e.target.value)} placeholder="1" />
                          </EffField>
                          <EffField label="Max Stacks Cap" minWidth={90}>
                            <input type="number" step="1" className="form-input w-100" value={effMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffMax(e.target.value)} placeholder="Limit" />
                          </EffField>
                        </div>

                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Duration (s)" minWidth={90}>
                            <input type="number" step="0.1" className="form-input w-100" value={effDur} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffDur(e.target.value)} placeholder="Time" />
                          </EffField>
                          <EffField label="Stack Logic" minWidth={100}>
                            <select className="base-select w-100" value={effStackBeh} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffStackBeh(e.target.value as any)}>
                              <option value="resettable">Refresh Timers</option>
                              <option value="separate">Separate Timers</option>
                            </select>
                          </EffField>
                          <EffField label="On Expiration" minWidth={100}>
                            <select className="base-select w-100" value={effExpBeh} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffExpBeh(e.target.value as any)}>
                              <option value="clear">Clear All</option>
                              <option value="drop_one">Drop 1 Stack</option>
                              <option value="drop_half">Drop Half</option>
                            </select>
                          </EffField>
                          <div className="form-group flex-1" style={{ minWidth: '130px', margin: 0 }}>
                            <label className="form-label text-dim" style={{ opacity: 0, marginBottom: '2px', height: '14px' }}>_</label>
                            <label className="toolbar-toggle-label w-100" style={{ margin: 0, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                              <input type="checkbox" checked={effRemSwap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffRemSwap(e.target.checked)} />
                              <span>Clear on Swap</span>
                            </label>
                          </div>
                        </div>
                      </>
                    )}

                    {effectType === 'tracker' && (
                      <>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Tracker ID" minWidth={90}>
                            <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Bullets" />
                          </EffField>
                          <EffField label="Action Type" minWidth={100}>
                            <select className="base-select w-100" value={effAction} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffAction(e.target.value)}>
                              <option value="add">Add (+/-)</option>
                              <option value="set">Set (=)</option>
                              <option value="consume">Consume (Zero)</option>
                              <option value="detonate">Detonate</option>
                            </select>
                          </EffField>
                        </div>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Tracker Value" minWidth={90}>
                            <input type="text" className="form-input w-100" value={effVal} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)} placeholder="Amount" />
                          </EffField>
                          <EffField label="Max Stacks Cap" minWidth={90}>
                            <input type="number" step="1" className="form-input w-100" value={effMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffMax(e.target.value)} placeholder="Limit" />
                          </EffField>
                        </div>
                      </>
                    )}

                    {effectType === 'buffAction' && (
                      <>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Target Effect ID" minWidth={90}>
                            <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Fusion Burst" />
                          </EffField>
                          <EffField label="Target Entity" minWidth={90}>
                            <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                          </EffField>
                        </div>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Action Type" minWidth={100}>
                            <select className="base-select w-100" value={effAction} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffAction(e.target.value)}>
                              <option value="remove">Remove / Consume</option>
                              <option value="pause">Pause Timer</option>
                              <option value="resume">Resume Timer</option>
                              <option value="extend">Extend Time</option>
                            </select>
                          </EffField>
                          <EffField label="Action Value" minWidth={90}>
                            <input type="text" className="form-input w-100" value={effVal} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)} placeholder="ALL, HALF, or Num" />
                          </EffField>
                        </div>
                      </>
                    )}

                    {effectType === 'resource' && (
                      <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                        <EffField label="Resource Type" minWidth={100}>
                          <select className="base-select w-100" value={effName} onChange={e => setEffName(e.target.value)}>
                            <option value="energy">Energy</option>
                            <option value="concerto">Concerto</option>
                            {forteOptions}
                            <option value="tune">Tune</option>
                          </select>
                        </EffField>
                        <EffField label="Resource Value" minWidth={90}>
                          <input type="text" className="form-input w-100" value={effVal} onChange={e => setEffVal(e.target.value)} placeholder="Amount (e.g. 10 or -5)" />
                        </EffField>
                      </div>
                    )}

                    {effectType === 'time_scale' && (
                      <>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Timer / Buff ID" minWidth={90}>
                            <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="Specific ID or ALL" />
                          </EffField>
                          <EffField label="Target Entity" minWidth={90}>
                            <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                          </EffField>
                        </div>
                        <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                          <EffField label="Time Speed / Scale" minWidth={90}>
                            <input type="text" className="form-input w-100" value={effVal} onChange={e => setEffVal(e.target.value)} placeholder="-50% (Fast) / 50% (Slow)" />
                          </EffField>
                          <EffField label="Duration (s)" minWidth={90}>
                            <input type="number" step="0.1" className="form-input w-100" value={effDur} onChange={e => setEffDur(e.target.value)} placeholder="Time" />
                          </EffField>
                        </div>
                      </>
                    )}
                  </div>

                  <button type="button" className="base-btn icon-btn icon-btn-sm align-self-start" onClick={handleAddEffect}>
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};