# Proposal A+B — `cms-ui`: combined theme + component package for both CaseMaster runtimes

**Goal**: take the existing CaseMaster-rendered HTML — currently a
plain Bootstrap 4 page — and make it look **and feel** like a modern
admin product on **both** the `.NET CaseMaster.Web.exe` runtime and
`cms-vercel`, in a single drop-in package. CSS modernises the visuals;
a small JS bundle progressively enhances static markup (sortable
tables, autocomplete dropdowns, datepickers, command palette,
keyboard shortcuts, inline edit). No `.cms` source changes. No
breaking changes to either runtime.

**Effort**: ~5 weeks total, one frontend developer (or two if the
phases run in parallel).

- Phase 1 (theme — CSS): ~1 week, ships as `@casemaster/ui@0.1`
- Phase 2 (enhancers — JS): ~3-4 weeks, ships as `@casemaster/ui@0.2`

**Repo**: new `cms-ui`, published to npm as `@casemaster/ui`. Both
runtimes gain a documented hook to load the CSS and JS bundles.

This proposal supersedes the earlier separate "A — theme" and
"B — component layer" drafts. They're consolidated here because the
visual and interactive improvements are designed against each other
and ship as one product.

---

## 1. Background — what we're modernising

### CaseMaster (the platform)

[CaseMaster](https://docs.casemaster.io/) is an enterprise web
application platform from 9 Knots Business Solutions. Apps are written
in a custom DSL — `.cms` files combining page handlers, business-object
(BO) declarations, scripts, and inline qualifiers. A typical app
layout:

```
my-casemaster-app/
├── bo/                    business object declarations
│   └── wms/inventory.cms
├── page/                  page handler functions
│   ├── index.cms
│   └── wms/inbound.cms
├── script/                shared utilities
│   └── wms/_layout.cms
├── qualifier/             custom <@…> qualifiers
└── runtime/               framework files (NOT user code)
```

A page file looks like:

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

### Two runtimes for the same `.cms` source

**Official `.NET` runtime** — `CaseMaster.Web.exe`. Windows-only.
Hosts apps from a Windows machine. Ships with Bootstrap 4, jQuery,
Font Awesome, Select2, FullCalendar, signature_pad, plus its own
`cm.js`/`app.js` / `cm.css`/`app.css`. The framework's HTML shell
lives in `runtime/page/base.cms`; static assets in `runtime/static/`.

**[`cms-vercel`](https://github.com/LadFoxTom/Casemaster-Vercel)** —
TypeScript reimplementation that runs as a single Vercel serverless
function. Same `.cms` language, same Postgres backend. Default HTML
shell ships Bootstrap 4 + jQuery + Font Awesome from CDN to match the
.NET runtime's stack.

### What's identical between the runtimes

The HTML markup. Both runtimes emit the same Bootstrap 4 classes
(`<table class="cms-table table table-sm table-striped table-bordered">`,
`<aside class="wms-sidebar">`, `<thead class='bg-primary text-light'>`,
`<select class="form-control">`). jQuery 3 is globally available on
both. **CSS or JS that targets one targets the other.** This is the
entire premise of the package.

### What differs

How you load assets:
- **.NET**: the framework's `runtime/page/base.cms` includes
  `static/css/app.css` and `static/js/app.js` at the bottom of every
  page. App authors append to those files to customise.
- **cms-vercel**: the runtime auto-wraps responses in a default shell
  whose `<head>` and `<body>` include hard-coded asset links. Adding
  one CSS link and one script tag is a one-line config knob.

### What feels dated

On both runtimes:
- Tables are static HTML — no sort, no search, no pagination control,
  no column show/hide.
- `<select>` is a browser-default dropdown (or, on .NET, a Select2
  dropdown for some inputs but not all). No consistent autocomplete.
- `<input type="date">` shows the browser's date input — fine in
  Chrome, ugly elsewhere.
- No optimistic mutations — every form submit is a full-page POST/redirect.
- No keyboard shortcuts (no `/` to focus search, no command palette).
- No loading states — between click and render, the page just blanks.
- Forms validate only on submit; no inline cues.
- Visual language is functional but unmistakably 2017 — small radii,
  flat shadows, harsh borders.

That's the gap `cms-ui` closes. CSS handles the look; JS handles the
feel; both ship as one package so apps see consistent improvements
without coordinating two versions.

---

## 2. What you're building

`@casemaster/ui` — a single npm package that exports two artefacts:

**`dist/ui.css`** (Phase 1, ~30 KB gz)
- Drop-in CSS bundle modernising every Bootstrap 4 component the
  CaseMaster runtimes emit.
- Design system in CSS variables (`--cms-primary`, `--cms-radius`,
  `--cms-font`, etc.) — per-app theming via overrides.
- Optional dark mode via `<html data-theme="dark">`.
- "Extras": empty states, loading skeletons, modern focus rings,
  animated transitions.

**`dist/ui.js`** (Phase 2, ~100 KB gz)
- Progressively enhances the rendered HTML on `DOMContentLoaded`.
- Detects what the runtime emitted and what's already enhanced
  (Select2 etc.) — never double-enhances or clobbers.
- Per-feature lazy loading; bundle splits into core + on-demand
  chunks.

The CSS and JS are designed to look right together (sort-indicator
arrows match the table thead colour; loading bars use `--cms-primary`;
toast notifications use the alert palette). They're released as one
package so this consistency is automatic.

### Visual targets

The combined output should feel comparable to:
- [Tabler](https://tabler.io)
- [shadcn/ui's Dashboard example](https://ui.shadcn.com/examples/dashboard)
- [Linear](https://linear.app) (for the keyboard-driven feel)
- [Material Dashboard](https://www.creative-tim.com/product/material-dashboard) (free version, BS-flavoured)

Bootswatch themes are a useful CSS starting point. Tom Select +
Flatpickr are the JS-side baselines.

### What absolutely must not change

The HTML the runtimes emit is a contract. **Do not** require runtime
markup changes for `cms-ui` to look or behave well. If a component
needs different markup, propose the runtime PR — but `cms-ui` itself
must degrade gracefully on the existing markup of both runtimes.

---

## 3. Configuration shape

Users opt in via a single config knob with three modes:

```ts
// cms-vercel — in api/index.ts
createHandler({ ui: 'pro' });                     // theme + enhancers (default "yes")
createHandler({ ui: 'theme-only' });              // CSS only, no JS
createHandler({ ui: 'enhancers-only' });          // JS only, no theme
createHandler({ ui: false });                     // neither (default)
createHandler({                                    // fine-grained
  ui: {
    theme: true,
    themeAccent: '#0066ff',
    enhancers: { tables: true, shortcuts: false }
  }
});
```

The `'pro'` value is the recommended default. The granular form is
for users who want to disable specific enhancers.

For .NET, the same shape applies via the `app.css` / `app.js`
inclusions described in §5. There's no config object — users just
include or omit the assets.

### Per-feature opt-out

Every JS enhancer can be disabled at runtime:

```html
<script>window.cmsUi = { tables: false };</script>
```

…or via a markup attribute on a specific element:

```html
<table class="cms-table" data-cms-no-enhance>...</table>
```

These two opt-out paths cover both "globally off" and "this one page
needs the legacy behaviour" cases.

---

## 4. Technical specification

### 4.1 Repo layout

```
cms-ui/
├── README.md
├── package.json
├── vite.config.ts          ESM bundle, tree-shaking, terser minify
├── postcss.config.js       autoprefixer, cssnano
├── src/
│   ├── theme/                          (Phase 1 — CSS)
│   │   ├── tokens.css                  CSS custom properties
│   │   ├── reset.css                   tiny reset on top of Bootstrap
│   │   ├── components/                 one file per component
│   │   │   ├── navbar.css
│   │   │   ├── sidebar.css
│   │   │   ├── tables.css
│   │   │   ├── forms.css
│   │   │   ├── buttons.css
│   │   │   ├── cards.css
│   │   │   ├── modals.css
│   │   │   ├── badges.css
│   │   │   ├── alerts.css
│   │   │   └── pagination.css
│   │   ├── extras.css                  empty states, transitions, skeletons
│   │   ├── dark.css                    [data-theme="dark"] overrides
│   │   └── index.css                   imports the above in order
│   ├── enhancers/                      (Phase 2 — JS)
│   │   ├── index.ts                    orchestrator
│   │   ├── tables.ts                   sort + filter + sticky + export + virtualize
│   │   ├── forms.ts                    Tom Select + Flatpickr
│   │   ├── confirm.ts                  [data-cms-confirm]
│   │   ├── loading.ts                  navigation spinner top bar
│   │   ├── toasts.ts                   JSON-header toast pop
│   │   ├── shortcuts.ts                /, g d, ?, Cmd+K
│   │   ├── modal-links.ts              [data-cms-modal-link]
│   │   ├── inline-edit.ts              [data-cms-inline-edit]
│   │   └── command.ts                  Cmd+K palette
│   └── lib/
│       ├── observer.ts                 mutation observer re-runs enhancers
│       ├── http.ts                     fetch wrapper that surfaces 4xx/5xx as toasts
│       ├── compat.ts                   detection helpers (Select2 present?)
│       └── shortcuts-map.ts            default key bindings
├── dist/                                generated artefacts
│   ├── ui.css            ~30 KB gz     full theme
│   ├── ui.css.min
│   ├── ui-dark.css.min                  optional dark stylesheet
│   ├── ui.js             ~100 KB gz    enhancers entry
│   ├── ui.js.map
│   └── chunks/                          lazy-loaded per-feature
├── examples/
│   ├── before-vercel.html               WMS dashboard captured from cms-vercel
│   ├── before-dotnet.html               same from CaseMaster.Web.exe
│   ├── after-vercel.html                same markup with cms-ui linked
│   └── after-dotnet.html
├── integrations/
│   ├── vercel/README.md                 cms-vercel one-pager
│   └── dotnet/README.md                 .NET runtime one-pager
└── test/
    ├── unit/                            Vitest — sort algos, CSV escape, shortcut chord
    ├── integration/                     Playwright vs cms-vercel + .NET
    └── visual/                          screenshot regression
```

### 4.2 Dependencies

Pinned. Ship in the bundle, no runtime npm install for end users.

| Package | Purpose | Size (gz) |
|---|---|---|
| [`tom-select`](https://tom-select.js.org/) | enhanced select | ~16 KB |
| [`flatpickr`](https://flatpickr.js.org/) | datepicker | ~20 KB |
| [`alpinejs`](https://alpinejs.dev/) | reactive primitives for inline edit & command palette | ~14 KB |

No jQuery dependency — both runtimes ship jQuery already, but staying
off it keeps the package light and migration-safe.

### 4.3 The CSS design system (`src/theme/tokens.css`)

Single source of truth that every component file pulls from. Override
in app code to retheme.

```css
:root {
  /* Brand */
  --cms-primary:        #2563eb;
  --cms-primary-hover:  #1d4ed8;
  --cms-primary-active: #1e40af;
  --cms-success:        #16a34a;
  --cms-warning:        #f59e0b;
  --cms-danger:         #dc2626;
  --cms-info:           #0891b2;

  /* Neutrals */
  --cms-bg:             #f8fafc;
  --cms-surface:        #ffffff;
  --cms-border:         #e2e8f0;
  --cms-text:           #0f172a;
  --cms-text-muted:     #64748b;

  /* Type */
  --cms-font:      ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --cms-font-mono: ui-monospace, "JetBrains Mono", "Fira Code", monospace;

  /* Geometry */
  --cms-radius:    8px;
  --cms-radius-sm: 4px;
  --cms-radius-lg: 14px;

  /* Shadow */
  --cms-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --cms-shadow:    0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -1px rgb(0 0 0 / 0.04);
  --cms-shadow-lg: 0 12px 28px -8px rgb(0 0 0 / 0.18);

  /* Animation */
  --cms-ease: cubic-bezier(.4, 0, .2, 1);
  --cms-dur:  160ms;
}

[data-theme="dark"] {
  --cms-bg:        #0f172a;
  --cms-surface:   #1e293b;
  --cms-border:    #334155;
  --cms-text:      #f1f5f9;
  --cms-text-muted:#94a3b8;
}
```

### 4.4 Per-component CSS rules (representative)

**Tables** — both runtimes emit the same shell, plus we add the
sortable-header indicator hook from Phase 2:

```css
.cms-table {
  background: var(--cms-surface);
  border: 1px solid var(--cms-border);
  border-radius: var(--cms-radius);
  overflow: hidden;
  box-shadow: var(--cms-shadow-sm);
  border-collapse: separate;
  border-spacing: 0;
}
.cms-table thead.bg-primary {
  background: linear-gradient(180deg, var(--cms-primary), var(--cms-primary-hover)) !important;
}
.cms-table thead th {
  font-weight: 600;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.75rem 1rem;
  border: none;
  cursor: pointer;
  position: relative;
}
/* Sort indicator — set by enhancers/tables.ts via data-cms-sort attribute */
.cms-table thead th[data-cms-sort="asc"]::after  { content: " ▲"; opacity: 0.7; }
.cms-table thead th[data-cms-sort="desc"]::after { content: " ▼"; opacity: 0.7; }
.cms-table tbody td   { padding: 0.65rem 1rem; border-top: 1px solid var(--cms-border); }
.cms-table tbody tr:hover { background: rgb(37 99 235 / 0.04); }
.cms-table thead     { position: sticky; top: 0; z-index: 10; }
```

The CSS *and* the JS use the same `data-cms-sort` attribute as a
hand-off point. That coupling is exactly why they ship together.

**Cards, buttons, sidebar, empty states** — see the detailed examples
in the original A draft (preserved in git history). Same patterns.

### 4.5 The JS entry point — `src/enhancers/index.ts`

```ts
import { enhanceTables }   from './tables.js';
import { enhanceForms }    from './forms.js';
import { wireConfirms }    from './confirm.js';
import { wireLoading }     from './loading.js';
import { wireToasts }      from './toasts.js';
import { wireShortcuts }   from './shortcuts.js';
import { wireModalLinks }  from './modal-links.js';
import { wireInlineEdit }  from './inline-edit.js';

const cfg = (window as any).cmsUi ?? {};
const on  = (k: string) => cfg[k] !== false;       // default-on opt-out

document.addEventListener('DOMContentLoaded', () => {
  if (on('tables'))     enhanceTables(document, cfg.tables);
  if (on('forms'))      enhanceForms(document, cfg.forms);
  if (on('confirm'))    wireConfirms(document);
  if (on('loading'))    wireLoading(document);
  if (on('toasts'))     wireToasts();
  if (on('shortcuts'))  wireShortcuts(cfg.shortcuts);
  if (on('modalLinks')) wireModalLinks(document);
  if (on('inlineEdit')) wireInlineEdit(document);

  // Re-run enhancers when DOM changes (modal-links inject new content).
  new MutationObserver(muts => {
    for (const m of muts) m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      const el = n as Element;
      if (on('tables'))     enhanceTables(el, cfg.tables);
      if (on('forms'))      enhanceForms(el, cfg.forms);
      if (on('confirm'))    wireConfirms(el);
      if (on('loading'))    wireLoading(el);
      if (on('modalLinks')) wireModalLinks(el);
      if (on('inlineEdit')) wireInlineEdit(el);
    });
  }).observe(document.body, { childList: true, subtree: true });
});
```

### 4.6 Tables enhancer (the biggest single win)

Detect every `<table class="cms-table">` and add a toolbar (search +
column toggle + CSV export) plus sortable headers. Reuse the
`data-cms-sort` attribute the CSS already styles.

```ts
// src/enhancers/tables.ts
export function enhanceTables(root: ParentNode) {
  for (const t of root.querySelectorAll<HTMLTableElement>(
    'table.cms-table:not([data-cms-enhanced]):not([data-cms-no-enhance])'
  )) {
    if ((t.tBodies[0]?.rows.length ?? 0) < 2) continue;
    t.dataset.cmsEnhanced = '1';

    addToolbar(t);
    makeHeadersSortable(t);
    if (t.tBodies[0].rows.length > 200) virtualize(t);
  }
}
```

(Full implementation: see the dedicated enhancer file. Toolbar adds a
filter input, column-toggle popover, CSV export. Sort sets
`data-cms-sort` on the clicked header — CSS draws the arrow.)

### 4.7 Forms enhancer with .NET coexistence

The .NET runtime ships Select2; we must not double-enhance:

```ts
// src/enhancers/forms.ts
import TomSelect from 'tom-select';

export function enhanceForms(root: ParentNode) {
  for (const sel of root.querySelectorAll<HTMLSelectElement>(
    'select.form-control:not([data-cms-enhanced]):not(.select2-hidden-accessible):not([data-cms-no-enhance])'
  )) {
    const tooBig = sel.options.length > 8;
    const flagged = sel.matches('[data-cms-search]');
    if (!tooBig && !flagged) continue;
    sel.dataset.cmsEnhanced = '1';
    new TomSelect(sel, {
      maxOptions: 1000, create: false, hidePlaceholder: true,
      plugins: sel.multiple ? ['remove_button'] : [],
    });
  }

  for (const inp of root.querySelectorAll<HTMLInputElement>(
    'input[type=date], input[type=datetime-local], input[data-cms-date]:not([data-cms-enhanced])'
  )) {
    inp.dataset.cmsEnhanced = '1';
    flatpickr(inp, {
      enableTime: inp.type === 'datetime-local',
      dateFormat: inp.type === 'datetime-local' ? 'Y-m-d H:i' : 'Y-m-d',
      weekNumbers: true, altInput: true,
    });
  }
}
```

The `:not(.select2-hidden-accessible)` filter is the key .NET-runtime
coexistence hook: when Select2 wraps a select, it adds that class. We
skip those — the framework's existing UX wins.

### 4.8 Loading bar, shortcuts, toasts, inline edit

(Implementations preserved from the original B draft. They're
independent of which runtime serves the page; they only depend on
standard DOM events.)

---

## 5. Integration paths

### 5.1 cms-vercel

A single PR to cms-vercel adds the config option:

**`packages/runtime/src/handler.ts`** — extend `CreateHandlerOptions`:

```ts
export interface CreateHandlerOptions {
  appDir?: string;
  loaderHook?: (reg: AppRegistry) => void;
  onError?: (e: unknown, req: VercelRequest, res: VercelResponse) => void;

  /** Visual + interactive UI package. */
  ui?: false | 'pro' | 'theme-only' | 'enhancers-only' | UiOpts;
}
interface UiOpts {
  theme?: boolean | string;        // boolean = on/off, string = custom CSS URL
  themeAccent?: string;
  enhancers?: boolean | Record<string, boolean>;
}
```

Inside `wrapInDefaultShell(body, opts)`:

```ts
const ui = normaliseUiOpts(opts.ui);
const themeLink = ui.theme
  ? `<link rel="stylesheet" href="${typeof ui.theme === 'string' ? ui.theme : 'https://cdn.jsdelivr.net/npm/@casemaster/ui@latest/dist/ui.min.css'}">`
  : '';
const accentVar = ui.themeAccent ? `<style>:root{--cms-primary:${ui.themeAccent}}</style>` : '';
const enhancerScript = ui.enhancers ? `
  <script>window.cmsUi = ${JSON.stringify(typeof ui.enhancers === 'object' ? ui.enhancers : {})};</script>
  <script type="module" src="https://cdn.jsdelivr.net/npm/@casemaster/ui@latest/dist/ui.min.js"></script>` : '';
```

Slot `themeLink` + `accentVar` in `<head>`; `enhancerScript` just
before `</body>`.

App author then enables in `api/index.ts`:

```ts
import { createHandler } from 'cms-vercel';
export default createHandler({ ui: 'pro' });
```

That's it. ~25 lines of runtime change, one config line per app.

### 5.2 .NET runtime (`CaseMaster.Web.exe`)

The .NET runtime's HTML shell already loads `static/css/app.css` and
`static/js/app.js` on every page. App authors customise via those
files — no framework patching, no `base.cms` modification.

#### Recommended path: vendored static files + `app.css` / `app.js` hooks

1. Drop the bundled artefacts into the framework's static-asset tree:

```
C:\Casemaster-WMS\runtime\static\lib\cms-ui\ui.css
C:\Casemaster-WMS\runtime\static\lib\cms-ui\ui.js
```

(Either copied at deploy time via `npm install @casemaster/ui` + a
PowerShell copy script, or vendored once into the app's repo.)

2. In the app's existing `static/css/app.css`:

```css
@import url('/static/lib/cms-ui/ui.css');
```

3. In the app's existing `static/js/app.js`:

```js
(function() {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = '/static/lib/cms-ui/ui.js';
  document.body.appendChild(s);
})();
```

That's the full integration. Survives `git pull` of the framework.
Per-app theming via `--cms-primary` overrides at the top of `app.css`.

#### Alternative: CDN reference (zero install)

```css
/* app.css */
@import url('https://cdn.jsdelivr.net/npm/@casemaster/ui@1/dist/ui.min.css');
```

```js
/* app.js */
const s = document.createElement('script');
s.type = 'module';
s.src = 'https://cdn.jsdelivr.net/npm/@casemaster/ui@1/dist/ui.min.js';
document.body.appendChild(s);
```

Requires the Windows host machine to have outbound HTTPS at request
time. Simpler for prototypes; for production prefer vendored.

#### Coexistence with the .NET stack's own scripts

The .NET runtime loads its assets in this order at the bottom of
`<body>`:

```
jquery.min.js          ← framework
select2.min.js          ← framework
bootstrap.bundle.min.js ← framework
cm.js                   ← framework
app.js                  ← app override (where we hook in)
```

`cms-ui/ui.js` is loaded last via the `app.js` snippet above. By the
time we scan the DOM, Select2 has already wrapped its targets — we
see `.select2-hidden-accessible` and skip them. No conflicts.

### 5.3 Distribution / versioning

- npm package: `@casemaster/ui`
- SemVer; major bumps only on contract-breaking class assumptions.
- CDN: jsdelivr auto-mirrors —
  `cdn.jsdelivr.net/npm/@casemaster/ui@1/dist/...`
- Phase 1 ships as `0.1.x` (CSS only; `dist/ui.js` exists but is empty).
- Phase 2 ships as `0.2.x` (CSS + enhancers).
- 1.0 cuts after the WMS demo lands cleanly on both runtimes.

---

## 6. Implementation plan

### Phase 1 — Theme (1 week)

**Day 1 — Setup & baselines**
- Repo + npm package skeleton + build pipeline (Vite + PostCSS + cssnano).
- `examples/`: capture HTML from BOTH runtimes by hitting WMS pages
  via curl/Invoke-WebRequest. These are the visual regression targets.
- Playwright harness: three screenshots per page (light, dark, mobile)
  on both runtimes.

**Day 2-3 — Tokens + core components**
- `tokens.css` finalised.
- `tables.css`, `cards.css`, `buttons.css`, `forms.css`. Iterate
  against both runtimes' WMS dashboards; visual delta near zero.

**Day 4 — Sidebar, navbar, layout**
- `navbar.css`, `sidebar.css`. WMS sidebar feels like Tabler/Linear.

**Day 5 — Polish + dark mode**
- `extras.css`: empty states, transitions, focus rings, scrollbars.
- `dark.css`: complete dark-mode coverage.
- Theme-switcher snippet (5 lines of inline JS).

**Day 6 — Runtime integrations + docs**
- cms-vercel PR adding the `ui` option.
- `.NET` walkthrough (no framework changes — just `app.css` recipe).
- README: visual before/after, all CSS variable names, dark-mode setup.
- Publish `@casemaster/ui@0.1.0`.

**Day 7 — Validation**
- Side-by-side WMS rendering on both runtimes. Capture screenshots.
- Visual regression suite green on three reference apps.
- Buffer for fixes.

### Phase 2 — Enhancers (3-4 weeks)

**Week 1 — foundation**
- `tables.ts`: sort + filter + sticky thead + CSV export. Verify
  identical behaviour on both runtimes.
- Wire the `enhancers` half of the cms-vercel PR.

**Week 2 — forms + loading**
- `forms.ts`: Tom Select + Flatpickr with .NET coexistence.
- `loading.ts`: top-bar progress on link click and form submit.
- `confirm.ts`: `[data-cms-confirm]` modal.
- Toast notification primitive.

**Week 3 — interactivity polish**
- `shortcuts.ts`: `/`, `g d`, `?`, `Cmd+K` palette.
- `modal-links.ts`: open detail pages in modals.
- Mutation observer wiring.

**Week 4 — inline edit + production**
- `inline-edit.ts`: click-to-edit cells via Alpine.
- Bundle-size audit, lazy-load each enhancer when first matched.
- Visual + interaction regression suite running against both runtimes.
- Docs + examples site.
- Publish `@casemaster/ui@0.2.0`.

### Phase ordering rationale

Phase 1 (CSS) ships first because:
- Gives an immediate visual lift on both runtimes — users see the
  payoff in week 1.
- De-risks the runtime integration on both targets before adding
  more moving parts.
- The CSS design system establishes the variables that Phase 2's
  components reference.

Phase 2 piggy-backs on the same repo, same package, same integration
hooks. Users get the upgrade by bumping `@casemaster/ui` to `0.2`.

---

## 7. Testing strategy

### Unit (Vitest)
- Sort algorithm cases (numeric, string, mixed, dates, nulls).
- CSV export quote-escaping.
- Shortcut chord detection.
- Coexistence-detection helpers (Select2 present? Already-enhanced flag?).

### Integration (Playwright against real backends)

Two CI targets:
1. **cms-vercel** booted locally (`vercel dev` against a checkout).
2. **CaseMaster.Web.exe** booted in a Windows runner.

For each, the suite verifies:
- WMS dashboard renders without console errors.
- Click a sortable header → rows reorder.
- Type in filter → non-matching rows hide.
- 100-option `<select>` → Tom Select renders (cms-vercel) /
  Select2 stays (.NET; we skip).
- Press `/` → search input gains focus.
- Press `Cmd+K` → command palette opens.

### Visual regression
- Per-page screenshots at 1440×900, 768×1024, 375×667.
- Capture from BOTH runtimes; identical (within tolerance) is a hard
  gate.
- Snapshots in repo. `--update-snapshots` for intentional changes.

### Accessibility
- axe-core integration. Zero serious violations on enhanced markup.
- Keyboard-only navigation works end to end.
- `prefers-reduced-motion` respected for every animation.
- Focus visible on every interactive element (the theme makes this
  explicit; the enhancers preserve it).

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| App ships its own conflicting CSS | All `--cms-*` variables; low-specificity selectors; avoid `!important` except where Bootstrap forces it. |
| .NET runtime emits markup that differs from cms-vercel | Capture both in `examples/`; CI runs visual regression against both. Any divergence is a hard gate. |
| .NET's Select2 / FullCalendar / signature_pad conflict with our enhancers | All enhancers idempotent; `data-cms-enhanced` flag; explicit `.select2-hidden-accessible` exclusion. CI tests on the .NET target catch regressions. |
| Bundle size creep | Per-enhancer tree-shaking; lazy-load Tom Select / Flatpickr only when matched. Hard budgets: 30 KB CSS gz, 100 KB JS gz. |
| Bootstrap 4 patches break if either runtime upgrades to BS5 | Pin against BS4. If/when one runtime jumps, ship a parallel `cms-ui-bs5` track. |
| .NET app's framework gets `git pull`'d and breaks integration | Recommend `app.css` / `app.js` approach (§5.2 option 1) — survives framework updates. |
| Pages bypass the default shell (`inherits 'base'` apps with custom shells) | Document a one-liner `<link>` + `<script>` for app-side shells. |
| Theme tokens drift from any future SPA package (Proposal C) | C consumes the same `--cms-*` variables — design system is the single source of truth across all UI packages. |
| Mutation observer thrash | Debounce; ignore subtree changes inside elements already enhanced. |
| User wants to disable just one enhancer | Per-feature flag in `window.cmsUi`. Documented. |

---

## 9. Success criteria

The 5-minute demo is the bar:

1. Boot the WMS app on **CaseMaster.Web.exe**. Take a screenshot of
   the dashboard.
2. Boot the same WMS on **cms-vercel**. Take a screenshot.
3. Add `@casemaster/ui` (CSS + JS) on both. Refresh.
4. Take a second screenshot of each.
5. Side by side: post-`cms-ui` screenshots should look noticeably
   more modern than pre, AND look essentially identical between the
   two runtimes.
6. Click a sortable column on either runtime — rows reorder.
7. Press `Cmd+K` — palette opens.

Plus measurable:

- CSS bundle ≤ 30 KB min+gz; JS bundle ≤ 100 KB min+gz.
- Lighthouse perf score not worse by more than 5 points (vs. baseline
  on either runtime).
- axe-core: zero serious violations.
- Visual regression suite green on three reference apps × two runtimes.
- No regressions on .NET runtime's existing Select2/datepicker behaviour.

---

## 10. Out of scope

These belong to [Proposal C](./C-spa-bridge.md) — the SPA bridge:

- React/Vue/Svelte SPA.
- Drag-drop dashboard editor.
- Real-time pages (SSE, websockets).
- Optimistic mutations across page navigations.
- Per-tenant visual customisation (beyond CSS variable overrides).
- Mobile-first re-layouts.

Also out of scope for `cms-ui`:

- Modifying the .NET framework's `runtime/static/lib/...` bundles —
  we live alongside, not inside.
- Replacing existing rendering — we're additive only.

If the developer finds themselves wanting full client-side routing
or a JSON API, that's a sign the problem belongs to Proposal C. Stop
and flag it.

---

## 11. Onboarding checklist for the developer

Before touching code:

- [ ] Read this whole document.
- [ ] Read [`README.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/README.md), [`HOWTOLAUNCH.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/HOWTOLAUNCH.md), [`CONVERTING.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/CONVERTING.md), [`packages/runtime/API.md`](https://github.com/LadFoxTom/Casemaster-Vercel/blob/main/packages/runtime/API.md) in cms-vercel.
- [ ] Get a cms-vercel WMS instance running. Click around. Note the
      visual + interactive gaps.
- [ ] Get a CaseMaster.Web.exe instance running with the same app.
      Click the same pages. Note what's the SAME (vast majority) and
      what differs.
- [ ] Inspect element on a page from each runtime. Compare class
      names — they're near-identical, that's our target surface.
- [ ] Read Tom Select docs, Flatpickr's options page, AlpineJS basics.
- [ ] Look at Tabler / shadcn dashboard / Linear for the visual + UX
      bar.

References:
- Bootstrap 4 docs: <https://getbootstrap.com/docs/4.6/>
- Bootswatch (drop-in BS4 themes): <https://bootswatch.com>
- Tabler (visual reference): <https://tabler.io>
- Tom Select: <https://tom-select.js.org/>
- Flatpickr: <https://flatpickr.js.org/>
- AlpineJS: <https://alpinejs.dev/>
- shadcn/ui Dashboard example: <https://ui.shadcn.com/examples/dashboard>
- Linear (keyboard-driven UX): <https://linear.app>

---

## 12. Final note

`cms-ui` is the smallest unit of "make CaseMaster look modern" that
makes sense to ship. Combining theme + enhancers in one package means
users get a complete experience from one `npm install`, designers
work against one source of truth, and the CSS-JS handoffs (sort
arrows, focus rings, loading states) stay coherent across versions.

If the visual lift from Phase 1 alone is enough, users stay on `0.1`
and don't pay the JS bundle cost. If they want the full experience,
they bump to `0.2` — same package, same config, same integration.

This is the foundation Proposal C builds on: the same `--cms-*`
variables, the same component conventions, the same opinionated look.
Whether or not C ever ships, `cms-ui` justifies itself in week one.
