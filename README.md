# cms-vercel

Run CaseMaster `.cms` applications on Vercel.

This repo is the parallel experiment described in `WHAT.md` and `HOW.md`,
tracked phase-by-phase in `ROADMAP.md`. The existing CaseMaster runtime
in `..\casemaster-runtime\` is **not modified** — both runtimes can read
the same `.cms` files and the same Postgres database concurrently.

## Status

Phase 1 — proof of concept. `app/page/ping.cms` parses + interprets +
hits Neon + returns `ok N\n` end-to-end.

```
$ npm install
$ DATABASE_URL=postgresql://… npm test
✓ 6 tests passed   (5 parser unit + 1 live-DB e2e)
```

## Layout

| Path           | What                                                     |
|----------------|----------------------------------------------------------|
| `ROADMAP.md`   | Single source of truth for status (update this)          |
| `WHAT.md`      | Project description, architecture, scope                 |
| `HOW.md`       | Tech stack + design decisions                            |
| `api/`         | Vercel function (catch-all router)                       |
| `src/cms/`     | Lexer, parser, AST, interpreter, BO/SQL, Postgres pool   |
| `app/`         | The `.cms` application — copy from CaseMaster, untouched |
| `tests/`       | Vitest unit + e2e suites                                 |

## Local dev

```bash
cp .env.example .env.local      # set DATABASE_URL
npm install
npm test                        # parser + e2e
npm run dev                     # vercel dev — http://localhost:3000
curl http://localhost:3000/page/foo/f/ping
# → ok 2
```

## What works in Phase 1

- `function … end-function` declarations
- `set('var', expr)` / `[var]` substitution
- `if/else-if/else/end-if`, `iterate iterator.ofEntity(…) end-iterate`
- `eq`, `ne`, `and`, `or`, `not`, `lt`, `gt`, `lte`, `gte`, `sum`, `sub`,
  `mul`, `div`, `mod`, `lng`, `if(cond, then, else)`
- `concat`, `formatString`, `replace`, `startsWith`, `trim`, `chr`
- `_onError`, `isNull`, `isNotNull`
- `iterator.ofEntity(<@iterator/entity name:'…' entity:'qr/labelTemplate'
  where:'…' orderBy:'…'>)` → SELECT against the mapped Postgres table
- `bo.attr([row], 'col')`
- `response.setContentType / write / flush / end / clearContent / redirect`

## What's coming

`ROADMAP.md` Phases 2–12.

## Why this exists

CaseMaster ships a closed-source .NET runtime that needs a long-running
Windows host. Vercel runs ephemeral Linux serverless functions. This
project bridges the two so a CaseMaster app can be pushed to GitHub or
Bitbucket and live-deployed via Vercel's standard CI.
