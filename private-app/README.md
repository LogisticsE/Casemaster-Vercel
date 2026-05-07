# private-app — internal CaseMaster project files

This folder contains the project-specific `.cms` source for the
**Axylog × Eurofins integration** (Axylog ingester, Penguin Lockers
LMS, QR labels). It was placed here so the public cms-vercel demo
in the repo root stays free of internal data.

The folder is structured to be **drop-in compatible with any
cms-vercel deployment** — copy `private-app/app/*` over the demo's
`app/` directory and you have a runnable private build.

## Contents

```
private-app/app/
├── bo/
│   ├── axylog/      — 8 BOs over the Axylog ingest tables
│   │                  (trip, document, party, visit, tripSummary,
│   │                   customerVisit, ingestRun, contextOwner)
│   ├── qr/          — 3 BOs for the QR label printer workflow
│   │                  (labelTemplate, job, code)
│   └── penguin/     — 8 BOs for Penguin Lockers LMS
│                      (activeBooking, compartment, compartmentToday,
│                       endUser, order, station, syncRun, unit)
└── script/
    ├── axylog/      — env + API helper + sync ingester
    └── penguin/     — env + sync ingester
```

## Usage — deploy as a private cms-vercel app

```bash
# 1. Clone the cms-vercel runtime (skip if you already have it)
git clone https://github.com/LadFoxTom/Casemaster-Vercel my-private-app
cd my-private-app
rm -rf .git && git init

# 2. Replace the public demo's app/ with the private one
rm -rf app
cp -r private-app/app ./app

# 3. (Optionally) remove private-app/ — you've now consumed it
rm -rf private-app

# 4. Configure secrets
cp .env.example .env.local
# Set DATABASE_URL + Axylog API creds + Penguin API creds (.env)

# 5. Local dev
npm install
npm run dev      # http://localhost:3000

# 6. Deploy
git remote add origin git@github.com:<your-org>/<private-repo>.git
git push -u origin main
# ...then connect the repo on a Vercel project of your choosing.
```

## What's runnable, what isn't

| Path                       | Status on cms-vercel                                |
|----------------------------|-----------------------------------------------------|
| `bo/**/*.cms`              | All 19 BOs load cleanly into the registry.          |
| `/maintenance/<bo>`        | Auto-CRUD pages render for every BO whose Postgres table exists. |
| `script/axylog/sync.cms`   | Calls `httpRequest.create` against api.axylog.com — works on Vercel **Pro** (60s timeout); times out on Hobby (10s). Move to a separate webhook/cron if you stay on Hobby. |
| `script/penguin/sync.cms`  | Same shape as the Axylog sync — same Pro-tier caveat. |
| Page handlers              | Not included in this folder. The original CaseMaster runtime ships a large `page/axylog.cms` with route-execution / customer / QR-designer pages; those use page-qualifier features (e.g. `page/data/inlineMaintenance`) that cms-vercel doesn't yet render. Port piecemeal. |

## What's NOT in this folder

- The CaseMaster framework's own `bo/`, `page/`, `qualifier/` files
  (anything that comes with the runtime). Those are framework, not
  project, and don't need to be redistributed.
- Page handlers from the original `page/axylog.cms`. They're large
  and use unsupported qualifiers; port them as you go and expand
  `cms-vercel` accordingly.
- `.env`, secrets, the live database. Bring your own.

## Why this exists

The cms-vercel public landing page at
`https://casemaster-vercel-toms-projects-6d758fc9.vercel.app/`
demonstrates the runtime against a clean demo (`hello.cms`,
`ping.cms`). Project-specific source belongs in a separate private
repo or this folder, not the public deploy.
