# UI modernisation proposals

Two proposals for making CaseMaster apps look and feel like a 2026
admin product, **on both runtimes** — the official `.NET`
`CaseMaster.Web.exe` and `cms-vercel` — without forcing app authors
to rewrite their `.cms` source.

## Dual-runtime story in one paragraph

CaseMaster apps render plain HTML through two interchangeable runtimes
that emit near-identical markup (Bootstrap 4 + jQuery + Font Awesome).
Because the visual surface is "just HTML + CSS + JS hooks", a single
package can ship a CSS theme **and** a progressive-enhancement JS
layer that improve apps on **both** runtimes — only the integration
step (which `<link>`/`<script>` tag goes where) differs. The SPA
proposal is the one exception: it builds a JSON API, which means
either running cms-vercel as a sidecar against the .NET runtime, or
optionally writing a parallel C# adapter.

## The proposals

| Proposal | Who it's for | Effort | Repo (suggested) |
|---|---|---|---|
| [**A+B — `cms-ui` (combined theme + components)**](./AB-ui-package.md) | A frontend dev (or two, in parallel) | ~5 weeks total, ships in two phases | `cms-ui` |
| [**C — `cms-admin` SPA bridge**](./C-spa-bridge.md) | Small team (1 backend + 1 frontend) | 3-6 months | `cms-admin` + `cms-api-vercel` (+ optional `cms-api-dotnet`) |

The earlier separate "A — theme overlay" and "B — component layer"
drafts have been consolidated into a single `AB-ui-package.md`. The
visual and interactive improvements are designed against each other
(sort indicators, focus rings, loading states all share design
tokens) and ship as one product so users get a coherent experience
from one `npm install`.

## Recommended sequencing

1. **`cms-ui` Phase 1 (theme — 1 week)** — fastest visual lift on
   both runtimes. Ships as `@casemaster/ui@0.1`.
2. **`cms-ui` Phase 2 (enhancers — 3-4 weeks)** — sortable tables,
   autocomplete, keyboard shortcuts. Same package, ships as `0.2`.
3. **`cms-admin` (only if)** the long-term goal expands beyond
   "modernise CaseMaster apps" into "build a polished admin product
   on top." Strategic commitment, not tactical.

After Phase 1+2 you'll have real user feedback to inform whether C
is worth the larger investment.
