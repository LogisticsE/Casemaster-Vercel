# Building a new CaseMaster app on cms-vercel

Greenfield guide. You have a fresh `my-cms-app` from
[`HOWTOLAUNCH.md`](./HOWTOLAUNCH.md) deployed on Vercel; this doc shows
how to actually fill in `.cms` files until it does something useful.

If you're porting an *existing* CaseMaster app, see
[`CONVERTING.md`](./CONVERTING.md) instead.

## Mental model

Your app is a directory of `.cms` files. Three categories matter:

| Folder           | Holds                                | Drives URL                         |
|------------------|--------------------------------------|------------------------------------|
| `app/bo/`        | Business Object declarations         | `/maintenance/<bo>` (auto-CRUD)   |
| `app/page/`      | Page handler functions               | `/page/<script>/f/<function>`      |
| `app/script/`    | Reusable functions, no URL of their own | (called from pages / other scripts) |

The runtime walks `app/` at startup, parses every `.cms` file, and
serves whatever functions and BOs it finds. Edit a file, refresh the
URL — change is live (no rebuild for `.cms`).

## Start with a Business Object

A BO declaration maps a `.cms` file to a Postgres table. Once it's
declared, you get auto-CRUD for free.

Create `app/bo/example/customer.cms`:

```cms
// One row per customer.
function main() return script.get('./main') end-function

resource main
    <@bo
        label:      'Customer',
        table:      'customer',
        primaryKey: 'id',
        deleteRule: deleteRule.Allowed,
        auditable:  auditing.None,
        attributes: <
            id:    <@bo/attribute label: 'ID',    column: 'id',    dataType: dataType.Long,   length: 9, optional: false()>,
            name:  <@bo/attribute label: 'Name',  column: 'name',  dataType: dataType.String, length: 200>,
            email: <@bo/attribute label: 'Email', column: 'email', dataType: dataType.String, length: 200>
        >,
        attributeGroups: <
            label: < 'name' >,
            list:  < 'name', 'email' >
        >
    >
end-resource
```

Make sure the matching SQL table exists in your Postgres. Quick way:

```sql
CREATE TABLE customer (
    id    BIGSERIAL    PRIMARY KEY,
    name  VARCHAR(200) NOT NULL,
    email VARCHAR(200)
);
```

Refresh `http://localhost:3000/maintenance/example/customer` — you have
a working CRUD UI: list, edit, create, delete. **Zero lines of UI code
written.**

## Now write a custom page

The auto-CRUD is good for admin tools. For user-facing pages you write
`page/` handlers. `app/page/customers.cms`:

```cms
// User-facing customer list — same data, different chrome.
function customers()
    set('main', page.get('./customersBody'))
    page.render(page.get('./shell'))
end-function

protected resource customersBody
    <@page/container
        content: <@page/content
            title: <@page/title label: 'Our customers'>,
            content: <@page/html resolveTemplate(
                `<p>Loading customers from Postgres…</p>
                 <ul>
                 {{[customerHtml]}}
                 </ul>`
            )>
        >
    >
end-resource

protected resource shell
    <@page/html resolveTemplate(
        `<!doctype html><html><head>
        <meta charset="utf-8"><title>Customers</title>
        <link rel="stylesheet" href="/static/css/app.css">
        </head><body>{{[main]}}</body></html>`
    )>
end-resource
```

That gives you the URL `http://localhost:3000/page/customers/f/customers`
(the function name `customers` repeated because the file is also named
`customers.cms`).

To actually render rows from the BO, build a string accumulator before
the resource is evaluated:

```cms
function customers()
    set('customerHtml', '')
    iterate iterator.ofEntity(
        entities: < <@iterator/entity name: 'c', entity: 'example/customer', orderBy: 'name'> >,
        rows: 100
    )
        set('customerHtml', concat([customerHtml],
            '<li>', bo.attr([c], 'name'), ' &mdash; ', bo.attr([c], 'email'), '</li>'
        ))
    end-iterate
    set('main', page.get('./customersBody'))
    page.render(page.get('./shell'))
end-function
```

Refresh — you see your customer rows.

## Adding scripts

`app/script/helpers.cms`:

```cms
// Format a person's name as "Lastname, Firstname".
function lastFirst(first, last)
    return concat([last], ', ', [first])
end-function

// Are we in a payday week?
function isPayday()
    return eq(format(today(), 'EEEE', 'EN'), 'Friday')
end-function
```

Call these from any page or BO via `script.call`:

```cms
set('display', script.call('./lastFirst', [firstName], [lastName]))
```

## Day-to-day cycle

```powershell
# 1. edit .cms files in app/
# 2. live preview
npx vercel dev
# 3. validate before deploying
node packages/runtime/bin/build.mjs --app ./app
# 4. ship
git add app/ ; git commit -m "feat: customer list page" ; git push
```

`git push` triggers an auto-deploy on Vercel (if you connected git per
HOWTOLAUNCH Option B). Otherwise `npx vercel --prod` ships manually.

## What's available

The full builtin reference is in
[`packages/runtime/API.md`](./packages/runtime/API.md). Highlights:

- **Control flow**: `set`, `if`, `iterate`, `return`, `script.call`
- **Strings**: `concat`, `formatString`, `replace`, `substring`, `lCase`/`uCase`
- **Numbers / dates**: `sum`, `mul`, `today`, `addDay`, `format`
- **DB read**: `iterator.ofEntity`, `bo.attr`, `sql.fetch`
- **DB write**: `bo.create` / `setAttr` / `persist` / `delete`, `sql.execute`
- **HTTP out**: `httpRequest.create`, `responseBody`
- **JSON / PB**: `json.parse`, `pb.get`, `pb.set`
- **Sessions**: `qualifier.call('session/cookie:authenticate')`,
  `session.get`, `session.set`
- **Pages**: `<@page/container>`, `<@page/content>`, `<@page/title>`,
  `<@page/html>`, `<@page/form>` (+ controls), `<@page/data/table>`,
  `<@page/sidebar>` (+ links), `<@page/icon>`, `<@url>`

Anything not on that list either doesn't work yet (see
[`UNSUPPORTED.md`](./UNSUPPORTED.md)) or hasn't been documented —
`cms-vercel-build` is the canonical way to find both.

## Where to go next

- Add more BOs and pages — same pattern as above.
- Wire authentication with `session.set` / `session.get` and
  `qualifier.call('session/cookie:authenticate')`.
- Schedule background work via `vercel.json`'s `crons` array.
- Read [`packages/runtime/MIGRATION.md`](./packages/runtime/MIGRATION.md)
  if you also want to bring in code from an existing CaseMaster project.
