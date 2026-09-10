import React, { useState, useEffect } from 'react';
import { CommonUtils, TRANSPARENT_PIXEL } from '../../utils/Common';
import type { ImageFolder } from '../../data/db';

interface AvatarIconProps {
  name: string;
  folder: ImageFolder;
  /** e.g. 'avatar-lg avatar-circle', 'avatar-sm avatar-rect' -- shape/size come from the shared .avatar-* classes. */
  className?: string;
}

/** Lazy-load-with-fallback avatar used across roster cards and anywhere an icon renders (e.g. dropdown options). */
export const AvatarIcon: React.FC<AvatarIconProps> = ({ name, folder, className = '' }) => {
  const hasVal = !!name;
  const path = hasVal ? CommonUtils.getIconPath(name, folder) : TRANSPARENT_PIXEL;

  const [loaded, setLoaded] = useState(() => CommonUtils.isImageCached(path));
  const [errored, setErrored] = useState(false);

  // A cache hit (e.g. this icon was already on screen before a remount) skips the fade-in --
  // only a genuinely new image needs onLoad to reveal it.
  useEffect(() => { setLoaded(CommonUtils.isImageCached(path)); setErrored(false); }, [path]);

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
