import { useEffect, useState } from 'react';
import type { ViewId } from '../config/nav';

const VALID_VIEWS: ViewId[] = ['landing', 'calculator', 'builder', 'rankings', 'guide'];

// Remembers the last Calculator step (Build Team / Build Rotation) across navigating away and
// back -- a bare "#/calculator" (e.g. clicking the Header's nav link from another page) would
// otherwise always land on step 1, discarding whatever step you were actually on.
const LAST_STEP_KEY = 'wuwa_calc_last_step';

function getLastStep(): 1 | 2 {
  try {
    return localStorage.getItem(LAST_STEP_KEY) === '2' ? 2 : 1;
  } catch {
    return 1;
  }
}

function setLastStep(step: 1 | 2): void {
  try {
    localStorage.setItem(LAST_STEP_KEY, String(step));
  } catch {
    // localStorage unavailable (private browsing, etc.) -- step just won't be remembered.
  }
}

export interface Route {
  view: ViewId;
  step: 1 | 2;
}

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = VALID_VIEWS.includes(parts[0] as ViewId) ? (parts[0] as ViewId) : 'landing';
  if (view !== 'calculator') return { view, step: 1 };

  // "step-2"/"step-1" are explicit; anything else (most commonly no second segment at all, from
  // a plain nav-link click) falls back to whichever step was last actually viewed.
  const step: 1 | 2 = parts[1] === 'step-2' ? 2 : parts[1] === 'step-1' ? 1 : getLastStep();
  setLastStep(step);
  return { view, step };
}

function routeToHash(view: ViewId, step: 1 | 2): string {
  if (view === 'landing') return '#/';
  if (view === 'calculator' && step === 2) return '#/calculator/step-2';
  return `#/${view}`;
}

// Drives navigation off window.location.hash so Chrome's back/forward/refresh work like a
// normal multi-page site, without needing a router dependency or server-side URL rewrites
// (GitHub Pages can't do SPA fallback for real paths, but hash URLs always just load index.html).
export function useHashRoute(): [Route, (view: ViewId, step?: 1 | 2) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (view: ViewId, step?: 1 | 2) => {
    // No explicit step (a plain nav-link click) -- resolve to the remembered last step instead
    // of always resetting to 1.
    const resolvedStep = step ?? (view === 'calculator' ? getLastStep() : 1);
    const nextHash = routeToHash(view, resolvedStep);
    if (window.location.hash === nextHash) {
      // Hash isn't actually changing (e.g. re-clicking the same nav item), so 'hashchange' won't
      // fire to re-run parseHash() -- update local state directly instead, same as parseHash
      // would've resolved.
      setRoute({ view, step: resolvedStep });
      return;
    }
    window.location.hash = nextHash;
  };

  return [route, navigate];
}
