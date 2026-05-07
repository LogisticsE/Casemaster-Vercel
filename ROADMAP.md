# Roadmap — CaseMaster on Vercel

The single source of truth for this experiment. Update statuses here as
work progresses; no other doc tracks completion.

## Vision

Take any CaseMaster `.cms` application, push it to GitHub or Bitbucket,
and have Vercel build and serve it as serverless functions — no
long-running .NET host, no Windows-only binaries, no `CaseMaster.Web.exe`.

## Status legend

- `[ ]` todo
- `[~]` in progress
- `[x]` done
- `[-]` cancelled / superseded

---

## Phase 0 — Discovery (done)

- [x] Confirm CaseMaster's runtime model (interpreted .cms, in-process)
- [x] Confirm Vercel's serverless model (ephemeral functions, no resident process)
- [x] Survey alternatives: Vercel-as-frontend / transpile / containerize / rewrite
- [x] Pick "transpile / interpret in JS" as the path to investigate
- [x] Decide on parallel directory (`cms-vercel/`), don't touch existing code

## Phase 1 — Proof of concept: ping on Vercel

The smallest end-to-end slice. Hits Neon, returns text, deploys.

- [x] Project scaffold (`package.json`, `tsconfig.json`, `vercel.json`)
- [x] Hand-rolled `.cms` lexer + parser → AST
- [x] Interpreter for: `function`, `set`, `[var]`, `if/else`, `eq`/`ne`/`and`/`or`/`not`, `concat`, `formatString`, `_onError`, `chr`, `sum`
- [x] `iterate iterator.ofEntity(<@iterator/entity ...>)` → `SELECT … FROM … WHERE … ORDER BY …`
- [x] `bo.attr([row], 'col')` reads a column from a row
- [x] `response.setContentType / write / flush / end`
- [x] Postgres pool (`pg`), shared at module scope
- [x] Vercel catch-all route `api/[...route].ts` resolves URL → `.cms` function and runs it
- [x] Copy `ping` function to `app/page/ping.cms`
- [x] e2e test passes against live Neon (`vitest run` → 6/6)
- [x] Push to GitHub (`LadFoxTom/Casemaster-Vercel`)
- [x] Vercel build succeeds (commit `7d93041`)
- [x] Set `DATABASE_URL` in Vercel env
- [x] Disable Vercel deployment-protection on production
- [x] Live URL returns `ok N` (commit `0e641be` — `/page/foo/f/ping` → `ok 1`)

### Phase 1 lessons (worth carrying into Phase 2)

- Vercel rewrites need explicit path forwarding via a query param —
  `req.url` after a rewrite points at the destination, not the source.
- `[...slug].ts` brackets are a Next.js convention; bare Vercel
  Functions need `api/index.ts` + a rewrite.
- `includeFiles` in `vercel.json` is mandatory for any non-imported
  files (.cms, JSON fixtures, etc.) — they're stripped otherwise.
- TS `module: ESNext` requires `"type": "module"` in package.json or
  Vercel's runtime fails at module load (FUNCTION_INVOCATION_FAILED).
- `import.meta.url` should not be relied on without ESM-mode confirmed.

## Phase 2 — Page rendering + resolveTemplate

Visual pages: list, detail, form. Required to do anything user-visible.

- [ ] `<@page/container>`, `<@page/content>`, `<@page/title>`, `<@page/html>`
- [ ] `resolveTemplate(\`{{ … }}\`)` substitution with full expression evaluator inside `{{}}`
- [ ] `protected resource …` definitions and `page.get('./resourceName')`
- [ ] `page.render(...)` builds final HTML body
- [ ] Shell layout (sidebar, navbar) — port the framework's chrome OR provide a thin replacement
- [ ] Static `<style>` + inline `<script>` survive intact
- [ ] One existing visual page (`qrTemplates`) renders byte-comparable output

## Phase 3 — BO definitions + table mapping

Model layer. Required for anything beyond hand-coded SQL.

- [ ] Parse `<@bo …>` blocks from `bo/**/*.cms`
- [ ] Map BO name (`qr/labelTemplate`) → table (`qr_label_template`)
- [ ] Attribute → column mapping including `dataType`, `length`, `optional`
- [ ] `foreignKey` resolution (load related BO transparently)
- [ ] `primaryKey`, `auditable`, `deleteRule` honored or ignored gracefully
- [ ] `attributeGroups` (label, list) used by maintenance pages
- [ ] Auto-generated maintenance page route (`/maintenance/<bo-path>`)

## Phase 4 — Function calls

Cross-file plumbing.

- [ ] Same-file `function name(args)` declaration + `return`
- [ ] `script.call('./fn', args...)` resolves same-file functions
- [ ] `script.call('script/path:fn', args...)` resolves files under `script/`
- [ ] Argument passing by position; named args (`<name: value>`) where used
- [ ] Function-local variable scope vs request-scoped `set`

## Phase 5 — Standard library

Built-in functions used pervasively.

- [ ] `json.parse`, `json.json2pb`, `json.pb2json`
- [ ] `pb.get`, `pb.set`, iterating PBs (`iterator.ofPB`)
- [ ] Dates: `today()`, `now()`, `addDay`, `addMonth`, `format(date, fmt, locale)`
- [ ] Strings: `replace`, `substring`, `startsWith`, `trim`, `lCase`, `uCase`, `chr`, `formatString`
- [ ] Numbers: `lng`, `mul`, `div`, `sub`, `sum`, `mod`, `lt`, `gt`, `lte`, `gte`
- [ ] `random()` (suitable for IDs)

## Phase 6 — POST body, forms, file upload

Mutating routes.

- [ ] `request.body()` returns raw POST body
- [ ] `request.isPOST()`, `request.isGET()`, `request.isSameOrigin()`
- [ ] `qs.getUntrusted(name)` works for both query and form-urlencoded body
- [ ] Multipart parsing for file uploads
- [ ] `response.redirect(url)` writes 302 + Location

## Phase 7 — Auth + sessions

The bit you can never skip in production.

- [ ] Cookie-based session storage (Postgres-backed)
- [ ] Login page + login handler
- [ ] `qualifier.call('session/cookie:authenticate')` equivalent
- [ ] `[//route.trusted]` flag for whitelisted endpoints
- [ ] `authenticate()` hook per script, replicating CaseMaster's contract
- [ ] CSRF token (`__h=...` style) for in-app form submits

## Phase 8 — Static assets

CSS, JS, images, fonts.

- [ ] `static/` directory served via Vercel's static-asset support (`public/`)
- [ ] Bundle bootstrap, font-awesome, the `cmPre.js` / `app.js` chain
- [ ] Cache-busting query params (`?v=…`)
- [ ] Per-page `<style>` blocks survive (verified by Phase 2)

## Phase 9 — Cron / scheduled tasks

The keepalive ping is the smallest example; bigger apps will have more.

- [ ] Detect `@schedule` annotations (or our convention) on `.cms` functions
- [ ] Generate `vercel.json` `crons:` entries from them
- [ ] Document the Vercel Cron limits (60 s max, 100 invocations/day on Hobby)
- [ ] Replace external keepalive script with a `*/4 * * * *` cron hitting `/api/ping`

## Phase 10 — CLI + deploy workflow

The "git push and it works" part.

- [ ] `cmsv dev` — local dev with hot-reload of `.cms` files
- [ ] `cmsv build` — pre-parse all `.cms` files; emit module map
- [ ] `cmsv deploy` — passthrough to `vercel deploy`
- [ ] GitHub Actions workflow (build + Vercel deploy on `main`)
- [ ] Bitbucket Pipelines workflow (same, alternate VCS)
- [ ] `.env.example` with `DATABASE_URL` + any other env conventions
- [ ] README on `git clone … && cmsv dev` for new contributors

## Phase 11 — Performance

After Phase 1 it works; this makes it fast.

- [ ] Parse `.cms` files at module load, not per request (warm-instance caching)
- [ ] Optional AOT: a build step that emits a `.ts` per `.cms` function
- [ ] Edge runtime experiment for read-only endpoints
- [ ] Cold-start measurement vs CaseMaster cold-start vs Neon cold-start
- [ ] Postgres connection-pool sizing per Vercel's invocation model

## Phase 12 — Migration tooling + parity tests

How a CaseMaster owner brings their app over.

- [ ] `cmsv import <CaseMaster-runtime-dir>` lays out a Vercel project
- [ ] Conformance suite: same `.cms` app run on both runtimes, byte-compare
  HTTP responses for a curated URL list
- [ ] Playwright parity suite (visual + interaction parity)
- [ ] Documented "unsupported features" list as it grows

---

## Out of scope (intentionally never on this roadmap)

- A visual `.cms` editor — keep using the existing CaseMaster IDE / VS Code layer
- Full BarTender feature parity — that's a different product
- Replacing Postgres with another database — Postgres only
- Windows-only deployment paths — the whole point is Linux serverless
- Real-time / WebSocket support — Vercel's model fights it; out unless explicit need
