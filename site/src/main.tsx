import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { installWipImageFallback } from './utils/dataSource';

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

installWipImageFallback(); // no-op outside dev builds