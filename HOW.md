# How we build it

The technical companion to `WHAT.md`. Decisions and conventions; not
status. Update only when an architectural choice changes.

## Tech stack

- **Runtime**: Node.js 20 (Vercel default). No React, no Next.js — we
  serve everything through Vercel's bare HTTP function signature so the
  generated HTML is identical to CaseMaster's output.
- **Language**: TypeScript, `strict: true`. Compiled with `tsc`; no
  bundler at runtime (Vercel handles esbuild itself).
- **Database**: `pg` (`node-postgres`). Connection pool sized per
  Vercel's invocation model; one pool per Node process, lazily warmed.
- **Tests**: `vitest` for unit tests (parser + interpreter); `playwright`
  for end-to-end parity tests against a running CaseMaster instance.
- **Format**: `prettier` defaults; `eslint` only on `src/cms/**`.

## Module layout

```
cms-vercel/
├── ROADMAP.md            (single source of truth for status)
├── WHAT.md               (this project, in plain prose)
├── HOW.md                (this file)
├── README.md             (developer onboarding)
├── package.json
├── tsconfig.json
├── vercel.json           (route config + cron entries)
├── api/
│   └── [...route].ts     (Vercel catch-all; resolves URL → .cms function)
├── src/
│   ├── cms/
│   │   ├── lex.ts        (tokenizer)
│   │   ├── parse.ts      (Pratt parser → AST)
│   │   ├── ast.ts        (AST types)
│   │   ├── eval.ts       (tree-walking interpreter)
│   │   ├── builtins.ts   (concat, if, today, json.parse, …)
│   │   ├── bo.ts         (BO registry + iterator → SQL)
│   │   ├── db.ts         (Postgres pool)
│   │   └── render.ts     (page resource → HTML)
│   ├── cli/
│   │   ├── dev.ts        (cmsv dev: local server + watch)
│   │   ├── build.ts      (cmsv build: pre-parse, emit module map)
│   │   └── deploy.ts     (cmsv deploy: passthrough to vercel)
│   └── tools/
│       └── import.ts     (cmsv import: copy a CaseMaster runtime layout)
├── app/                  (the .cms app — never auto-modified)
│   ├── bo/**/*.cms
│   ├── page/**/*.cms
│   └── script/**/*.cms
└── tests/
    ├── parser.spec.ts
    ├── interp.spec.ts
    └── parity/
        └── ping.spec.ts  (live-runtime parity per URL)
```

## Parser strategy

A hand-rolled lexer + Pratt parser. PEG generators (`peggy`,
`nearley`) make it tempting to skip writing a lexer, but `.cms` has
unusual lexemes (backticked multi-line strings that contain JS,
`<@qualifier …>` blocks, `[var]` substitutions) that hurt
generator-friendliness. Hand-rolled keeps debugging trivial.

- **Lex output**: a flat token stream — `IDENT`, `NUM`, `STR`,
  `TBSTR` (backticked template), `LBRACK`/`RBRACK`, `LANG`/`RANG` (for
  `<@…>`), `KW_FUNCTION`, `KW_END_FUNCTION`, etc.
- **Parse output**: an AST where each `function` is a top-level node
  containing a `Block` of statements. Statements: `Set`, `If`,
  `Iterate`, `Return`, `Raise`, `ExprStmt`. Expressions: `Call`,
  `Var`, `Lit`, `Concat`, `If` (the function form), `Qualifier`.
- **Resources** (`resource name <@page/... >`) parse as a single
  expression assigned to `name`, evaluated at render time.

## Interpreter design

- **Scope**: one request-scoped variable map (used by `set` / `[var]`).
  Function calls open a fresh map; arguments are bound by position;
  `set` inside a function does not leak out.
- **Evaluation**: tree-walking. No JIT. Performance work goes into
  *parser caching* (Phase 11), not interpreter cleverness.
- **Errors**: every error carries `(file, line, column)`. Surfaced to
  the response body in dev as a CaseMaster-styled error block; in
  production they go through Vercel logs and a generic 500 page.

## BO → SQL

`<@bo>` declarations register at module load: name → table, attribute
list, FK targets. `iterator.ofEntity({entity: 'qr/labelTemplate',
where: 'id=1', orderBy: 'id'})` translates to
`SELECT id, name, … FROM qr_label_template WHERE id=1 ORDER BY id ASC`
with the WHERE clause compiled from the BO's mini-language (`&` →
`AND`, `=` → `=`, `>=` → `>=`, etc.). Values that look like `[var]`
are substituted before the where-clause compile pass.

`bo.attr(row, 'name')` is a column lookup on the row object emitted by
the iterator — same shape `pg` already returns.

`bo.persist`, `bo.create`, etc. are scheduled for Phase 5 once enough
read paths work to justify them.

## Page rendering

`<@page/container>` and friends are *constructors*: they return a
typed AST node that `render.ts` turns into HTML at the end of the
request. The render is intentionally pure — given the same inputs,
same output bytes — so Phase 12's parity tests can byte-compare.

`resolveTemplate(\`...{{ expr }}...\`)` runs each `{{…}}` through the
expression evaluator with the current scope, then concatenates the
parts. Template literals are *not* re-evaluated after substitution
(unlike `{{[var]}}` which CaseMaster does single-pass — we match).

## Routing

Vercel routes everything to `api/[...route].ts`. That file does:

1. Take `/page/<script>/f/<fn>` → look up `app/page/<script>.cms` →
   call function `<fn>`.
2. Take `/maintenance/<bo>` → call the auto-generated maintenance
   function for `<bo>`.
3. Anything else → 404.

URL conventions match CaseMaster's exactly so links render under both
runtimes without rewriting.

## Local dev

```bash
git clone …
npm install
cp .env.example .env       # fill DATABASE_URL
npx cmsv dev               # http://localhost:3000
```

`cmsv dev` runs Vercel's local emulator (`vercel dev`) under the hood,
plus a file-watcher that invalidates the parser cache when `.cms`
files change.

## Deploy workflow (the goal)

```bash
git push origin main
# GitHub Actions / Bitbucket Pipelines:
#   1. npm ci
#   2. cmsv build         (sanity-parse all .cms; fail on syntax errors)
#   3. vercel --prod --token $VERCEL_TOKEN
```

`vercel.json` declares the catch-all route and any cron jobs derived
from `@schedule`-annotated functions. No further runtime config needed
— the secrets (`DATABASE_URL`, etc.) live in Vercel's environment
variables panel.

## Testing strategy

- **Unit**: parse a representative library of `.cms` snippets; assert
  AST shapes and round-trip via the interpreter on stub inputs.
- **Integration**: spin up Postgres (the same Neon DB), run the small
  apps in `tests/fixtures/*`, hit them via `vercel dev`, snapshot HTTP
  responses.
- **Parity**: keep `CaseMaster.Web.exe` running on `localhost:5050`,
  point a Playwright runner at both URLs in turn, byte-compare bodies
  modulo timestamps and CSRF tokens.

## Conventions

- **Errors** thrown inside `eval.ts` always wrap the underlying error
  with `{file, line, col}`; never raise a bare `Error`.
- **Builtins** in `builtins.ts` are pure where possible. Effects
  (database, response) live in dedicated modules so the interpreter
  itself stays mockable.
- **One BO per file**, mirroring CaseMaster's convention.
- **Generated files** never go in `app/` — they live under `.cmsv/`
  and are gitignored.
- **Snake-case in SQL, camelCase in TypeScript, kebab-case in URLs.**
