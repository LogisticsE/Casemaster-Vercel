// Phase 12 — `cmsv import`.
// Copies the .cms source tree from a CaseMaster runtime layout into this
// project's app/ directory. Knows about the conventional CaseMaster
// folders (bo/, page/, script/, qualifier/) and skips runtime/ (the
// framework binaries, which we don't need) and incDevelopment.cms etc.
//
// Usage:
//   node tools/import.mjs --from C:/path/to/casemaster-runtime
//   node tools/import.mjs --from ../casemaster-runtime --dry-run

import { mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => {
    if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1] ?? true]);
    return a;
  }, [])
);
const FROM   = args.from;
const TO     = args.to ?? join(process.cwd(), 'app');
const DRY    = Boolean(args['dry-run']);

if (!FROM) {
  console.error('usage: node tools/import.mjs --from <casemaster-runtime-dir> [--to ./app] [--dry-run]');
  process.exit(1);
}

// Top-level dirs we *do* import. Anything else is framework or local
// state and gets skipped.
const KEEP_TOP = new Set(['bo', 'page', 'script', 'qualifier']);

// Resolve the actual runtime root. Users typically point --from at their
// project folder (e.g. C:\Casemaster-WMS), but the bo/page/script/qualifier
// dirs may live one level down (e.g. C:\Casemaster-WMS\casemaster-runtime).
// Try the path as-is first; if that has no KEEP_TOP children, look one
// level down and pick the first child that does.
function hasKeepChild(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  for (const entry of readdirSync(dir)) {
    if (KEEP_TOP.has(entry) && statSync(join(dir, entry)).isDirectory()) return true;
  }
  return false;
}

let root = FROM;
if (!hasKeepChild(FROM)) {
  const candidates = [];
  for (const entry of readdirSync(FROM)) {
    const sub = join(FROM, entry);
    if (statSync(sub).isDirectory() && hasKeepChild(sub)) candidates.push(sub);
  }
  if (candidates.length === 1) {
    root = candidates[0];
    console.log(`auto-detected runtime root: ${root}\n`);
  } else if (candidates.length > 1) {
    console.error(`Multiple candidate runtime roots under ${FROM}:`);
    for (const c of candidates) console.error(`  ${c}`);
    console.error('\nPass --from with one of the paths above.');
    process.exit(1);
  }
}

const stats = { files: 0, dirs: 0, skipped: 0, bytes: 0 };

for (const entry of readdirSync(root)) {
  if (!KEEP_TOP.has(entry)) { stats.skipped++; continue; }
  const src = join(root, entry);
  if (!statSync(src).isDirectory()) { stats.skipped++; continue; }
  walkAndCopy(src, join(TO, entry));
}

console.log('--- import summary ---');
console.log(`from:    ${root}`);
console.log(`to:      ${TO}`);
console.log(`dirs:    ${stats.dirs}`);
console.log(`files:   ${stats.files}`);
console.log(`bytes:   ${stats.bytes.toLocaleString()}`);
console.log(`skipped: ${stats.skipped} (top-level non-cms dirs)`);
if (DRY) console.log('(dry run — no files written)');

if (stats.files === 0) {
  console.error('\n!! No .cms files imported.');
  console.error(`!! Looked under: ${root}`);
  console.error('!! Expected at least one of: bo/, page/, script/, qualifier/');
  console.error('!! Pass --from pointing at the folder that contains those dirs');
  console.error('!! (or its parent — the importer looks one level down).');
  process.exit(2);
}

console.log('\nnext: `npm run typecheck && npm test` to surface unsupported features.');

function walkAndCopy(src, dst) {
  if (!existsSync(src) || !statSync(src).isDirectory()) return;
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      stats.dirs++;
      walkAndCopy(s, d);
    } else if (entry.endsWith('.cms')) {
      stats.files++;
      stats.bytes += st.size;
      if (!DRY) {
        mkdirSync(dirname(d), { recursive: true });
        copyFileSync(s, d);
      }
      console.log(`  ${DRY ? '[dry] ' : ''}${relative(process.cwd(), d)}`);
    }
  }
}
