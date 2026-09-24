import { useSyncExternalStore } from 'react';
import { uiScale } from '../utils/Common';

// The current UI scale (see uiScale), re-rendering when it changes -- the fluid root font size
// only moves with the viewport size or browser zoom, both of which fire `resize`.
const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

export const useUiScale = (): number => useSyncExternalStore(subscribe, uiScale);
