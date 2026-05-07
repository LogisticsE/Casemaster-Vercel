import { describe, it, expect } from 'vitest';
import { lex } from '../src/cms/lex.js';
import { parse } from '../src/cms/parse.js';

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
    const fns = parse(lex(src, 'test.cms'), 'test.cms');
    expect(fns.length).toBe(1);
    expect(fns[0]!.name).toBe('f');
    expect(fns[0]!.body.length).toBe(2);
    expect(fns[0]!.body[0]!.kind).toBe('Set');
    expect(fns[0]!.body[1]!.kind).toBe('Return');
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
    const fns = parse(lex(src, 'test.cms'), 'test.cms');
    expect(fns.length).toBe(1);
    expect(fns[0]!.body[0]!.kind).toBe('Iterate');
  });
});
