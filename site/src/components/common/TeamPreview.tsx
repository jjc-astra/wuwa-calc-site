// src/components/common/TeamPreview.tsx
// The mini character+weapon avatar row shown in the roster builder's collapsed header --
// extracted out of TeamBuilder.tsx so the Rankings page's leaderboard rows can reuse the exact
// same icon treatment for "which team is this" at a glance.
import React, { useState } from 'react';
import { CommonUtils, getCharacterThemeColor, tip } from '../../utils/Common';
import { DataLoader } from '../../utils/DataLoader';
import { IMAGE_FOLDERS } from '../../data/db';
import type { ImageFolder } from '../../data/db';
import type { TeamSlot } from '../../types/index';

const PreviewIcon: React.FC<{ name: string; folder: ImageFolder }> = ({ name, folder }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const showImage = !errored;

  return (
    <>
      {!showImage || !loaded ? <span className="preview-char-initial">?</span> : null}
      {showImage && (
        <img
          className={`preview-img-abs ${loaded ? 'opacity-1' : 'opacity-0'}`}
          src={CommonUtils.getIconPath(name, folder)}
          alt={name}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </>
  );
};

interface TeamPreviewProps {
  team: TeamSlot[];
}

export const TeamPreview: React.FC<TeamPreviewProps> = ({ team }) => (
  <>
    {team.map((slot, i) => {
      const themeColor = getCharacterThemeColor(slot.character ? DataLoader.characterDB[slot.character] : undefined);
      return (
        <div key={i} className="preview-slot" style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
          <div className="preview-avatar preview-circle preview-avatar-wrap" {...tip(slot.character || 'No Character')}>
            {slot.character ? (
              <PreviewIcon name={slot.character} folder={IMAGE_FOLDERS.CHARACTERS} />
            ) : (
              <span className="preview-char-initial">?</span>
            )}
          </div>
          <span className="preview-badge">S{slot.sequence || 0}</span>
          <span style={{ color: 'var(--text-disabled)', margin: '0 5px' }}>/</span>
          <div className="preview-avatar preview-rect preview-avatar-wrap" {...tip(slot.weapon || 'No Weapon')}>
            {slot.weapon ? (
              <PreviewIcon name={slot.weapon} folder={IMAGE_FOLDERS.WEAPONS} />
            ) : (
              <span className="preview-char-initial">?</span>
            )}
          </div>
          <span className="preview-badge">R{slot.rank || 1}</span>
        </div>
      );
    })}
  </>
);
