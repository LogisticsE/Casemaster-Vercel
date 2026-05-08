/**
 * Parser for the .cms language. Phase 1 covers only what `ping` needs:
 * function declarations, set/if/iterate/return statements, calls with
 * positional + named args, qualifier blocks, var refs, dotted member
 * access, string/number/bool/null literals.
 *
 * No grammar generator — see HOW.md for why. The parser is two parts:
 *   skipNL()       — consume any pending NEWLINE tokens
 *   parseFile()    — top-level loop, picks `function` or skips other things
 */

import { Tok } from './lex.js';
import * as A from './ast.js';

export class ParseError extends Error {
  constructor(public file: string, public line: number, public col: number, msg: string) {
    super(`${file}:${line}:${col}: ${msg}`);
  }
}

export interface ParsedFile {
  funcs: A.Func[];
  resources: A.Resource[];
}

export function parse(toks: Tok[], file: string): ParsedFile {
  const p = new Parser(toks, file);
  return p.parseFile();
}

/**
 * Parse a free-standing expression — used by resolveTemplate to evaluate
 * a single `{{…}}` chunk. Toks should be the lex output of the chunk's
 * source, no surrounding `function` / `end-function`.
 */
export function parseExpression(toks: Tok[], file: string): A.Expr {
  const p = new Parser(toks, file);
  p.skipNL();
  const e = p.parseExprPublic();
  return e;
}

class Parser {
  i = 0;
  constructor(public toks: Tok[], public file: string) {}

  peek(off = 0): Tok { return this.toks[this.i + off]!; }
  eof() { return this.peek().kind === 'EOF'; }
  loc(): A.Loc { const t = this.peek(); return { file: this.file, line: t.line, col: t.col }; }

  err(msg: string): never {
    const t = this.peek();
    throw new ParseError(this.file, t.line, t.col, `${msg} (got ${t.kind} '${t.value}')`);
  }

  eat(kind: Tok['kind']): Tok {
    if (this.peek().kind !== kind) this.err(`expected ${kind}`);
    return this.toks[this.i++]!;
  }
  // Accept IDENT or any keyword that has an identifier-shaped lexed value.
  // Used wherever the grammar wants an "identifier" but a user .cms might
  // shadow a keyword (param named `function`, property named `class`, etc.)
  isIdentLike(off = 0): boolean {
    const k = this.peek(off).kind;
    return k === 'IDENT' || k.startsWith('KW_');
  }
  eatIdentLike(): Tok {
    if (!this.isIdentLike()) this.err(`expected identifier`);
    return this.toks[this.i++]!;
  }
  // Non-consuming check: does the position start a `name (.name)* :` named-arg head?
  // Used by qualifier and PB-literal parsers to disambiguate `key: value` from
  // an expression like `$bo.attr(...)` whose first token is also an identifier.
  isNamedHead(): boolean {
    if (!this.isIdentLike()) return false;
    let off = 1;
    while (this.peek(off).kind === 'DOT' && this.isIdentLike(off + 1)) off += 2;
    return this.peek(off).kind === 'COLON';
  }
  eatDottedName(): string {
    let name = this.eatIdentLike().value;
    while (this.peek().kind === 'DOT' && this.isIdentLike(1)) {
      this.i++;
      name += '.' + this.eatIdentLike().value;
    }
    return name;
  }
  match(...kinds: Tok['kind'][]): boolean {
    if (kinds.includes(this.peek().kind)) { this.i++; return true; }
    return false;
  }
  skipNL() { while (this.peek().kind === 'NEWLINE') this.i++; }

  // Public wrapper for the standalone expression parser. Called by
  // parseExpression() above (for resolveTemplate's {{…}} chunks).
  parseExprPublic(): A.Expr { return this.parseExpr(); }

  // ─── Top level ─────────────────────────────────────────────
  parseFile(): ParsedFile {
    const funcs: A.Func[] = [];
    const resources: A.Resource[] = [];
    this.skipNL();
    while (!this.eof()) {
      if (this.peek().kind === 'KW_INHERITS') {
        // `inherits 'base'` — no-op for Phase 1
        this.i++;
        if (this.peek().kind === 'STR') this.i++;
        this.skipNL();
        continue;
      }
      if (this.peek().kind === 'KW_PROTECTED') { this.i++; this.skipNL(); }
      if (this.peek().kind === 'KW_FUNCTION') {
        funcs.push(this.parseFunction());
        this.skipNL();
        continue;
      }
      if (this.peek().kind === 'KW_RESOURCE') {
        resources.push(this.parseResource());
        this.skipNL();
        continue;
      }
      // Anything else at top level: skip the token to keep the parser
      // forward-progressing on unknown directives. Phase 10 adds a
      // strict validator.
      this.i++;
    }
    return { funcs, resources };
  }

  parseResource(): A.Resource {
    const loc = this.loc();
    this.eat('KW_RESOURCE');
    const name = this.eat('IDENT').value;
    this.skipNL();
    // CaseMaster resources may contain a single expression (the common case)
    // or a sequence of top-level qualifiers (BO declarations bundle several
    // <@bo/attribute>, <@bo/event> blocks at the same level). Read until we
    // see end-resource and wrap multi-element bodies in a synthetic `_list`.
    const exprs: A.Expr[] = [];
    while (!this.eof() && this.peek().kind !== 'KW_END_RESOURCE') {
      exprs.push(this.parseExpr());
      this.skipNL();
    }
    this.eat('KW_END_RESOURCE');
    let body: A.Expr;
    if (exprs.length === 1) body = exprs[0]!;
    else {
      const props: Record<string, A.Expr> = {};
      exprs.forEach((e, i) => { props[String(i)] = e; });
      body = { kind: 'Qualifier', path: ['_list'], props, loc };
    }
    return { kind: 'Resource', name, body, loc };
  }

  // ─── Function ──────────────────────────────────────────────
  parseFunction(): A.Func {
    const startLoc = this.loc();
    this.eat('KW_FUNCTION');
    const name = this.eat('IDENT').value;
    this.eat('LPAREN');
    const params: A.Param[] = [];
    this.skipNL();
    while (this.peek().kind !== 'RPAREN') {
      const pname = this.eatIdentLike().value;
      let default_: A.Expr | null = null;
      // Optional default value: `_arg: 'someDefault'`
      if (this.peek().kind === 'COLON') {
        this.i++;
        this.skipNL();
        default_ = this.parseExpr();
      }
      params.push({ name: pname, default_ });
      this.skipNL();
      if (this.peek().kind === 'COMMA') { this.i++; this.skipNL(); }
    }
    this.eat('RPAREN');
    this.skipNL();
    const body = this.parseStmts(['KW_END_FUNCTION']);
    this.eat('KW_END_FUNCTION');
    return { kind: 'Func', name, params, body, loc: startLoc };
  }

  // ─── Statements ────────────────────────────────────────────
  parseStmts(terminators: Tok['kind'][]): A.Stmt[] {
    const out: A.Stmt[] = [];
    this.skipNL();
    while (!this.eof() && !terminators.includes(this.peek().kind) &&
           this.peek().kind !== 'KW_ELSE' && this.peek().kind !== 'KW_ELSE_IF') {
      out.push(this.parseStmt());
      this.skipNL();
    }
    return out;
  }

  parseStmt(): A.Stmt {
    const t = this.peek();
    switch (t.kind) {
      case 'KW_IF':       return this.parseIf();
      case 'KW_ITERATE':  return this.parseIterate();
      case 'KW_RETURN':   return this.parseReturn();
      case 'KW_RAISE':    return this.parseRaise();
      case 'KW_EXIT_FUNCTION': {
        const loc = this.loc();
        this.i++;
        return { kind: 'ExitFunction', loc };
      }
      case 'KW_TRY':      return this.parseTry();
      default: {
        // `set('name', expr)` is just a Call expression statement; we
        // recognise it generically (no special-casing).
        const expr = this.parseExpr();
        // Synthesise a Set node when the expression is `set(...)` so the
        // interpreter can branch cheaply.
        if (expr.kind === 'Call' && expr.callee.kind === 'Ident' && expr.callee.name === 'set'
            && expr.args.length === 2 && expr.args[0]!.kind === 'StrLit') {
          return { kind: 'Set', name: (expr.args[0] as A.StrLit).value, value: expr.args[1]!, loc: expr.loc };
        }
        return { kind: 'ExprStmt', expr, loc: expr.loc };
      }
    }
  }

  parseIf(): A.If {
    const loc = this.loc();
    this.eat('KW_IF');
    const cond = this.parseExpr();
    this.skipNL();
    const then = this.parseStmts(['KW_END_IF']);
    const elseIfs: { cond: A.Expr; body: A.Stmt[] }[] = [];
    let else_: A.Stmt[] | null = null;
    while (this.peek().kind === 'KW_ELSE_IF') {
      this.i++;
      const c = this.parseExpr();
      this.skipNL();
      const b = this.parseStmts(['KW_END_IF']);
      elseIfs.push({ cond: c, body: b });
    }
    if (this.peek().kind === 'KW_ELSE') {
      this.i++;
      this.skipNL();
      else_ = this.parseStmts(['KW_END_IF']);
    }
    this.eat('KW_END_IF');
    return { kind: 'If', cond, then, elseIfs, else_, loc };
  }

  parseIterate(): A.Iterate {
    const loc = this.loc();
    this.eat('KW_ITERATE');
    const source = this.parseExpr();
    this.skipNL();
    const body = this.parseStmts(['KW_END_ITERATE']);
    this.eat('KW_END_ITERATE');
    return { kind: 'Iterate', source, body, loc };
  }

  parseReturn(): A.Return {
    const loc = this.loc();
    this.eat('KW_RETURN');
    if (this.peek().kind === 'NEWLINE' || this.peek().kind === 'EOF' ||
        this.peek().kind === 'KW_END_FUNCTION') {
      return { kind: 'Return', value: null, loc };
    }
    const value = this.parseExpr();
    return { kind: 'Return', value, loc };
  }

  parseTry(): A.Try {
    const loc = this.loc();
    this.eat('KW_TRY');
    this.skipNL();
    const body = this.parseStmts(['KW_CATCH', 'KW_FINALLY', 'KW_END_TRY']);
    let catchVar: string | null = null;
    let catch_: A.Stmt[] | null = null;
    let finally_: A.Stmt[] | null = null;
    if (this.peek().kind === 'KW_CATCH') {
      this.i++;
      // Several .cms forms are in use:
      //   `catch`                — bare
      //   `catch e`              — variable binding
      //   `catch (e)`            — variable binding (parens)
      //   `catch exceptionType.fatal`  — type filter, no binding
      // The variable / type-filter must appear on the SAME LINE as the
      // `catch` keyword. A bare `catch\n` is followed by statements, not
      // a binding expression.
      if (this.peek().kind === 'LPAREN') {
        this.i++;
        if (this.peek().kind === 'IDENT') catchVar = this.eat('IDENT').value;
        this.eat('RPAREN');
      } else if (this.peek().kind === 'IDENT' && this.peek(1).kind !== 'DOT') {
        catchVar = this.eat('IDENT').value;
      } else if (this.peek().kind !== 'NEWLINE' && this.peek().kind !== 'KW_FINALLY'
                 && this.peek().kind !== 'KW_END_TRY') {
        // Type-filter expression on the same line: parse and discard.
        this.parseExpr();
      }
      this.skipNL();
      catch_ = this.parseStmts(['KW_FINALLY', 'KW_END_TRY']);
    }
    if (this.peek().kind === 'KW_FINALLY') {
      this.i++;
      this.skipNL();
      finally_ = this.parseStmts(['KW_END_TRY']);
    }
    this.eat('KW_END_TRY');
    return { kind: 'Try', body, catchVar, catch_, finally_, loc };
  }

  parseRaise(): A.Raise {
    const loc = this.loc();
    this.eat('KW_RAISE');
    const exType = this.parseExpr();
    this.eat('COMMA');
    this.skipNL();
    const message = this.parseExpr();
    return { kind: 'Raise', exType, message, loc };
  }

  // ─── Expressions ───────────────────────────────────────────
  parseExpr(): A.Expr {
    return this.parsePrimary();
  }

  parsePrimary(): A.Expr {
    const t = this.peek();
    let head: A.Expr;
    switch (t.kind) {
      case 'STR':       this.i++; head = { kind: 'StrLit', value: t.value, template: false, loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'TBSTR':     this.i++; head = { kind: 'StrLit', value: t.value, template: true,  loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'NUM':       this.i++; head = { kind: 'NumLit', value: parseFloat(t.value), loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_TRUE':   this.i++; head = { kind: 'BoolLit', value: true,  loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_FALSE':  this.i++; head = { kind: 'BoolLit', value: false, loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'KW_NULL':   this.i++; head = { kind: 'NullLit', loc: { file: this.file, line: t.line, col: t.col } }; break;
      case 'LBRACK': {
        this.i++;
        // Allow leading slashes: `[//route.function]` is a CaseMaster path-ref.
        let n = '';
        while (this.peek().kind === 'SLASH') { this.i++; n += '/'; }
        // Variable references can shadow keywords (e.g. `[return]`, `[try]`).
        n += this.eatIdentLike().value;
        // Path body: `name.subname[/subname]…` collected into one identifier.
        while (this.peek().kind === 'DOT' || this.peek().kind === 'SLASH') {
          if (this.peek().kind === 'DOT')   { this.i++; n += '.' + this.eatIdentLike().value; continue; }
          if (this.peek().kind === 'SLASH') { this.i++; n += '/' + this.eatIdentLike().value; continue; }
        }
        this.eat('RBRACK');
        head = { kind: 'VarRef', name: n, loc: { file: this.file, line: t.line, col: t.col } };
        break;
      }
      case 'LANGAT':    this.i++; head = this.parseQualifier(); break;
      case 'LANG':      head = this.parsePbLiteral(); break;
      case 'IDENT':     head = this.parseIdentOrCall(); break;
      // `if(cond, then, else)` is also valid as an *expression* in CMS;
      // treat the keyword as a plain identifier when used in expression
      // position. The statement form is handled higher up via parseIf().
      case 'KW_IF': {
        this.i++;
        head = { kind: 'Ident', name: 'if', loc: { file: this.file, line: t.line, col: t.col } };
        break;
      }
      case 'LPAREN': {
        this.i++;
        const e = this.parseExpr();
        this.eat('RPAREN');
        head = e;
        break;
      }
      default:
        this.err(`unexpected expression start`);
    }
    // postfix: dotted member access + call
    while (true) {
      if (this.peek().kind === 'DOT') {
        const dotLoc = this.loc();
        this.i++;
        const member = this.eat('IDENT').value;
        head = { kind: 'MemberAcc', object: head, member, loc: dotLoc };
        continue;
      }
      if (this.peek().kind === 'LPAREN') {
        const cLoc = this.loc();
        this.i++;
        const args: A.Expr[] = [];
        this.skipNL();
        while (this.peek().kind !== 'RPAREN') {
          // Named arg: `name: value`
          if (this.isNamedHead()) {
            const nLoc = this.loc();
            const name = this.eatDottedName();
            this.eat('COLON');
            this.skipNL();
            const value = this.parseExpr();
            args.push({ kind: 'NamedArg', name, value, loc: nLoc });
          } else {
            args.push(this.parseExpr());
          }
          this.skipNL();
          if (this.peek().kind === 'COMMA') { this.i++; this.skipNL(); }
        }
        this.eat('RPAREN');
        head = { kind: 'Call', callee: head, args, loc: cLoc };
        continue;
      }
      break;
    }
    return head;
  }

  parseIdentOrCall(): A.Expr {
    const t = this.eat('IDENT');
    return { kind: 'Ident', name: t.value, loc: { file: this.file, line: t.line, col: t.col } };
  }

  parseQualifier(): A.Qualifier {
    const loc = this.loc();
    // `<@page/container content: …>` — already consumed `<@`
    const path: string[] = [this.eat('IDENT').value];
    while (this.peek().kind === 'SLASH') {
      this.i++;
      path.push(this.eat('IDENT').value);
    }
    const props: Record<string, A.Expr> = {};
    let positional = 0;
    while (this.peek().kind !== 'RANG' && this.peek().kind !== 'EOF') {
      this.skipNL();
      if (this.peek().kind === 'RANG') break;
      // Named arg vs positional — `<@page/html "literal">` is positional.
      // Allow dotted keys (`client.description: <…>`) and keyword-shaped names.
      if (this.isNamedHead()) {
        const name = this.eatDottedName();
        this.eat('COLON');
        this.skipNL();
        props[name] = this.parseExpr();
      } else {
        props[String(positional++)] = this.parseExpr();
      }
      if (this.peek().kind === 'COMMA') this.i++;
      this.skipNL();
    }
    this.eat('RANG');
    return { kind: 'Qualifier', path, props, loc };
  }

  parsePbLiteral(): A.Expr {
    // `< … >` literal. In .cms this is used both for property bags and
    // for typed-list arguments to `entities:`. We capture the inner
    // expressions as a synthetic qualifier `_list`, with positional
    // children stored under numeric keys ("0", "1", …). The interpreter
    // turns `_list` qualifiers into JS arrays.
    const loc = this.loc();
    this.eat('LANG');
    const props: Record<string, A.Expr> = {};
    let n = 0;
    while (this.peek().kind !== 'RANG' && this.peek().kind !== 'EOF') {
      this.skipNL();
      if (this.peek().kind === 'RANG') break;
      // `key: value` (named PB entry) or just `value` (positional list entry).
      // Keys may be dotted (`client.description: <…>`) and may shadow keywords.
      if (this.isNamedHead()) {
        const name = this.eatDottedName();
        this.eat('COLON');
        this.skipNL();
        props[name] = this.parseExpr();
      } else {
        props[String(n++)] = this.parseExpr();
      }
      if (this.peek().kind === 'COMMA') this.i++;
      this.skipNL();
    }
    this.eat('RANG');
    return { kind: 'Qualifier', path: ['_list'], props, loc };
  }
}
