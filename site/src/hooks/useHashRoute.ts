import { useEffect, useState } from 'react';
import type { ViewId } from '../config/nav';

const VALID_VIEWS: ViewId[] = ['landing', 'calculator', 'builder', 'rankings', 'guide'];

export interface Route {
  view: ViewId;
  step: 1 | 2;
}

function parseHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = VALID_VIEWS.includes(parts[0] as ViewId) ? (parts[0] as ViewId) : 'landing';
  const step: 1 | 2 = view === 'calculator' && parts[1] === 'step-2' ? 2 : 1;
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

  const navigate = (view: ViewId, step: 1 | 2 = 1) => {
    const nextHash = routeToHash(view, step);
    if (window.location.hash === nextHash) return;
    window.location.hash = nextHash;
  };

  return [route, navigate];
}
