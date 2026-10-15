import { defineConfig, normalizePath } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { SITE_URL, SITE_NAME, PAGE_META, VIEW_IDS, viewPath, calculatorPath, guidePath, guideCharacterMeta } from './src/config/routes.ts'
import type { PageMeta } from './src/config/routes.ts'

// `virtual:calc-version`: hash of src/**/*.ts, for invalidating cached results.
// Dev: recomputed on the next full reload, not hot-updated.
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

// Dev only: GET /__wip-files serves the WIP mirror's manifest.
function wipFilesPlugin(): Plugin {
  const dataDir = join(import.meta.dirname, 'public', 'wip-data', 'data')
  const listFiles = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? listFiles(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : []
      )
    } catch {
      return []
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

// Meta tags for link previews; URLs must be absolute. null `canonicalPath`: noindex.
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
  canonicalPath: string | null
}

// Ranked characters from WUWA_DATA_DIR's rankings index (empty without it).
function rankedGuideCharacters(): string[] {
  const dataDir = process.env.WUWA_DATA_DIR
  if (!dataDir) return []
  const index = JSON.parse(readFileSync(join(dataDir, 'character_results', 'index.json'), 'utf8')) as { characters: string[] }[]
  return [...new Set(index.flatMap(entry => entry.characters).filter(Boolean))].sort()
}

function routePages(): RoutePage[] {
  const views: RoutePage[] = VIEW_IDS.map(view => ({ path: viewPath(view), meta: PAGE_META[view], canonicalPath: viewPath(view) }))
  const steps: RoutePage[] = ([1, 2] as const).map(step => ({ path: calculatorPath(step), meta: PAGE_META.calculator, canonicalPath: viewPath('calculator') }))
  const guides: RoutePage[] = rankedGuideCharacters().map(name => ({ path: guidePath(name), meta: guideCharacterMeta(name), canonicalPath: guidePath(name) }))
  return [...views, ...steps, ...guides]
}

// Build only: per-route index.html, 404.html, sitemap.xml and robots.txt (GitHub Pages has no rewrites).
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
  // Served from the custom domain's root.
  base: '/',
  plugins: [react(), calcVersionPlugin(), wipFilesPlugin(), routePagesPlugin()],
})
