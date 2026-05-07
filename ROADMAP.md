# Roadmap — CaseMaster on Vercel

The single source of truth for this work. Update statuses here as work
progresses; no other doc tracks completion.

## Vision

A **standard, packaged way** to take any CaseMaster `.cms` application,
push it to GitHub or Bitbucket, and have Vercel build and serve it as
serverless functions — no long-running .NET host, no Windows-only
binaries, no `CaseMaster.Web.exe`. The artefact is an npm package
(`cms-vercel`) plus a scaffold (`npm create cms-vercel`), not a
one-off integration.

## Two tracks

The roadmap has two phases of work. **Track 1 (Phases 1–12)** built the
proof of concept: a working slice that proved the architecture is
feasible — a real `.cms` page renders on Vercel against the same Neon
DB. **Track 2 (Phases 13–22)** is the productisation track: turn the
PoC into a reusable package with adoption tooling so any CaseMaster
project can use it.

Track 1 is closed. Track 2 is the active work.

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

- [x] `public/` directory served by Vercel's static-asset support
- [x] `/static/:path*` rewrite preserves CaseMaster's URL convention
- [x] `public/css/app.css` shipped; `hello.cms` consumes it via
      `<link rel="stylesheet" href="/static/css/app.css?v=…">`
- [x] Per-page `<style>` blocks still survive (Phase 2 path)
- [-] Bundling bootstrap / font-awesome / cmPre.js — copy verbatim from
      the runtime when needed; no work required from this project

## Phase 9 — Cron / scheduled tasks

The keepalive ping is the smallest example; bigger apps will have more.

- [x] `vercel.json` `crons:` entry hits `/page/foo/f/ping` once daily
      (Hobby-tier compatible: Pro+ can raise to every 4 min)
- [x] Documented in README the plan-vs-cadence trade-off
- [-] `@schedule` annotation parser — defer; the `vercel.json` entry is
      the same source-of-truth Vercel itself reads

## Phase 10 — CLI + deploy workflow

The "git push and it works" part.

- [x] `npm run dev` — Vercel dev server with hot-reload
- [x] `npm run typecheck` — `tsc --noEmit`, runs in CI
- [x] `npm test` — Vitest suite (live-DB skipped without env)
- [x] `npm run deploy` / `deploy:preview` — Vercel CLI passthroughs
- [x] `.github/workflows/ci.yml` — type-check + tests on push/PR
- [x] `bitbucket-pipelines.yml` — same checks for Bitbucket-hosted repos
- [x] `.env.example` documents `DATABASE_URL` + `CMS_APP_DIR`
- [x] README "Deploy" section walks through the env-var, deployment
      protection, and cron-schedule settings on the Vercel dashboard
- [-] Dedicated `cmsv` CLI binary — npm scripts cover it; ship a real
      binary later when migration tooling (Phase 12) demands it

## Phase 11 — Performance

After Phase 1 it works; this makes it fast.

- [x] AST cache: registry built once per warm instance (was already
      true; Phase 11 made it observable)
- [x] `/api?stats=1` reports registry warmth, fn/resource/BO counts,
      and request total ms — distinguishes real slowness from cold start
- [x] `tools/bench.mjs` standalone latency harness (min/p50/p95/max).
      First run on live URL: cold ~1071ms, p50 warm ~289ms.
- [x] Postgres pool sized for Vercel's invocation model (`db.ts`)
- [-] AOT compile to `.ts` — deferred; AST cache covers the hot path
- [-] Edge runtime — deferred; `pg` doesn't run on edge today

## Phase 12 — Migration tooling + parity tests

How a CaseMaster owner brings their app over.

- [x] `tools/import.mjs --from <runtime-dir>` copies bo/, page/,
      script/, qualifier/ trees into `app/`. `--dry-run` prints the
      plan. Tested: 86 .cms / 23 dirs / 863 KB from real Axylog runtime.
- [x] `tests/parity/ping.spec.ts` compares both runtimes when both
      URLs are configured (env-gated)
- [x] `UNSUPPORTED.md` catalogues runtime-faulting, partial, and
      never-going-to features
- [-] Playwright parity suite — deferred until enough pages are ported
      that visual diffs are meaningful

---

# Track 2 — Productisation

Turning the PoC into a reusable package + scaffold so any CaseMaster
project can deploy to Vercel without forking this repo.

## Phase 13 — Package extraction

Make the runtime importable as `cms-vercel` from any project.

- [ ] npm workspace at the repo root (`packages/*` + the example app)
- [ ] `packages/runtime/` ships the lexer / parser / interpreter /
      renderer / BO registry / Postgres pool
- [ ] Public API: `createHandler({ appDir })` returns a Vercel-compatible
      function. Plus typed exports for advanced consumers (`Ctx`,
      `Value`, `loadApp`, `callFunction`)
- [ ] `packages/runtime/dist/` published to npm (private scope or public —
      decide before the 0.1.0 cut)
- [ ] The existing live deploy keeps working post-refactor (no URL
      regressions; Vercel project root re-pointed if needed)
- [ ] `tools/bench.mjs` and `tools/import.mjs` move into the package's
      `bin/` so they're available as `npx cms-vercel <cmd>` once published

## Phase 14 — Scaffold tool

`npm create cms-vercel my-app` is how a new user starts.

- [ ] `packages/create-cms-vercel/` — the scaffold runner
- [ ] Lays out `package.json`, `vercel.json`, `api/index.ts` (5 lines),
      `app/` placeholder, `.env.example`, `README.md`
- [ ] First-run prompts: project name, package manager, optional
      "import from CaseMaster runtime path"
- [ ] If imported, runs `cms-vercel import` to populate `app/`
- [ ] Documented in the package README

## Phase 15 — Build-time validator

Tell the user what *won't* work *before* they deploy.

- [ ] `cms-vercel build` walks every `.cms` and parses
- [ ] Reports unknown calls (`unimplemented call: x.y`), unrendered
      `<@page/...>` qualifiers, missing BO references, and other
      surface-level gaps with `file:line:col`
- [ ] Exits non-zero on errors; warnings still allow build
- [ ] CI integration: GitHub Actions workflow template runs it

## Phase 16 — Close the writer gap

Read-only is fine for demos; real apps mutate.

- [ ] `bo.persist`, `bo.create`, `bo.delete`, `bo.setAttr`
- [ ] `sql.execute` (raw SQL, no rows returned)
- [ ] `sql.fetch` returns rows for cases the BO layer can't model
- [ ] Transactions: implicit per-request? Explicit `sql.transaction`?
      Decide and document.

## Phase 17 — Outbound HTTP

The Axylog ingester is the canonical example: it pulls JSON from
api.axylog.com and upserts into Postgres.

- [ ] `httpRequest.create(url, opts)` returns a request handle
- [ ] `httpRequest.responseBody(req)` returns the body string
- [ ] Headers, methods, JSON bodies, basic auth + bearer
- [ ] Document Vercel's 10s/60s/900s function-duration limits per plan

## Phase 18 — Real auth + sessions

Replaces the Phase 7 stub.

- [ ] Postgres-backed session table (`cms_session`: id, payload, expires)
- [ ] Cookie set/read; rolling expiry
- [ ] Login page + login handler (configurable user table)
- [ ] CSRF token (`__h=…` query param) for in-app form submits;
      `qs.isTrusted()` returns true when the token matches
- [ ] `qualifier.call('session/cookie:authenticate')` does real cookie
      validation
- [ ] Whitelist mechanism (`[//route.trusted]`) for explicit bypasses

## Phase 19 — More page qualifiers

Real pages need more than `container/content/title/html`.

- [ ] `<@page/data/table>` — list with pagination, sorting, row links
- [ ] `<@page/form>` + `<@page/form/control>` + input controls
      (`text`, `select`, `checkbox`, `date`, `number`, `dropDown` if
      feasible without select2)
- [ ] `<@page/sidebar>` + `<@page/sidebar/link>` for the navbar/sidebar
- [ ] `<@page/icon>` (font-awesome integration via the static-asset
      tree)

## Phase 20 — Auto BO maintenance

`/maintenance/<bo>` becomes the standard CRUD surface.

- [ ] List page: derived from `attributeGroups.list`
- [ ] Detail / edit page: derived from `attributeGroups` (or all attrs)
- [ ] Create + delete handlers
- [ ] Pagination / sort / search
- [ ] Honours `auditable`, `deleteRule`, `optional`, `caseSensitive`
      flags from the BO declaration

## Phase 21 — Parity CI

Catch regressions automatically when the official runtime is the
ground truth.

- [ ] GitHub Actions matrix: `cms-vercel` on Linux + `CaseMaster.Web.exe`
      on Windows
- [ ] Curated URL list: `/page/foo/f/ping`, `/page/axylog/f/customers`,
      `/maintenance/qr/labelTemplate`, …
- [ ] Diff body bytes modulo expected variance (timestamps, CSRF tokens,
      session cookies)
- [ ] Block PRs that introduce divergence

## Phase 22 — Docs + 0.1.0 release

Make it adoptable.

- [ ] API reference for every builtin in `packages/runtime/docs/api.md`
- [ ] Migration guide: "porting a real CaseMaster app to Vercel" with
      Axylog as the worked example
- [ ] Examples gallery: `examples/{ping, hello, blog, qr-labels, …}`
- [ ] CHANGELOG and SemVer policy
- [ ] `npm publish` 0.1.0 (decide: public or scoped private)
- [ ] Announce: README badge, GitHub Discussions enabled

---

## Out of scope (intentionally never on this roadmap)

- A visual `.cms` editor — keep using the existing CaseMaster IDE / VS Code layer
- Full BarTender feature parity — that's a different product
- Replacing Postgres with another database — Postgres only
- Windows-only deployment paths — the whole point is Linux serverless
- Real-time / WebSocket support — Vercel's model fights it; out unless explicit need
