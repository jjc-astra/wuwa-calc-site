// src/components/builder/panels/CooldownPanel.tsx
import React, { useState } from 'react';
import type { MechanicNode } from '../../../types';
import { useBuilderStore } from '../../../store/useBuilderStore';
import { MechanicKey } from '../../../utils/MechanicKey';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { displayTimeVal, makeTimeBlur } from '../mechanicNodeHelpers';

interface CooldownPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
}

export const CooldownPanel: React.FC<CooldownPanelProps> = ({ data, updateNode }) => {
  const { activeChar, mechanics, setMechanicNode } = useBuilderStore();
  const [shareDraft, setShareDraft] = useState<string | null>(null);

  // "Share Cooldown With" is a two-way link: writing it on this move also stamps the partner's
  // own field to point back here, and changing/clearing it un-stamps whichever partner it used
  // to point at (only if that partner still points back at this move -- never steal a link the
  // user pointed somewhere else by hand). Committed on blur, like every other draft field here.
  const commitShareCooldown = () => {
    if (shareDraft === null) return;
    const newPartnerName = shareDraft.trim();
    const oldPartnerName = data.shareCooldownWith || '';
    setShareDraft(null);
    if (newPartnerName === oldPartnerName) return;

    const prefix = MechanicKey.prefix(activeChar || 'Generic');

    if (oldPartnerName) {
      const oldPartner = mechanics[`${prefix}${oldPartnerName}`];
      if (oldPartner?.shareCooldownWith === data.name) {
        const { shareCooldownWith: _drop, ...rest } = oldPartner;
        setMechanicNode(`${prefix}${oldPartnerName}`, rest as MechanicNode);
      }
    }

    const isSelf = newPartnerName === data.name;
    if (newPartnerName && !isSelf) {
      const newPartner = mechanics[`${prefix}${newPartnerName}`];
      if (newPartner) setMechanicNode(`${prefix}${newPartnerName}`, { ...newPartner, shareCooldownWith: data.name });
    }

    updateNode({ shareCooldownWith: (newPartnerName && !isSelf) ? newPartnerName : undefined });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Cooldown</div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Cooldown</label>
          <input
            type="text"
            className="form-input"
            value={displayTimeVal(data.cooldown, 's')}
            onChange={e => updateNode({ cooldown: e.target.value })}
            onBlur={makeTimeBlur(data, updateNode, 'cooldown', 'seconds')}
            placeholder="e.g. 20s"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Max Charges</label>
          <input
            type="text"
            inputMode="numeric"
            className="form-input"
            value={data.maxCharges ?? ''}
            onChange={e => {
              const digits = e.target.value.replace(/[^0-9]/g, '');
              updateNode({ maxCharges: digits === '' ? undefined : digits });
            }}
            placeholder="1"
          />
        </div>
        <div className="form-group flex-1">
          <label className="form-label">Share Cooldown With</label>
          <AutocompleteInput
            mode="eff-cd-name"
            value={shareDraft !== null ? shareDraft : (data.shareCooldownWith || '')}
            onValueChange={setShareDraft}
            onBlur={commitShareCooldown}
            placeholder="e.g. Resonance Skill"
          />
        </div>
      </div>
    </div>
  );
};
