import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { DATA_REPO_BASE_URL, WIP_BASE_URL } from './utils/Common';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Dev-excluded: a cache-first service worker would serve stale modules right through Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

// Dev-only: getImage()/getIconPath() (Common.ts) point <img> src at the local WIP mirror first,
// so a unit's icon can be tested before it ships to the real data repo. An icon this specific
// unit doesn't have a WIP override for just fails to load there -- <img> error events don't
// bubble but do fire during the capture phase, so one listener here catches every failed WIP
// image load (without touching each of the several components that render one) and swaps it to
// the real repo. Registered on `window`, the outermost capture-phase target, so it runs before
// a component's own onError (e.g. GridCard's/AvatarIcon's "show a fallback letter" handler,
// which React attaches as a capture-phase listener closer to the element since `error` doesn't
// bubble) -- stopImmediatePropagation keeps that handler from firing (and unmounting the <img>
// out from under the corrected src) on this first, WIP-only failure. A second failure -- the
// real repo also doesn't have this icon -- has a src that no longer starts with wipOrigin, so it
// skips this listener and reaches the component's onError normally, same as without WIP at all.
if (import.meta.env.DEV) {
  const wipOrigin = window.location.origin + WIP_BASE_URL;
  window.addEventListener(
    'error',
    e => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement) || !target.src.startsWith(wipOrigin)) return;
      e.stopImmediatePropagation();
      target.src = DATA_REPO_BASE_URL + target.src.slice(wipOrigin.length);
    },
    true
  );
}