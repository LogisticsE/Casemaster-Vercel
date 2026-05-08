# Converting an existing CaseMaster app to Vercel

If you have a working CaseMaster project running on
`CaseMaster.Web.exe` and want to deploy it to Vercel via cms-vercel,
this is the guide.

For a greenfield app, see [`BUILDING.md`](./BUILDING.md).

## Conceptual model

cms-vercel **does not run** `CaseMaster.Web.exe` on Vercel. It
re-implements the same `.cms` interpreter in TypeScript so your
existing source files behave the same way without the .NET binary.
This means:

- Your `.cms` files are mostly portable as-is — same syntax, same BOs,
  same pages.
- Anything inside the `runtime/` directory of the CaseMaster install
  (the framework's own code, the IDE, the editor) is **not** ported.
  You only port your `bo/`, `page/`, `script/`, `qualifier/` trees.
- Vendor-side features that have no cms-vercel implementation (yet)
  will fault at request time — the `cms-vercel-build` validator
  reports them upfront.

The deployment story changes too: instead of running a Windows host
that serves `localhost:5050`, every request hits a stateless Vercel
Function that reads the same Postgres database.

## Effort estimate by feature

| Your app uses…                                   | Conversion effort                                   |
|--------------------------------------------------|-----------------------------------------------------|
| `<@bo>` declarations + read paths                | **Automatic** — copy and go                         |
| `iterator.ofEntity`, `bo.attr`, `sql.fetch`      | Automatic                                           |
| BO maintenance pages (lists, edit, new, delete)  | Automatic via `/maintenance/<bo>`                   |
| Custom pages with the supported `<@page/...>` qualifiers (container, content, title, html, form + controls, table, sidebar, icon) | Drop-in |
| Cookie-based sessions, login state               | Drop-in via `session.get/set`                       |
| Outbound HTTP via `httpRequest.create`           | Drop-in (within Vercel's per-plan duration limit)  |
| Raw SQL writes via `sql.execute`                 | Drop-in                                             |
| `bo.persist` / `bo.create` / `bo.delete`         | Drop-in                                             |
| Custom `<@page/...>` qualifiers we don't render  | Manual: add a renderer in `packages/runtime/src/render.ts` (~10 lines per qualifier) |
| `<@page/data/inlineMaintenance>`, complex form widgets, datepicker / select2 dropdowns | Manual: not yet supported, port to simpler qualifiers or contribute renderers |
| Long-running ingest scripts (>10s)               | **Plan-bound**: Vercel Hobby caps at 10s, Pro at 60s, Enterprise at 900s. Move to a webhook the official runtime calls, or upgrade plan |
| File uploads (multipart)                          | Not yet supported. Use base64 hidden fields for now |
| WebSocket / SSE / server push                    | Not supported and not on the roadmap (Vercel's request model fights it) |

[`UNSUPPORTED.md`](./UNSUPPORTED.md) catalogues the deferred features.
The validator (`cms-vercel-build`) tells you which ones *your specific
app* hits.

## Workflow

### 1. Scaffold the cms-vercel target

Follow [`HOWTOLAUNCH.md`](./HOWTOLAUNCH.md) through step 4 to get a
deployed cms-vercel skeleton. Don't bother writing any `.cms` yet —
the import tool will populate `app/` from your existing runtime.

### 2. Import your CaseMaster source

Point `--from` at your existing CaseMaster project folder. The importer
copies the four conventional source dirs (`bo/`, `page/`, `script/`,
`qualifier/`) into your `app/`, and skips the rest (`runtime/` framework
files, `.exe` binaries, log files, SQLite DBs).

```powershell
cd C:\path\to\my-cms-app
node packages/runtime/bin/import.mjs --from C:\path\to\your-casemaster-project --dry-run
```

You can point `--from` at either:

- The folder that **directly contains** `bo/`, `page/`, `script/`,
  `qualifier/` (e.g. `C:\Casemaster-WMS\casemaster-runtime`), **or**
- A parent of that folder (e.g. `C:\Casemaster-WMS`) — the importer
  looks one level down to find the runtime root.

The dry-run prints what would be copied. When the list looks right,
drop `--dry-run`:

```powershell
node packages/runtime/bin/import.mjs --from C:\path\to\your-casemaster-project
```

If you see `!! No .cms files imported.` the path you passed has no
runtime tree under it — pass a path that contains (or whose immediate
child contains) `bo/`/`page/`/`script/`/`qualifier/`.

Re-running the importer is incremental: it overwrites files that exist
in the source. It does **not** delete files that were renamed away —
remove obsolete files manually.

If your source contains a `page/index.cms`, the importer additionally:

- deletes the cms-vercel placeholder `app/page/welcome.cms` (you brought
  your own landing page; the welcome page is no longer wanted).
- updates `vercel.json` so the `/` URL routes to `/page/index/f/main`
  instead of the welcome placeholder.

If your `index.cms` exposes an entry function under a different name,
edit the `/` rule in `vercel.json` accordingly.

### 3. Validate

```powershell
node packages/runtime/bin/build.mjs --app ./app
```

The validator parses every `.cms` file and reports:

- **Errors**: parse failures with `file:line:col`. Fix these or the
  page won't load.
- **Warnings**: calls or qualifiers that aren't implemented in cms-vercel
  yet. The page that uses them will fault at request time.

A typical first-import report:

```
scanned: 86 .cms files
errors:  0
warns:   34
W bo/axylog/visit.cms:54:36: unknown call: <expr>            # inline true()/false() — harmless
W page/axylog.cms:1024:18: unknown call: bo.persist          # implemented now, false alarm
W page/axylog.cms:2412:12: unknown qualifier: <@page/data/inlineMaintenance>   # really not supported
```

Address the warnings in priority order:

1. **`unknown qualifier`** — the page won't render correctly. Either:
   - Replace the qualifier with one that *is* supported (often you can
     decompose `inlineMaintenance` into a `page/data/table` + a small
     custom form), or
   - Contribute a renderer to `packages/runtime/src/render.ts` (~10
     lines per qualifier — see existing ones for the pattern), or
   - Skip the page for now (`git mv app/page/that-page.cms ../`).

2. **`unknown call: …`** — almost always the inline literal `true()`
   or `false()` (those work, the validator just doesn't know about
   them). Real unknown builtins fault at runtime; check
   [`API.md`](./packages/runtime/API.md) for the supported list.

### 4. Set up the database

If your existing app uses Postgres, point cms-vercel at the same
`DATABASE_URL` — both runtimes can read/write the same database
concurrently while you migrate. Set it in `.env.local` for dev, and
in **Vercel Settings → Environment Variables** for production.

If your existing app uses SQLite, MS SQL, or Oracle, you'll need to
move the schema to Postgres first. cms-vercel does not ship a
non-Postgres adapter and won't.

**Format note**: paste the URL **without surrounding quotes** —
`DATABASE_URL=postgres://user:pass@host/db?sslmode=require` (not
`DATABASE_URL='postgres://...'`). Vercel CLI's env loader handles
quotes inconsistently across versions and silently passes an empty
value if it can't parse the line.

**Linked-project gotcha**: once `vercel dev` links to a cloud project
(`.vercel/project.json` exists), env vars from `.env.local` may be
shadowed by the cloud project's env. If `/api?diag=1` shows
`hasDbUrl: false` despite a populated `.env.local`, push the var to
the cloud project explicitly:

```powershell
npx vercel env add DATABASE_URL development
# paste the URL when prompted
```

Then restart `vercel dev`. The diag endpoint also lists every
non-system env key the function process can see (`userEnvKeys`),
which makes "is `.env.local` actually loaded?" easy to answer.

### 5. Walk through the URLs

Start the dev server. Two options:

```powershell
# Option A — fast inner loop (recommended for development)
npx cms-vercel-dev

# Option B — full Vercel CLI dev (slower, but matches production routing layer 1:1)
npx vercel dev
```

`cms-vercel-dev` is a thin Node http server that loads your `api/index.ts`
directly — no per-request bundling, no proxy hop. Adds ~50ms per request
warm vs `vercel dev`'s ~2.5s. Applies the rewrites from `vercel.json`
and serves `/static/*` from `public/`. Loads `.env.local` automatically.

For TypeScript handlers, install `tsx` once: `npm i -D tsx`.

First run of `vercel dev` prompts you to link the Vercel project (pick
the one created in HOWTOLAUNCH step 4). Then visit each page in your
app on `http://localhost:3000`:

- **Page renders, data shows** → port complete for this page.
- **Page is mostly right but missing UI** → look in the HTML source
  for `<!-- TODO render: <@…> -->`. That's the qualifier whose renderer
  is missing. Address per the validator step.
- **`unimplemented call: x.y`** → builtin not implemented. If you
  control the .cms source, swap to an alternative; otherwise file an
  issue describing what the call does and we'll add it.
- **500 with stack trace** → real runtime error, usually the SQL
  underneath isn't what the BO expected. Check `/api?diag=1` first.

### 6. Authentication

If your app patched `runtime/script/web/router/page.cms`'s
`authenticate` function to whitelist routes (Axylog Integration does
this), you'll need to recreate that whitelist in cms-vercel via the
`loaderHook` option to `createHandler`:

```ts
// api/index.ts
import { createHandler } from 'cms-vercel';

export default createHandler({
  loaderHook(reg) {
    // Mark every page function under app/page/<myapp>/ as trusted —
    // skips the cookie-auth check.
    for (const fnName of reg.funcs.keys()) {
      // mark whatever you want as trusted here
    }
  },
});
```

The full session machinery (`qualifier.call('session/cookie:authenticate')`,
`session.get/set`) is in place — just call into it from your existing
login page and it'll work.

### 7. Long-running scripts

Vercel functions have a maximum duration:

| Plan        | Max duration   |
|-------------|----------------|
| Hobby (free)| 10 seconds     |
| Pro         | 60 seconds     |
| Enterprise  | 900 seconds    |

If your app runs a sync ingester that loops over thousands of API
records, it won't finish before Vercel kills the function. Three
mitigations:

1. **Upgrade the Vercel plan** — Pro is enough for most ingesters.
2. **Run the ingester on the official runtime** — keep
   `CaseMaster.Web.exe` alive somewhere just for the cron job, point
   it at the same Postgres. cms-vercel handles the user-facing pages.
3. **Split the work** — make the ingester process N records per
   request, reschedule itself via a Vercel cron. Adds machinery but
   stays on Hobby.

### 8. Deploy

`git push` (if connected) or `npx vercel --prod`. Set `DATABASE_URL` +
disable Deployment Protection per
[HOWTOLAUNCH step 7](./HOWTOLAUNCH.md#7-configure-the-production-environment).

## How long does it take?

It depends on the app:

- **A read-only dashboard with `<@bo>` + page lists**: an afternoon.
- **A Eurofins-Axylog-scale app with custom forms, sessions, and an
  API ingester**: 1–3 weeks of porting work, depending on which
  qualifiers and how many ingest paths.
- **An app heavy on `<@page/inlineMaintenance>` + complex forms**:
  significant — those qualifiers haven't been ported. Plan for a
  contribution to the runtime alongside the app port.

The validator gives you a concrete count of warnings on day one,
which is the best estimator. The number of unique unknown qualifiers
× ~10 lines per renderer ≈ engineering effort to close the gap.

## When to keep using the official runtime

cms-vercel is not a replacement for `CaseMaster.Web.exe` in every
case. Stick with the official runtime if:

- You want the visual `.cms` IDE / Monaco editor / VS Code language layer.
- You need long-running scripts beyond Vercel's per-plan limits.
- You need WebSocket / SSE / file-system writes during requests.
- You use SQLite, MS SQL, or Oracle and aren't moving to Postgres.

A common pattern: deploy public-facing pages on cms-vercel, keep the
official runtime for admin / authoring / batch jobs. Both connect to
the same Postgres.
