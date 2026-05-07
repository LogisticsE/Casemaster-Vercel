# What we're building

## In one sentence

A drop-in serverless runtime for CaseMaster `.cms` applications so the
same app that runs locally on `CaseMaster.Web.exe` can also be pushed to
GitHub or Bitbucket and deployed to Vercel.

## In one minute

CaseMaster ships a closed-source .NET runtime that interprets `.cms`
script files at request time. That binary needs a long-running Windows
host, which excludes Vercel and most modern serverless platforms. This
project re-implements *only* the surface area an app actually depends on
— page routing, BO definitions, iterators, expressions, the standard
library — in TypeScript, packaged as a Vercel Function. Same `.cms`
files, same Postgres, same URLs.

## Architecture

```
┌──────────────────────┐                ┌──────────────────────┐
│   Existing dev loop  │                │      New target      │
│                      │                │                      │
│  *.cms ─► CaseMaster │                │  *.cms ─► cms-vercel │
│          .Web.exe    │                │           runtime    │
│            │         │                │             │        │
│            ▼         │                │             ▼        │
│       Kestrel :5050  │                │    Vercel Function   │
│            │         │                │             │        │
└────────────┼─────────┘                └─────────────┼────────┘
             │                                        │
             └──────────► Same Neon Postgres ◄────────┘
```

Both paths read the same `.cms` files and the same database, so an app
can be developed locally with the official runtime and deployed via
Vercel without source-code changes (or with a small `.cms` migration if
we use a feature `cms-vercel` doesn't yet support).

## What's in scope

- **Routing**: URLs of the form `/page/<script>/f/<function>` and
  `/maintenance/<bo>` resolve to the matching `.cms` function.
- **Pages**: `<@page/...>` resources render to HTML; `resolveTemplate`
  expands `{{ … }}` expressions.
- **Business Objects**: `<@bo …>` declarations map to Postgres tables;
  `iterator.ofEntity` runs `SELECT`s; `bo.attr` reads columns;
  `bo.persist` / SQL writes go through a connection pool.
- **Standard library**: the functions used pervasively in real `.cms`
  code (`concat`, `if`, `eq`, `format`, `today`, `addDay`, `replace`,
  `json.parse`, `pb.get`, …).
- **Build & deploy**: `cmsv build` precompiles, `cmsv deploy` ships;
  CI templates for GitHub Actions and Bitbucket Pipelines are included.

## What's out of scope (today)

- The CaseMaster IDE / Monaco editor / VS Code language layer — keep
  using those locally; they don't run on Vercel and don't need to.
- Real-time features (WebSockets, SSE) — Vercel's serverless model is
  a poor fit. Add later via Vercel's edge runtime if a real need shows up.
- Authoring tools to *create* `.cms` files programmatically — the
  artifact layer stays exactly compatible with CaseMaster's.
- Drop-in support for *every* CaseMaster feature on day one — the
  Roadmap is explicit about which subset Phase N covers.

## Compatibility goals

- **Source compatibility, not binary**: a `.cms` file that uses only
  supported features behaves identically on both runtimes. Where it
  doesn't, a build-time validator flags the unsupported call.
- **Database compatibility**: identical SQL emitted; no schema changes
  on switching runtimes; the existing connection-string conventions
  carry over.
- **URL compatibility**: same routes, same query-string conventions, so
  bookmarks and external integrations keep working.

## Non-goals

- Faster than CaseMaster on a long-lived host — we trade per-request
  latency for elastic scale-to-zero. A lukewarm Vercel function is
  ~50–200 ms slower on cold start than a warm `CaseMaster.Web.exe`, and
  that's an acceptable cost for the deployment story.
- A GUI for managing the deployment — `vercel deploy` and the dashboard
  do that. We don't reinvent.
- Replacing CaseMaster's local development experience — the official
  runtime keeps being the best place to author and debug. This project
  takes the *output* of that work and makes it deployable elsewhere.

## Success criteria

- An end-to-end demo: clone a fresh repo containing a small `.cms` app,
  `cmsv deploy`, the Vercel URL renders the same pages as
  `CaseMaster.Web.exe` does on the developer's laptop.
- The Axylog Integration app — at least its read-only paths (lists,
  detail views, exports) — runs on Vercel without source changes after
  Phase 5.
- A new CaseMaster developer can stand up a Vercel deployment in under
  an hour, working only from `WHAT.md`, `HOW.md`, and the README.
