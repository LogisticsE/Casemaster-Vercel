# How to launch your own CaseMaster app on Vercel

Practical guide for the **Path A** distribution model (clone the repo,
no npm publish yet). Once 9 Knots greenlights publishing, this same
flow shrinks to `npm create cms-vercel my-app`.

## The three questions

> **Can I open a new VS Code window, `npm install
> github:LadFoxTom/Casemaster-Vercel#main`, and build a CaseMaster
> project from there?**

Not exactly that command — `npm install github:…` would put the whole
repo under `node_modules/`, but the runtime lives in
`packages/runtime/` (a workspace member), so the install wouldn't
expose `cms-vercel` as a usable dependency. The right flow is to
**clone or fork**, then work *inside* the cloned tree (steps below).

> **Do we need a README in that folder, or HOWTOLAUNCH info?**

Yes — this file. The repo root README describes the project; this
file walks through the actual workflow.

> **Can people host the system locally before deploying to Vercel?**

Yes. `npm run dev` runs Vercel's local emulator on
`http://localhost:3000`. Same routing, same `.cms` files, same DB
connection — only difference is the binding (laptop vs Vercel
infrastructure).

## Five-minute quickstart

```bash
# 1. Clone the repo (or your fork)
git clone https://github.com/LadFoxTom/Casemaster-Vercel my-cms-app
cd my-cms-app

# 2. Detach from upstream so this becomes YOUR project
rm -rf .git
git init

# 3. Install dependencies (~30s)
npm install

# 4. Set the database URL — same string the official runtime uses
cp .env.example .env.local
#  edit .env.local and paste your Postgres connection string

# 5. (Optional) Import your existing CaseMaster app's .cms files
node packages/runtime/bin/import.mjs --from C:/path/to/casemaster-runtime
#  copies bo/, page/, script/, qualifier/ into ./app/

# 6. Run locally
npm run dev
#  → http://localhost:3000/page/foo/f/hello       (the demo page)
#  → http://localhost:3000/page/foo/f/ping        (DB connectivity check)
#  → http://localhost:3000/maintenance/qr/labelTemplate  (auto CRUD)

# 7. Validate before deploying
node packages/runtime/bin/build.mjs --app ./app
#  reports unsupported builtins / qualifiers with file:line:col

# 8. Deploy
git add . && git commit -m 'init my CaseMaster app on Vercel'
git remote add origin https://github.com/<you>/<your-repo>.git
git push -u origin main
#  then: vercel.com → New Project → import the repo →
#         set DATABASE_URL in Settings → Environment Variables →
#         disable Deployment Protection (Settings → Deployment Protection)
```

After that first deploy, every `git push origin main` auto-builds and
auto-publishes the new version. Branches get preview URLs.

## What's in the repo

| Path                          | What it is                                       |
|-------------------------------|--------------------------------------------------|
| `app/page/*.cms`              | Page handlers — your URLs                        |
| `app/bo/*.cms`                | Business Object declarations — DB tables         |
| `app/script/*.cms`            | Reusable scripts                                 |
| `api/index.ts`                | 5-line Vercel-Function entrypoint                |
| `public/`                     | Static assets, served at `/static/*`             |
| `vercel.json`                 | Routing + cron + build configuration             |
| `packages/runtime/`           | The interpreter — touch nothing unless you're upgrading the runtime |
| `packages/create-cms-vercel/` | Future scaffold tool (not used in Path A yet)    |

You only ever edit `app/`, `public/`, `.env.local`, `vercel.json`,
and `package.json` (to add JS deps). Everything under
`packages/runtime/` is "the framework."

## Local dev cycle

`npm run dev` (which is `vercel dev` under the hood) gives you:

- Hot-reload of `.cms` files — edit and refresh.
- Real Postgres via the same `DATABASE_URL` you set in `.env.local`.
- All five static-asset routes, auto-routing through `/static/*`,
  `/page/*`, `/maintenance/*`.

The local server uses port 3000 by default (vs Vercel's deployed URL
in production). Functionally identical — anything that works locally
will work after `git push`.

## When to push to your own Vercel project

Two URLs to know:

- `https://<your-project>-<your-team>.vercel.app` — the canonical
  prod URL Vercel hands out. Public if you've disabled Deployment
  Protection.
- `https://<your-project>-git-<branch>-<your-team>.vercel.app` —
  per-branch preview URL. Useful for sharing WIP without merging.

If your Vercel account is on the free Hobby tier, **disable
Deployment Protection** under Project Settings — otherwise every URL
returns `401 Authentication Required`.

## Updating the runtime later

The runtime evolves. To pick up new builtins / bugfixes:

```bash
git remote add upstream https://github.com/LadFoxTom/Casemaster-Vercel.git
git fetch upstream
git merge upstream/main
# resolve any conflicts (you only own app/, public/, vercel.json,
# .env.local, so conflicts should be minimal)
npm install
git push
```

Vercel rebuilds and you're on the new runtime.

## Troubleshooting

| Symptom                              | Likely cause + fix                                       |
|--------------------------------------|----------------------------------------------------------|
| `401 Authentication Required`        | Vercel Deployment Protection on. Disable it.             |
| `500 FUNCTION_INVOCATION_FAILED`     | Module-load error. Hit `/api?diag=1` for the real cause. |
| `unimplemented call: bo.X`           | An unsupported builtin. Run `cms-vercel-build` to find it. |
| Page is blank with `<!-- TODO render: <@page/...> -->` | We don't render that qualifier yet. Either skip the page or contribute the renderer. |
| `Failed to connect to … 5432`        | Neon's compute is suspended. Wait ~10s or run a keepalive cron. |
| `npm install` fails                  | Need Node 20+ (`node --version`). Older versions don't support `import.meta` reliably. |

## What works today vs. what doesn't

See [`UNSUPPORTED.md`](./UNSUPPORTED.md) — the canonical list. The
**`cms-vercel-build` validator** is the right tool for finding what
your specific app uses that isn't supported yet. Run it before every
deploy.
