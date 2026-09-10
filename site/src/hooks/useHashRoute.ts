import { useEffect, useState } from 'react';
import type { ViewId } from '../config/nav';

const VALID_VIEWS: ViewId[] = ['landing', 'calculator', 'builder', 'rankings', 'guide'];

// Remembers the last Calculator step (Build Team / Build Rotation) across navigation --
// without it, a bare "#/calculator" nav click would always land back on step 1.
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

  // routeToHash always writes an explicit step-1/step-2, so a missing segment here only
  // happens for a hand-typed/bookmarked bare "#/calculator" -- falls back to last-viewed step.
  // Must stay distinct from explicit step-1, or navigating to step 1 gets silently overridden.
  const step: 1 | 2 = parts[1] === 'step-2' ? 2 : parts[1] === 'step-1' ? 1 : getLastStep();
  setLastStep(step);
  return { view, step };
}

function routeToHash(view: ViewId, step: 1 | 2): string {
  // No hash at all for the homepage -- '#/' would parse identically, but leaves a bare trailing
  // "#" in the address bar that a plain "/" load never had.
  if (view === 'landing') return '';
  // Both steps get their own explicit segment -- see parseHash above for why step 1 can't be
  // "the bare #/calculator path" without becoming ambiguous with "no step specified".
  if (view === 'calculator') return `#/calculator/step-${step}`;
  return `#/${view}`;
}

// Drives navigation off window.location.hash, so back/forward/refresh work normally with no
// router dependency or server-side rewrites (GitHub Pages hash URLs always load index.html).
export function useHashRoute(): [Route, (view: ViewId, step?: 1 | 2) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    // 'popstate' covers back/forward through the pushState-based landing entries below (which
    // never fire 'hashchange' on their own); 'hashchange' covers every other route. Both firing
    // for the same transition is harmless -- parseHash() is idempotent.
    const onRouteChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
    };
  }, []);

  const navigate = (view: ViewId, step?: 1 | 2) => {
    // No explicit step (a plain nav-link click) -- resolve to the remembered last step instead
    // of always resetting to 1.
    const resolvedStep = step ?? (view === 'calculator' ? getLastStep() : 1);
    const nextHash = routeToHash(view, resolvedStep);
    if (window.location.hash === nextHash) {
      // Hash isn't changing (e.g. re-clicking the same nav item), so no event fires to re-run
      // parseHash() -- update local state directly instead.
      setRoute({ view, step: resolvedStep });
      return;
    }
    if (nextHash === '') {
      // location.hash = '' still leaves a bare trailing "#" -- rewrite the URL directly so the
      // homepage URL is fully clean. pushState fires neither hashchange nor popstate, so the
      // state update has to happen right here.
      history.pushState(null, '', window.location.pathname + window.location.search);
      setRoute({ view, step: resolvedStep });
      return;
    }
    window.location.hash = nextHash;
  };

  return [route, navigate];
}
