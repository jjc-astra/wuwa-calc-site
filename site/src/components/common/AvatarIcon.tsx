import React, { useState, useEffect } from 'react';
import { CommonUtils, TRANSPARENT_PIXEL } from '../../utils/Common';
import type { ImageFolder } from '../../data/db';

interface AvatarIconProps {
  name: string;
  folder: ImageFolder;
  /** e.g. 'avatar-lg avatar-circle', 'avatar-sm avatar-rect' -- shape/size come from the shared .avatar-* classes. */
  className?: string;
}

/** Same lazy-load-with-fallback-initial avatar used across roster cards, reused wherever a
 * character/weapon/set/echo icon needs to render (e.g. dropdown options). */
export const AvatarIcon: React.FC<AvatarIconProps> = ({ name, folder, className = '' }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => { setLoaded(false); setErrored(false); }, [name, folder]);

  const hasVal = !!name;
  const path = hasVal ? CommonUtils.getIconPath(name, folder) : TRANSPARENT_PIXEL;
  const showImage = hasVal && !errored && loaded;

  return (
    <div className={`avatar ${className} avatar-wrapper`}>
      <span className={showImage ? 'opacity-0' : ''}>{hasVal ? name.charAt(0) : '?'}</span>
      <img
        className={`avatar-img ${showImage ? 'opacity-1' : 'opacity-0'}`}
        src={path}
        alt={name || 'empty'}
        onLoad={() => { if (hasVal) setLoaded(true); }}
        onError={() => { if (hasVal) setErrored(true); }}
      />
    </div>
  );
};
