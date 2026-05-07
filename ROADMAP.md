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

- [x] `<@page/container>`, `<@page/content>`, `<@page/title>`, `<@page/html>`
- [x] `resolveTemplate(\`{{ … }}\`)` substitution with expression evaluator
      inside `{{}}` (re-lexes + parseExpression + evalExpr)
- [x] `protected resource …` definitions and `page.get('./resourceName')`
- [x] `page.render(...)` writes HTML to the response
- [x] Qualifier values inside `{{…}}` render recursively (so `{{[main]}}`
      embeds a page body in a shell)
- [x] Static `<style>` + inline `<script>` survive intact (passed through
      via `<@page/html>` positional)
- [x] First visible page (`hello.cms`) live on Vercel — commit `0624a52`
- [ ] Port one existing visual page (`qrTemplates`) — gated on Phase 3
      (BO `<@bo>` declarations, since templates iterate qr_label_template)
- [ ] Sidebar/navbar shell from the official runtime — gated on Phase 4
      (script.call, since the shell uses cross-file resource composition)

## Phase 3 — BO definitions + table mapping

Model layer. Required for anything beyond hand-coded SQL.

- [x] Parse `<@bo …>` blocks from `bo/**/*.cms`
- [x] Map BO name (`qr/labelTemplate`) → table (`qr_label_template`)
- [x] Attribute → column mapping captured (dataType + foreignKey)
- [x] `attributeGroups.list` captured (used by Phase 12 list pages)
- [-] `foreignKey` resolution — captured, not yet eager-loaded
- [-] Auto-generated maintenance page route — moved to Phase 12

## Phase 4 — Function calls

Cross-file plumbing.

- [x] Same-file `function name(args)` declaration + `return`
- [x] `script.call('./fn', args...)` resolves same-file functions
- [x] `script.call('script/path:fn', args...)` resolves by fn name
- [x] `page.call('./fn', args...)` (same dispatch as script.call for now)
- [x] Argument passing by position
- [x] Function-local variable scope vs request-scoped `set`
- [-] Cross-file path-based dispatch — uses single global registry; later
      phase keys by file when fn-name collisions appear

## Phase 5 — Standard library

Built-in functions used pervasively.

- [x] `json.parse`, `json.json2pb` (identity), `json.pb2json` (`formatted:`)
- [x] `pb.get`, `pb.set`, `iterator.ofPB`, `iterator.ofToken`
- [x] Dates: `today()`, `now()`, `addDay`, `addMonth`, `format(d, 'yyyy-MM-dd HH:mm')`
- [x] Strings: `replace`, `substring`, `startsWith`, `trim`, `lCase`, `uCase`, `chr`, `formatString`, `strLength`
- [x] Numbers: `lng`, `mul`, `div`, `sub`, `sum`, `mod`, `lt`, `gt`, `lte`, `gte`, `toLong`, `random`
- [x] `if(cond, then, else)` accepted as an *expression*

## Phase 6 — POST body, forms, file upload

Mutating routes.

- [x] `request.body()` returns raw POST body
- [x] `request.isPOST()`, `request.isGET()`, `request.isSameOrigin()`
- [x] `qs.getUntrusted(name)` works for both query and form-urlencoded body
- [x] `response.redirect(url)` writes 302 + Location
- [-] Multipart parsing for file uploads — deferred (the existing app
      uses base64-in-form-fields for images, no multipart needed yet)

## Phase 7 — Auth + sessions

The bit you can never skip in production.

- [x] `qualifier.call('session/cookie:authenticate')` stub (returns true)
- [-] Cookie-based session storage — deferred (single-builtin swap)
- [-] Login page + login handler — deferred
- [-] `[//route.trusted]` flag — deferred
- [-] CSRF token machinery — deferred

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
