/**
 * Tree-walking interpreter. Phase 1 supports the subset of expressions
 * and statements that the `ping` function exercises. Each function call
 * gets its own fresh Scope; `set('x', …)` mutates the *current* scope
 * and is invisible to the caller.
 *
 * The `Ctx` carries request-wide state — the response writer and the
 * registry of loaded functions. Builtins live in a single dispatch
 * table; new ones are added as later phases need them.
 */

import * as A from './ast.js';
import { query } from './db.js';

export type Value =
  | string | number | boolean | null
  | Row | RowList
  | Iter
  | Qualifier
  | { __kind: 'undefined' };

export interface Row {
  __kind: 'Row';
  data: Record<string, unknown>;
  // Tracks which BO produced the row, so future bo.attr() calls can
  // disambiguate columns vs computed attributes.
  entity?: string;
}

export interface RowList {
  __kind: 'RowList';
  rows: Row[];
}

// An iterable result yielded by `iterator.ofEntity`. The Iterate
// statement walks it row by row, binding the loop variable.
export interface Iter {
  __kind: 'Iter';
  iterName: string;          // the per-row variable name (`<@iterator/entity name:'c' …>`)
  rows: Row[];
}

export interface Qualifier {
  __kind: 'Qualifier';
  path: string[];
  props: Record<string, Value>;
}

export class Scope {
  vars: Map<string, Value> = new Map();
  constructor(public parent: Scope | null = null) {}
  get(name: string): Value {
    if (this.vars.has(name)) return this.vars.get(name)!;
    if (this.parent) return this.parent.get(name);
    return { __kind: 'undefined' };
  }
  set(name: string, v: Value) { this.vars.set(name, v); }
}

export interface Ctx {
  // Module-level registry: function name → AST. For Phase 1 a single
  // file is loaded; later phases will key by (script, fn).
  funcs: Map<string, A.Func>;
  // Mutable response state, drained at the end.
  res: { contentType: string; body: string; status: number; headers: Record<string,string>; redirect?: string };
  // Request inputs.
  req: { method: string; url: string; query: Record<string,string>; body: string };
}

export class RuntimeError extends Error {
  constructor(public loc: A.Loc, msg: string) {
    super(`${loc.file}:${loc.line}:${loc.col}: ${msg}`);
  }
}

// Public entry point: invoke a function by name. Used by the route
// handler in api/[...route].ts.
export async function callFunction(ctx: Ctx, name: string, args: Value[] = []): Promise<Value> {
  const fn = ctx.funcs.get(name);
  if (!fn) throw new Error(`function not found: ${name}`);
  const scope = new Scope();
  fn.params.forEach((p, i) => scope.set(p, args[i] ?? null));
  try {
    await execBlock(ctx, scope, fn.body);
    return null;
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

class ReturnSignal {
  constructor(public value: Value) {}
}

async function execBlock(ctx: Ctx, scope: Scope, stmts: A.Stmt[]): Promise<void> {
  for (const s of stmts) await execStmt(ctx, scope, s);
}

async function execStmt(ctx: Ctx, scope: Scope, s: A.Stmt): Promise<void> {
  switch (s.kind) {
    case 'Set': {
      const v = await evalExpr(ctx, scope, s.value);
      scope.set(s.name, v);
      return;
    }
    case 'If': {
      if (truthy(await evalExpr(ctx, scope, s.cond))) {
        return execBlock(ctx, scope, s.then);
      }
      for (const e of s.elseIfs) {
        if (truthy(await evalExpr(ctx, scope, e.cond))) {
          return execBlock(ctx, scope, e.body);
        }
      }
      if (s.else_) return execBlock(ctx, scope, s.else_);
      return;
    }
    case 'Iterate': {
      const it = await evalExpr(ctx, scope, s.source);
      if (!isIter(it)) throw new RuntimeError(s.loc, `iterate target is not an iterator`);
      for (const row of it.rows) {
        scope.set(it.iterName, row);
        await execBlock(ctx, scope, s.body);
      }
      return;
    }
    case 'Return': {
      const v = s.value ? await evalExpr(ctx, scope, s.value) : null;
      throw new ReturnSignal(v);
    }
    case 'Raise': {
      const msg = String(await evalExpr(ctx, scope, s.message));
      throw new RuntimeError(s.loc, msg);
    }
    case 'ExprStmt': {
      await evalExpr(ctx, scope, s.expr);
      return;
    }
  }
}

async function evalExpr(ctx: Ctx, scope: Scope, e: A.Expr): Promise<Value> {
  switch (e.kind) {
    case 'StrLit':  return e.value;
    case 'NumLit':  return e.value;
    case 'BoolLit': return e.value;
    case 'NullLit': return null;
    case 'VarRef':  return scope.get(e.name);
    case 'Ident':   return scope.get(e.name);

    case 'MemberAcc': {
      const obj = await evalExpr(ctx, scope, e.object);
      // Most member access in .cms is at the head of a Call (e.g.
      // `bo.attr(...)`, `iterator.ofEntity(...)`); the Call evaluator
      // handles those. Bare member access on rows reads a column.
      if (isRow(obj)) return (obj.data[e.member] ?? null) as Value;
      return { __kind: 'undefined' };
    }

    case 'Qualifier': {
      const props: Record<string, Value> = {};
      for (const k of Object.keys(e.props)) {
        props[k] = await evalExpr(ctx, scope, e.props[k]!);
      }
      return { __kind: 'Qualifier', path: e.path, props } as Qualifier;
    }

    case 'NamedArg':
      return await evalExpr(ctx, scope, e.value);

    case 'Call': {
      // Resolve the callee shape: bare ident, dotted, or qualifier.
      const callee = e.callee;
      const argVals: Value[] = [];
      const namedArgs: Record<string, Value> = {};
      for (const a of e.args) {
        if (a.kind === 'NamedArg') {
          namedArgs[a.name] = await evalExpr(ctx, scope, a.value);
        } else {
          argVals.push(await evalExpr(ctx, scope, a));
        }
      }
      return await dispatch(ctx, scope, callee, argVals, namedArgs, e.loc);
    }
  }
}

// ─── Builtin dispatch ──────────────────────────────────────────────
async function dispatch(
  ctx: Ctx, scope: Scope, callee: A.Expr,
  args: Value[], named: Record<string, Value>, loc: A.Loc
): Promise<Value> {
  const path = calleePath(callee);   // e.g. ['set'] or ['response','write'] or ['iterator','ofEntity']
  const key = path.join('.');

  switch (key) {
    case 'set': {
      // already lifted to A.Set in the parser, but still callable as an
      // expression (some .cms uses `set('x', y)` mid-expression)
      if (args.length !== 2 || typeof args[0] !== 'string') {
        throw new RuntimeError(loc, `set expects (name, value)`);
      }
      scope.set(args[0], args[1] ?? null);
      return null;
    }

    case 'concat': return args.map(a => stringify(a)).join('');
    case 'eq':     return args[0] === args[1] || stringify(args[0] ?? null) === stringify(args[1] ?? null);
    case 'ne':     return !(args[0] === args[1] || stringify(args[0] ?? null) === stringify(args[1] ?? null));
    case 'and':    return args.every(truthy);
    case 'or':     return args.some(truthy);
    case 'not':    return !truthy(args[0] ?? null);
    case 'lt':     return num(args[0]!) <  num(args[1]!);
    case 'gt':     return num(args[0]!) >  num(args[1]!);
    case 'lte':    return num(args[0]!) <= num(args[1]!);
    case 'gte':    return num(args[0]!) >= num(args[1]!);
    case 'sum':    return args.reduce((a: number, b) => a + num(b!), 0);
    case 'sub':    return num(args[0]!) - num(args[1]!);
    case 'mul':    return num(args[0]!) * num(args[1]!);
    case 'div':    return num(args[0]!) / num(args[1]!);
    case 'mod':    return num(args[0]!) % num(args[1]!);
    case 'lng':    return Math.trunc(num(args[0]!));

    case 'if':     return truthy(args[0]!) ? args[1]! : args[2]!;

    case '_onError': {
      // CaseMaster's _onError(expr, fallback) — if `expr` is undefined
      // (or a runtime threw), use fallback. The interpreter doesn't
      // bubble "undefined" through naturally, so we treat the {undefined}
      // sentinel + null as triggers.
      const v = args[0]!;
      if (v === null || (typeof v === 'object' && v && (v as any).__kind === 'undefined')) {
        return args[1] ?? null;
      }
      return v;
    }

    case 'isNull':    return args[0] === null || (typeof args[0] === 'object' && args[0] !== null && (args[0] as any).__kind === 'undefined');
    case 'isNotNull': return !(args[0] === null || (typeof args[0] === 'object' && args[0] !== null && (args[0] as any).__kind === 'undefined'));

    case 'chr':            return String.fromCharCode(num(args[0]!));
    case 'formatString': {
      const fmt = String(args[0] ?? '');
      return fmt.replace(/\{(\d+)\}/g, (_, i) => stringify(args[parseInt(i, 10) + 1] ?? ''));
    }
    case 'replace': {
      const s = String(args[0] ?? '');
      const find = String(args[1] ?? '');
      const repl = String(args[2] ?? '');
      return s.split(find).join(repl);
    }
    case 'startsWith':  return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
    case 'trim':        return String(args[0] ?? '').trim();

    case 'iterator.ofEntity': {
      // The single positional arg is the qualifier list (`entities: <…>`).
      // CaseMaster supplies `entities`, `where`, `orderBy`, `rows`, `start`
      // as named args. Phase 1 reads `entities[0]` only.
      const ents = (named.entities as Qualifier | Value | undefined);
      if (!ents) throw new RuntimeError(loc, `iterator.ofEntity needs entities:`);
      // The lexer's `<...>` literal isn't fully parsed in Phase 1; we
      // accept the simpler form where the qualifier is a single
      // `<@iterator/entity name:'…' entity:'…' where:'…' orderBy:'…'>`
      // passed positionally.
      const entQ = pickEntityQualifier(ents);
      if (!entQ) throw new RuntimeError(loc, `iterator.ofEntity: cannot read entity qualifier`);
      const entityName  = String(entQ.props.entity  ?? '');
      const iterName    = String(entQ.props.name    ?? 'r');
      const whereClause = entQ.props.where ? String(entQ.props.where) : '';
      const orderByCol  = entQ.props.orderBy ? String(entQ.props.orderBy) : '';
      const rowsLimit   = num(named.rows ?? 1000);

      const tbl = entityToTable(entityName);
      let sql = `SELECT * FROM ${tbl}`;
      if (whereClause) sql += ` WHERE ${compileWhere(whereClause)}`;
      if (orderByCol) {
        const desc = orderByCol.startsWith('-');
        sql += ` ORDER BY ${desc ? orderByCol.slice(1) : orderByCol} ${desc ? 'DESC' : 'ASC'}`;
      }
      sql += ` LIMIT ${rowsLimit}`;
      const rows = await query(sql);
      const out: Iter = {
        __kind: 'Iter',
        iterName,
        rows: rows.map(r => ({ __kind: 'Row', data: r as any, entity: entityName })),
      };
      return out;
    }

    case 'bo.attr': {
      const row = args[0] as Row | undefined;
      const col = String(args[1] ?? '');
      if (!isRow(row)) return null;
      return (row.data[col] ?? null) as Value;
    }

    case 'response.setContentType': {
      ctx.res.contentType = String(args[0] ?? 'text/plain');
      return null;
    }
    case 'response.write': {
      ctx.res.body += stringify(args[0] ?? '');
      return null;
    }
    case 'response.flush':       return null;
    case 'response.end':         return null;
    case 'response.clearContent':{ ctx.res.body = ''; return null; }
    case 'response.redirect': {
      ctx.res.redirect = String(args[0] ?? '');
      ctx.res.status = 302;
      return null;
    }

    default:
      throw new RuntimeError(loc, `unimplemented call: ${key}`);
  }
}

// Map a CaseMaster BO path to its Postgres table. Phase 1 hard-codes the
// known set; Phase 3 will read real `<@bo>` declarations and build this
// lookup at module load.
function entityToTable(entity: string): string {
  const known: Record<string,string> = {
    'qr/labelTemplate': 'qr_label_template',
    'qr/job':           'qr_job',
    'qr/code':          'qr_code',
  };
  if (entity in known) return known[entity]!;
  // fall back: replace `/` with `_` and camelCase → snake_case.
  return entity.replace(/\//g, '_').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

// CaseMaster's `where:` mini-language uses `=` for equality, `&` for AND,
// `>=`, `<=`, etc. Phase 1 supports just enough to translate the strings
// the ping function would never produce — but the same compiler will
// power Phase 2+. Values come pre-substituted from .cms (`concat('id=', [id])`).
function compileWhere(w: string): string {
  return w
    .replace(/\s*&\s*/g, ' AND ')
    // `name="value"` is already valid SQL; pass through.
    ;
}

function pickEntityQualifier(v: Value): Qualifier | null {
  // The `entities:` arg can be either a single qualifier or a `_list`
  // qualifier wrapping one (or more) `<@iterator/entity …>` entries.
  if (typeof v === 'object' && v && (v as any).__kind === 'Qualifier') {
    const q = v as Qualifier;
    if (q.path[0] === '_list') {
      // Take the first positional entry.
      const first = q.props['0'];
      if (first && typeof first === 'object' && (first as any).__kind === 'Qualifier') return first as Qualifier;
    }
    return q;
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && (v[0] as any).__kind === 'Qualifier') return v[0] as Qualifier;
  return null;
}

function calleePath(callee: A.Expr): string[] {
  if (callee.kind === 'Ident') return [callee.name];
  if (callee.kind === 'MemberAcc') return [...calleePath(callee.object), callee.member];
  throw new Error('unrecognised call target');
}

function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (typeof v === 'object' && v && (v as any).__kind === 'undefined') return false;
  if (v === 0 || v === '') return false;
  return true;
}
function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 0;
}
function stringify(v: Value): string {
  if (v === null) return '';
  if (typeof v === 'object' && v && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function isIter(v: Value): v is Iter { return typeof v === 'object' && v !== null && (v as any).__kind === 'Iter'; }
function isRow(v: Value | undefined): v is Row { return typeof v === 'object' && v !== null && (v as any).__kind === 'Row'; }
