// Picks a roster unit (or, when offered, the whole team): Export's what-to-export, and a full
// roster's which-unit-an-import-replaces.
import React from 'react';
import type { TeamSlot } from '../../types';
import { IMAGE_FOLDERS } from '../../data/db';
import { AvatarIcon } from '../common/AvatarIcon';

export type RosterPick = number | 'team';

interface RosterPickDialogProps {
  title: string;
  message: string;
  team: TeamSlot[];
  // Adds a Full Team option above the units.
  offerTeam?: boolean;
  onPick: (pick: RosterPick) => void;
  onCancel: () => void;
}

export const RosterPickDialog: React.FC<RosterPickDialogProps> = ({ title, message, team, offerTeam = false, onPick, onCancel }) => (
  <div className="modal-overlay" onClick={onCancel}>
    <div className="modal-box" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close-x" onClick={onCancel} aria-label="Close">×</button>
      <div className="modal-content">
        <h3>{title}</h3>
        <p className="text-dim">{message}</p>
        <div className="roster-pick-options">
          {offerTeam && (
            <button type="button" className="base-btn roster-pick-option" onClick={() => onPick('team')}>
              Full Team
            </button>
          )}
          {team.filter(slot => slot.character).map(slot => (
            <button key={slot.index} type="button" className="base-btn roster-pick-option" onClick={() => onPick(slot.index)}>
              <AvatarIcon name={slot.character} folder={IMAGE_FOLDERS.CHARACTERS} className="avatar-sm" />
              <span>{slot.character}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="base-btn text-xs" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>
);
