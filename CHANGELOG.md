# Changelog

Notable changes to the `cms-vercel` package. Versions follow [SemVer]:
0.x is pre-stable, breaking changes can land on minor bumps. From 1.0
onward, breaking changes require a major bump.

[SemVer]: https://semver.org

## 0.1.0 — Unreleased

First versioned cut. Track 1 (Phases 1–12) built the proof of concept;
Track 2 (Phases 13–22) turned it into a packaged toolchain. Track 3
(real-world conversion pass) closed the gaps surfaced by porting a
356-file WMS app and comparing every rendered page against the
official `.NET` runtime.

### Real-world conversion pass

Discovered and fixed end-to-end while porting an external WMS app:

- **Multi-segment page routing**: `/page/wms/inbound/f/main` works.
  Functions and resources are page-scoped, so 152 pages each declaring
  `function main()` and `protected resource mainView` no longer
  collide. `/f/<fn>` is optional and defaults to `main`.
- **`response.redirect('page:fn')`** translates to a real URL. Was
  emitting `Location: wms:main` literally, browsers 404'd.
- **CaseMaster predicate translator** (`compileWhere`): `status="OPEN"
  | is_billed=0 & qty>10` becomes valid Postgres SQL. Includes boolean
  coercion for `is_*=0/1` (schema-aware via `dataType.Boolean`,
  fallback heuristic on the `is_/has_/can_` name prefix).
- **`script.call('foo:bar')`** prepends the right namespace
  (`script/foo:bar` vs `page/foo:bar`) so cross-file calls resolve.
- **`<@page/content>`** now renders all named slots in declaration
  order (sidebar, hero, kpi, workflows, …). Previously only
  title/intro/content were emitted.
- **Default HTML shell** for pages that don't `inherits` their own:
  jQuery 3 + Bootstrap 4.6 + Font Awesome 6 + `bg-primary` navbar,
  matching the official CaseMaster runtime's frontend stack so .cms
  source written for the .NET runtime renders identically.
- **Tables honour `<@page/data/table group: 'list'>`**: column list
  and human labels come from the BO's `attributeGroups` and
  `<@bo/attribute label: …>`. Empty result sets still render the
  header row. `<thead class="bg-primary text-light">`. Wide tables
  scroll horizontally via `.table-responsive`.
- **Importer (`cms-vercel-import`)** auto-detects the runtime root one
  level down (so `--from C:\Casemaster-WMS` works when the source tree
  is `C:\Casemaster-WMS\casemaster-runtime\bo\…`). Errors loudly +
  exits 2 when zero files match. After import, removes the placeholder
  `app/page/welcome.cms` and rewires `vercel.json`'s `/` rule to the
  user's `index.cms`.
- **Builtins added**: `dbl()`, `null()`, `request.urlBase`,
  `request.path`. `dbl()` is blank-tolerant so unfilled form values
  don't crash on first render.
- **Diagnostics**: `/api?diag=1` lists every non-system env key and
  shows `dbUrlLength` so "is `.env.local` actually loaded?" is
  one-click-debuggable. Errors thrown from builtin dispatch get
  wrapped with `file:line:col` and the failing SQL when applicable.
  500 responses include the full stack trace in non-production.
- **`tsconfig.json` `moduleResolution: "node"`** (was `"Bundler"` —
  the older TypeScript bundled by `vercel dev` rejected it).

### Added

- `createHandler({ appDir, loaderHook, onError })` — single-line
  Vercel-Function entrypoint. ([Phase 13])
- `npm create cms-vercel my-app` scaffold. ([Phase 14])
- `cms-vercel-build` validator: reports unknown calls + qualifiers
  with `file:line:col`. ([Phase 15])
- `cms-vercel-import` migrates a CaseMaster runtime layout. ([Phase 12])
- `cms-vercel-bench` latency harness. ([Phase 11])
- `bo.create` / `bo.setAttr` / `bo.persist` / `bo.delete`,
  `sql.execute`, `sql.fetch`. ([Phase 16])
- `httpRequest.create` / `responseBody` / `responseStatus`. ([Phase 17])
- Postgres-backed sessions (`cms_session` table, `cmsv_sid` cookie),
  `qualifier.call('session/cookie:authenticate')`, `session.get/set`,
  CSRF token helpers. ([Phase 18])
- Page qualifiers: `page/data/table`, `page/form` family, every
  `page/input/*`, `page/sidebar` family, `page/icon`, `page/table/link`,
  `<@url>`. ([Phase 19])
- Auto BO maintenance pages at `/maintenance/<bo>`: list (paginated),
  edit, new, save (POST), delete (POST). ([Phase 20])
- Parity CI workflow (`workflow_dispatch`-triggered) running the
  official CaseMaster runtime on Windows alongside cms-vercel. ([Phase 21])
- API reference (`API.md`), migration guide (`MIGRATION.md`),
  package README. ([Phase 22])

### Known limitations

See [`UNSUPPORTED.md`](./UNSUPPORTED.md). The validator (`cms-vercel-build`)
is the canonical mechanism for surfacing what doesn't work in your app.

### Versioning policy

- 0.x: minor releases may break. `cms-vercel-build` is your safety net.
- 1.0: cuts when a real CaseMaster app (Axylog Integration) ships
  its read paths in production on cms-vercel.

[Phase 11]: ./ROADMAP.md#phase-11--performance
[Phase 12]: ./ROADMAP.md#phase-12--migration-tooling--parity-tests
[Phase 13]: ./ROADMAP.md#phase-13--package-extraction
[Phase 14]: ./ROADMAP.md#phase-14--scaffold-tool
[Phase 15]: ./ROADMAP.md#phase-15--build-time-validator
[Phase 16]: ./ROADMAP.md#phase-16--close-the-writer-gap
[Phase 17]: ./ROADMAP.md#phase-17--outbound-http
[Phase 18]: ./ROADMAP.md#phase-18--real-auth--sessions
[Phase 19]: ./ROADMAP.md#phase-19--more-page-qualifiers
[Phase 20]: ./ROADMAP.md#phase-20--auto-bo-maintenance
[Phase 21]: ./ROADMAP.md#phase-21--parity-ci
[Phase 22]: ./ROADMAP.md#phase-22--docs--010-release
