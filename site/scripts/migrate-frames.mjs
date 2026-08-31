// scripts/migrate-frames.mjs
// One-off migration for the frame-based timing refactor. Converts the duration-domain literal
// fields in every mechanic JSON file from seconds to frames (60fps, Math.round(seconds*60)).
// Does NOT touch cooldown or effects[].duration/.maxDuration/.durations -- those are a
// deliberate exception and stay in seconds. Does NOT touch string values in the converted
// fields (DSL expressions like "@Default.SwapTime") -- only plain number literals convert.
//
// Run once by hand: `node scripts/migrate-frames.mjs`. Review the result with `git diff`
// before committing -- this is not wired into the build.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MECHANICS_ROOT = join(__dirname, '..', 'public', 'data', 'mechanics');
const SUBFOLDERS = ['characters', 'weapons', 'sets', 'echoes', 'generic'];
const FPS = 60;

const secondsToFrames = (seconds) => Math.round(seconds * FPS);

function convertDurationField(value) {
  // Only plain number literals convert; strings (DSL expressions like "@Default.SwapTime")
  // pass through completely untouched.
  return typeof value === 'number' ? secondsToFrames(value) : value;
}

function migrateMechanicNode(node) {
  if (node.actionDuration !== undefined) node.actionDuration = convertDurationField(node.actionDuration);
  if (node.freezeTime !== undefined) node.freezeTime = convertDurationField(node.freezeTime);
  if (node.stanceTime !== undefined) node.stanceTime = convertDurationField(node.stanceTime);
  if (node.swapTiming !== undefined) node.swapTiming = convertDurationField(node.swapTiming);
  if (node.comboWindow !== undefined) node.comboWindow = convertDurationField(node.comboWindow);

  if (node.damageTimeframe) {
    if (node.damageTimeframe.start !== undefined) node.damageTimeframe.start = convertDurationField(node.damageTimeframe.start);
    if (node.damageTimeframe.end !== undefined) node.damageTimeframe.end = convertDurationField(node.damageTimeframe.end);
  }

  if (Array.isArray(node.cancelTimings)) {
    node.cancelTimings.forEach(ct => {
      if (ct.time !== undefined) ct.time = convertDurationField(ct.time);
    });
  }

  // cooldown and effects[].duration/.maxDuration/.durations are intentionally left untouched --
  // cooldowns and buff/effect lifetimes stay in seconds.
}

// Plain JSON.stringify(data, null, 2) expands every array onto multiple lines, which balloons
// the diff far beyond the actual value changes -- the existing files instead keep primitive
// arrays (["Basic"]) on one line and render array-of-object entries (effects[]) one compact
// object per line. This custom serializer matches that convention so the diff stays reviewable.
function stringifyInline(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stringifyInline).join(', ') + ']';
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return '{ ' + keys.map(k => `${JSON.stringify(k)}: ${stringifyInline(value[k])}`).join(', ') + ' }';
}

function stringifyPretty(value, indent = 0) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const allPrimitive = value.every(v => v === null || typeof v !== 'object');
    if (allPrimitive) return '[' + value.map(v => JSON.stringify(v)).join(', ') + ']';
    const items = value.map(v => padInner + stringifyInline(v));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const items = keys.map(k => `${padInner}${JSON.stringify(k)}: ${stringifyPretty(value[k], indent + 1)}`);
  return '{\n' + items.join(',\n') + '\n' + pad + '}';
}

let filesChanged = 0;
for (const folder of SUBFOLDERS) {
  const dir = join(MECHANICS_ROOT, folder);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    continue;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = join(dir, entry);
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    for (const key of Object.keys(data)) {
      migrateMechanicNode(data[key]);
    }

    // Existing files use CRLF line endings with no trailing newline -- match that exactly so
    // the diff is just the changed values, not a whole-file line-ending/formatting rewrite.
    const output = stringifyPretty(data).replace(/\n/g, '\r\n');
    writeFileSync(filePath, output, 'utf-8');
    filesChanged++;
    console.log(`Migrated ${folder}/${entry}`);
  }
}

console.log(`\nDone. ${filesChanged} file(s) migrated.`);
