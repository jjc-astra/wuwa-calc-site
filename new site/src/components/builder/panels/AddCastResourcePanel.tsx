// src/components/builder/panels/AddCastResourcePanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';

interface AddCastResourcePanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  castResType: string;
  setCastResType: (v: string) => void;
  castResAmt: string;
  setCastResAmt: (v: string) => void;
  forteOptions: React.ReactElement[];
}

export const AddCastResourcePanel: React.FC<AddCastResourcePanelProps> = ({
  data, updateNode, castResType, setCastResType, castResAmt, setCastResAmt, forteOptions
}) => {
  const handleAddCastResource = () => {
    if (!castResAmt) return;
    const castResources = { ...(data.castResources || {}), [castResType]: parseFloat(castResAmt) || 0 };
    updateNode({ castResources });
    setCastResAmt('');
  };

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
};
