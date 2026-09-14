// src/components/builder/panels/AddCastTypePanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { Dropdown } from '../../common/Dropdown';
import { TypeTag } from '../../common/TypeTag';
import { castTagColor } from '../mechanicNodeHelpers';

interface AddCastTypePanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  castSelect: string;
  setCastSelect: (v: string) => void;
}

export const AddCastTypePanel: React.FC<AddCastTypePanelProps> = ({ data, updateNode, castSelect, setCastSelect }) => {
  const handleAddCastTag = () => {
    if (!castSelect) return;
    const castTypes = Array.from(new Set([...(data.castTypes || []), castSelect]));
    updateNode({ castTypes });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Add Cast Type</div>
      {(data.castTypes || []).length > 0 && (
        <div className="mech-tag-row" style={{ marginBottom: 'var(--space-3)' }}>
          {(data.castTypes || []).map((t, i) => (
            <TypeTag
              key={i}
              val={t}
              label={t}
              color={castTagColor(t)}
              onRemove={() => updateNode({ castTypes: data.castTypes?.filter((_, idx) => idx !== i) })}
            />
          ))}
        </div>
      )}
      <div className="mech-add-row">
        <Dropdown
          className="base-select mech-mini-select"
          value={castSelect}
          onChange={setCastSelect}
          options={BuilderState.CAST_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <button type="button" className="base-btn text-xs" onClick={handleAddCastTag}>Add</button>
      </div>
    </div>
  );
};
