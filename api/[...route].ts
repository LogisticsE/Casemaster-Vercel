/**
 * Vercel catch-all route. Maps incoming URLs to .cms functions and runs
 * them through the interpreter.
 *
 * URL conventions match CaseMaster's:
 *   /page/<script>/f/<function>     → functions in app/page/<script>.cms
 *   /maintenance/<bo>               → BO maintenance (Phase 3)
 *
 * Phase 1: only `/page/axylog/f/<fn>` is wired, and the registry is
 * loaded from `app/page/` (no nested directories yet).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { join } from 'node:path';
import { loadApp } from '../src/cms/loader.js';
import { callFunction, Ctx } from '../src/cms/eval.js';

const APP_DIR = process.env.CMS_APP_DIR || join(process.cwd(), 'app');

// Module-scoped registry — parsed once per Vercel function instance and
// reused for every warm invocation. Phase 11 makes this smarter.
let appRegistry: ReturnType<typeof loadApp> | null = null;
function registry() {
  if (!appRegistry) appRegistry = loadApp(APP_DIR);
  return appRegistry;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = url.pathname.match(/^\/page\/([^/]+)\/f\/([^/]+)$/);
    if (!m) {
      res.status(404).send('not found');
      return;
    }
    const fnName = m[2]!;
    const reg = registry();
    if (!reg.funcs.has(fnName)) {
      res.status(404).send(`function not found: ${fnName}`);
      return;
    }

    const ctx: Ctx = {
      funcs: reg.funcs,
      req: {
        method: req.method ?? 'GET',
        url: url.toString(),
        query: Object.fromEntries(url.searchParams),
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''),
      },
      res: { contentType: 'text/html', body: '', status: 200, headers: {} },
    };

    await callFunction(ctx, fnName, []);

    if (ctx.res.redirect) {
      res.status(302).setHeader('Location', ctx.res.redirect).send('');
      return;
    }
    res.status(ctx.res.status)
       .setHeader('Content-Type', ctx.res.contentType)
       .send(ctx.res.body);
  } catch (e: any) {
    // Surface the file:line:col directly so Phase-1 dev iteration is fast.
    res.status(500).setHeader('Content-Type', 'text/plain').send(`Error: ${e?.message ?? String(e)}`);
  }
}
