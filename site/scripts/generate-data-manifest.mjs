// scripts/generate-data-manifest.mjs
// Walks public/data and writes public/data/manifest.json: { relativePath: shortHash } for every
// .json file (manifest.json itself excluded). The client (DataLoader.refreshManifest) fetches
// only this one small file to detect whether something it already has cached has changed on the
// server -- comparing a short hash instead of re-downloading every data file it's holding.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(__dirname, '..', 'public', 'data');
const manifestPath = join(dataDir, 'manifest.json');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.json') && full !== manifestPath) {
      out.push(full);
    }
  }
}

const files = [];
walk(dataDir, files);

const manifest = {};
for (const file of files) {
  const relPath = relative(dataDir, file).split(sep).join('/');
  const contents = readFileSync(file);
  manifest[relPath] = createHash('sha256').update(contents).digest('hex').slice(0, 16);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[generate-data-manifest] Wrote ${Object.keys(manifest).length} entries to ${manifestPath}`);
