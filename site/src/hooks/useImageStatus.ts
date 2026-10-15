import { useState } from 'react';
import { CommonUtils } from '../utils/Common';

/** Load status of the icon at `path`; cached images skip the fade-in. */
export function useImageStatus(path: string) {
  const [loaded, setLoaded] = useState(() => CommonUtils.isImageCached(path));
  const [errored, setErrored] = useState(false);
  const [trackedPath, setTrackedPath] = useState(path);

  // Reset during render; an effect would run after a cached onLoad.
  if (path !== trackedPath) {
    setTrackedPath(path);
    setLoaded(CommonUtils.isImageCached(path));
    setErrored(false);
  }

  return { loaded, errored, onLoad: () => setLoaded(true), onError: () => setErrored(true) };
}
