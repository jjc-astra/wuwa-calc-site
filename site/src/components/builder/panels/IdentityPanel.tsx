// src/components/builder/panels/IdentityPanel.tsx
import React from 'react';
import type { MechanicNode } from '../../../types';
import { useBuilderStore } from '../../../store/useBuilderStore';
import { BuilderUtils } from '../../../utils/BuilderUtils';

interface IdentityPanelProps {
  nodeId: string;
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

export const IdentityPanel: React.FC<IdentityPanelProps> = ({ nodeId, data, updateNode }) => {
  const { activeChar, renameMechanicNode } = useBuilderStore();

  // Renaming a node regenerates its ID (provider is always the active char, matching
  // the old site's ID = `${activeChar}_${name}` derivation). The re-key only happens on
  // blur -- doing it on every keystroke would change the store key (and thus this card's
  // React list key) mid-typing, remounting the input and dropping keyboard focus.
  const handleNameBlur = () => {
    const currentName = data.name || '';
    const owner = activeChar === 'Generic' ? 'System' : (activeChar || '');
    const newId = currentName.trim() ? BuilderUtils.generateId(owner, currentName) : nodeId;
    const collides = newId !== nodeId && useBuilderStore.getState().mechanics[newId];
    if (newId !== nodeId && !collides) {
      renameMechanicNode(nodeId, newId, data);
    }
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Identity</div>
      <div className="form-row">
        <div className="form-group flex-1">
          <label className="form-label">Name</label>
          <input
            type="text"
            className="form-input"
            value={data.name || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ name: e.target.value })}
            onBlur={handleNameBlur}
            placeholder="New Mechanic"
          />
        </div>
        <div className="form-group flex-05">
          <label className="form-label">Provider</label>
          <input type="text" className="form-input" value={data.provider || activeChar || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ provider: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label text-accent">ID (Read-Only)</label>
          <input type="text" className="form-input input-readonly" value={nodeId} readOnly />
        </div>
      </div>
    </div>
  );
};
