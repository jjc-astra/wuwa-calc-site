import { defineConfig, normalizePath } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { SITE_URL, SITE_NAME, PAGE_META, VIEW_IDS, viewPath, calculatorPath, guidePath, guideCharacterMeta } from './src/config/routes.ts'
import type { PageMeta } from './src/config/routes.ts'

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

const ROUTE_META_MARKER = '<!--route-meta-->'

const escapeAttr = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Link-preview scrapers (Discord, Slack, iMessage) read these from the raw HTML with no JS, so
// every URL must be absolute. `canonicalPath` null: a noindex page (404.html).
function routeMetaTags({ title, description }: PageMeta, canonicalPath: string | null): string {
  const t = escapeAttr(title)
  const d = escapeAttr(description)
  const url = SITE_URL + (canonicalPath ?? '/')
  const image = `${SITE_URL}/og-image.png`
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    canonicalPath ? `<link rel="canonical" href="${url}" />` : '<meta name="robots" content="noindex" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta property="og:image:type" content="image/png" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${image}" />`
  ].join('\n    ')
}

interface RoutePage {
  path: string
  meta: PageMeta
  // Where search engines should index this page's content; null for 404.html.
  canonicalPath: string | null
}

// Characters with a ranked rotation (the ones the Character Guide library opens), from the data
// repo's rankings index. WUWA_DATA_DIR (the data repo's data/) is set by the deploy workflow; without
// it, guide characters fall back to 404.html like any other unknown path.
function rankedGuideCharacters(): string[] {
  const dataDir = process.env.WUWA_DATA_DIR
  if (!dataDir) return []
  const index = JSON.parse(readFileSync(join(dataDir, 'character_results', 'index.json'), 'utf8')) as { characters: string[] }[]
  return [...new Set(index.flatMap(entry => entry.characters).filter(Boolean))].sort()
}

function routePages(): RoutePage[] {
  const views: RoutePage[] = VIEW_IDS.map(view => ({ path: viewPath(view), meta: PAGE_META[view], canonicalPath: viewPath(view) }))
  // Same page as /calculator/, so they point search engines there.
  const steps: RoutePage[] = ([1, 2] as const).map(step => ({ path: calculatorPath(step), meta: PAGE_META.calculator, canonicalPath: viewPath('calculator') }))
  const guides: RoutePage[] = rankedGuideCharacters().map(name => ({ path: guidePath(name), meta: guideCharacterMeta(name), canonicalPath: guidePath(name) }))
  return [...views, ...steps, ...guides]
}

// Build only: GitHub Pages has no SPA rewrites, so each route gets a real <path>/index.html (a copy
// of the app with that route's title, description and canonical URL baked in, for crawlers and
// link previews), plus 404.html for every other path, and a sitemap.xml + robots.txt listing them.
// Dev serves index.html for every path, with the landing page's tags.
function routePagesPlugin(): Plugin {
  return {
    name: 'route-pages',
    transformIndexHtml(html, ctx) {
      if (ctx.server) return html.replace(ROUTE_META_MARKER, () => routeMetaTags(PAGE_META.landing, viewPath('landing')))
    },
    writeBundle({ dir }) {
      if (!dir) return
      const template = readFileSync(join(dir, 'index.html'), 'utf8')
      const write = (file: string, content: string) => {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }
      const pages = routePages()
      for (const page of pages) {
        write(join(dir, ...decodeURIComponent(page.path).split('/'), 'index.html'), template.replace(ROUTE_META_MARKER, () => routeMetaTags(page.meta, page.canonicalPath)))
      }
      write(join(dir, '404.html'), template.replace(ROUTE_META_MARKER, () => routeMetaTags(PAGE_META.landing, null)))

      const urls = pages.filter(page => page.canonicalPath === page.path).map(page => `  <url><loc>${escapeAttr(SITE_URL + page.path)}</loc></url>`)
      write(join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`)
      write(join(dir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served from wuwacalc.com's root via the custom domain, not the github.io/wuwa-calc-site/
  // subpath, so assets resolve from '/' for both dev and production builds.
  base: '/',
  plugins: [react(), calcVersionPlugin(), wipFilesPlugin(), routePagesPlugin()],
})
