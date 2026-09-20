import { useState, useEffect } from 'react';
import { CommonUtils } from '../utils/Common';

/** Whether the icon at `path` has loaded or failed, for fading it in over a fallback initial.
 * A cache hit (e.g. this icon was already on screen before a remount) skips the fade-in -- only a
 * genuinely new image needs onLoad to reveal it. Starts over when `path` changes. */
export function useImageStatus(path: string) {
  const [loaded, setLoaded] = useState(() => CommonUtils.isImageCached(path));
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setLoaded(CommonUtils.isImageCached(path));
    setErrored(false);
  }, [path]);

  return { loaded, errored, onLoad: () => setLoaded(true), onError: () => setErrored(true) };
}
