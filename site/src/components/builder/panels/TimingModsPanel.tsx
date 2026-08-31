// src/components/builder/panels/TimingModsPanel.tsx
import React, { useState } from 'react';
import type { MechanicNode } from '../../../types';
import { parseTimeInput } from '../../../utils/Frames';
import { displayTimeVal, makeTimeBlur } from '../mechanicNodeHelpers';

interface TimingModsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

export const TimingModsPanel: React.FC<TimingModsPanelProps> = ({ data, updateNode }) => {
  const [cancelTime, setCancelTime] = useState('');
  const [cancelHits, setCancelHits] = useState('');
  const [cancelRule, setCancelRule] = useState('');

  const cancelTimings = data.cancelTimings || [];

  const handleAddCancelTiming = () => {
    if (!cancelTime) return;
    // cancelTimings[].time is frames-domain (a cancel point within the move's animation) --
    // accepts "30f"/"0.5s"/a bare number (frames, matching the field's native unit).
    const obj: any = { time: Math.round(Number(parseTimeInput(cancelTime, 'frames'))) };
    if (cancelHits) obj.hits = parseInt(cancelHits, 10);
    if (cancelRule.trim()) obj.triggerRule = cancelRule.trim();

    updateNode({ cancelTimings: [...cancelTimings, obj] });

    setCancelTime('');
    setCancelHits('');
    setCancelRule('');
  };

  const loadCancelForEdit = (idx: number) => {
    const ct = cancelTimings[idx];
    if (!ct) return;
    setCancelTime(ct.time !== undefined ? String(ct.time) : '');
    setCancelHits(ct.hits !== undefined ? String(ct.hits) : '');
    setCancelRule(ct.triggerRule || '');
    updateNode({ cancelTimings: cancelTimings.filter((_, i) => i !== idx) });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Timing Modifiers</div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Freeze Time</label>
          <input type="text" className="form-input w-100" value={displayTimeVal(data.freezeTime, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ freezeTime: e.target.value })} onBlur={makeTimeBlur(data, updateNode, 'freezeTime', 'frames')} placeholder="e.g. 5f" />
        </div>
        <div className="form-group">
          <label className="form-label">Swap Time</label>
          <input type="text" className="form-input w-100" value={displayTimeVal(data.swapTiming, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ swapTiming: e.target.value })} onBlur={makeTimeBlur(data, updateNode, 'swapTiming', 'frames')} placeholder="e.g. 9f" />
        </div>
        <div className="form-group">
          <label className="form-label">Priority</label>
          <input type="text" className="form-input w-100" value={data.priority ?? 0} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ priority: e.target.value })} placeholder="@Default.basicPriority" />
        </div>
        <div className="form-group relative">
          <label className="form-label">Combo Window</label>
          <input type="text" className="form-input w-100" value={displayTimeVal(data.comboWindow, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ comboWindow: e.target.value })} onBlur={makeTimeBlur(data, updateNode, 'comboWindow', 'frames')} placeholder="@Default.ComboWindow" />
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
              onClick={e => { e.stopPropagation(); updateNode({ cancelTimings: cancelTimings.filter((_, i) => i !== idx) }); }}
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
};
