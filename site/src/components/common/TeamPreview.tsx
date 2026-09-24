// Mini character + weapon avatar row: the roster's collapsed header, Rankings and History rows.
import React from 'react';
import { CommonUtils, getCharacterThemeColor, tip } from '../../utils/Common';
import { useImageStatus } from '../../hooks/useImageStatus';
import { DataLoader } from '../../utils/DataLoader';
import { IMAGE_FOLDERS } from '../../data/db';
import type { ImageFolder } from '../../data/db';
import type { TeamSlot } from '../../types/index';

const PreviewIcon: React.FC<{ name: string; folder: ImageFolder }> = ({ name, folder }) => {
  const path = CommonUtils.getIconPath(name, folder);
  const { loaded, errored, onLoad, onError } = useImageStatus(path);

  return (
    <>
      {(errored || !loaded) && <span className="preview-char-initial">?</span>}
      {!errored && (
        <img
          className={`preview-img-abs ${loaded ? 'opacity-1' : 'opacity-0'}`}
          src={path}
          alt={name}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </>
  );
};

interface TeamPreviewProps {
  team: Array<Pick<TeamSlot, 'character' | 'sequence' | 'weapon' | 'rank'>>;
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
          <span style={{ color: 'var(--text-disabled)', margin: '0 2px' }}>&middot;</span>
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
