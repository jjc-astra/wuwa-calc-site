// src/components/builder/SummaryRow.tsx
// The mech-table's single-line summary <tr> for one MechanicNode -- clicking most cells opens
// the matching sub-panel (rendered by the parent MechanicNodeCard) in a detail row underneath.
import React from 'react';
import type { MechanicNode } from '../../types';
import { TypeTag } from '../common/TypeTag';
import { GAME_DEFAULTS } from '../../data/db';
import { displayTimeVal, fmtNum, resAbbr, resFullName, sumNumeric, castTagColor, dmgTagColor, tip, resolveDefaultNum, makeTimeBlur } from './mechanicNodeHelpers';
import type { PanelKey } from './MechanicNodeCard';

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

interface SummaryRowProps {
  nodeId: string;
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  activeTrigger: PanelKey | null;
  toggleTrigger: (key: PanelKey) => (e: React.MouseEvent) => void;
  setActiveTrigger: (key: PanelKey) => void;
  removeMechanicNode: (nodeId: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFieldMouseEnter: (key: PanelKey) => void;
  onFieldMouseLeave: () => void;
  setCastSelect: (v: string) => void;
  setDmgSelect: (v: string) => void;
  setCastResType: (v: string) => void;
  setCastResAmt: (v: string) => void;
}

export const SummaryRow: React.FC<SummaryRowProps> = ({
  nodeId, data, updateNode, activeTrigger, toggleTrigger, setActiveTrigger, removeMechanicNode,
  onMouseEnter, onMouseLeave, onFieldMouseEnter, onFieldMouseLeave,
  setCastSelect, setDmgSelect, setCastResType, setCastResAmt
}) => {
  const hitMultsArr = Array.isArray(data.hitMults) ? data.hitMults : [];
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

  const physicsSummaryLabel = `${data.input || '—'}${data.inputType ? ` · ${data.inputType}` : ''}`;
  const hitResourceKeys = Object.keys(data.hitResources || {});

  // Cancel/Freeze/Swap/Priority/Combo Window all edit together in one "Timing Modifiers"
  // sub-panel -- the summary column lists a small tag per field that's actually set, rather
  // than reserving a whole column for each (most of these are empty on most moves).
  const dslEvalCtx = { default: GAME_DEFAULTS };
  const cancelTimings = data.cancelTimings || [];
  const freezeVal = resolveDefaultNum(data.freezeTime, dslEvalCtx);
  const swapVal = resolveDefaultNum(data.swapTiming, dslEvalCtx);
  const priorityVal = data.isPassive ? null : resolveDefaultNum(data.priority, dslEvalCtx);
  const comboVal = resolveDefaultNum(data.comboWindow, dslEvalCtx);

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

  return (
    <tr className="mech-row" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <td
        className={`mech-col-expand mech-trigger-cell ${activeTrigger === 'default' ? 'is-active' : ''}`}
        onClick={toggleTrigger('default')}
        onMouseEnter={() => onFieldMouseEnter('default')}
        onMouseLeave={onFieldMouseLeave}
      >
        <span className="collapse-icon" style={{ transform: activeTrigger === 'default' ? 'rotate(90deg)' : 'none' }}>{chevronIcon}</span>
      </td>

      <td
        className={`mech-col-name mech-trigger-cell ${activeTrigger === 'identity' ? 'is-active' : ''}`}
        onClick={toggleTrigger('identity')}
        onMouseEnter={() => onFieldMouseEnter('identity')}
        onMouseLeave={onFieldMouseLeave}
      >
        <span className="mech-name-display">{data.name || 'New Mechanic'}</span>
      </td>

      <td
        className={`mech-col-cast mech-trigger-cell ${activeTrigger === 'castTags' ? 'is-active' : ''}`}
        onClick={toggleTrigger('castTags')}
        onMouseEnter={() => onFieldMouseEnter('castTags')}
        onMouseLeave={onFieldMouseLeave}
      >
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

      <td
        className={`mech-col-dmg mech-trigger-cell ${activeTrigger === 'dmgTags' ? 'is-active' : ''}`}
        onClick={toggleTrigger('dmgTags')}
        onMouseEnter={() => onFieldMouseEnter('dmgTags')}
        onMouseLeave={onFieldMouseLeave}
      >
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
        onMouseEnter={data.isPassive ? undefined : () => onFieldMouseEnter('inputs')}
        onMouseLeave={data.isPassive ? undefined : onFieldMouseLeave}
      >
        {data.isPassive ? <span className="dim">—</span> : <span className="mech-sum-text">{physicsSummaryLabel}</span>}
      </td>

      <td
        className={`mech-col-num mech-trigger-cell ${activeTrigger === 'hits' ? 'is-active' : ''}`}
        onClick={toggleTrigger('hits')}
        onMouseEnter={() => onFieldMouseEnter('hits')}
        onMouseLeave={onFieldMouseLeave}
      >
        <span className="mech-sum-text">{multSummaryLabel}</span>
      </td>

      <td className="mech-col-num">
        <input
          type="text"
          className="cell-value"
          value={displayTimeVal(data.actionDuration, 'f')}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ actionDuration: e.target.value })}
          onBlur={makeTimeBlur(data, updateNode, 'actionDuration', 'frames')}
          placeholder="—"
        />
      </td>

      <td
        className={`mech-trigger-cell ${activeTrigger === 'timeMods' ? 'is-active' : ''}`}
        onClick={toggleTrigger('timeMods')}
        onMouseEnter={() => onFieldMouseEnter('timeMods')}
        onMouseLeave={onFieldMouseLeave}
      >
        <div className="mech-tag-row">
          {timingModTags.length === 0 ? <span className="dim">—</span> : timingModTags.map((t, i) => (
            <TypeTag key={i} val={t.label} label={t.label} tooltip={t.tooltip} />
          ))}
        </div>
      </td>

      <td
        className={`mech-col-castres mech-trigger-cell ${activeTrigger === 'castRes' ? 'is-active' : ''}`}
        onClick={toggleTrigger('castRes')}
        onMouseEnter={() => onFieldMouseEnter('castRes')}
        onMouseLeave={onFieldMouseLeave}
      >
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

      <td
        className={`mech-trigger-cell ${activeTrigger === 'hits' ? 'is-active' : ''}`}
        onClick={toggleTrigger('hits')}
        onMouseEnter={() => onFieldMouseEnter('hits')}
        onMouseLeave={onFieldMouseLeave}
      >
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
          onBlur={makeTimeBlur(data, updateNode, 'cooldown', 'seconds')}
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
  );
};
