#!/usr/bin/env node
// cms-vercel-dev — local dev server without `vercel dev`'s 2.5s/request overhead.
//
// Imports the user's api/index.{ts,js}, wraps it in a plain Node http server,
// applies the rewrites from vercel.json, serves /static/* from public/.
// Drop-in replacement for `npx vercel dev` for inner-loop development.
//
// Usage (from the user's project root, after `npm install cms-vercel`):
//   npx cms-vercel-dev               # ports auto from $PORT or 3000
//   PORT=4000 npx cms-vercel-dev
//
// TypeScript handler: requires `tsx` to be installed alongside cms-vercel
//   (or use cms-vercel-dev with a pre-built api/index.js).

import { createServer } from 'node:http';
import { existsSync, readFileSync, createReadStream, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

// ─── 1. Load .env.local (.env.local takes precedence; .env as fallback) ─────────
function loadDotenv(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return 0;
  let n = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    // Strip surrounding quotes, both single and double.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = v;
      n++;
    }
  }
  return n;
}
const envLoaded = loadDotenv('.env.local') + loadDotenv('.env');
if (envLoaded) console.log(`cms-vercel-dev: loaded ${envLoaded} env var(s)`);

// ─── 2. Resolve + import the user's handler ────────────────────────────────────
async function resolveHandler() {
  const candidates = [
    'api/index.ts',
    'api/index.js',
    'api/index.mjs',
  ];
  for (const c of candidates) {
    const p = join(ROOT, c);
    if (!existsSync(p)) continue;
    if (c.endsWith('.ts')) {
      // TypeScript — try to use `tsx` to load it.
      try {
        const { register } = await import('tsx/esm/api');
        register();
        const mod = await import(pathToFileURL(p).href);
        return { handler: mod.default ?? mod, source: c };
      } catch (e) {
        console.error(`cms-vercel-dev: cannot load ${c} — install \`tsx\` (npm i -D tsx) or pre-build api/ to .js`);
        process.exit(1);
      }
    } else {
      const mod = await import(pathToFileURL(p).href);
      return { handler: mod.default ?? mod, source: c };
    }
  }
  console.error('cms-vercel-dev: no api/index.{ts,js,mjs} found in', ROOT);
  process.exit(1);
}

const { handler, source } = await resolveHandler();
console.log(`cms-vercel-dev: using ${source}`);

// ─── 3. Parse vercel.json rewrites ─────────────────────────────────────────────
const vercelCfg = existsSync(join(ROOT, 'vercel.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
  : {};

function applyRewrite(url) {
  const [path, qs] = url.split('?');
  for (const r of vercelCfg.rewrites ?? []) {
    // Convert Vercel's :param / :param* placeholders to named regex groups.
    const re = new RegExp(
      '^' +
      r.source
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')              // escape regex chars
        .replace(/:([a-zA-Z_]+)\\\*/g, '(?<$1>.*)')         // :path*  → catch-all
        .replace(/:([a-zA-Z_]+)/g, '(?<$1>[^/]+)') +        // :slug   → segment
      '$'
    );
    const m = path.match(re);
    if (!m) continue;
    let dest = r.destination;
    for (const [k, v] of Object.entries(m.groups ?? {})) {
      dest = dest.replace(`:${k}*`, v).replace(`:${k}`, v);
    }
    if (qs) dest += (dest.includes('?') ? '&' : '?') + qs;
    return dest;
  }
  return url;
}

// ─── 4. The HTTP server ────────────────────────────────────────────────────────
const MIME = {
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const t0 = Date.now();

  // Static files served straight from public/, mirroring Vercel's behaviour.
  if (req.url.startsWith('/static/')) {
    const sub = req.url.slice('/static/'.length).split('?')[0];
    const file = join(ROOT, 'public', sub);
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
      return;
    }
  }
  // Direct public/* lookup as fallback (useful for /favicon.ico etc.)
  if (req.method === 'GET') {
    const direct = join(ROOT, 'public', req.url.split('?')[0]);
    if (existsSync(direct) && statSync(direct).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[extname(direct)] ?? 'application/octet-stream' });
      createReadStream(direct).pipe(res);
      return;
    }
  }

  // Read body for POST / PUT / PATCH so the handler can see it.
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    req.body = Buffer.concat(chunks).toString('utf8');
  }

  // Apply vercel.json rewrites.
  req.url = applyRewrite(req.url);

  // Vercel-style res shim — adds .status() / .send() / .json().
  res.status = (c) => { res.statusCode = c; return res; };
  res.send = (body) => { res.end(body ?? ''); return res; };
  res.json = (obj) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };

  // Vercel-style req shim — .query plus .body parsed for form-urlencoded.
  const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  req.query = Object.fromEntries(u.searchParams);

  try {
    await handler(req, res);
  } catch (e) {
    console.error('[cms-vercel-dev] handler error:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${e?.message ?? e}\n\n${e?.stack ?? ''}`);
    }
  } finally {
    const ms = Date.now() - t0;
    console.log(`${req.method} ${req.url}  ${res.statusCode}  ${ms}ms`);
  }
});

// ─── 5. Listen ─────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`\ncms-vercel-dev — http://localhost:${PORT}`);
  console.log(`(skips Vercel CLI's per-request overhead; runtime is ~50ms warm)\n`);
});
