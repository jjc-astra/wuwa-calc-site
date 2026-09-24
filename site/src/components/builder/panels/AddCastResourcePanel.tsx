import React from 'react';
import type { MechanicNode } from '../../../types';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { tip } from '../mechanicNodeHelpers';

interface AddCastResourcePanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  castResType: string;
  setCastResType: (v: string) => void;
  castResAmt: string;
  setCastResAmt: (v: string) => void;
  forteOptions: DropdownOption[];
}

/** Builder sub-panel: adds an on-cast resource change. */
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
        <span className="form-label caps-label" style={{ margin: 0 }}>Add Resource</span>
        <Dropdown
          className="base-select mech-mini-select has-value"
          value={castResType}
          onChange={setCastResType}
          options={[
            { value: 'energy', label: 'Energy' },
            { value: 'concerto', label: 'Concerto' },
            ...forteOptions,
            { value: 'tune', label: 'Tune' }
          ]}
        />
        <input type="text" className="form-input mech-mini-input" value={castResAmt} onChange={e => setCastResAmt(e.target.value)} placeholder="10" />
        <button type="button" className="base-btn mech-add-icon-btn" onClick={handleAddCastResource} {...tip('Add on-cast resource')}>+</button>
      </div>
    </div>
  );
};
