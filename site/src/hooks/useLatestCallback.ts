import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback with a fixed identity that always runs the latest `fn`, so a memoized child can skip
 * re-rendering without holding a stale closure. For event handlers only, not for use during render.
 */
export function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
