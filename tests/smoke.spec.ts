import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { lex } from 'cms-vercel';
import { parse } from 'cms-vercel';
import { loadApp } from 'cms-vercel';
import { callFunction, Ctx } from 'cms-vercel';

describe('lexer', () => {
  it('tokenises a simple set call', () => {
    const t = lex(`set('x', 1)`, 'test.cms');
    expect(t.map(x => x.kind)).toEqual(['IDENT','LPAREN','STR','COMMA','NUM','RPAREN','EOF']);
  });

  it('tokenises end-function as a single keyword', () => {
    const t = lex(`function ping()\nend-function`, 'test.cms');
    expect(t.find(x => x.kind === 'KW_END_FUNCTION')).toBeDefined();
  });

  it('preserves backticked template strings', () => {
    const t = lex('`hello {{x}} world`', 'test.cms');
    expect(t[0]!.kind).toBe('TBSTR');
    expect(t[0]!.value).toBe('hello {{x}} world');
  });
});

describe('parser', () => {
  it('parses a single function with set + return', () => {
    const src = `function f()
        set('x', 1)
        return [x]
    end-function`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.funcs.length).toBe(1);
    expect(parsed.funcs[0]!.name).toBe('f');
    expect(parsed.funcs[0]!.body.length).toBe(2);
    expect(parsed.funcs[0]!.body[0]!.kind).toBe('Set');
    expect(parsed.funcs[0]!.body[1]!.kind).toBe('Return');
  });

  it('parses iterate iterator.ofEntity with multi-segment qualifier path', () => {
    const src = `function f()
        iterate iterator.ofEntity(
            entities: < <@iterator/entity name: 'tt', entity: 'qr/labelTemplate', orderBy: 'id'> >,
            rows: 1
        )
            set('n', 1)
        end-iterate
    end-function`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.funcs.length).toBe(1);
    expect(parsed.funcs[0]!.body[0]!.kind).toBe('Iterate');
  });

  it('parses protected resource blocks', () => {
    const src = `protected resource shell
        <@page/html `+'`<!doctype html><body>{{[main]}}</body>`'+`>
    end-resource`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.resources.length).toBe(1);
    expect(parsed.resources[0]!.name).toBe('shell');
  });
});

describe('Phase 3 — BO registry', () => {
  it('extracts a BO declaration from a parsed resource', async () => {
    // Self-contained test — no dependency on app/bo/* contents.
    const cms = await import('cms-vercel');
    const src = `function main() return script.get('./main') end-function
      protected resource main
        <@bo
          label: 'Demo items',
          table: 'demo_items',
          primaryKey: 'id',
          attributes: <
            id:    <@bo/attribute label: 'ID',   column: 'id',   dataType: dataType.Long,   length: 9>,
            name:  <@bo/attribute label: 'Name', column: 'name', dataType: dataType.String, length: 80>
          >,
          attributeGroups: <
            list: < 'name' >
          >
        >
      end-resource`;
    const parsed = cms.parse(cms.lex(src, 'demo.cms'), 'demo.cms');
    const main = parsed.resources.find(r => r.name === 'main')!;
    expect(main).toBeDefined();
    const info = cms.tryExtractBo('demo/items', main)!;
    expect(info).toBeDefined();
    expect(info.table).toBe('demo_items');
    expect(info.primaryKey).toBe('id');
    expect(info.attributes.has('name')).toBe(true);
    expect(info.listGroup).toEqual(['name']);
  });
});

describe('Phase 4 — function calls', () => {
  it('script.call invokes a same-file function and propagates the return value', async () => {
    const src = `function entry()
        return script.call('./helper', 7, 'x')
    end-function
    function helper(a, b)
        return concat([b], '=', formatString('{0}', sum([a], 1)))
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    // Re-parse our snippet on top of the existing registry
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    const result = await callFunction(ctx, 'entry');
    expect(result).toBe('x=8');
  });
});

describe('compileWhere — CaseMaster predicate syntax', () => {
  it('converts double-quoted string literals to single-quoted SQL', async () => {
    const { compileWhere } = await import('cms-vercel');
    expect(compileWhere('status="OPEN"')).toBe("status='OPEN'");
  });
  it('translates | to OR and & to AND', async () => {
    const { compileWhere } = await import('cms-vercel');
    expect(compileWhere('status="OPEN" | status="DRAFT"'))
      .toBe("status='OPEN'  OR  status='DRAFT'");
    expect(compileWhere('task_type="PICK" & (status="OPEN" | status="ASSIGNED")'))
      .toBe("task_type='PICK'  AND  (status='OPEN'  OR  status='ASSIGNED')");
  });
  it('passes numeric comparisons through unchanged', async () => {
    const { compileWhere } = await import('cms-vercel');
    expect(compileWhere('qty>10')).toBe('qty>10');
    expect(compileWhere('qty>10 & active=2')).toBe('qty>10  AND  active=2');
  });
  it('escapes single quotes inside double-quoted values', async () => {
    const { compileWhere } = await import('cms-vercel');
    expect(compileWhere(`name="O'Brien"`)).toBe("name='O''Brien'");
  });
  it('coerces is_x=0/=1 to FALSE/TRUE when BO declares dataType.Boolean', async () => {
    const { compileWhere } = await import('cms-vercel');
    const info = {
      name: 'demo', table: 'demo', primaryKey: 'id',
      attributes: new Map([
        ['is_billed', { column: 'is_billed', dataType: 'dataType.Boolean' }],
        ['qty',       { column: 'qty',       dataType: 'dataType.Long'    }],
      ]),
      listGroup: [],
    };
    expect(compileWhere('is_billed=0', info)).toBe('is_billed=FALSE');
    expect(compileWhere('is_billed=1', info)).toBe('is_billed=TRUE');
    // qty=0 must NOT be coerced — qty is an integer column.
    expect(compileWhere('qty=0', info)).toBe('qty=0');
  });
  it('falls back to is_/has_/can_ name heuristic when no schema is given', async () => {
    const { compileWhere } = await import('cms-vercel');
    expect(compileWhere('is_billed=0')).toBe('is_billed=FALSE');
    expect(compileWhere('has_serial=1')).toBe('has_serial=TRUE');
    expect(compileWhere('can_pick=0')).toBe('can_pick=FALSE');
    // A column without the boolean prefix stays integer.
    expect(compileWhere('qty=0')).toBe('qty=0');
  });
});

describe('response.redirect URL translation', () => {
  it('translates "page:fn" CaseMaster syntax to /page/<path>/f/<fn>', async () => {
    const cms = await import('cms-vercel');
    const reg = loadApp(join(process.cwd(), 'app'));
    const src = `function entry()
        response.redirect('wms:main')
    end-function`;
    const parsed = cms.parse(cms.lex(src, 'page/index.cms'), 'page/index.cms');
    for (const fn of parsed.funcs) {
      reg.funcs.set(`page/index:${fn.name}`, fn);
      reg.funcs.set(fn.name, fn);
    }
    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      currentPage: 'page/index',
      req: { method:'GET', url:'/page/index', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'page/index:entry');
    expect(ctx.res.redirect).toBe('/page/wms/f/main');
    expect(ctx.res.status).toBe(302);
  });

  it('passes absolute paths through unchanged', async () => {
    const cms = await import('cms-vercel');
    const reg = loadApp(join(process.cwd(), 'app'));
    const src = `function entry()
        response.redirect('/login')
    end-function`;
    const parsed = cms.parse(cms.lex(src, 'page/x.cms'), 'page/x.cms');
    for (const fn of parsed.funcs) {
      reg.funcs.set(`page/x:${fn.name}`, fn);
      reg.funcs.set(fn.name, fn);
    }
    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      currentPage: 'page/x',
      req: { method:'GET', url:'/page/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'page/x:entry');
    expect(ctx.res.redirect).toBe('/login');
  });
});

describe('multi-segment page routing', () => {
  it('two pages at different paths can both define main() without colliding', async () => {
    // Simulate the WMS-style tree: app/page/wms/inventory.cms and
    // app/page/wms/shipment.cms each with a main() that returns its own
    // marker. Without page-scoped function keys these would clobber.
    const cms = await import('cms-vercel');
    const reg = loadApp(join(process.cwd(), 'app'));

    const inv = cms.parse(cms.lex(`function main() return 'inv-main' end-function`, 'page/wms/inventory.cms'), 'page/wms/inventory.cms');
    for (const fn of inv.funcs) {
      reg.funcs.set(`page/wms/inventory:${fn.name}`, fn);
      reg.funcs.set(fn.name, fn);
    }

    const ship = cms.parse(cms.lex(`function main() return 'ship-main' end-function`, 'page/wms/shipment.cms'), 'page/wms/shipment.cms');
    for (const fn of ship.funcs) {
      reg.funcs.set(`page/wms/shipment:${fn.name}`, fn);
      reg.funcs.set(fn.name, fn);
    }

    // currentPage on the request scopes the unqualified `main` lookup.
    const inventoryCtx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      currentPage: 'page/wms/inventory',
      req: { method:'GET', url:'/page/wms/inventory', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    const shipmentCtx: Ctx = {
      ...inventoryCtx, currentPage: 'page/wms/shipment',
    };

    expect(await callFunction(inventoryCtx, 'page/wms/inventory:main')).toBe('inv-main');
    expect(await callFunction(shipmentCtx, 'page/wms/shipment:main')).toBe('ship-main');
  });
});

describe('Phase 5 — standard library', () => {
  it('today/format/addDay round-trip', async () => {
    const src = `function entry()
        set('t', addDay(today(), -1))
        return format([t], 'yyyy/MM/dd')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    const out = String(await callFunction(ctx, 'entry'));
    // Yesterday in YYYY/MM/DD form
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });
});

describe('Phase 6 — request introspection', () => {
  it('request.isPOST + qs.getUntrusted reads form-urlencoded body', async () => {
    const src = `function entry()
        return concat(
          if(request.isPOST(), 'POST', 'GET'),
          ':',
          qs.getUntrusted('name')
        )
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'POST', url:'/x', query:{ name:'Alice' }, body:'name=Alice', headers:{ 'content-type':'application/x-www-form-urlencoded' } },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    expect(await callFunction(ctx, 'entry')).toBe('POST:Alice');
  });
});

describe('Phase 18 — real auth', () => {
  it('qualifier.call(session/cookie:authenticate) returns false when no cookie present', async () => {
    const src = `function entry()
        return qualifier.call('session/cookie:authenticate')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'', headers: {} },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    // No cmsv_sid cookie → not authenticated.
    expect(await callFunction(ctx, 'entry')).toBe(false);
  });

  it('session.set marks the session dirty', async () => {
    const src = `function entry()
        session.set('user', 'alice')
        return session.get('user')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    expect(await callFunction(ctx, 'entry')).toBe('alice');
    expect(ctx.sessionDirty).toBe(true);
  });
});

describe('Phase 19 — page qualifiers', () => {
  it('renders @page/form + @page/form/control + @page/input/text', async () => {
    const src = `function entry()
        page.render(<@page/form
            method: 'POST',
            action: '/page/foo/f/save',
            content: <@page/form/control
                label: 'Your name',
                input: <@page/input/text name: 'name', value: ''>
            >
        >)
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'entry');
    expect(ctx.res.body).toContain('<form method="POST"');
    expect(ctx.res.body).toContain('action="/page/foo/f/save"');
    expect(ctx.res.body).toContain('<input type="text" name="name"');
    expect(ctx.res.body).toContain('Your name');
  });

  it('renders @page/sidebar/link with active state', async () => {
    const src = `function entry()
        page.render(<@page/sidebar/link
            label: 'Home', url: '/', active: true
        >)
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'entry');
    expect(ctx.res.body).toContain('class="cms-sidebar-link active"');
    expect(ctx.res.body).toContain('href="/"');
  });
});

describe('welcome.cms (starter landing page)', () => {
  it('parses + renders to HTML containing the welcome content', async () => {
    const reg = loadApp(join(process.cwd(), 'app'));
    expect(reg.funcs.has('welcome')).toBe(true);
    expect(reg.resources.has('welcomeBody')).toBe(true);
    expect(reg.resources.has('welcomeShell')).toBe(true);

    const ctx: Ctx = {
      funcs: reg.funcs,
      resources: reg.resources,
      bos: reg.bos,
      req: { method: 'GET', url: '/page/welcome/f/welcome', query: {}, body: '' },
      res: { contentType: 'text/html', body: '', status: 200, headers: {} },
    };
    await callFunction(ctx, 'welcome');

    expect(ctx.res.contentType).toMatch(/text\/html/);
    expect(ctx.res.body).toContain('<!doctype html>');
    expect(ctx.res.body).toContain('cms-vercel');
    expect(ctx.res.body).toContain('Where to put your code');
    // The welcome page shows the live demo links to ping + stats.
    expect(ctx.res.body).toContain('/page/ping/f/ping');
  });
});
