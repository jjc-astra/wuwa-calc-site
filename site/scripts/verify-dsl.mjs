#!/usr/bin/env node
// Guards the DSL registry (src/logic/dsl/dslRegistry.ts) against silent regressions:
//   1. Every non-method property translates one way or another, and every method has a jsName
//      that the evaluation context (ContextManager) actually defines (structural check).
//   2. Every '@'-bearing DSL string actually used in the data repo (triggerRule/effects
//      values/priority/etc.) compiles/translates without throwing and without leaving an
//      unresolved '@' behind -- which would mean some pointer/property isn't registered.
// Loads the real src/logic/dsl/dslParser.ts and dslRegistry.ts through Vite's own SSR module
// loader (not a hand-transcription) so this can't drift from what the app actually ships.
import { createServer } from 'vite';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.WUWA_DATA_PATH || path.resolve(siteRoot, '../../wuwa-calc-data/data/mechanics');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

function collectAtStrings(obj, out = new Set()) {
  if (typeof obj === 'string') {
    if (obj.includes('@')) out.add(obj);
  } else if (Array.isArray(obj)) {
    obj.forEach(v => collectAtStrings(v, out));
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(v => collectAtStrings(v, out));
  }
  return out;
}

async function main() {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
  let failed = false;

  try {
    const { DSL_POINTERS } = await server.ssrLoadModule('/src/logic/dsl/dslRegistry.ts');
    const { DSLParser } = await server.ssrLoadModule('/src/logic/dsl/dslParser.ts');

    // --- 1. Structural check ---
    let structuralIssues = 0;
    for (const pointer of Object.values(DSL_POINTERS)) {
      for (const prop of pointer.properties) {
        if (!prop.isMethod && !prop.fullOverride && !prop.targetKey) {
          console.error(`STRUCTURAL: "${pointer.pointer}.${prop.propName}" has neither targetKey nor fullOverride.`);
          structuralIssues++;
        }
      }
    }
    // Every method the registry declares must be defined on the context it compiles against.
    const { ContextManager } = await server.ssrLoadModule('/src/logic/ContextManager.ts');
    const context = ContextManager.buildContext({}, 'Verify', []);
    for (const pointerName of ['Self', 'Enemy']) {
      const target = context?.[pointerName.toLowerCase()];
      for (const prop of DSL_POINTERS[pointerName].properties.filter(p => p.isMethod)) {
        if (!prop.jsName) {
          console.error(`STRUCTURAL: "${pointerName}.${prop.propName}" is a method with no jsName.`);
          structuralIssues++;
        } else if (typeof target?.[prop.jsName] !== 'function') {
          console.error(`STRUCTURAL: "${pointerName}.${prop.propName}" compiles to .${prop.jsName}(), which the evaluation context doesn't define.`);
          structuralIssues++;
        }
      }
    }
    if (structuralIssues > 0) failed = true;
    console.log(`Structural check: ${structuralIssues === 0 ? 'PASS' : `FAIL (${structuralIssues} issue(s))`}`);

    // --- 2. Real-data translation coverage ---
    if (!existsSync(dataDir)) {
      console.log(`Skipping data-repo check -- ${dataDir} not found (set WUWA_DATA_PATH to point at a wuwa-calc-data checkout).`);
    } else {
      const files = walk(dataDir);
      const strings = new Set();
      for (const f of files) collectAtStrings(JSON.parse(readFileSync(f, 'utf8')), strings);

      let coverageIssues = 0;
      for (const s of strings) {
        let translated;
        try {
          translated = DSLParser._translatePointers(s);
        } catch (e) {
          console.error(`TRANSLATE THREW: ${JSON.stringify(s)}\n  ${e.message}`);
          coverageIssues++;
          continue;
        }
        if (translated.includes('@')) {
          console.error(`UNRESOLVED '@' remains after translation: ${JSON.stringify(s)}\n  -> ${translated}`);
          coverageIssues++;
        }
      }
      if (coverageIssues > 0) failed = true;
      console.log(`Data-repo coverage check: ${strings.size} strings from ${files.length} files -- ${coverageIssues === 0 ? 'PASS' : `FAIL (${coverageIssues} issue(s))`}`);
    }
  } finally {
    await server.close();
  }

  if (failed) {
    console.error('\nverify-dsl FAILED');
    process.exit(1);
  }
  console.log('\nverify-dsl PASSED');
}

main();
