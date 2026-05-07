/**
 * Single Vercel Function — receives every `/page/...` and `/maintenance/...`
 * request via the rewrites in vercel.json, parses the URL out of req.url,
 * resolves it to a .cms function, and runs the interpreter.
 *
 * URL conventions match CaseMaster's:
 *   /page/<script>/f/<function>     → functions in app/page/<script>.cms
 *   /maintenance/<bo>               → BO maintenance (Phase 3)
 *
 * Phase 1: only `/page/.../f/<fn>` is implemented; the registry is loaded
 * from `app/` recursively. Filenames don't yet matter — function names are
 * unique across the app — but Phase 4 will key by (script, fn).
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
    // After Vercel's rewrite, req.url is `/api?_p=/page/foo/f/ping&…`.
    // The original path is forwarded through the `_p` query param (see
    // vercel.json `rewrites`). We unwrap it here and parse normally.
    const rawUrl = req.url ?? '/';
    const tmp = new URL(rawUrl, 'http://x');
    const proxied = tmp.searchParams.get('_p') ?? rawUrl;
    tmp.searchParams.delete('_p');
    // Re-attach the rest of the query string to the original path.
    const remainingQs = tmp.searchParams.toString();
    const url = new URL(proxied + (remainingQs ? `?${remainingQs}` : ''), 'http://x');

    const m = url.pathname.match(/^\/page\/([^/]+)\/f\/([^/]+)$/);
    if (!m) {
      res.status(404).setHeader('Content-Type', 'text/plain')
         .send(`no route for ${url.pathname}`);
      return;
    }
    const fnName = m[2]!;
    const reg = registry();
    if (!reg.funcs.has(fnName)) {
      res.status(404).setHeader('Content-Type', 'text/plain')
         .send(`function not found: ${fnName} (loaded: ${[...reg.funcs.keys()].join(', ')})`);
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
    res.status(500).setHeader('Content-Type', 'text/plain')
       .send(`Error: ${e?.message ?? String(e)}`);
  }
}
