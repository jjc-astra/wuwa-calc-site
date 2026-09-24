// src/components/builder/panels/AddDmgTypePanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { Dropdown } from '../../common/Dropdown';
import { TypeTag } from '../../common/TypeTag';
import { dmgTagColor, tip } from '../mechanicNodeHelpers';

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
      {(data.dmgTypes || []).length > 0 && (
        <div className="mech-tag-row" style={{ marginBottom: 'var(--space-3)' }}>
          {(data.dmgTypes || []).map((t, i) => (
            <TypeTag
              key={i}
              val={t}
              label={t}
              color={dmgTagColor(t)}
              onRemove={() => updateNode({ dmgTypes: data.dmgTypes?.filter((_, idx) => idx !== i) })}
            />
          ))}
        </div>
      )}
      <div className="mech-add-row">
        <span className="form-label caps-label" style={{ margin: 0 }}>Add Damage Type</span>
        <Dropdown
          className="base-select mech-mini-select has-value"
          value={dmgSelect}
          onChange={setDmgSelect}
          options={BuilderState.DMG_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <button type="button" className="base-btn mech-add-icon-btn" onClick={handleAddDmgTag} {...tip('Add damage type')}>+</button>
      </div>
    </div>
  );
};
