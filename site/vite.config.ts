import { defineConfig, normalizePath } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// `virtual:calc-version`: a hash of every non-UI source file (src/**/*.ts -- the calc engine,
// workers, data tables, stores, guide model), so caches of calculated results can tell when the
// code that produced them changed. Recomputed on every load. In dev, editing one of those files
// only marks it for recompute on the next full page load -- it doesn't push a hot update, which
// would reload the page on every save. Holding the old value until then is still right: the calc
// runs in a worker, and workers keep their old code until a full reload too.
function calcVersionPlugin(): Plugin {
  const id = 'virtual:calc-version'
  const resolvedId = '\0' + id
  const srcDir = normalizePath(join(import.meta.dirname, 'src'))
  const isCalcSource = (file: string) => file.endsWith('.ts') && !file.endsWith('.d.ts')
  const listFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? listFiles(join(dir, e.name)) : isCalcSource(e.name) ? [join(dir, e.name)] : []
    )

  return {
    name: 'calc-version',
    resolveId: source => (source === id ? resolvedId : undefined),
    load(loadId) {
      if (loadId !== resolvedId) return
      const hash = createHash('sha256')
      for (const file of listFiles(srcDir).sort()) {
        hash.update(relative(srcDir, file)).update(readFileSync(file))
      }
      return `export default ${JSON.stringify(hash.digest('hex').slice(0, 16))};`
    },
    handleHotUpdate({ file, server }) {
      if (!normalizePath(file).startsWith(srcDir + '/') || !isCalcSource(file)) return
      const mod = server.moduleGraph.getModuleById(resolvedId)
      if (mod) server.moduleGraph.invalidateModule(mod)
    }
  }
}

// Dev only: GET /__wip-files (WIP_FILES_URL in src/utils/dataSource.ts) is the WIP mirror's own
// manifest -- each data file's path inside data/ and a hash of its content -- so the site can tell
// which entities have WIP mechanics and notice a WIP file being added, edited or deleted.
function wipFilesPlugin(): Plugin {
  const dataDir = join(import.meta.dirname, 'public', 'wip-data', 'data')
  const listFiles = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? listFiles(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []
      )
    } catch {
      return [] // no WIP mirror
    }
  }

  return {
    name: 'wip-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__wip-files', (_req, res) => {
        const manifest = Object.fromEntries(listFiles(dataDir).map(file => [
          normalizePath(relative(dataDir, file)),
          createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
        ]))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(manifest))
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served from wuwacalc.com's root via the custom domain, not the github.io/wuwa-calc-site/
  // subpath, so assets resolve from '/' for both dev and production builds.
  base: '/',
  plugins: [react(), calcVersionPlugin(), wipFilesPlugin()],
})
