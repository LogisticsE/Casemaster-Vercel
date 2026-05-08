/**
 * Tokenizer for the .cms language. Phase 1: covers the ping function's
 * surface area — keywords, identifiers, numbers, strings (single-quoted,
 * double-quoted, backticked template), `[var]` substitutions, common
 * operators, and the `<@…>` qualifier opener.
 *
 * Backticked strings are returned whole (no inner-expression interpolation
 * happens here — that's resolveTemplate's job at evaluation time).
 */

export type TokKind =
  | 'IDENT' | 'NUM' | 'STR' | 'TBSTR'
  | 'LPAREN' | 'RPAREN' | 'LBRACK' | 'RBRACK' | 'LANG' | 'RANG'
  | 'LANGAT'        // `<@`
  | 'COMMA' | 'COLON' | 'DOT' | 'SLASH'
  | 'EQ' | 'NEQ' | 'LE' | 'GE' | 'LT' | 'GT'   // syntax not used as ops in .cms; keep for future
  | 'KW_FUNCTION' | 'KW_END_FUNCTION' | 'KW_EXIT_FUNCTION'
  | 'KW_RESOURCE' | 'KW_END_RESOURCE'
  | 'KW_IF' | 'KW_ELSE' | 'KW_ELSE_IF' | 'KW_END_IF'
  | 'KW_ITERATE' | 'KW_END_ITERATE'
  | 'KW_FOR' | 'KW_END_FOR'
  | 'KW_TRY' | 'KW_CATCH' | 'KW_FINALLY' | 'KW_END_TRY'
  | 'KW_RETURN' | 'KW_RAISE'
  | 'KW_TRUE' | 'KW_FALSE' | 'KW_NULL'
  | 'KW_PROTECTED' | 'KW_INHERITS'
  | 'NEWLINE' | 'EOF';

export interface Tok {
  kind: TokKind;
  value: string;
  line: number;
  col: number;
}

const KEYWORDS: Record<string, TokKind> = {
  function: 'KW_FUNCTION',
  'end-function': 'KW_END_FUNCTION',
  'exit-function': 'KW_EXIT_FUNCTION',
  resource: 'KW_RESOURCE',
  'end-resource': 'KW_END_RESOURCE',
  if: 'KW_IF',
  else: 'KW_ELSE',
  'else-if': 'KW_ELSE_IF',
  'end-if': 'KW_END_IF',
  iterate: 'KW_ITERATE',
  'end-iterate': 'KW_END_ITERATE',
  for: 'KW_FOR',
  'end-for': 'KW_END_FOR',
  try: 'KW_TRY',
  catch: 'KW_CATCH',
  finally: 'KW_FINALLY',
  'end-try': 'KW_END_TRY',
  return: 'KW_RETURN',
  raise: 'KW_RAISE',
  protected: 'KW_PROTECTED',
  inherits: 'KW_INHERITS',
};

export class LexError extends Error {
  constructor(public file: string, public line: number, public col: number, msg: string) {
    super(`${file}:${line}:${col}: ${msg}`);
  }
}

export function lex(src: string, file: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = 1, col = 1;
  // Track bracket depth so `//` inside `[//route.function]` (path-ref) is
  // not mis-tokenised as a line comment.
  let bracketDepth = 0;

  const peek = (off = 0) => src[i + off] ?? '';
  const advance = () => {
    const ch = src[i++];
    if (ch === '\n') { line++; col = 1; } else { col++; }
    return ch ?? '';
  };
  const push = (kind: TokKind, value: string, l: number, c: number) =>
    out.push({ kind, value, line: l, col: c });

  while (i < src.length) {
    const startLine = line, startCol = col;
    const ch = peek();

    // Whitespace (preserve newlines as tokens — useful for statement boundaries)
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }
    if (ch === '\n') { advance(); push('NEWLINE', '\n', startLine, startCol); continue; }

    // Line comments: `// ...` — but not inside `[…]`, where `//` introduces
    // a path-ref like `[//route.function]`.
    if (ch === '/' && peek(1) === '/' && bracketDepth === 0) {
      while (i < src.length && peek() !== '\n') advance();
      continue;
    }

    // Block comments: `/* ... */` (may span lines, no nesting)
    if (ch === '/' && peek(1) === '*') {
      advance(); advance();
      while (i < src.length && !(peek() === '*' && peek(1) === '/')) advance();
      if (peek() === '*' && peek(1) === '/') { advance(); advance(); }
      continue;
    }

    // String literals: '...' and "..."
    if (ch === "'" || ch === '"') {
      const quote = ch;
      advance();
      let s = '';
      while (i < src.length && peek() !== quote) {
        if (peek() === '\\' && peek(1) === quote) { s += quote; advance(); advance(); continue; }
        if (peek() === '\\' && peek(1) === '\\')  { s += '\\';  advance(); advance(); continue; }
        if (peek() === '\\' && peek(1) === 'n')   { s += '\n';  advance(); advance(); continue; }
        if (peek() === '\\' && peek(1) === 't')   { s += '\t';  advance(); advance(); continue; }
        s += advance();
      }
      if (peek() !== quote) {
        throw new LexError(file, startLine, startCol, `unterminated string`);
      }
      advance();
      push('STR', s, startLine, startCol);
      continue;
    }

    // Backticked template strings: `... can span lines, `\`` escapes a literal backtick.
    if (ch === '`') {
      advance();
      let s = '';
      while (i < src.length && peek() !== '`') {
        if (peek() === '\\' && peek(1) === '`')  { s += '`';  advance(); advance(); continue; }
        if (peek() === '\\' && peek(1) === '\\') { s += '\\'; advance(); advance(); continue; }
        s += advance();
      }
      if (peek() !== '`') {
        throw new LexError(file, startLine, startCol, `unterminated template string`);
      }
      advance();
      push('TBSTR', s, startLine, startCol);
      continue;
    }

    // Numbers: integer or decimal
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(peek(1)))) {
      let s = advance();
      while (i < src.length && /[0-9.]/.test(peek())) s += advance();
      push('NUM', s, startLine, startCol);
      continue;
    }

    // `<@` qualifier opener (must come before generic `<`)
    if (ch === '<' && peek(1) === '@') { advance(); advance(); push('LANGAT', '<@', startLine, startCol); continue; }

    // Punctuation
    if (ch === '(') { advance(); push('LPAREN', '(', startLine, startCol); continue; }
    if (ch === ')') { advance(); push('RPAREN', ')', startLine, startCol); continue; }
    if (ch === '[') { advance(); bracketDepth++; push('LBRACK', '[', startLine, startCol); continue; }
    if (ch === ']') { advance(); if (bracketDepth > 0) bracketDepth--; push('RBRACK', ']', startLine, startCol); continue; }
    if (ch === '<') { advance(); push('LANG',   '<', startLine, startCol); continue; }
    if (ch === '>') { advance(); push('RANG',   '>', startLine, startCol); continue; }
    if (ch === ',') { advance(); push('COMMA',  ',', startLine, startCol); continue; }
    if (ch === ':') { advance(); push('COLON',  ':', startLine, startCol); continue; }
    if (ch === '.') { advance(); push('DOT',    '.', startLine, startCol); continue; }
    if (ch === '/') { advance(); push('SLASH',  '/', startLine, startCol); continue; }

    // Identifiers (incl. dotted: `iterator.ofEntity` is two IDENT + DOT)
    // Allows hyphens within an identifier (`end-function`, `AR-AE`, `exit-function`)
    // when the hyphen is followed by another letter — keeps `-NUM` literal numbers
    // working since those are matched earlier.
    // Also accepts a leading `$` (i18n shorthand: `$getTranslation('foo')`).
    if (/[A-Za-z_$]/.test(ch)) {
      let s = advance();
      while (i < src.length) {
        const p = peek();
        if (/[A-Za-z0-9_]/.test(p)) { s += advance(); continue; }
        // Allow hyphen inside identifier only when followed by a letter and we
        // already have at least one letter, so subtraction-style `a -b` (with
        // a space) won't be glued. We still defensively require no space.
        if (p === '-' && /[A-Za-z]/.test(src[i + 1] ?? '')) { s += advance(); continue; }
        break;
      }
      const kw = KEYWORDS[s];
      if (kw) { push(kw, s, startLine, startCol); continue; }
      if (s === 'true')  { push('KW_TRUE',  s, startLine, startCol); continue; }
      if (s === 'false') { push('KW_FALSE', s, startLine, startCol); continue; }
      if (s === 'null')  { push('KW_NULL',  s, startLine, startCol); continue; }
      push('IDENT', s, startLine, startCol);
      continue;
    }

    throw new LexError(file, startLine, startCol, `unexpected character '${ch}'`);
  }

  push('EOF', '', line, col);
  return out;
}
