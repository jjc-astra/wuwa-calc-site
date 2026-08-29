// src/components/builder/panels/InputsPhysicsPanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { AutocompleteInput } from '../../common/AutocompleteInput';
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
          <input type="text" className="form-input w-100" value={displayTimeVal(data.stanceTime, 'f')} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ stanceTime: e.target.value })} onBlur={makeTimeBlur(data, updateNode, 'stanceTime', 'frames')} placeholder="e.g. 0 or 15f" disabled={data.stanceResult === 'Retain'} />
        </div>
      </div>

      {data.inputType === 'Release' && (
        <div className="form-row hold-config-row mt-sm" style={{ display: 'flex', background: 'rgba(220,165,76,0.05)', padding: 'var(--space-3)', border: '1px solid rgba(220,165,76,0.2)', borderRadius: '4px', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
};
