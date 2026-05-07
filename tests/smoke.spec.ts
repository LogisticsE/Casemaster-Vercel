import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { lex } from '../src/cms/lex.js';
import { parse } from '../src/cms/parse.js';
import { loadApp } from '../src/cms/loader.js';
import { callFunction, Ctx } from '../src/cms/eval.js';

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

describe('hello.cms (Phase 2)', () => {
  it('parses + renders to HTML containing the greeting', async () => {
    const reg = loadApp(join(process.cwd(), 'app'));
    expect(reg.funcs.has('hello')).toBe(true);
    expect(reg.resources.has('helloBody')).toBe(true);
    expect(reg.resources.has('helloShell')).toBe(true);

    const ctx: Ctx = {
      funcs: reg.funcs,
      resources: reg.resources,
      req: { method: 'GET', url: '/page/foo/f/hello', query: {}, body: '' },
      res: { contentType: 'text/html', body: '', status: 200, headers: {} },
    };
    await callFunction(ctx, 'hello');

    expect(ctx.res.contentType).toMatch(/text\/html/);
    expect(ctx.res.body).toContain('<!doctype html>');
    expect(ctx.res.body).toContain('Hello from cms-vercel');
    expect(ctx.res.body).toContain('Phase 2');
    // resolveTemplate substituted [subtitle] with the eval'd concat
    expect(ctx.res.body).toContain('Time on server: 2');
  });
});
