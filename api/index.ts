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
import { existsSync } from 'node:fs';
import { loadApp } from '../src/cms/loader.js';
import { callFunction, Ctx } from '../src/cms/eval.js';

// Find the bundled `app/` directory. On Vercel, `includeFiles: "app/**"`
// copies the tree to the deploy root (`/var/task/app`). Locally,
// `process.cwd()` is the project root.
function findAppDir(): string {
  const candidates = [
    process.env.CMS_APP_DIR,
    join(process.cwd(), 'app'),
    '/var/task/app',
    join(process.cwd(), '..', 'app'),
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}
const APP_DIR = findAppDir();

// Module-scoped registry — parsed once per Vercel function instance and
// reused for every warm invocation. Phase 11 makes this smarter. We catch
// load errors and surface them in the response so a silent FUNCTION_INVOCATION_FAILED
// is replaced with a debuggable message.
let appRegistry: ReturnType<typeof loadApp> | null = null;
let appRegistryError: Error | null = null;
function registry() {
  if (appRegistry) return appRegistry;
  try {
    appRegistry = loadApp(APP_DIR);
    return appRegistry;
  } catch (e: any) {
    appRegistryError = e;
    throw e;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Quick health-check without any DB / interpreter involvement. Useful
  // for diagnosing function-startup failures: if /api?diag=1 returns 200
  // but /page/foo/f/ping returns 500, the routing or interpreter is to
  // blame, not the function bundle itself.
  if (req.url && /[?&]diag=1/.test(req.url)) {
    res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({
      ok: true,
      cwd: process.cwd(),
      appDir: APP_DIR,
      appDirExists: existsSync(APP_DIR),
      hasDbUrl: Boolean(process.env.DATABASE_URL),
      registryError: appRegistryError ? String(appRegistryError) : null,
      loadedFns: appRegistry ? [...appRegistry.funcs.keys()] : null,
    }, null, 2));
    return;
  }

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
