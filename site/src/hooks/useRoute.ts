import { useEffect, useRef, useState } from 'react';
import { VIEW_IDS, PAGE_META, viewPath, calculatorPath, guidePath, guideCharacterMeta } from '../config/routes';
import type { ViewId } from '../config/routes';

// Last Calculator step, for bare "/calculator/" visits.
const LAST_STEP_KEY = 'wuwa_calc_last_step';
// Last open Character Guide character; cleared by a bare "/guide/".
const LAST_GUIDE_KEY = 'wuwa_calc_last_guide_character';

// pushState fires no event, so goTo() dispatches this.
const ROUTE_CHANGE_EVENT = 'wuwa-route-change';

declare global {
  interface Window {
    goatcounter?: { count?: (opts: { path: string }) => void };
  }
}

// localStorage may be unavailable (private browsing).
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable.
  }
}

const getLastStep = (): 1 | 2 => (readStored(LAST_STEP_KEY) === '2' ? 2 : 1);
const setLastStep = (step: 1 | 2): void => writeStored(LAST_STEP_KEY, String(step));

export interface Route {
  view: ViewId;
  step: 1 | 2;
  guideCharacter?: string;
}

/** Navigates to an in-app path without a page load. */
export function goTo(path: string): void {
  if (path !== window.location.pathname) history.pushState(null, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

function parseRoute(): Route {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const view = VIEW_IDS.includes(parts[0] as ViewId) ? (parts[0] as ViewId) : 'landing';
  if (view === 'guide') {
    const guideCharacter = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    writeStored(LAST_GUIDE_KEY, guideCharacter ?? null);
    return { view, step: 1, guideCharacter };
  }
  if (view !== 'calculator') return { view, step: 1 };

  // No step segment: fall back to the last-viewed step.
  const step: 1 | 2 = parts[1] === 'step-2' ? 2 : parts[1] === 'step-1' ? 1 : getLastStep();
  setLastStep(step);
  return { view, step };
}

// Both steps get an explicit segment.
const routePath = (view: ViewId, step: 1 | 2): string =>
  view === 'calculator' ? calculatorPath(step) : viewPath(view);

const routeTitle = ({ view, guideCharacter }: Route): string =>
  view === 'guide' && guideCharacter ? guideCharacterMeta(guideCharacter).title : PAGE_META[view].title;

// Routing from window.location.pathname, without a router library.
export function useRoute(): [Route, (view: ViewId, step?: 1 | 2) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    // Keep the same object when unchanged to avoid re-rendering.
    const onRouteChange = () => setRoute(prev => {
      const next = parseRoute();
      return next.view === prev.view && next.step === prev.step && next.guideCharacter === prev.guideCharacter ? prev : next;
    });
    window.addEventListener(ROUTE_CHANGE_EVENT, onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener(ROUTE_CHANGE_EVENT, onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, []);

  // Title and GoatCounter pageview per route (count.js handles the first).
  const isFirstRoute = useRef(true);
  useEffect(() => {
    document.title = routeTitle(route);
    if (isFirstRoute.current) {
      isFirstRoute.current = false;
      return;
    }
    window.goatcounter?.count?.({ path: window.location.pathname });
  }, [route]);

  const navigate = (view: ViewId, step?: 1 | 2) => {
    // No step: use the remembered one.
    const resolvedStep = step ?? (view === 'calculator' ? getLastStep() : 1);
    goTo(view === 'guide' ? guidePath(readStored(LAST_GUIDE_KEY) ?? undefined) : routePath(view, resolvedStep));
  };

  return [route, navigate];
}
