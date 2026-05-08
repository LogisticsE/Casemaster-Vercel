# packages/runtime/ — framework code

This is the cms-vercel runtime: the lexer, parser, interpreter, BO
registry, page renderer, Postgres pool, and session machinery that
make `.cms` files runnable on Vercel.

> **Don't edit this directory.** Local edits get overwritten on
> `git pull` when a new release lands. If you need a missing builtin
> or hit a bug, open an issue or send a PR — the dispatch table in
> `src/eval.ts` is the usual edit site (~10 lines per call), and
> `src/render.ts` for adding a new `<@…>` qualifier.

Your code lives one level up, in [`../../app/`](../../app/).

## What lives here

| File                     | What                                                            |
|--------------------------|-----------------------------------------------------------------|
| `src/lex.ts`             | Tokenizer (kebab-keywords, backtick templates, `<@>`, `[var]`)  |
| `src/parse.ts`           | Pratt-style parser → AST                                        |
| `src/ast.ts`             | AST node types                                                  |
| `src/eval.ts`            | Tree-walking interpreter; the builtin dispatch table is here    |
| `src/render.ts`          | Renders qualifiers (`<@page/container>` etc.) to HTML           |
| `src/bo.ts`              | Walks `<@bo>` declarations into a registry of BO + table info   |
| `src/maintenance.ts`     | Auto-CRUD page generator — drives `/maintenance/<bo>`           |
| `src/handler.ts`         | Vercel function entry — public `createHandler({ … })` API       |
| `src/db.ts`              | Postgres pool wrapper (Neon-friendly defaults)                  |
| `src/session.ts`         | `cms_session` table + cookie + CSRF token                       |
| `src/loader.ts`          | Walks `app/` and registers everything                           |
| `bin/build.mjs`          | The validator CLI (`node packages/runtime/bin/build.mjs`)       |
| `bin/import.mjs`         | Copies `bo/`, `page/`, `script/`, `qualifier/` from a CaseMaster install |
| `bin/welcome.mjs`        | Postinstall banner — prints next-steps after `npm install`      |

## Programmatic use

```ts
// api/index.ts — already wired up in this template
import { createHandler } from 'cms-vercel';

export default createHandler({
  appDir: process.env.CMS_APP_DIR ?? './app',

  // Optional plugin hook to extend the registry post-load.
  loaderHook(reg) {
    reg.funcs.set('myCustomBuiltin', /* ... */);
  },

  // Optional custom 500 page.
  onError(err, req, res) { res.status(500).send('oops'); },
});
```

## Routes the runtime serves

URLs match the official CaseMaster runtime's:

| URL                                  | What                          |
|--------------------------------------|-------------------------------|
| `/page/<script>/f/<fn>`              | Run a page function           |
| `/maintenance/<bo>`                  | Auto-generated CRUD list page |
| `/maintenance/<bo>/edit?id=<id>`     | Edit form                     |
| `/maintenance/<bo>/new`              | Create form                   |
| `/maintenance/<bo>/save`   (POST)    | Insert / update               |
| `/maintenance/<bo>/delete` (POST)    | Delete                        |
| `/static/<path>`                     | Files from `public/`          |
| `/api?diag=1`                        | Diagnostic JSON               |
| `/api?stats=1`                       | Registry warmth + counts      |

## Building

The `dist/` folder is generated from `src/`. The root project's
`postinstall` hook runs `tsc -p packages/runtime` so a fresh
`npm install` produces a working `dist/`. If you're hacking on the
runtime locally, run `npx tsc -p packages/runtime --watch` to
auto-rebuild on save.

## Reference

- [`API.md`](./API.md) — full builtin reference with signatures
- [`MIGRATION.md`](./MIGRATION.md) — porting from the .NET runtime
- [`../../UNSUPPORTED.md`](../../UNSUPPORTED.md) — what doesn't work yet
- [`../../ROADMAP.md`](../../ROADMAP.md) — phase status

## License

UNLICENSED — internal experiment. Public licensing decision lands with
the 0.1.0 npm publish.
