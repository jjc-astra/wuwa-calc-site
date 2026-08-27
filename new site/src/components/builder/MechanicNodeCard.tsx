import React, { useState, useRef, useEffect } from 'react';
import type { MechanicNode, Effect } from '../../types';
import { useBuilderStore } from '../../store/useBuilderStore';
import { TypeTag } from '../common/TypeTag';
import { AutocompleteInput } from '../common/AutocompleteInput';
import { BuilderState, CAST_TYPE_COLORS, GAME_DEFAULTS } from '../../data/db';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils, ELEMENT_COLORS, TooltipManager } from '../../utils/Common';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { parseTimeInput, type Frames } from '../../utils/Frames';
import { DSLParser } from '../../logic/DSLParser';

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

// Cast types get a fixed non-elemental palette; dmg types get the real elemental color when
// they match one exactly, or the color of whichever element name appears in the label (e.g.
// "Aero Erosion" reads as Aero) so status-effect dmgTypes still land on a sensible hue.
function dmgTagColor(tag: string): string {
  if (ELEMENT_COLORS[tag]) return ELEMENT_COLORS[tag];
  const match = Object.keys(ELEMENT_COLORS).find(el => tag.includes(el));
  return match ? ELEMENT_COLORS[match] : '#999999';
}
const castTagColor = (tag: string): string => CAST_TYPE_COLORS[tag] || '#dca54c';

// Short labels for resource-key chips/summaries (On Cast / Resources columns).
function resAbbr(key: string): string {
  const forte = key.match(/^forte(\d+)$/i);
  if (forte) return `F${forte[1]}`;
  const map: Record<string, string> = { energy: 'ER', concerto: 'Con', tune: 'TB' };
  return map[key] || key.slice(0, 2).toUpperCase();
}

// Full resource name for tooltips -- resAbbr's short form (e.g. "ER") is for the compact chip
// label, not for a hover tooltip, which should spell the resource out ("Energy").
function resFullName(key: string): string {
  const forte = key.match(/^forte(\d+)$/i);
  if (forte) return `Forte ${forte[1]}`;
  const map: Record<string, string> = { energy: 'Energy', concerto: 'Concerto', tune: 'Tune' };
  return map[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

const sumNumeric = (v: string | number | number[] | undefined): number => {
  const arr = Array.isArray(v) ? v : v !== undefined ? [v] : [];
  return arr.filter((x): x is number => typeof x === 'number').reduce((a, b) => a + b, 0);
};

const fmtNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Displays a stored Frames/seconds value with its unit suffix ("30f" / "12s") once it's a
// plain number, so the field always reads as unambiguous without the user having to type the
// unit themselves -- a DSL string (e.g. "@Default.SwapTime") is shown untouched.
const displayTimeVal = (v: number | string | undefined, unit: 'f' | 's'): string => {
  if (v === undefined || v === '') return '';
  return typeof v === 'number' ? `${v}${unit}` : v;
};

// Effects Array chip label -- was type|name|stat, which silently dropped the actual value
// (e.g. a resource effect's amount, or a buff's percentage), leaving chips like
// "RESOURCE | FORTE1 |" with no number at all. Only includes segments that are actually set.
function effectLabel(eff: Effect): string {
  const parts: string[] = [String(eff.type || '').toUpperCase()];
  if (eff.name) parts.push(eff.name);
  if (eff.stat) parts.push(eff.stat);
  if (eff.action) parts.push(eff.action);
  if (eff.value !== undefined && eff.value !== '') parts.push(String(eff.value));
  return parts.join(' | ');
}

type PanelKey = 'identity' | 'inputs' | 'timeMods' | 'hits' | 'castTags' | 'dmgTags' | 'castRes' | 'default';

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({ nodeId, data }) => {
  const { setMechanicNode, renameMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId } = useBuilderStore();
  const [effectType, setEffectType] = useState<string>('buff');
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which column's sub-panel is open, if any -- exactly one at a time, mirroring the rotation
  // table's activeTrigger/SubPanel pattern instead of a floating popover.
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveTrigger(prev => (prev === key ? null : key));
  };

  // Raw text mirror of hitMults — kept separate from the parsed store value so
  // typing (e.g. "[50%, 100%]") isn't clobbered by the round-tripped parse on every keystroke.
  const [multText, setMultText] = useState<string>(() => (data.hitMults ? JSON.stringify(data.hitMults) : ''));
  useEffect(() => {
    setMultText(data.hitMults ? JSON.stringify(data.hitMults) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Tag/Resource/Cancel Add Controls State
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');
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

  // Uses the site's shared TooltipManager (.global-tooltip) instead of a native title
  // attribute -- spread onto an element in place of `title="..."`.
  const tip = (text: string) => ({
    onMouseEnter: (e: React.MouseEvent) => TooltipManager.show(e.currentTarget as Element, text),
    onMouseLeave: () => TooltipManager.hide()
  });

  const updateNode = (patch: Partial<MechanicNode>) => {
    setMechanicNode(nodeId, { ...data, ...patch });
  };

  // Normalizes a timing field's "30f"/"0.5s"/bare-number/DSL-expression text on blur, not on
  // every keystroke -- these fields commit their raw typed string on every onChange (so DSL
  // passthrough and mid-type values like "1." or "30f" aren't clobbered), and only get
  // re-derived into the field's canonical unit once the user's actually done typing.
  const makeTimeBlur = (field: keyof MechanicNode, nativeUnit: 'frames' | 'seconds') => () => {
    const raw = (data as any)[field];
    if (typeof raw !== 'string' || raw.trim() === '') return;
    const parsed = parseTimeInput(raw, nativeUnit);
    if (parsed !== raw) updateNode({ [field]: parsed } as Partial<MechanicNode>);
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
  const forteOptions: React.ReactElement[] = [];
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

  const handleAddCastResource = () => {
    if (!castResAmt) return;
    const castResources = { ...(data.castResources || {}), [castResType]: parseFloat(castResAmt) || 0 };
    updateNode({ castResources });
    setCastResAmt('');
  };

  const updateHitResourceValue = (key: string, idx: number, raw: string) => {
    const current = data.hitResources?.[key];
    const arr = Array.isArray(current) ? [...current] : new Array(Math.max(idx + 1, 1)).fill(0);
    const num = parseFloat(raw);
    arr[idx] = isNaN(num) ? 0 : num;
    updateNode({ hitResources: { ...(data.hitResources || {}), [key]: arr } });
  };

  const handleAddCancelTiming = () => {
    if (!cancelTime) return;
    // cancelTimings[].time is frames-domain (a cancel point within the move's animation) --
    // accepts "30f"/"0.5s"/a bare number (frames, matching the field's native unit).
    const obj: any = { time: Math.round(Number(parseTimeInput(cancelTime, 'frames'))) };
    if (cancelHits) obj.hits = parseInt(cancelHits, 10);
    if (cancelRule.trim()) obj.triggerRule = cancelRule.trim();

    const cancelTimings = [...(data.cancelTimings || []), obj];
    updateNode({ cancelTimings });

    setCancelTime('');
    setCancelHits('');
    setCancelRule('');
  };

  const loadCancelForEdit = (idx: number) => {
    const ct = (data.cancelTimings || [])[idx];
    if (!ct) return;
    setCancelTime(ct.time !== undefined ? String(ct.time) : '');
    setCancelHits(ct.hits !== undefined ? String(ct.hits) : '');
    setCancelRule(ct.triggerRule || '');
    updateNode({ cancelTimings: data.cancelTimings?.filter((_, i) => i !== idx) });
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
      // Buff lifetimes stay seconds -- "30f"/"0.5s"/a bare number (seconds) all accepted.
      if (effDur) newEff.duration = parseTimeInput(effDur, 'seconds');
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
      if (effectType === 'time_scale' && effDur) newEff.duration = parseTimeInput(effDur, 'seconds');
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

  // Matches the rotation calculator's dmg-accordion-icon exactly: a solid ▶ that rotates to ▼.
  const chevronIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );

  const closeIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );

  const holdCfg = data.holdConfig || {};

  // Per-hit breakdown / timeline preview -- mirrors TimelineEngine._resolveTimings' own
  // getHitTimeOffset interpolation, recomputed here purely for display (doesn't touch the
  // real engine, doesn't affect calculation). The dmg window is INFERRED from this: hit 1's
  // frame (if explicitly set) is damageTimeframe.start, the last hit's frame (if explicitly
  // set) is damageTimeframe.end -- there's no separate dmg-window input anymore.
  const hitMultsArr = Array.isArray(data.hitMults) ? data.hitMults : [];
  const hitCount = hitMultsArr.length;
  const durationFrames = typeof data.actionDuration === 'number' ? data.actionDuration : null;
  const tfStart = typeof data.damageTimeframe?.start === 'number' ? data.damageTimeframe.start : 0;
  const tfEnd = typeof data.damageTimeframe?.end === 'number' ? data.damageTimeframe.end : (durationFrames ?? 0);
  const hitOffsets = Array.from({ length: hitCount }, (_, i) =>
    hitCount <= 1 || tfEnd <= tfStart ? tfEnd : Math.round(tfStart + (tfEnd - tfStart) * (i / (hitCount - 1)))
  );
  const cancelFrames = (data.cancelTimings || []).map(ct => ct.time).filter((t): t is Frames => typeof t === 'number');
  const timelineMax = Math.max(durationFrames || 0, tfEnd, ...cancelFrames, ...hitOffsets, 1);
  const hitResourceKeys = Object.keys(data.hitResources || {});

  const handleHitFrameChange = (i: number, raw: string) => {
    const patch: any = { ...(data.damageTimeframe || {}) };
    if (i === 0) patch.start = raw;
    if (i === hitCount - 1) patch.end = raw;
    updateNode({ damageTimeframe: patch });
  };

  const handleHitFrameBlur = (i: number) => () => {
    const raw = i === 0 ? data.damageTimeframe?.start : data.damageTimeframe?.end;
    if (typeof raw !== 'string' || raw.trim() === '') return;
    const parsed = parseTimeInput(raw, 'frames');
    if (parsed === raw) return;
    const patch: any = { ...(data.damageTimeframe || {}) };
    if (i === 0) patch.start = parsed;
    if (i === hitCount - 1) patch.end = parsed;
    updateNode({ damageTimeframe: patch });
  };

  // --- Summary-row computed labels ---
  // hitMults entries may be plain numbers OR percentage strings like "48.71%" (static JSON
  // data commonly stores them the latter way) -- parse both, only DSL expressions fail to parse.
  const parsedMults = hitMultsArr.map(v => {
    if (typeof v === 'number') return v;
    const n = parseFloat(v.replace('%', ''));
    return isNaN(n) ? null : n;
  });
  const numericMults = parsedMults.filter((v): v is number => v !== null);
  const multSum = numericMults.reduce((a, b) => a + b, 0);
  const multSummaryLabel = hitMultsArr.length === 0 ? '—' : `${fmtNum(multSum)}%${numericMults.length !== hitMultsArr.length ? '…' : ''}`;

  const cancelTimings = data.cancelTimings || [];

  const physicsSummaryLabel = `${data.input || '—'}${data.inputType ? ` · ${data.inputType}` : ''}`;

  // Cancel/Freeze/Swap/Priority/Combo Window all edit together in one "Timing Modifiers"
  // sub-panel -- the summary column lists a small tag per field that's actually set, rather
  // than reserving a whole column for each (most of these are empty on most moves). DSL values
  // like "@Default.BasicPriority + 1" are resolved to their actual number rather than shown as
  // raw DSL text -- @Default is the only pointer guaranteed resolvable without a live rotation
  // context (@Self/@Move etc. need one), which covers the common case for these fields.
  const dslEvalCtx = { default: GAME_DEFAULTS };
  const resolveNum = (v: number | string | undefined): number | null => {
    if (v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    try {
      return DSLParser.evaluateMath(v, dslEvalCtx);
    } catch {
      return null;
    }
  };
  const freezeVal = resolveNum(data.freezeTime);
  const swapVal = resolveNum(data.swapTiming);
  const priorityVal = data.isPassive ? null : resolveNum(data.priority);
  const comboVal = resolveNum(data.comboWindow);

  // Each tag carries its own tooltip (the cancel rule, or just what the field is) so hovering
  // a specific tag shows info about THAT tag, not one tooltip shared across the whole cell.
  const timingModTags: { label: string; tooltip: string }[] = [
    ...cancelTimings.map(ct => ({
      label: `Cancel ${ct.time}f${ct.hits ? `·${ct.hits}h` : ''}`,
      tooltip: ct.triggerRule ? `Rule: ${ct.triggerRule}` : 'Cancel Timing'
    })),
    ...(freezeVal !== null ? [{ label: `Freeze ${fmtNum(freezeVal)}f`, tooltip: 'Freeze Time' }] : []),
    ...(swapVal !== null ? [{ label: `Swap ${fmtNum(swapVal)}f`, tooltip: 'Swap Time' }] : []),
    ...(priorityVal !== null ? [{ label: `Prio ${fmtNum(priorityVal)}`, tooltip: 'Priority' }] : []),
    ...(comboVal !== null ? [{ label: `Combo ${fmtNum(comboVal)}f`, tooltip: 'Combo Window' }] : [])
  ];

  // --- Sub-panel content ---
  const renderPanel = () => {
    switch (activeTrigger) {
      case 'identity':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Identity</div>
            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={data.name || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleNameChange(e.target.value)}
                  onBlur={handleNameBlur}
                  placeholder="New Mechanic"
                />
              </div>
              <div className="form-group flex-05">
                <label className="form-label">Provider</label>
                <input type="text" className="form-input" value={data.provider || activeChar || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ provider: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label text-accent">ID (Read-Only)</label>
                <input type="text" className="form-input input-readonly" value={nodeId} readOnly />
              </div>
            </div>
          </div>
        );

      case 'inputs':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Inputs & Physics</div>
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
                <label className="form-label">Stance Required</label>
                <select className="base-select" value={data.stanceReq || 'Any'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ stanceReq: e.target.value as any })}>
                  <option value="Any">Any</option>
                  <option value="Grounded">Grounded</option>
                  <option value="Midair">Midair</option>
                </select>
              </div>
            </div>
            <div className="form-row">
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
                <input type="text" className="form-input w-100" value={displayTimeVal(data.stanceTime, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ stanceTime: e.target.value })} onBlur={makeTimeBlur('stanceTime', 'frames')} placeholder="e.g. 0 or 15f" disabled={data.stanceResult === 'Retain'} />
              </div>
            </div>

            {data.inputType === 'Release' && (
              <div className="form-row hold-config-row mt-sm" style={{ display: 'flex', background: 'rgba(212,175,55,0.05)', padding: '8px', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '4px', flexDirection: 'column', gap: '8px' }}>
                <div className="w-100 text-gold text-bold" style={{ fontSize: '0.8rem' }}>Hold Input Configuration</div>
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
          </div>
        );

      case 'timeMods':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Timing Modifiers</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Freeze Time</label>
                <input type="text" className="form-input w-100" value={displayTimeVal(data.freezeTime, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ freezeTime: e.target.value })} onBlur={makeTimeBlur('freezeTime', 'frames')} placeholder="e.g. 5f" />
              </div>
              <div className="form-group">
                <label className="form-label">Swap Time</label>
                <input type="text" className="form-input w-100" value={displayTimeVal(data.swapTiming, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ swapTiming: e.target.value })} onBlur={makeTimeBlur('swapTiming', 'frames')} placeholder="e.g. 9f" />
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <input type="text" className="form-input w-100" value={data.priority ?? 0} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ priority: e.target.value })} placeholder="@Default.basicPriority" />
              </div>
              <div className="form-group relative">
                <label className="form-label">Combo Window</label>
                <input type="text" className="form-input w-100" value={displayTimeVal(data.comboWindow, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ comboWindow: e.target.value })} onBlur={makeTimeBlur('comboWindow', 'frames')} placeholder="@Default.ComboWindow" />
              </div>
            </div>

            <div className="panel-header-tiny" style={{ marginTop: '14px' }}>Cancel Timings</div>
            <div className="mech-list">
              {cancelTimings.length === 0 && <div className="dim" style={{ padding: '4px 0' }}>No cancel timings yet.</div>}
              {cancelTimings.map((ct, idx) => (
                <div key={idx} className="mech-list-row" onClick={() => loadCancelForEdit(idx)}>
                  <span>{ct.time}f{ct.hits ? ` · ${ct.hits} hits` : ''}{ct.triggerRule ? ` · ${ct.triggerRule}` : ''}</span>
                  <button
                    type="button"
                    className="mech-list-remove"
                    onClick={e => { e.stopPropagation(); updateNode({ cancelTimings: data.cancelTimings?.filter((_, i) => i !== idx) }); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mech-add-row mt-sm">
              <input type="text" className="form-input mech-mini-input" value={cancelTime} onChange={e => setCancelTime(e.target.value)} placeholder="24f" />
              <input type="number" step="1" className="form-input mech-mini-input" value={cancelHits} onChange={e => setCancelHits(e.target.value)} placeholder="hits" />
              <input type="text" className="form-input mech-mini-input-wide" value={cancelRule} onChange={e => setCancelRule(e.target.value)} placeholder="rule (opt), e.g. IF (...)" />
              <button type="button" className="base-btn text-xs" onClick={handleAddCancelTiming}>Add</button>
            </div>
          </div>
        );

      case 'hits':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Hit Breakdown</div>
            <div className="flex-row gap-sm align-center mb-4px">
              <div className="form-group flex-05" style={{ margin: 0 }}>
                <label className="form-label">Scalar Stat</label>
                <select className="base-select" value={data.scalar || ''} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateNode({ scalar: e.target.value as any })}>
                  <option value="">None</option>
                  <option value="ATK">ATK</option>
                  <option value="DEF">DEF</option>
                  <option value="HP">HP</option>
                </select>
              </div>
              <div className="form-group flex-1" style={{ margin: 0 }}>
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

            {hitCount > 0 && durationFrames !== null && (
              <>
                <div className="mech-timeline-bar">
                  {hitOffsets.map((off, i) => (
                    <div key={i} className="mech-timeline-tick" style={{ left: `${(off / timelineMax) * 100}%` }} {...tip(`Hit ${i + 1}: ${off}f`)} />
                  ))}
                  {cancelFrames.map((cf, i) => (
                    <div key={`c${i}`} className="mech-timeline-tick is-cancel" style={{ left: `${(cf / timelineMax) * 100}%` }} {...tip(`Cancel: ${cf}f`)} />
                  ))}
                  <span className="mech-timeline-label" style={{ left: 4 }}>0f</span>
                  <span className="mech-timeline-label" style={{ right: 4 }}>{timelineMax}f</span>
                </div>
                <table className="mech-hit-table">
                  <thead>
                    <tr>
                      <th>Hit</th>
                      <th>Frame</th>
                      <th>Mv</th>
                      {hitResourceKeys.map(k => <th key={k}>{k}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {hitMultsArr.map((mv, i) => {
                      const editableFrame = i === 0 || i === hitCount - 1;
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>
                            {editableFrame ? (
                              <input
                                type="text"
                                className="cell-value"
                                value={displayTimeVal(i === 0 ? data.damageTimeframe?.start : data.damageTimeframe?.end, 'f')}
                                onChange={e => handleHitFrameChange(i, e.target.value)}
                                onBlur={handleHitFrameBlur(i)}
                                placeholder={`${hitOffsets[i]}f`}
                                {...tip(i === 0 ? 'Dmg window start (inferred if blank)' : 'Dmg window end (inferred if blank)')}
                              />
                            ) : (
                              <span className="dim">{hitOffsets[i]}f</span>
                            )}
                          </td>
                          <td className="accent">{String(mv)}</td>
                          {hitResourceKeys.map(k => {
                            const arr = data.hitResources?.[k];
                            const val = Array.isArray(arr) ? arr[i] : undefined;
                            return (
                              <td key={k}>
                                <input
                                  type="text"
                                  className="cell-value"
                                  value={val ?? ''}
                                  onChange={e => updateHitResourceValue(k, i, e.target.value)}
                                  placeholder="—"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );

      case 'castTags':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Add Cast Type</div>
            <div className="mech-add-row">
              <select className="base-select mech-mini-select" value={castSelect} onChange={e => setCastSelect(e.target.value)}>
                {BuilderState.CAST_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <button type="button" className="base-btn text-xs" onClick={handleAddCastTag}>Add</button>
            </div>
          </div>
        );

      case 'dmgTags':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Add Dmg Type</div>
            <div className="mech-add-row">
              <select className="base-select mech-mini-select" value={dmgSelect} onChange={e => setDmgSelect(e.target.value)}>
                {BuilderState.DMG_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <button type="button" className="base-btn text-xs" onClick={handleAddDmgTag}>Add</button>
            </div>
          </div>
        );

      case 'castRes':
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Add On-Cast Resource</div>
            <div className="mech-add-row">
              <select className="base-select mech-mini-select" value={castResType} onChange={e => setCastResType(e.target.value)}>
                <option value="energy">Energy</option>
                <option value="concerto">Concerto</option>
                {forteOptions}
                <option value="tune">Tune</option>
              </select>
              <input type="text" className="form-input mech-mini-input" value={castResAmt} onChange={e => setCastResAmt(e.target.value)} placeholder="10" />
              <button type="button" className="base-btn text-xs" onClick={handleAddCastResource}>Add</button>
            </div>
          </div>
        );

      case 'default':
      default:
        return (
          <div className="sub-panel is-open">
            <div className="panel-header-main">Trigger Rule &amp; Effects</div>
            <div className="form-row">
              <div className="form-group flex-1">
                <label className="form-label">Trigger Rule (DSL)</label>
                <AutocompleteInput mode="general" value={data.triggerRule || ''} onValueChange={val => updateNode({ triggerRule: val })} placeholder="e.g. IF (@Self.Energy > 50)" />
              </div>
            </div>
            <div className="flags-row m-0">
              <label className="checkbox-label">
                <input type="checkbox" checked={!!data.isPassive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isPassive: e.target.checked })} />
                <span>Passive</span>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={!!data.isSwapInDefault} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isSwapInDefault: e.target.checked })} />
                <span>Default Swap-In</span>
              </label>
            </div>

            <div className="panel-header-tiny" style={{ marginTop: '14px' }}>Effects Array</div>
            <div className="type-tag-container mech-effects-container mb-4px">
              {(data.effects || []).map((eff, idx) => (
                <TypeTag
                  key={idx}
                  val={JSON.stringify(eff)}
                  label={effectLabel(eff)}
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
        );
    }
  };

  return (
    <tbody className="mech-row-group">
      <tr className="mech-row" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <td
          className={`mech-col-expand mech-trigger-cell ${activeTrigger === 'default' ? 'is-active' : ''}`}
          onClick={toggleTrigger('default')}
        >
          <span className="collapse-icon" style={{ transform: activeTrigger === 'default' ? 'rotate(90deg)' : 'none' }}>{chevronIcon}</span>
        </td>

        <td
          className={`mech-col-name mech-trigger-cell ${activeTrigger === 'identity' ? 'is-active' : ''}`}
          onClick={toggleTrigger('identity')}
        >
          <span className="mech-name-display">{data.name || 'New Mechanic'}</span>
        </td>

        <td className={`mech-col-cast mech-trigger-cell ${activeTrigger === 'castTags' ? 'is-active' : ''}`} onClick={toggleTrigger('castTags')}>
          <div className="mech-tag-row">
            {(data.castTypes || []).map((t, i) => (
              <TypeTag
                key={i}
                val={t}
                label={t}
                color={castTagColor(t)}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setCastSelect(t);
                  updateNode({ castTypes: data.castTypes?.filter((_, idx) => idx !== i) });
                  setActiveTrigger('castTags');
                }}
                onRemove={() => updateNode({ castTypes: data.castTypes?.filter((_, idx) => idx !== i) })}
              />
            ))}
            <button type="button" className={`tag-add-btn ${activeTrigger === 'castTags' ? 'is-open' : ''}`}>+</button>
          </div>
        </td>

        <td className={`mech-col-dmg mech-trigger-cell ${activeTrigger === 'dmgTags' ? 'is-active' : ''}`} onClick={toggleTrigger('dmgTags')}>
          <div className="mech-tag-row">
            {(data.dmgTypes || []).map((t, i) => (
              <TypeTag
                key={i}
                val={t}
                label={t}
                color={dmgTagColor(t)}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setDmgSelect(t);
                  updateNode({ dmgTypes: data.dmgTypes?.filter((_, idx) => idx !== i) });
                  setActiveTrigger('dmgTags');
                }}
                onRemove={() => updateNode({ dmgTypes: data.dmgTypes?.filter((_, idx) => idx !== i) })}
              />
            ))}
            <button type="button" className={`tag-add-btn ${activeTrigger === 'dmgTags' ? 'is-open' : ''}`}>+</button>
          </div>
        </td>

        <td
          className={data.isPassive ? 'mech-col-disabled' : `mech-trigger-cell ${activeTrigger === 'inputs' ? 'is-active' : ''}`}
          onClick={data.isPassive ? undefined : toggleTrigger('inputs')}
        >
          {data.isPassive ? <span className="dim">—</span> : <span className="mech-sum-text">{physicsSummaryLabel}</span>}
        </td>

        <td className={`mech-col-num mech-trigger-cell ${activeTrigger === 'hits' ? 'is-active' : ''}`} onClick={toggleTrigger('hits')}>
          <span className="mech-sum-text">{multSummaryLabel}</span>
        </td>

        <td className="mech-col-num">
          <input
            type="text"
            className="cell-value"
            value={displayTimeVal(data.actionDuration, 'f')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ actionDuration: e.target.value })}
            onBlur={makeTimeBlur('actionDuration', 'frames')}
            placeholder="—"
          />
        </td>

        <td className={`mech-trigger-cell ${activeTrigger === 'timeMods' ? 'is-active' : ''}`} onClick={toggleTrigger('timeMods')}>
          <div className="mech-tag-row">
            {timingModTags.length === 0 ? <span className="dim">—</span> : timingModTags.map((t, i) => (
              <TypeTag key={i} val={t.label} label={t.label} tooltip={t.tooltip} />
            ))}
          </div>
        </td>

        <td className={`mech-col-castres mech-trigger-cell ${activeTrigger === 'castRes' ? 'is-active' : ''}`} onClick={toggleTrigger('castRes')}>
          <div className="mech-tag-row">
            {Object.entries(data.castResources || {}).map(([k, v]) => (
              <TypeTag
                key={k}
                val={String(v)}
                label={`${resAbbr(k)} ${Number(v) > 0 ? '+' + v : v}`}
                tooltip={resFullName(k)}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setCastResType(k);
                  setCastResAmt(String(v));
                  const updated = { ...(data.castResources || {}) };
                  delete updated[k];
                  updateNode({ castResources: updated });
                  setActiveTrigger('castRes');
                }}
                onRemove={() => {
                  const updated = { ...(data.castResources || {}) };
                  delete updated[k];
                  updateNode({ castResources: updated });
                }}
              />
            ))}
            <button type="button" className={`tag-add-btn ${activeTrigger === 'castRes' ? 'is-open' : ''}`}>+</button>
          </div>
        </td>

        <td className={`mech-trigger-cell ${activeTrigger === 'hits' ? 'is-active' : ''}`} onClick={toggleTrigger('hits')}>
          <div className="mech-tag-row">
            {hitResourceKeys.length === 0 ? <span className="dim">—</span> : hitResourceKeys.map(k => (
              <TypeTag key={k} val={k} label={`${resAbbr(k)} ${fmtNum(sumNumeric(data.hitResources?.[k]))}`} tooltip={resFullName(k)} />
            ))}
          </div>
        </td>

        <td className="mech-col-num">
          <input
            type="text"
            className="cell-value"
            value={displayTimeVal(data.cooldown, 's')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ cooldown: e.target.value })}
            onBlur={makeTimeBlur('cooldown', 'seconds')}
            placeholder="—"
          />
        </td>

        <td className="mech-col-remove">
          <button
            type="button"
            className="base-btn icon-btn remove-node-btn btn-danger icon-btn-sm"
            onClick={() => removeMechanicNode(nodeId)}
            {...tip('Delete Node')}
          >
            {closeIcon}
          </button>
        </td>
      </tr>

      {activeTrigger && (
        <tr>
          <td colSpan={12} className="mech-detail-cell">
            {renderPanel()}
          </td>
        </tr>
      )}
    </tbody>
  );
};
