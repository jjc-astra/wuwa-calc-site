// src/components/builder/panels/AddDmgTypePanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { Dropdown } from '../../common/Dropdown';

interface AddDmgTypePanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  dmgSelect: string;
  setDmgSelect: (v: string) => void;
}

export const AddDmgTypePanel: React.FC<AddDmgTypePanelProps> = ({ data, updateNode, dmgSelect, setDmgSelect }) => {
  const handleAddDmgTag = () => {
    if (!dmgSelect) return;
    const dmgTypes = Array.from(new Set([...(data.dmgTypes || []), dmgSelect]));
    updateNode({ dmgTypes });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Add Dmg Type</div>
      <div className="mech-add-row">
        <Dropdown
          className="base-select mech-mini-select"
          value={dmgSelect}
          onChange={setDmgSelect}
          options={BuilderState.DMG_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <button type="button" className="base-btn text-xs" onClick={handleAddDmgTag}>Add</button>
      </div>
    </div>
  );
};
