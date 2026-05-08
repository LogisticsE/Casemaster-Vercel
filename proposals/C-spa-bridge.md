# Proposal C — `cms-admin`: a modern SPA for both CaseMaster runtimes

**Goal**: build a polished React admin SPA that consumes the same
`.cms` source — by talking to a JSON API instead of receiving rendered
HTML. App authors get a 2026-class admin UI (drag-drop dashboards,
command palette, real-time, optimistic mutations) without rewriting
their `.cms`. The SPA is **runtime-agnostic**: it works against
cms-vercel out of the box and against the .NET runtime via a
documented sidecar deployment pattern (or, optionally, a parallel C#
JSON adapter).

**Effort**: 3-6 months, small team (1 backend + 1 frontend, or one
full-stack senior). Adding the optional .NET adapter would be another
~2 months of C# work; the sidecar approach (recommended) costs zero
additional dev time.

**Repos** (all new):
- `cms-admin` — the runtime-agnostic SPA, published as `@casemaster/admin`.
- `cms-api-vercel` — the cms-vercel JSON adapter, published as
  `@casemaster/api-vercel` (drops into a cms-vercel project).
- `cms-api-dotnet` — *optional* C# JSON adapter for users who can't
  run cms-vercel as a sidecar.

This is a strategic commitment, not a tactical fix. Read
[§8 "Why this is a bigger decision"](#8-why-this-is-a-bigger-decision)
before scoping budget.

---

## 1. Background — what cms-vercel actually is

> **Note for the recipient developer**: this section repeats verbatim
> across all three proposal docs. If you've read it elsewhere, skip
> to §2.

### CaseMaster (the platform we're modernising)

[CaseMaster](https://docs.casemaster.io/) is a Windows-only enterprise
web platform from 9 Knots Business Solutions. Apps are written in a
custom DSL — `.cms` files combining page handlers, business-object
declarations, scripts, and inline qualifiers. A typical .cms page:

```cms
inherits 'base'

function main()
    set('items', iterator.ofEntity(
        entities: < <@iterator/entity name: 'i', entity: 'wms/inventory', orderBy: '-id'> >,
        rows: 20
    ))
    page.render(page.get('./mainView'))
end-function

protected resource mainView
    <@page/container
        content: <@page/content
            title: <@page/title label: 'Inventory'>,
            table: <@page/data/table iterator: [items], group: 'list'>
        >
    >
end-resource
```

The official runtime is a `.NET` Windows binary serving these apps
with Bootstrap 4 + jQuery + Font Awesome + Select2 + FullCalendar.

### cms-vercel (the Vercel-friendly reimplementation)

[`cms-vercel`](https://github.com/LadFoxTom/Casemaster-Vercel) is a
TypeScript reimplementation that runs as a single Vercel serverless
function. Same `.cms` language, same Postgres backend, no Windows
required. Currently emits server-rendered HTML through these layers:

```
HTTP ──► handler.ts ──► loadApp (parse all .cms) ──► callFunction
                                                          │
                                                          ▼
                                                   eval.ts (interpreter)
                                                          │
                                                          ▼
                                                   render.ts (HTML)
                                                          │
                                                          ▼
                                                   wrapInDefaultShell
                                                          │
                                                          ▼
                                                       HTTP response
```

Read paths and write paths both work against Postgres. The runtime
already has a clean separation: `eval.ts` produces structured values
(rows, qualifier trees, BO instances), and `render.ts` is the only
HTML producer. **That separation is what makes Proposal C feasible:**
we can replace `render.ts` with a JSON serialiser and feed the same
structured data to a SPA.

### What other ports/tools look like in this space

The shape we're chasing has many predecessors:
- **[Refine](https://refine.dev/)** — React framework for admin UIs;
  data-source agnostic.
- **[React-Admin](https://marmelab.com/react-admin/)** — older, mature.
- **[Retool](https://retool.com/)** — drag-drop closed-source tool.
- **[Forest Admin](https://www.forestadmin.com/)** — auto-admin from a
  schema.

cms-admin is closest in spirit to React-Admin, but with the twist
that the schema and behaviour come from `.cms` files, not from a
separate frontend specification.

---

## 2. Dual runtime support — three deployment shapes

Unlike A and B (where a single CSS or JS file serves both runtimes
unchanged), C needs a **JSON API** somewhere. The SPA is one artefact;
the JSON API has three viable shapes depending on the user's
infrastructure:

### Shape 1: cms-vercel only (the simplest)

```
Browser  ──►  Vercel Function (cms-vercel + cms-api-vercel)
                   │
                   ▼
             Postgres (Neon / RDS / etc.)
```

The user has chosen cms-vercel as their runtime. The Vercel Function
serves both classic HTML routes (`/page/*`) and JSON API routes
(`/api/v1/*`). The SPA hits `/api/v1/*`. Everything in one deployment.

**This is the default and recommended shape for new deployments.**
§3-§6 below all assume this.

### Shape 2: .NET runtime + cms-vercel JSON sidecar (recommended for .NET deployments)

```
Browser  ──►  Static SPA host (any CDN — Vercel, Netlify, S3, IIS)
              │
              │ classic HTML       │ JSON API
              ▼                    ▼
         CaseMaster.Web.exe   cms-vercel (JSON-only)
              │                    │
              └────────┬───────────┘
                       ▼
                  Postgres (shared)
```

The user's existing CaseMaster.Web.exe stays in production untouched.
**cms-vercel runs alongside it as a JSON-only sidecar** — same `.cms`
source mounted (or git-cloned), pointed at the same Postgres, with
the JSON API enabled. Both runtimes share the `cms_session` table so
auth flows transparently.

The SPA is hosted as static assets anywhere convenient (Vercel,
Netlify, IIS on the same Windows box, S3+CloudFront, etc.) and its
API client points at the cms-vercel sidecar's URL.

This pattern is **already documented** in cms-vercel's CONVERTING.md
("a common pattern: deploy public-facing pages on cms-vercel, keep
the official runtime for admin/authoring/batch jobs"). C reuses it —
the .NET runtime keeps doing what it does well; cms-vercel
contributes the JSON layer.

**Why this is the recommended .NET path**: zero new code per user;
the JSON API is exactly the same artefact users on Shape 1 use; auth
already shares state via Postgres; cms-vercel running JSON-only has
no `vercel dev` HTML overhead.

**Cost**: hosting one extra service (cms-vercel as a JSON gateway).
Vercel's free tier handles modest deployments; bigger ones run the
sidecar on whatever already hosts the .NET runtime.

### Shape 3: .NET runtime + native C# JSON adapter (for users who can't run a sidecar)

```
Browser  ──►  Static SPA host
                   │ JSON API
                   ▼
              CaseMaster.Web.exe + cms-api-dotnet plugin
                   │
                   ▼
              Postgres
```

For users on locked-down Windows-only infrastructure who can't add a
cms-vercel sidecar, build a C# implementation of the same JSON API
contract that runs **inside** CaseMaster.Web.exe as a plugin.

This is real work: the predicate translator, BO ops, attribute group
serialisation, page-action runner all need to be written in C#
against the .NET runtime's internals. ~2 months of focused C# dev
once the JSON contract from Shape 1 is stable.

The SPA doesn't change — it sees the same `/api/v1/*` shape from
either backend.

**Don't build this for v1.** Ship Shapes 1 and 2 first. Build Shape 3
only if a paying customer specifically can't run a sidecar.

### Choosing a shape

| Your runtime | Recommended shape |
|---|---|
| Greenfield, Vercel-friendly | Shape 1 (cms-vercel only) |
| Existing .NET production, can host extra services | Shape 2 (sidecar) |
| Existing .NET, locked-down Windows-only | Shape 3 (eventually) |

The SPA itself is the **same code in all three shapes**. Only the
backend differs. That single-frontend / multiple-backend property is
what makes "build something that works on both runtimes" feasible.

---

## 3. Architecture — the big picture

```
┌─────────────────────────────────────────────────────────────────┐
│                            BROWSER                              │
│                                                                 │
│   @casemaster/admin SPA  (React / Vite / TypeScript)            │
│       ▲                                                         │
│       │ JSON over fetch                                         │
└───────┼─────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────┐
│                    cms-vercel + @casemaster/api-vercel                 │
│                                                                 │
│   /api/v1/schema         <- BO + page descriptors (JSON)        │
│   /api/v1/page/:p/:fn    <- runs page fn, returns JSON state    │
│   /api/v1/bo/:bo/list    <- paginated BO listing                │
│   /api/v1/bo/:bo/get     <- BO row by id                        │
│   /api/v1/bo/:bo/save    <- BO write (insert/update)            │
│   /api/v1/bo/:bo/delete                                         │
│   /api/v1/sql            <- gated raw SQL for db-admin pages    │
│   /api/v1/session        <- login / logout / who-am-i           │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
   Postgres (Neon / RDS / etc.)
```

The cms-vercel runtime already has all the pieces. The job is to:

1. **Add a JSON adapter** (`@casemaster/api-vercel`) that reuses the existing
   loader, eval, and BO machinery to produce JSON instead of HTML.
2. **Build a SPA shell** (`@casemaster/admin`) that consumes that JSON
   and renders polished React.

Critically: the existing HTML rendering keeps working. C is additive.
An app can serve some pages as classic cms-vercel HTML and others as
the SPA, gated per-route. That makes adoption incremental and de-risks
the bet.

---

## 4. The JSON API surface (`@casemaster/api-vercel`)

### 3.1 `/api/v1/schema` — what the SPA needs to know

Returns one JSON document describing the entire app:

```json
{
  "version": "1",
  "appName": "Casemaster-WMS",
  "bos": [
    {
      "name": "wms/inventory",
      "table": "inventory",
      "primaryKey": "id",
      "attributes": [
        { "name": "id",          "label": "Id",           "type": "long",    "required": true,  "readOnly": true },
        { "name": "item_id",     "label": "Item id",      "type": "long",    "required": true,  "fk": "wms/item" },
        { "name": "qty_on_hand", "label": "Qty on hand",  "type": "decimal", "scale": 6 },
        { "name": "is_active",   "label": "Is active",    "type": "boolean", "required": true }
      ],
      "groups": {
        "list":        ["item_id", "qty_on_hand", "qty_reserved", "quality_status"],
        "description": ["item_id", "qty_on_hand", "qty_reserved", "qty_on_hold", "qty_in_transit"],
        "search":      ["item_id"]
      }
    }
  ],
  "pages": [
    {
      "path": "wms/inbound",
      "functions": ["main", "asn", "po", "receive", "receipt"],
      "title": "Inbound",
      "navIcon": "fa-truck-loading"
    }
  ],
  "navigation": [
    { "label": "Inbound", "path": "/page/wms/inbound", "icon": "📦", "order": 10 }
  ]
}
```

Generated on the cms-vercel side from:
- `BOInfo` registry (already built by `loader.ts`)
- A new `/api/page-meta/<path>` introspection that runs the page's
  `meta()` function if present, otherwise infers from registered
  function names.

### 3.2 `/api/v1/bo/:bo/list` — paginated BO listing

```
GET /api/v1/bo/wms/inventory/list?
  group=list&
  filter[status]=AVAILABLE&
  sort=-qty_on_hand&
  page=1&
  pageSize=50
```

Response:

```json
{
  "rows": [
    { "id": 6, "item_id": 6, "qty_on_hand": 200, ... }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 50,
  "groups": {
    "list": ["item_id", "qty_on_hand", "qty_reserved", "quality_status"]
  }
}
```

Implementation: this is `iterator.ofEntity` plus pagination. The
predicate translator already builds the WHERE clause from the
`filter[…]` params.

### 3.3 `/api/v1/bo/:bo/save` — write

```
POST /api/v1/bo/wms/inventory/save
{ "id": 42, "qty_on_hand": 100, "quality_status": "AVAILABLE" }
```

Maps to `bo.quickLoad` + `bo.setAttr` + `bo.persist` (existing
runtime ops). Returns the saved row + version.

### 3.4 `/api/v1/page/:path/:fn` — run a page function as a JSON action

For pages that have logic beyond CRUD (e.g. WMS `postReceive`,
`postPutaway`). The page function runs, but instead of `page.render`
producing HTML, the runtime collects the variables the function `set`
via `set('//act_msg', …)` and returns them as JSON:

```
POST /api/v1/page/wms/inbound/receive
{ "asn": 1, "qty_42": 5, "lot_42": "LOT-2026-001", "confirm": "1" }
```

```json
{
  "ok": true,
  "outputs": {
    "act_rcpt_id": 10000123,
    "act_lines_received": 1,
    "act_msg": "Receipt 10000123 posted; 1 lines received."
  }
}
```

This makes existing `.cms` actions reusable from the SPA without
rewriting them.

### 3.5 Auth surface

Reuses cms-vercel's existing session mechanism:

```
POST /api/v1/session/login   { email, password }   → sets cmsv_sid cookie
POST /api/v1/session/logout                         → clears cookie
GET  /api/v1/session/me                             → { user, perms }
```

### 3.6 Implementation in the cms-vercel repo

`@casemaster/api-vercel` is a small adapter inside `packages/api/`:

```
packages/api/
├── src/
│   ├── index.ts          createJsonHandler({ appDir, …}) -> Vercel handler
│   ├── routes/
│   │   ├── schema.ts
│   │   ├── bo-list.ts
│   │   ├── bo-save.ts
│   │   ├── bo-delete.ts
│   │   ├── page-action.ts
│   │   ├── sql.ts
│   │   └── session.ts
│   └── lib/
│       ├── parse-filters.ts
│       └── serialise-row.ts
└── README.md
```

Wire-up in the user's project:

```ts
// api/v1/[...route].ts
import { createJsonHandler } from '@casemaster/api-vercel';
export default createJsonHandler();
```

vercel.json gets one extra rewrite:

```json
{ "source": "/api/v1/:path*", "destination": "/api/v1/:path*" }
```

### 3.7 Key design constraints

- **No new auth model** — JWT? OAuth? No. Reuse the cookie session.
  Adds zero new attack surface.
- **No new DB model** — go through the existing BO machinery. Same
  reads, same writes, same predicate translator.
- **Stable API** — version it (`/api/v1`). Breaking changes cut a
  new version, both run side by side.
- **CSRF-safe** — the SPA includes the cookie on same-origin requests;
  state-changing routes require a CSRF token from `/api/v1/session/me`.

---

## 5. The SPA (`@casemaster/admin`)

### 4.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **React 18 + TypeScript** | Largest ecosystem; matches Refine/React-Admin folks coming over. |
| Bundler | **Vite** | Fastest dev loop. |
| Routing | **React Router 6** | Stable, file-router optional via Tanstack Router later. |
| Data | **TanStack Query** | Caching, optimistic mutations, dedupe. |
| Forms | **react-hook-form** + **zod** | Schema validation against the BO descriptors. |
| UI primitives | **Radix UI** + **Tailwind CSS** | Headless primitives, no opinion on visual theme. |
| Visual theme | **shadcn/ui** components copy-pasted | Modern look, easy to customize. |
| Tables | **TanStack Table** | Best-in-class headless table. |
| Charts | **Recharts** or **visx** | Dashboard widgets. |
| Date pickers | **react-day-picker** | Accessible, lightweight. |
| Editor | **Monaco** (lazy-loaded) | For the SQL playground page. |

Alternative stack consideration: **Vue 3 + Nuxt** if the team is more
Vue-shaped. **SvelteKit** if you want bleeding-edge UX with smaller
bundles. Pick one and stick — the docs assume React.

### 4.2 What the SPA renders

For each `.cms` page-path, the SPA picks a layout from the schema:

| `.cms` shape | SPA layout |
|---|---|
| `<@page/data/table>` only | TanStack Table view with search, sort, pagination, column visibility, CSV/XLSX export |
| `<@page/form>` for one BO | Form view with grouped fields, schema-driven validation (zod from BO type info) |
| `<@page/form>` + `<@page/data/table>` | Master-detail (left form, right list) |
| Multiple `<@page/data/table>` (like a dashboard) | Card grid with KPI widgets and tables |
| Custom logic via `set` + `iterate` | Full control: a generic "data view" that the SPA renders and the user can override per-page |

The SPA ships a default rendering for every shape. Per-app overrides
are via React component slots:

```tsx
// User's per-app override
<CmsAdmin
  schema={schema}
  overrides={{
    'wms/inventory:list': InventoryListWithBarcodes,
    'wms/inbound':        WmsInboundDashboard,
  }}
/>
```

### 4.3 Repo layout

```
cms-admin/
├── README.md
├── packages/
│   ├── admin/                    the SPA shell
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   └── ...
│   │   │   ├── components/
│   │   │   │   ├── DataTable.tsx       wraps TanStack Table
│   │   │   │   ├── BoForm.tsx          react-hook-form + zod from schema
│   │   │   │   ├── CommandPalette.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Topbar.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useSchema.ts
│   │   │   │   ├── useBoList.ts        TanStack Query + cms-vercel API
│   │   │   │   └── useBoSave.ts
│   │   │   └── api/
│   │   │       └── client.ts            fetch wrapper
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── create-cms-admin/  scaffold tool
│   │   └── src/cli.ts
│   └── api-client/               typed client of the JSON API,
│                                 consumable by other tools
│       └── src/index.ts
├── examples/
│   └── wms/                       a sample app deploying the SPA
│       ├── api/v1/[...route].ts
│       ├── src/                   per-app overrides
│       └── vercel.json
└── docs/
    ├── getting-started.md
    ├── overrides.md
    └── architecture.md
```

### 4.4 The default page rendering

A page authored as:

```cms
function main()
    set('items', iterator.ofEntity(
        entities: < <@iterator/entity name: 'i', entity: 'wms/inventory'> >,
        rows: 50
    ))
    page.render(page.get('./mainView'))
end-function

protected resource mainView
    <@page/container content: <@page/content
        title: <@page/title label: 'Inventory'>,
        table: <@page/data/table iterator: [items], group: 'list'>
    >>
end-resource
```

When the SPA hits `/admin/wms/inventory`, it:
1. Fetches `/api/v1/schema` (cached).
2. Sees the page has one table bound to `wms/inventory` group `list`.
3. Calls `/api/v1/bo/wms/inventory/list?group=list` for data.
4. Renders `<DataTable schema={...} data={...} />`.

Result: same data, but rendered as a TanStack Table with sticky
header, sortable/filterable columns, virtual scroll, clickable rows
that open a Radix `<Dialog>` with the BO edit form. Zero `.cms` code
changes.

### 4.5 Unique opportunities the SPA enables

Things impossible (or painful) with the HTML rendering:

- **Real-time updates** — subscribe to a Postgres `LISTEN` channel via
  Vercel's Edge SSE; rows update live.
- **Optimistic mutations** — a row edit appears instant; rolls back
  on save error.
- **Multi-tab workflows** — operator opens 5 receipts in tabs; SPA
  caches the schema once.
- **Drag-drop dashboards** — user composes their own KPI tile layout,
  saved per-user.
- **Progressive sync** — offline-first: queue mutations, replay when
  reconnected.
- **Embedded analytics** — charts on top of `bo.list` results, no
  extra backend.

None of these are required for v1. They're the upside that justifies
C's bigger commitment over A+B.

---

## 6. Implementation plan (aggressive 3-month version)

### Month 1 — JSON API + scaffold

**Weeks 1-2**: `@casemaster/api-vercel` package
- `/api/v1/schema` (introspect BOInfo + parsed pages)
- `/api/v1/bo/:bo/list` with filter/sort/page parsing
- `/api/v1/bo/:bo/get`, `/save`, `/delete`
- Reuse cms-vercel's pg pool, predicate translator, BO ops.
- Unit tests against the WMS schema.

**Weeks 3-4**: `@casemaster/admin` skeleton
- Vite + React + Tailwind + TanStack Query bootstrap.
- Login screen.
- Schema fetch + sidebar from `navigation`.
- Data table view: `<DataTable boName="wms/inventory" />`.
- BO form view: `<BoForm boName="wms/inventory" id={42} />`.
- Routing: `/admin/<page>` mirrors cms-vercel's routes.

By end of month 1: open `/admin` in a browser, see the WMS sidebar,
click any list-shape page, see a working sortable table, edit a row,
save.

### Month 2 — coverage + per-page overrides

**Weeks 5-6**: page-action endpoint
- `/api/v1/page/:path/:fn` runs `.cms` actions.
- SPA hooks: `usePageAction(path, fn)` for forms with custom logic
  (WMS receive, putaway, adjust).

**Weeks 7-8**: layout + overrides
- Master-detail layout for pages with form + table.
- Dashboard layout (multi-card-multi-table).
- Per-page React override system: `overrides={{'wms/inventory': MyCustomList}}`.
- Command palette, keyboard shortcuts, breadcrumbs.

By end of month 2: WMS dashboard, inbound, stock, outbound all viewable.

### Month 3 — polish + production

**Weeks 9-10**: write paths fully
- Optimistic mutations (TanStack Query mutations + rollback).
- Toast notifications.
- Form validation from BO schema.
- Inline edit cells.

**Weeks 11-12**: production ready
- Auth flows (login, logout, session refresh, role-based nav).
- Error boundaries, 404, 5xx pages.
- Loading skeletons.
- Visual + accessibility audit.
- Bundle audit (target ≤ 250 KB initial gz).
- Deploy `examples/wms` to Vercel as a public reference.
- Publish 0.1.0 of `@casemaster/admin`, `@casemaster/api-vercel`,
  `@casemaster/api-vercel-client`.

---

## 7. Testing strategy

### Backend (cms-vercel/packages/api)
- Unit (Vitest): each route function with mocked pg.
- Integration: live Postgres in CI, run against the WMS schema dump.
- API contract: a typed schema (zod or Type-Safe Zod) that both server
  and client consume; mismatches fail CI.

### SPA (cms-admin)
- Component tests (Vitest + Testing Library) — DataTable, BoForm,
  CommandPalette.
- E2E (Playwright) — login → list → edit → save → logout.
- Visual regression — same as proposals A and B, but extended to
  every page shape.
- Accessibility — axe-core, no serious violations.

### Compatibility
- The SPA's API client is generated from the schema and has its own
  versioned tests against a reference `@casemaster/api-vercel@^1` server.

---

## 8. Why this is a bigger decision

A and B are tactical. C is strategic. Things that change with C:

- **Two front-ends to maintain**: classic cms-vercel HTML AND the SPA.
  Apps choose. The choice is rarely either-or — typically apps run
  both.
- **API stability matters**: `/api/v1` is now a public contract. Breaking
  changes carry real cost. SemVer matters.
- **New audience**: teams who'd never have used CaseMaster might use the
  SPA + cms-vercel as a "code-first admin platform." That's a distinct
  product.
- **Bigger surface**: the SPA shell itself is large. A polished one is
  3-6 dev-months. An ambitious one (drag-drop dashboards,
  customisable per-tenant) is a year.

Don't start C unless the answer to "do we want to build a polished
admin product on top of cms-vercel?" is yes. If you're just trying to
make existing CaseMaster apps look better, A + B are the right scope
and you'll get there in a month.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Schema introspection misses things `.cms` does dynamically (set/iterate logic) | Default to "render the page as HTML in an iframe" for shapes the SPA can't handle. Lossless. |
| API surface explodes as page-action shapes diverge | Prefer generic `/api/v1/page/:path/:fn` over specialised endpoints. Treat anything specialised as a code smell. |
| Auth diverges between cms-vercel HTML and SPA | Strict reuse of the existing cookie session. Same `cms_session` table, same handler. No JWT layer. |
| SPA bundle grows unbounded | Hard budget. Lazy-load per-page chunks. Audit on every PR. |
| Real-time/SSE introduces server cost | Opt-in per page; not in v1. |
| Theme drift between A's CSS and SPA's Tailwind | Tailwind config reads the same `--cms-*` variables A defines. Keep A and SPA in visual lockstep. |
| Per-app overrides need to be shipped at build time, not request time | `cms-admin` ships as a library; users build their own deployment. The CLI scaffolds the project. |

---

## 10. Success criteria

### v1 (3 months)

- A real CaseMaster app (the WMS) is fully operable through the SPA
  for all read paths and the most-used 5 write paths (receive, putaway,
  adjust, move, ship).
- A 30-second video demos: clone, deploy, log in, click around. Tables
  sort, forms validate, mutations are instant.
- The SPA bundle is under 250 KB initial gz.
- The `/api/v1` schema is documented in OpenAPI.

### v1.x (6 months)

- Real-time on at least one page (live receipts).
- Per-tenant theming.
- Mobile-responsive enough for warehouse-floor tablets.
- One external team deploying for their own CaseMaster app.

---

## 11. Out of scope (forever, or for v1)

For v1:
- Drag-drop dashboard editor (hard).
- Multi-tenant SaaS infra (Vercel does the hosting; we do the app).
- Visual page editor — pages stay in `.cms`. The SPA renders them.
- Anything competing with `.cms` itself (no new declarative language).

Forever:
- Replacing cms-vercel's HTML rendering. Both serve forever; users
  pick per-route.

---

## 12. Onboarding checklist for the team

Before writing code:

- [ ] Read this whole document.
- [ ] Read [`README.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/README.md), [`HOWTOLAUNCH.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/HOWTOLAUNCH.md), [`CONVERTING.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/CONVERTING.md), [`packages/runtime/API.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/packages/runtime/API.md).
- [ ] Run a real cms-vercel app locally; click through a dozen pages.
- [ ] Read the `loader.ts` and `eval.ts` source — those determine
      what shapes the API can describe.
- [ ] Pick one of: React-Admin, Refine, or shadcn/ui's [Dashboard
      example](https://ui.shadcn.com/examples/dashboard) — use it as
      the visual + feature bar.
- [ ] Build a 1-page proof of concept: SPA shell → fetches
      `/api/v1/schema` → renders a single hardcoded table from a real
      cms-vercel API. Get this working before designing the rest.

References:
- React Admin: <https://marmelab.com/react-admin/>
- Refine: <https://refine.dev/>
- TanStack Table: <https://tanstack.com/table>
- TanStack Query: <https://tanstack.com/query>
- shadcn/ui: <https://ui.shadcn.com>
- Radix UI: <https://www.radix-ui.com>
- Tailwind: <https://tailwindcss.com>

---

## 13. Final note

C is the most exciting of the three proposals because it expands
cms-vercel from "a way to run existing CaseMaster apps" to "a
foundation for building polished admin software". But it's also the
most committing — six months and a real team, not a side project.

Recommend doing A and B first. They land actual UX wins for users
*today*. C builds on the API surface those teams will demand anyway
(particularly B's appetite for richer data → richer JSON contract).

If C ships, cms-vercel is no longer a CaseMaster compatibility layer.
It's a serious admin-app platform.
