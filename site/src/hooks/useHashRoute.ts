import { useEffect, useState } from 'react';
import type { ViewId } from '../config/nav';

const VALID_VIEWS: ViewId[] = ['landing', 'calculator', 'builder', 'rankings', 'guide', 'about'];

// Remembers the last Calculator step (Build Team / Build Rotation) across navigation --
// without it, a bare "#/calculator" nav click would always land back on step 1.
const LAST_STEP_KEY = 'wuwa_calc_last_step';
// Remembers the open Character Guide character, like the Mechanics Builder's open unit: a plain
// "Character Guide" nav click reopens it, and Back to Library (a bare "#/guide") forgets it.
const LAST_GUIDE_KEY = 'wuwa_calc_last_guide_character';

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
  // Character Guide only: "#/guide/<name>".
  guideCharacter?: string;
}

// Also set directly (window.location.hash = ...) by components that navigate() doesn't reach.
export const guideHash = (character?: string): string =>
  character ? `#/guide/${encodeURIComponent(character)}` : '#/guide';

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = VALID_VIEWS.includes(parts[0] as ViewId) ? (parts[0] as ViewId) : 'landing';
  if (view === 'guide') {
    const guideCharacter = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    writeStored(LAST_GUIDE_KEY, guideCharacter ?? null);
    return { view, step: 1, guideCharacter };
  }
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
    const nextHash = view === 'guide' ? guideHash(readStored(LAST_GUIDE_KEY) ?? undefined) : routeToHash(view, resolvedStep);
    if (window.location.hash === nextHash) {
      // Hash isn't changing (e.g. re-clicking the same nav item), so no event fires to re-run
      // parseHash() -- update local state directly instead.
      setRoute(parseHash());
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
