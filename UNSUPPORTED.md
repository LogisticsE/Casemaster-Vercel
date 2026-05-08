# Unsupported features

Living list of CaseMaster features that the cms-vercel runtime doesn't
implement (yet). The compiler/interpreter doesn't validate against this
list — a `.cms` file using one of these features will either fault at
runtime with `unimplemented call: <name>` or silently no-op. The build
validator (`cms-vercel-build`) reports the unimplemented calls in your
specific app.

Update this file whenever you add or remove a builtin.

## Currently runtime-faulting

These will throw `unimplemented call: …` at request time:

- `qs.getTrusted` — only the untrusted form is wired. (`qs.getUntrusted`
  works.)
- `request.headers.get(name)` style accessors — only
  `request.body / isPOST / isGET / isSameOrigin / url / urlBase / path`
  are exposed.
- `<@page/data/inlineMaintenance>` and rich form qualifiers
  (datepicker, select2-style autocomplete dropdowns) — port to the
  simpler `<@page/data/table>` + a hand-written `<@page/form>`.
- Anything else inside `<@page/...>` we haven't added a renderer for.
  Unknown tags emit `<!-- TODO render: <@…> -->` so they're greppable.
  Currently rendered: `container`, `content`, `title`, `html`, `form`,
  `form/control`, `form/row`, `form/col`, `input/text` and friends,
  `data/table`, `sidebar`, `sidebar/link`, `icon`, `table/link`,
  `<@url>`.

## Silently no-op or partial

These parse and don't throw, but behave differently from the official
runtime:

- `request.isSameOrigin()` — uses the Referer header, doesn't match the
  framework's stricter same-site check.
- `qs.isTrusted()` — always returns `false` (no CSRF token machinery).
- `_pb` PB literals — parsed but treated as opaque values; mutating PBs
  via `pb.set` works for plain JS objects only.
- `<@bo>` `foreignKey` — captured in the registry but not eager-loaded
  by the iterator (no JOIN'ing across BOs).

## What works (used to be on this list)

Recorded so the conversion guide is honest about coverage. Don't shy
away from these:

- **BO writes**: `bo.create`, `bo.setAttr`, `bo.persist`, `bo.delete`,
  `bo.quickLoad`, `bo.tryLoad`, `bo.count` (with `attributeGroups`).
- **Raw SQL**: `sql.execute`, `sql.fetch` (errors include the failing
  SQL when something blows up).
- **Predicate language**: `where: 'status="OPEN" | is_billed=0'` is
  translated to valid Postgres — double-quoted string literals,
  pipe-OR, ampersand-AND, plus boolean coercion for `is_*=0/1`.
- **Outbound HTTP**: `httpRequest.create` / `.responseBody` /
  `.responseStatus` — within Vercel's per-plan duration limit.
- **Sessions**: Postgres-backed via `cms_session`; cookie-based
  authentication via `qualifier.call('session/cookie:authenticate')`,
  `session.get/set`.
- **Multi-segment routing**: `/page/wms/inbound/f/main` with each page
  declaring its own `main()` and `mainView` resource without
  collisions.
- **`response.redirect('page:fn')`** — translated to a real URL.
- **`inherits 'base'`** — parsed, no-op. The runtime auto-wraps
  responses in a default Bootstrap-4 + jQuery + Font Awesome shell so
  pages that relied on the framework's `base` template still render.
- **Common builtins**: `dbl()`, `null()`, `true()`, `false()`,
  `_onError()`, `formatString`, `format`, `concat`, `replace`, `startsWith`,
  arithmetic + comparisons.

## Multipart / file uploads

`request.body()` returns the raw POST body. Form-urlencoded is parsed
into the query map. Multipart isn't parsed yet — file uploads should
go through a base64 hidden field for now (the existing QR-label
designer does this).

## Static assets

`/static/:path*` is rewritten to `/:path*` in vercel.json so URL
conventions match. The runtime's `runtime/static/` directory is *not*
auto-copied — drop the bits you need (custom CSS, images, …) into
`public/` manually. The default shell already loads Bootstrap 4,
jQuery, and Font Awesome from a CDN.

## Cron limits

Vercel Hobby allows daily cron entries only. Pro raises the cadence to
`*/4 * * * *`. The single cron in `vercel.json` is set to daily so the
default account works.

## Why a feature might be here forever

Some CaseMaster features don't translate to Vercel's serverless model
and won't be implemented:

- WebSocket / Server-Sent Events — Vercel functions are request-bound.
- Filesystem writes at request time (`fileSystem.writeFile`) — Vercel
  functions have a read-only filesystem.
- The CaseMaster IDE / Monaco / VS Code language layer — that's a
  developer tool, not a runtime feature.
