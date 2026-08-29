// src/components/builder/panels/HitBreakdownPanel.tsx
import React, { useState, useEffect } from 'react';
import type { Frames } from '../../../utils/Frames';
import type { MechanicNode } from '../../../types';
import { CommonUtils } from '../../../utils/Common';
import { displayTimeVal, tip } from '../mechanicNodeHelpers';
import { parseTimeInput } from '../../../utils/Frames';

interface HitBreakdownPanelProps {
  nodeId: string;
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

export const HitBreakdownPanel: React.FC<HitBreakdownPanelProps> = ({ nodeId, data, updateNode }) => {
  // Raw text mirror of hitMults — kept separate from the parsed store value so
  // typing (e.g. "[50%, 100%]") isn't clobbered by the round-tripped parse on every keystroke.
  const [multText, setMultText] = useState<string>(() => (data.hitMults ? JSON.stringify(data.hitMults) : ''));
  useEffect(() => {
    setMultText(data.hitMults ? JSON.stringify(data.hitMults) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

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

  const updateHitResourceValue = (key: string, idx: number, raw: string) => {
    const current = data.hitResources?.[key];
    const arr = Array.isArray(current) ? [...current] : new Array(Math.max(idx + 1, 1)).fill(0);
    const num = parseFloat(raw);
    arr[idx] = isNaN(num) ? 0 : num;
    updateNode({ hitResources: { ...(data.hitResources || {}), [key]: arr } });
  };

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
};
