import React from 'react';
import type { InputBinding, MechanicNode, StanceChange } from '../../../types';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { MECHANICS_NOTATION } from '../../../data/db';
import { displayTimeVal } from '../mechanicNodeHelpers';
import { tip } from '../../../utils/Common';
import { parseTimeInput, toFrames } from '../../../utils/Frames';
import { getStanceChanges, stanceChangeFrames } from '../../../utils/Stance';

const INPUT_OPTIONS: DropdownOption[] = ['Basic', 'Skill', 'Jump', 'Dodge', 'Liberation', 'Utility', 'Echo'].map(v => ({ value: v, label: v }));
// Alternate inputs: a press, or a hold carried on from the previous move.
const ALT_INPUT_TYPE_OPTIONS: DropdownOption[] = [{ value: '', label: 'Press' }, { value: 'Hold', label: 'Hold (carried on)' }];

// Grounded (green) / Midair (red) over the move; "Any" is hatched.
const StanceBar: React.FC<{ data: MechanicNode; changes: StanceChange[] }> = ({ data, changes }) => {
  const duration = typeof data.actionDuration === 'number' ? data.actionDuration : 0;
  const cancelFrames = (data.cancelTimings || []).map(ct => ct.time);
  const ordered = changes
    .map(c => ({ stance: c.stance, frame: stanceChangeFrames(c) }))
    .sort((a, b) => a.frame - b.frame);
  const max = Math.max(duration, ...cancelFrames, ...ordered.map(c => c.frame), 1);
  const start = data.stanceReq || 'Any';
  const segments = [{ stance: start as string, from: 0 }, ...ordered.map(c => ({ stance: c.stance as string, from: Math.min(c.frame, max) }))];

  return (
    <div className="mech-timeline-bar mech-stance-bar">
      {segments.map((s, i) => {
        const to = i < segments.length - 1 ? segments[i + 1].from : max;
        if (to <= s.from) return null;
        return (
          <div
            key={i}
            className={`mech-stance-seg is-${s.stance.toLowerCase()}`}
            style={{ flexGrow: to - s.from }}
            {...tip(`${s.stance === 'Any' ? 'Any stance' : s.stance}: ${s.from}f - ${to}f`)}
          />
        );
      })}
      <span className="mech-timeline-label" style={{ left: 4 }}>0f</span>
      <span className="mech-timeline-label" style={{ right: 4 }}>{max}f</span>
    </div>
  );
};

interface InputsPhysicsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  forteOptions: DropdownOption[];
  // A Repeat sibling hides the hold config.
  groupSiblings?: { repeat?: [string, MechanicNode]; release?: [string, MechanicNode] };
}

/** Builder sub-panel: input binding and type, stance changes and a hold's cursor config. */
export const InputsPhysicsPanel: React.FC<InputsPhysicsPanelProps> = ({ data, updateNode, forteOptions, groupSiblings }) => {
  const holdCfg = data.holdConfig || {};
  const d = MECHANICS_NOTATION.HOLD_DEFAULTS;
  const isClamp = (holdCfg.cursorMode || d.CURSOR_MODE) === 'clamp';

  const changes = getStanceChanges(data);
  // Clears the legacy stanceResult/stanceTime.
  const setChanges = (next: StanceChange[]) => updateNode({ stanceChanges: next, stanceResult: undefined, stanceTime: undefined });
  const addChange = () => {
    const last = changes.length > 0 ? changes[changes.length - 1].stance : data.stanceReq;
    // Starts at the end so it has no effect until moved.
    const endFrame = typeof data.actionDuration === 'number' ? data.actionDuration : '';
    setChanges([...changes, { stance: last === 'Midair' ? 'Grounded' : 'Midair', time: endFrame }]);
  };

  const altInputs = data.altInputs || [];
  const setAltInputs = (next: InputBinding[]) => updateNode({ altInputs: next.length > 0 ? next : undefined });

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Inputs</div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label caps-label">Input Binding</label>
          <Dropdown
            className="base-select"
            value={data.input || ''}
            onChange={v => updateNode({ input: v })}
            options={[{ value: '', label: 'None' }, ...INPUT_OPTIONS]}
          />
        </div>
        <div className="form-group">
          <label className="form-label caps-label">Input Type</label>
          <Dropdown
            className="base-select"
            value={data.inputType || ''}
            onChange={v => updateNode({ inputType: (v || undefined) as any })}
            options={[
              { value: '', label: 'None' },
              { value: 'Hold', label: 'Hold' },
              { value: 'Repeat', label: 'Repeat' },
              { value: 'Release', label: 'Release' }
            ]}
          />
        </div>
      </div>

      <div className="panel-header-tiny mt-sm">Also Accepts</div>
      <div className="mech-list">
        {altInputs.length === 0 && <div className="dim" style={{ padding: '0.25rem 0' }}>Only the input above.</div>}
        {altInputs.map((b, i) => (
          <div key={i} className="mech-add-row">
            <Dropdown className="base-select mech-mini-select has-value" value={b.input}
              onChange={v => setAltInputs(altInputs.map((x, j) => (j === i ? { ...x, input: v } : x)))} options={INPUT_OPTIONS} />
            <Dropdown className="base-select mech-mini-select has-value" value={b.inputType || ''}
              onChange={v => setAltInputs(altInputs.map((x, j) => (j === i ? { input: x.input, ...(v ? { inputType: v as InputBinding['inputType'] } : {}) } : x)))}
              options={ALT_INPUT_TYPE_OPTIONS} />
            <button type="button" className="mech-list-remove" onClick={() => setAltInputs(altInputs.filter((_, j) => j !== i))} {...tip('Remove input')}>×</button>
          </div>
        ))}
      </div>
      <div className="mech-add-row">
        <span className="form-label caps-label" style={{ margin: 0 }} {...tip('Other inputs that cast this move. Hold: carried on from a hold on the previous move, e.g. holding Basic through a combo.')}>Add Input</span>
        <button type="button" className="base-btn mech-add-icon-btn" onClick={() => setAltInputs([...altInputs, { input: data.input || 'Basic' }])} {...tip('Add input')}>+</button>
      </div>

      <div className="panel-header-main mt-sm">Stance Transitions</div>
      <StanceBar data={data} changes={changes} />
      <table className="mech-hit-table mech-stance-table">
        <thead className="caps-label">
          <tr>
            <th>Change</th>
            <th>Stance</th>
            <th>Frame</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>—</td>
            <td>
              <Dropdown
                className="base-select mech-mini-select has-value"
                value={data.stanceReq || 'Any'}
                onChange={v => updateNode({ stanceReq: v as any })}
                options={[
                  { value: 'Any', label: 'Any' },
                  { value: 'Grounded', label: 'Grounded' },
                  { value: 'Midair', label: 'Midair' }
                ]}
              />
            </td>
            <td><span className="dim">0f</span></td>
            <td />
          </tr>
          {changes.map((c, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <Dropdown
                  className="base-select mech-mini-select has-value"
                  value={c.stance}
                  onChange={v => setChanges(changes.map((x, j) => (j === i ? { ...x, stance: v as StanceChange['stance'] } : x)))}
                  options={[
                    { value: 'Grounded', label: 'Grounded' },
                    { value: 'Midair', label: 'Midair' }
                  ]}
                />
              </td>
              <td>
                <input
                  type="text"
                  className="cell-value"
                  value={displayTimeVal(c.time, 'f')}
                  onChange={e => setChanges(changes.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                  onBlur={() => {
                    if (typeof c.time !== 'string' || c.time.trim() === '') return;
                    const parsed = parseTimeInput(c.time, 'frames');
                    if (parsed === c.time) return;
                    const framesOrDsl = typeof parsed === 'number' ? toFrames(parsed) : parsed;
                    setChanges(changes.map((x, j) => (j === i ? { ...x, time: framesOrDsl } : x)));
                  }}
                  placeholder="0f"
                />
              </td>
              <td>
                <button type="button" className="mech-list-remove" onClick={() => setChanges(changes.filter((_, j) => j !== i))} {...tip('Remove stance change')}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mech-add-row">
        <span className="form-label caps-label" style={{ margin: 0 }}>Add Stance Change</span>
        <button type="button" className="base-btn mech-add-icon-btn" onClick={addChange} {...tip('Add stance change')}>+</button>
      </div>

      {data.inputType === 'Release' && !groupSiblings?.repeat && (
        <div className="form-row hold-config-row mt-sm" style={{ display: 'flex', background: 'rgba(220,165,76,0.05)', padding: 'var(--space-3)', border: '1px solid rgba(220,165,76,0.2)', borderRadius: '0.25rem', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="w-100 text-gold text-bold" style={{ fontSize: '0.8rem' }}>Hold Input Configuration</div>
          <div className="flex-row gap-sm w-100 flex-wrap">
            <div className="form-group flex-1">
              <label className="form-label caps-label">Cursor Mode</label>
              <Dropdown
                className="base-select"
                value={holdCfg.cursorMode || d.CURSOR_MODE}
                onChange={v => updateNode({ holdConfig: { ...holdCfg, cursorMode: v as any } })}
                options={[
                  { value: 'pingpong', label: 'Ping-Pong' },
                  { value: 'clamp', label: 'Clamp' },
                  { value: 'loop', label: 'Loop' }
                ]}
              />
            </div>
            <div className="form-group flex-1">
              <label className="form-label caps-label">Speed (Forte per Second)</label>
              <input type="number" className="form-input" value={holdCfg.cursorSpeed ?? d.CURSOR_SPEED} onChange={e => updateNode({ holdConfig: { ...holdCfg, cursorSpeed: parseFloat(e.target.value) || d.CURSOR_SPEED } })} />
            </div>
            <div className="form-group flex-1">
              <label className="form-label caps-label">Forte Slot</label>
              <Dropdown
                className="base-select"
                value={holdCfg.forteSlot || d.FORTE_SLOT}
                onChange={v => updateNode({ holdConfig: { ...holdCfg, forteSlot: v } })}
                options={forteOptions}
              />
            </div>
            <label className="checkbox-label align-self-end" style={{ height: '2rem', display: 'flex', alignItems: 'center' }}>
              <input type="checkbox" checked={!!holdCfg.retainCursor} onChange={e => updateNode({ holdConfig: { ...holdCfg, retainCursor: e.target.checked } })} />
              <span>Retain Cursor</span>
            </label>
          </div>
          {/* Clamp has no window. */}
          {!isClamp && (
            <div className="flex-row gap-sm w-100">
              <div className="form-group relative flex-1">
                <label className="form-label caps-label">Window Center (DSL)</label>
                <AutocompleteInput mode="general" value={holdCfg.windowCenter ?? d.WINDOW_CENTER} onValueChange={val => updateNode({ holdConfig: { ...holdCfg, windowCenter: val } })} placeholder={`e.g. ${d.WINDOW_CENTER}`} />
              </div>
              <div className="form-group relative flex-1">
                <label className="form-label caps-label">Window Size (DSL)</label>
                <AutocompleteInput mode="general" value={holdCfg.windowSize ?? d.WINDOW_SIZE} onValueChange={val => updateNode({ holdConfig: { ...holdCfg, windowSize: val } })} placeholder={`e.g. ${d.WINDOW_SIZE}`} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
