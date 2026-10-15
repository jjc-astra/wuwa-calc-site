import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable callback that runs the latest `fn`. Event handlers only. */
export function useLatestCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
