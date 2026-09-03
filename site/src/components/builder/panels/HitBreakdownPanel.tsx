// src/components/builder/panels/HitBreakdownPanel.tsx
import React, { useState, useEffect } from 'react';
import type { Frames } from '../../../utils/Frames';
import type { MechanicNode } from '../../../types';
import { CommonUtils } from '../../../utils/Common';
import { displayTimeVal, tip } from '../mechanicNodeHelpers';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { parseTimeInput } from '../../../utils/Frames';

interface HitBreakdownPanelProps {
  nodeId: string;
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  forteOptions: DropdownOption[];
}

export const HitBreakdownPanel: React.FC<HitBreakdownPanelProps> = ({ nodeId, data, updateNode, forteOptions }) => {
  // Which resource type "Add Hit Resource" will add next -- there was previously no way to add a
  // *new* hitResources key at all (only edit an already-existing one's per-hit values), for any
  // mechanic, passive or scheduled -- castResources had AddCastResourcePanel's equivalent control,
  // hitResources never got one.
  const [newHitResType, setNewHitResType] = useState('energy');
  // Raw text mirror of hitMults — kept separate from the parsed store value so
  // typing (e.g. "[50%, 100%]") isn't clobbered by the round-tripped parse on every keystroke.
  const [multText, setMultText] = useState<string>(() => (data.hitMults ? JSON.stringify(data.hitMults) : ''));
  useEffect(() => {
    setMultText(data.hitMults ? JSON.stringify(data.hitMults) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Same raw-text-mirror trick, per hit-resource cell (keyed "resKey_hitIndex") -- each cell's
  // onChange parses immediately (so calculation and other open views stay live), but the cell
  // itself displays this raw string, not the round-tripped number, so a mid-typed "1." isn't
  // snapped back to "1" before the user can type the digits after the decimal point.
  const [hitResRaw, setHitResRaw] = useState<Record<string, string>>({});
  useEffect(() => {
    setHitResRaw({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Per-hit breakdown / timeline preview -- mirrors TimelineEngine._resolveTimings' own
  // getHitTimeOffset interpolation, recomputed here purely for display (doesn't touch the
  // real engine, doesn't affect calculation). The dmg window is INFERRED from this: hit 1's
  // frame (if explicitly set) is damageTimeframe.start, the last hit's frame (if explicitly
  // set) is damageTimeframe.end -- there's no separate dmg-window input anymore.
  const hitMultsArr = Array.isArray(data.hitMults) ? data.hitMults : [];
  const hitCount = hitMultsArr.length;
  // actionDuration is only the dmg-window's fallback end when damageTimeframe.end isn't set
  // directly -- a passive/proc'd mechanic (no actionDuration at all, since it's never a
  // scheduled action) still needs to be able to set damageTimeframe on its own, so this no
  // longer gates whether the panel renders at all (see the render condition below).
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
  // The dropdown's own selection can go stale once its current value is added/removed
  // elsewhere -- fall back to the first still-available option rather than a value that no
  // longer appears in the list, and use that same resolved value when actually adding.
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
          <label className="form-label">Scalar Stat</label>
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
            <thead>
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
              <Dropdown
                className="base-select mech-mini-select"
                value={effectiveNewHitResType}
                onChange={setNewHitResType}
                options={availableHitResTypes}
              />
              <button type="button" className="base-btn text-xs" onClick={handleAddHitResource}>Add Hit Resource</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
