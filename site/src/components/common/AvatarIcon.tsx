import React from 'react';
import { useImageStatus } from '../../hooks/useImageStatus';
import { CommonUtils, TRANSPARENT_PIXEL } from '../../utils/Common';
import type { ImageFolder } from '../../data/db';

interface AvatarIconProps {
  name: string;
  folder: ImageFolder;
  /** e.g. 'avatar-lg avatar-circle' */
  className?: string;
}

/** Lazy-loaded avatar with a fallback. */
export const AvatarIcon: React.FC<AvatarIconProps> = ({ name, folder, className = '' }) => {
  const hasVal = !!name;
  const path = hasVal ? CommonUtils.getIconPath(name, folder) : TRANSPARENT_PIXEL;

  const { loaded, errored, onLoad, onError } = useImageStatus(path);

  const showImage = hasVal && !errored && loaded;

  return (
    <div className={`avatar ${className} avatar-wrapper`}>
      <span className={showImage ? 'opacity-0' : ''}>{hasVal ? name.charAt(0) : '?'}</span>
      <img
        className={`avatar-img ${showImage ? 'opacity-1' : 'opacity-0'}`}
        src={path}
        alt={name || 'empty'}
        onLoad={() => { if (hasVal) onLoad(); }}
        onError={() => { if (hasVal) onError(); }}
      />
    </div>
  );
};
