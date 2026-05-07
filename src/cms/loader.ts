/**
 * Read all .cms files under the app directory, parse them, and return a
 * flat function registry. Phase 1: a single file is enough; later phases
 * will key by (script, fn) and build a richer module map.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lex } from './lex.js';
import { parse } from './parse.js';
import * as A from './ast.js';

export interface AppRegistry {
  funcs: Map<string, A.Func>;
}

export function loadApp(appDir: string): AppRegistry {
  const funcs = new Map<string, A.Func>();
  for (const file of walk(appDir)) {
    if (!file.endsWith('.cms')) continue;
    const src = readFileSync(file, 'utf8');
    const rel = relative(appDir, file);
    const tokens = lex(src, rel);
    const fns = parse(tokens, rel);
    for (const fn of fns) funcs.set(fn.name, fn);
  }
  return { funcs };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
