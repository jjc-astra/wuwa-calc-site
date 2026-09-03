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

      const regenerate = (file: string) => {
        if (!isDataJson(file)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          generateManifest();
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
