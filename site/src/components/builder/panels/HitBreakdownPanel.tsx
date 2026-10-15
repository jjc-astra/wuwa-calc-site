import React, { useState, useEffect } from 'react';
import type { Frames } from '../../../utils/Frames';
import type { MechanicNode } from '../../../types';
import { CommonUtils } from '../../../utils/Common';
import { displayTimeVal } from '../mechanicNodeHelpers';
import { tip, escapeHtml } from '../../../utils/Common';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { parseTimeInput, hitFrameOffsets } from '../../../utils/Frames';

interface HitBreakdownPanelProps {
  nodeId: string;
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  forteOptions: DropdownOption[];
}

export const HitBreakdownPanel: React.FC<HitBreakdownPanelProps> = ({ nodeId, data, updateNode, forteOptions }) => {
  const [newHitResType, setNewHitResType] = useState('energy');
  // Raw text so typing isn't clobbered by parsing.
  const [multText, setMultText] = useState<string>(() => (data.hitMults ? JSON.stringify(data.hitMults) : ''));
  useEffect(() => {
    setMultText(data.hitMults ? JSON.stringify(data.hitMults) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Raw text per cell ("resKey_hitIndex").
  const [hitResRaw, setHitResRaw] = useState<Record<string, string>>({});
  useEffect(() => {
    setHitResRaw({});
  }, [nodeId]);

  // Hit timing preview via hitFrameOffsets.
  const hitMultsArr = Array.isArray(data.hitMults) ? data.hitMults : [];
  const hitCount = hitMultsArr.length;
  // Fallback end when damageTimeframe.end is unset.
  const durationFrames = typeof data.actionDuration === 'number' ? data.actionDuration : null;
  const tfStart = typeof data.damageTimeframe?.start === 'number' ? data.damageTimeframe.start : 0;
  const tfEnd = typeof data.damageTimeframe?.end === 'number' ? data.damageTimeframe.end : (durationFrames ?? 0);
  // DSL overrides preview as spread.
  const hitFrameOverrides = (data.hitFrames || []).map(v => (typeof v === 'number' ? v : undefined));
  const hitOffsets = hitFrameOffsets(hitCount, tfStart, tfEnd, hitFrameOverrides);
  const cancelFrames = (data.cancelTimings || []).map(ct => ct.time).filter((t): t is Frames => typeof t === 'number');
  const timelineMax = Math.max(durationFrames || 0, tfEnd, ...cancelFrames, ...hitOffsets, 1);
  const hitResourceKeys = Object.keys(data.hitResources || {});

  const isWindowEdge = (i: number) => i === 0 || i === hitCount - 1;
  const hitFrameValue = (i: number) =>
    i === 0 ? data.damageTimeframe?.start : i === hitCount - 1 ? data.damageTimeframe?.end : data.hitFrames?.[i - 1] ?? undefined;
  const setHitFrame = (i: number, value: any) => {
    if (isWindowEdge(i)) {
      const patch: any = { ...(data.damageTimeframe || {}) };
      if (i === 0) patch.start = value;
      if (i === hitCount - 1) patch.end = value;
      updateNode({ damageTimeframe: patch });
      return;
    }
    // hitFrames starts at hit 2.
    const hitFrames = Array.from({ length: Math.max(hitCount - 2, data.hitFrames?.length ?? 0) }, (_, j) => data.hitFrames?.[j] ?? null);
    hitFrames[i - 1] = value === '' ? null : value;
    updateNode({ hitFrames });
  };

  const handleHitFrameBlur = (i: number) => () => {
    const raw = hitFrameValue(i);
    if (typeof raw !== 'string' || raw.trim() === '') return;
    const parsed = parseTimeInput(raw, 'frames');
    if (parsed !== raw) setHitFrame(i, parsed);
  };

  const updateHitResourceValue = (key: string, idx: number, raw: string) => {
    const current = data.hitResources?.[key];
    const arr = Array.isArray(current) ? [...current] : new Array(Math.max(idx + 1, 1)).fill(0);
    const num = parseFloat(raw);
    arr[idx] = isNaN(num) ? 0 : num;
    updateNode({ hitResources: { ...(data.hitResources || {}), [key]: arr } });
  };

  const removeHitResource = (key: string) => {
    const hitResources = { ...(data.hitResources || {}) };
    delete hitResources[key];
    updateNode({ hitResources });
  };

  const availableHitResTypes = [
    { value: 'energy', label: 'Energy' },
    { value: 'concerto', label: 'Concerto' },
    ...forteOptions,
    { value: 'tune', label: 'Tune' }
  ].filter(o => data.hitResources?.[o.value] === undefined);
  // Fall back to the first option if the selection is stale.
  const effectiveNewHitResType = availableHitResTypes.some(o => o.value === newHitResType)
    ? newHitResType
    : availableHitResTypes[0]?.value;

  const handleAddHitResource = () => {
    if (!effectiveNewHitResType || data.hitResources?.[effectiveNewHitResType] !== undefined) return;
    const hitResources = { ...(data.hitResources || {}), [effectiveNewHitResType]: new Array(hitCount).fill(0) };
    updateNode({ hitResources });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Hit Breakdown</div>
      <div className="flex-row gap-sm align-center mb-4px">
        <div className="form-group flex-05" style={{ margin: 0 }}>
          <label className="form-label caps-label">Scalar Stat</label>
          <Dropdown
            className="base-select"
            value={data.scalar || ''}
            onChange={v => updateNode({ scalar: v as any })}
            options={[
              { value: '', label: 'None' },
              { value: 'ATK', label: 'ATK' },
              { value: 'DEF', label: 'DEF' },
              { value: 'HP', label: 'HP' }
            ]}
          />
        </div>
        <div className="form-group flex-1" style={{ margin: 0 }}>
          <label className="form-label caps-label">Multiplier String</label>
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

      {hitCount > 0 && (
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
            <thead className="caps-label">
              <tr>
                <th>Hit</th>
                <th>Frame</th>
                <th>Mv</th>
                {hitResourceKeys.map(k => (
                  <th key={k}>
                    {k}
                    <button type="button" className="mech-list-remove" onClick={() => removeHitResource(k)} {...tip(`Remove ${k}`)}>×</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hitMultsArr.map((mv, i) => {
                const frameTip = i === 0
                  ? 'Dmg window start (inferred if blank)'
                  : i === hitCount - 1
                    ? 'Dmg window end (inferred if blank)'
                    : "This hit's frame";
                const frameText = String(displayTimeVal(hitFrameValue(i), 'f'));
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        className="cell-value mech-hit-frame"
                        value={frameText}
                        onChange={e => setHitFrame(i, e.target.value)}
                        onBlur={handleHitFrameBlur(i)}
                        placeholder={`${hitOffsets[i]}f`}
                        style={{ width: `${frameText.length + 1}ch` }}
                        {...tip(frameText.length > 4 ? `${frameTip}<br>${escapeHtml(frameText)}` : frameTip)}
                      />
                    </td>
                    <td className="accent">{String(mv)}</td>
                    {hitResourceKeys.map(k => {
                      const arr = data.hitResources?.[k];
                      const val = Array.isArray(arr) ? arr[i] : undefined;
                      const cellKey = `${k}_${i}`;
                      return (
                        <td key={k}>
                          <input
                            type="text"
                            className="cell-value"
                            value={hitResRaw[cellKey] ?? (val ?? '')}
                            onChange={e => {
                              setHitResRaw(prev => ({ ...prev, [cellKey]: e.target.value }));
                              updateHitResourceValue(k, i, e.target.value);
                            }}
                            onBlur={() => setHitResRaw(prev => { const next = { ...prev }; delete next[cellKey]; return next; })}
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
          {availableHitResTypes.length > 0 && (
            <div className="mech-add-row mt-sm">
              <span className="form-label caps-label" style={{ margin: 0 }}>Add Hit Resource</span>
              <Dropdown
                className="base-select mech-mini-select has-value"
                value={effectiveNewHitResType}
                onChange={setNewHitResType}
                options={availableHitResTypes}
              />
              <button type="button" className="base-btn mech-add-icon-btn" onClick={handleAddHitResource} {...tip('Add hit resource')}>+</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
