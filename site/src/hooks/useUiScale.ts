import { useSyncExternalStore } from 'react';
import { uiScale } from '../utils/Common';

// UI scale changes fire `resize`.
const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

export const useUiScale = (): number => useSyncExternalStore(subscribe, uiScale);
