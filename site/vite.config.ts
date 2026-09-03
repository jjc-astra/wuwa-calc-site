import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { generateManifest } from './scripts/generate-data-manifest.mjs'

// `npm run dev` regenerates public/data/manifest.json once, before Vite starts (see
// package.json's predev-style `dev` script) -- but DataLoader's freshness checks
// (src/utils/dataFreshness.ts) compare against whatever manifest.json says *right now*, not
// against the data files themselves. Editing a public/data/**/*.json file (e.g. a character's
// mechanics) while the dev server is already running left manifest.json's hash for that file
// stale, so the freshness check always saw "unchanged" and silently kept serving the
// already-cached old data -- invisible in the running app until a manual Reset Cache. This
// plugin keeps manifest.json in sync with the actual files for the life of the dev server, the
// same way a production build's `npm run build` always regenerates it fresh.
function dataManifestWatchPlugin(): Plugin {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    name: 'data-manifest-watch',
    apply: 'serve',
    configureServer(server) {
      const isDataJson = (file: string) =>
        file.replace(/\\/g, '/').includes('/public/data/') &&
        file.endsWith('.json') &&
        !file.endsWith('manifest.json');

      // generateManifest()'s writeFileSync can transiently fail on Windows (antivirus/OneDrive/
      // the dev server's own static handler briefly holding the file open right after a write --
      // observed as `Error: UNKNOWN: unknown error, open '...manifest.json'`) -- and an uncaught
      // exception thrown from inside a setTimeout callback takes down the whole Node process, not
      // just this plugin. One short retry covers the transient case; if it still fails, log and
      // move on -- the next real file change queues another attempt anyway, so this is never
      // stuck wrong for long, just briefly stale (same as the manifest always was before this
      // plugin existed).
      const tryGenerate = (attempt: number) => {
        try {
          generateManifest();
        } catch (err) {
          if (attempt === 0) {
            setTimeout(() => tryGenerate(1), 100);
          } else {
            console.warn('[data-manifest-watch] Failed to regenerate manifest.json:', err);
          }
        }
      };

      const regenerate = (file: string) => {
        if (!isDataJson(file)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          tryGenerate(0);
        }, 150);
      };

      server.watcher.on('change', regenerate);
      server.watcher.on('add', regenerate);
      server.watcher.on('unlink', regenerate);
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dataManifestWatchPlugin()],
})
