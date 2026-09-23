import { useState } from 'react';
import { CommonUtils } from '../utils/Common';

/** Whether the icon at `path` has loaded or failed, for fading it in over a fallback initial.
 * A cache hit (e.g. this icon was already on screen before a remount) skips the fade-in -- only a
 * genuinely new image needs onLoad to reveal it. Starts over when `path` changes. */
export function useImageStatus(path: string) {
  const [loaded, setLoaded] = useState(() => CommonUtils.isImageCached(path));
  const [errored, setErrored] = useState(false);
  const [trackedPath, setTrackedPath] = useState(path);

  // Reset during render, only on a real path change. A mount-time effect would run after a
  // cached image's onLoad and hide it again (the dev WIP fallback loads a different URL than
  // `path`, so the cache check can't see it).
  if (path !== trackedPath) {
    setTrackedPath(path);
    setLoaded(CommonUtils.isImageCached(path));
    setErrored(false);
  }

  return { loaded, errored, onLoad: () => setLoaded(true), onError: () => setErrored(true) };
}
