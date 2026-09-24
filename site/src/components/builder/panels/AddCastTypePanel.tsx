import React from 'react';
import type { MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { Dropdown } from '../../common/Dropdown';
import { TypeTag } from '../../common/TypeTag';
import { castTagColor, tip } from '../mechanicNodeHelpers';

interface AddCastTypePanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  castSelect: string;
  setCastSelect: (v: string) => void;
}

/** Builder sub-panel: the node's cast type tags. */
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
        <span className="form-label caps-label" style={{ margin: 0 }}>Add Cast Type</span>
        <Dropdown
          className="base-select mech-mini-select has-value"
          value={castSelect}
          onChange={setCastSelect}
          options={BuilderState.CAST_OPTIONS.map(o => ({ value: o, label: o }))}
        />
        <button type="button" className="base-btn mech-add-icon-btn" onClick={handleAddCastTag} {...tip('Add cast type')}>+</button>
      </div>
    </div>
  );
};
