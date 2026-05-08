# app/ — your code lives here

Everything in this directory is **your** application code. The runtime
walks `app/` at startup, parses every `.cms` file, and serves whatever
functions, BOs, and resources it finds.

## What goes where

| Folder           | Holds                                    | Drives URL                          |
|------------------|------------------------------------------|-------------------------------------|
| `app/bo/`        | Business Object declarations             | `/maintenance/<bo>` (auto-CRUD UI)  |
| `app/page/`      | Page handler functions                   | `/page/<script>/f/<function>`       |
| `app/script/`    | Reusable functions, no URL of their own  | (called from pages / other scripts) |
| `app/qualifier/` | Custom `<@…>` qualifiers                 | (rendered on demand)                |

The starter ships two pages:

- `app/page/welcome.cms` — the landing page you saw on first launch.
  Edit it freely; the route `/` redirects here.
- `app/page/ping.cms` — a Postgres connectivity check. Hit
  `/page/ping/f/ping` to verify your `DATABASE_URL` works.

## Where NOT to edit

Anything outside `app/`:

- `packages/runtime/` — the cms-vercel framework. `git pull` overwrites it.
- `api/`, `vercel.json`, `package.json` — deploy plumbing. Touch only
  if you're changing how the project deploys, not what it does.
- `public/` — static assets only (`/static/css/app.css`). Add files to
  serve them under `/static/<path>`.

## Day-to-day cycle

```powershell
# 1. edit a .cms file under app/
# 2. live preview
npx vercel dev
# 3. check the validator before deploying
node packages/runtime/bin/build.mjs --app ./app
# 4. ship
git add app/ ; git commit -m "feat: customer list page" ; git push
```

`git push` triggers an auto-deploy on Vercel (if you connected git per
HOWTOLAUNCH Option B). Otherwise `npx vercel --prod` ships manually.

## Guides

- [`../BUILDING.md`](../BUILDING.md) — building a new app from scratch
- [`../CONVERTING.md`](../CONVERTING.md) — porting an existing CaseMaster app
- [`../HOWTOLAUNCH.md`](../HOWTOLAUNCH.md) — deploying to Vercel

## Builtin reference

- [`../packages/runtime/API.md`](../packages/runtime/API.md) —
  full list of supported `.cms` builtins, qualifiers, and behaviours
- [`../UNSUPPORTED.md`](../UNSUPPORTED.md) —
  what doesn't work yet (file uploads, WebSocket, &gt;Hobby-tier durations)
