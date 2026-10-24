import React, { useState } from 'react';
import type { MechanicNode, PriorityStep } from '../../../types';
import { parseTimeInput } from '../../../utils/Frames';
import { displayTimeVal, makeTimeBlur } from '../mechanicNodeHelpers';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { tip } from '../../../utils/Common';

interface TimingModsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

interface TimingListProps {
  title: string;
  empty: string;
  labels: string[];
  onEdit: (idx: number) => void;
  onRemove: (idx: number) => void;
  children: React.ReactNode;
}

// Click a row to load it back into the add row; x removes it.
const TimingList: React.FC<TimingListProps> = ({ title, empty, labels, onEdit, onRemove, children }) => (
  <>
    <div className="panel-header-tiny" style={{ marginTop: '0.875rem' }}>{title}</div>
    <div className="mech-list">
      {labels.length === 0 && <div className="dim" style={{ padding: '0.25rem 0' }}>{empty}</div>}
      {labels.map((label, idx) => (
        <div key={idx} className="mech-list-row" onClick={() => onEdit(idx)}>
          <span>{label}</span>
          <button type="button" className="mech-list-remove" onClick={e => { e.stopPropagation(); onRemove(idx); }}>×</button>
        </div>
      ))}
    </div>
    <div className="mech-add-row mt-sm">{children}</div>
  </>
);

/** Builder sub-panel: freeze, motion stop, swap, priority, combo window, cancel timings and priority timeline. */
export const TimingModsPanel: React.FC<TimingModsPanelProps> = ({ data, updateNode }) => {
  const [cancelTime, setCancelTime] = useState('');
  const [cancelHits, setCancelHits] = useState('');
  const [cancelRule, setCancelRule] = useState('');
  const [stepTime, setStepTime] = useState('');
  const [stepPriority, setStepPriority] = useState('');

  const cancelTimings = data.cancelTimings || [];
  const priorityTimeline = data.priorityTimeline || [];

  const handleAddPriorityStep = () => {
    if (!stepTime || stepPriority.trim() === '') return;
    const raw = stepPriority.trim();
    const step: PriorityStep = { time: Math.round(Number(parseTimeInput(stepTime, 'frames'))) as PriorityStep['time'], priority: isNaN(Number(raw)) ? raw : Number(raw) };
    updateNode({ priorityTimeline: [...priorityTimeline, step].sort((a, b) => Number(a.time) - Number(b.time)) });
    setStepTime('');
    setStepPriority('');
  };

  const loadStepForEdit = (idx: number) => {
    const step = priorityTimeline[idx];
    if (!step) return;
    setStepTime(String(step.time));
    setStepPriority(String(step.priority));
    updateNode({ priorityTimeline: priorityTimeline.filter((_, i) => i !== idx) });
  };

  const handleAddCancelTiming = () => {
    if (!cancelTime) return;
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
          <label className="form-label caps-label">Freeze Time</label>
          <AutocompleteInput mode="dsl-value" value={displayTimeVal(data.freezeTime, 'f')} onValueChange={val => updateNode({ freezeTime: val })} onBlur={makeTimeBlur(data, updateNode, 'freezeTime', 'frames')} placeholder="e.g. 5f" />
        </div>
        <div className="form-group">
          <label className="form-label caps-label" {...tip('Frames into the move the freeze begins. Empty: at the cast.')}>Freeze Start</label>
          <AutocompleteInput mode="dsl-value" value={displayTimeVal(data.freezeStart, 'f')} onValueChange={val => updateNode({ freezeStart: val })} onBlur={makeTimeBlur(data, updateNode, 'freezeStart', 'frames')} placeholder="0f" />
        </div>
        <div className="form-group">
          <label className="form-label caps-label">Motion Stop</label>
          <AutocompleteInput mode="dsl-value" value={displayTimeVal(data.motionStop, 'f')} onValueChange={val => updateNode({ motionStop: val })} onBlur={makeTimeBlur(data, updateNode, 'motionStop', 'frames')} placeholder="e.g. 5f" />
        </div>
        <div className="form-group">
          <label className="form-label caps-label">Swap Time</label>
          <AutocompleteInput mode="dsl-value" value={displayTimeVal(data.swapTiming, 'f')} onValueChange={val => updateNode({ swapTiming: val })} onBlur={makeTimeBlur(data, updateNode, 'swapTiming', 'frames')} placeholder="e.g. 9f" />
        </div>
        <div className="form-group">
          <label className="form-label caps-label">Priority</label>
          <AutocompleteInput mode="dsl-value" value={String(data.priority ?? 0)} onValueChange={val => updateNode({ priority: val })} placeholder="@Default.basicPriority" />
        </div>
        <div className="form-group relative">
          <label className="form-label caps-label">Combo Window</label>
          <AutocompleteInput mode="dsl-value" value={displayTimeVal(data.comboWindow, 'f')} onValueChange={val => updateNode({ comboWindow: val })} onBlur={makeTimeBlur(data, updateNode, 'comboWindow', 'frames')} placeholder="@Default.ComboWindow" />
        </div>
      </div>

      <TimingList
        title="Cancel Timings"
        empty="No cancel timings yet."
        labels={cancelTimings.map(ct => `${ct.time}f${ct.hits ? ` · ${ct.hits} hits` : ''}${ct.triggerRule ? ` · ${ct.triggerRule}` : ''}`)}
        onEdit={loadCancelForEdit}
        onRemove={idx => updateNode({ cancelTimings: cancelTimings.filter((_, i) => i !== idx) })}
      >
        <input type="text" className="form-input mech-mini-input" value={cancelTime} onChange={e => setCancelTime(e.target.value)} placeholder="24f" />
        <input type="number" step="1" className="form-input mech-mini-input" value={cancelHits} onChange={e => setCancelHits(e.target.value)} placeholder="hits" />
        <div className="flex-1">
          <AutocompleteInput mode="general" className="mech-mini-input-wide" value={cancelRule} onValueChange={setCancelRule} placeholder="rule (opt), e.g. IF (...)" />
        </div>
        <button type="button" className="base-btn text-xs" onClick={handleAddCancelTiming}>Add</button>
      </TimingList>

      <TimingList
        title="Priority Timeline"
        empty="Priority stays the same for the whole move."
        labels={priorityTimeline.map(step => `${step.time}f · priority ${step.priority}`)}
        onEdit={loadStepForEdit}
        onRemove={idx => updateNode({ priorityTimeline: priorityTimeline.filter((_, i) => i !== idx) })}
      >
        <input type="text" className="form-input mech-mini-input" value={stepTime} onChange={e => setStepTime(e.target.value)} placeholder="88f" {...tip('From this frame on, the move has the priority on the right. A drop lets moves that now outrank it cancel it there.')} />
        <div className="flex-1">
          <AutocompleteInput mode="dsl-value" className="mech-mini-input-wide" value={stepPriority} onValueChange={setStepPriority} placeholder="@Default.BasicPriority" />
        </div>
        <button type="button" className="base-btn text-xs" onClick={handleAddPriorityStep}>Add</button>
      </TimingList>
    </div>
  );
};
