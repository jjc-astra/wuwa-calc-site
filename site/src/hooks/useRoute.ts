import { useEffect, useRef, useState } from 'react';
import { VIEW_IDS, PAGE_META, viewPath, calculatorPath, guidePath, guideCharacterMeta } from '../config/routes';
import type { ViewId } from '../config/routes';

// Remembers the last Calculator step (Build Team / Build Rotation) across navigation --
// without it, a bare "/calculator/" nav click would always land back on step 1.
const LAST_STEP_KEY = 'wuwa_calc_last_step';
// Remembers the open Character Guide character, like the Mechanics Builder's open unit: a plain
// "Character Guide" nav click reopens it, and Back to Library (a bare "/guide/") forgets it.
const LAST_GUIDE_KEY = 'wuwa_calc_last_guide_character';

// pushState fires no event of its own, so goTo() announces the change with this one.
const ROUTE_CHANGE_EVENT = 'wuwa-route-change';

declare global {
  interface Window {
    goatcounter?: { count?: (opts: { path: string }) => void };
  }
}

// localStorage unavailable (private browsing, etc.) -- the value just isn't remembered.
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
    // See readStored.
  }
}

const getLastStep = (): 1 | 2 => (readStored(LAST_STEP_KEY) === '2' ? 2 : 1);
const setLastStep = (step: 1 | 2): void => writeStored(LAST_STEP_KEY, String(step));

export interface Route {
  view: ViewId;
  step: 1 | 2;
  // Character Guide only: "/guide/<name>/".
  guideCharacter?: string;
}

/** Navigates to an in-app path without a page load; also for components navigate() doesn't reach. */
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

  // routePath always writes an explicit step-1/step-2, so a missing segment here only
  // happens for a hand-typed/bookmarked bare "/calculator/" -- falls back to last-viewed step.
  // Must stay distinct from explicit step-1, or navigating to step 1 gets silently overridden.
  const step: 1 | 2 = parts[1] === 'step-2' ? 2 : parts[1] === 'step-1' ? 1 : getLastStep();
  setLastStep(step);
  return { view, step };
}

// Both calculator steps get their own explicit segment -- see parseRoute for why step 1 can't be
// the bare "/calculator/" path without becoming ambiguous with "no step specified".
const routePath = (view: ViewId, step: 1 | 2): string =>
  view === 'calculator' ? calculatorPath(step) : viewPath(view);

const routeTitle = ({ view, guideCharacter }: Route): string =>
  view === 'guide' && guideCharacter ? guideCharacterMeta(guideCharacter).title : PAGE_META[view].title;

// Drives navigation off window.location.pathname, so back/forward/refresh work normally with no
// router dependency. Each view (and ranked guide character) has its own static page in the build,
// and 404.html serves the app for every other path -- see routePagesPlugin in vite.config.ts.
export function useRoute(): [Route, (view: ViewId, step?: 1 | 2) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    // Kept as-is when the route didn't actually change: a new object re-renders the whole app.
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

  // Title + GoatCounter pageview per route. The first load's pageview is count.js's own onload one.
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
    // No explicit step (a plain nav-link click) -- resolve to the remembered last step instead
    // of always resetting to 1.
    const resolvedStep = step ?? (view === 'calculator' ? getLastStep() : 1);
    goTo(view === 'guide' ? guidePath(readStored(LAST_GUIDE_KEY) ?? undefined) : routePath(view, resolvedStep));
  };

  return [route, navigate];
}
