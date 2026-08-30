// src/components/builder/panels/InputsPhysicsPanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { Dropdown } from '../../common/Dropdown';
import { displayTimeVal, makeTimeBlur } from '../mechanicNodeHelpers';

interface InputsPhysicsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

export const InputsPhysicsPanel: React.FC<InputsPhysicsPanelProps> = ({ data, updateNode }) => {
  const holdCfg = data.holdConfig || {};

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Inputs &amp; Physics</div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Input Binding</label>
          <Dropdown
            className="base-select"
            value={data.input || ''}
            onChange={v => updateNode({ input: v })}
            options={[
              { value: '', label: 'None' },
              { value: 'Basic', label: 'Basic' },
              { value: 'Skill', label: 'Skill' },
              { value: 'Jump', label: 'Jump' },
              { value: 'Dodge', label: 'Dodge' },
              { value: 'Liberation', label: 'Liberation' },
              { value: 'Utility', label: 'Utility' },
              { value: 'Echo', label: 'Echo' }
            ]}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Input Type</label>
          <Dropdown
            className="base-select"
            value={data.inputType || 'Press'}
            onChange={v => updateNode({ inputType: v as any })}
            options={[
              { value: 'Press', label: 'Press' },
              { value: 'Hold', label: 'Hold' },
              { value: 'Release', label: 'Release' }
            ]}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Stance Required</label>
          <Dropdown
            className="base-select"
            value={data.stanceReq || 'Any'}
            onChange={v => updateNode({ stanceReq: v as any })}
            options={[
              { value: 'Any', label: 'Any' },
              { value: 'Grounded', label: 'Grounded' },
              { value: 'Midair', label: 'Midair' }
            ]}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Stance Result</label>
          <Dropdown
            className="base-select"
            value={data.stanceResult || 'Retain'}
            onChange={v => updateNode({ stanceResult: v as any, stanceTime: v === 'Retain' ? '' : data.stanceTime })}
            options={[
              { value: 'Retain', label: 'Retain' },
              { value: 'Grounded', label: 'Grounded' },
              { value: 'Midair', label: 'Midair' }
            ]}
          />
        </div>
        <div className="form-group relative">
          <label className="form-label">Transition Time</label>
          <input type="text" className="form-input w-100" value={displayTimeVal(data.stanceTime, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ stanceTime: e.target.value })} onBlur={makeTimeBlur(data, updateNode, 'stanceTime', 'frames')} placeholder="e.g. 0 or 15f" disabled={data.stanceResult === 'Retain'} />
        </div>
      </div>

      {data.inputType === 'Release' && (
        <div className="form-row hold-config-row mt-sm" style={{ display: 'flex', background: 'rgba(220,165,76,0.05)', padding: 'var(--space-3)', border: '1px solid rgba(220,165,76,0.2)', borderRadius: '4px', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="w-100 text-gold text-bold" style={{ fontSize: '0.8rem' }}>Hold Input Configuration</div>
          <div className="flex-row gap-sm w-100 flex-wrap">
            <div className="form-group flex-1">
              <label className="form-label">Cursor Mode</label>
              <Dropdown
                className="base-select"
                value={holdCfg.cursorMode || 'pingpong'}
                onChange={v => updateNode({ holdConfig: { ...holdCfg, cursorMode: v as any } })}
                options={[
                  { value: 'pingpong', label: 'Ping-Pong' },
                  { value: 'clamp', label: 'Clamp' },
                  { value: 'loop', label: 'Loop' }
                ]}
              />
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
};
