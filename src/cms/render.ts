/**
 * HTML renderer for `<@page/...>` qualifier values, plus the
 * resolveTemplate(`…{{ expr }}…`) string interpolator.
 *
 * Phase 2 covers the bare minimum to render one visible page:
 *   page/container, page/content, page/title, page/html
 * Plus the `_list` synthetic qualifier that the parser emits for `< … >`
 * literals (we walk children in order).
 *
 * Anything not yet implemented falls through to a comment marker so the
 * page renders something visible and we can grep the HTML for missing
 * qualifiers when porting more pages.
 */

import { Value, Qualifier, Scope, Ctx } from './eval.js';
import { evalExpr } from './eval.js';
import { lex } from './lex.js';
import { parseExpression } from './parse.js';

export async function renderValue(ctx: Ctx, scope: Scope, v: Value): Promise<string> {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isQualifier(v)) return await renderQualifier(ctx, scope, v as Qualifier);
  // Rows / iterators don't render directly — caller's mistake; leave a marker.
  return `<!-- unrenderable ${(v as any).__kind ?? typeof v} -->`;
}

async function renderQualifier(ctx: Ctx, scope: Scope, q: Qualifier): Promise<string> {
  const path = q.path.join('/');

  // Synthetic list qualifier from `< a, b, c >` literals — render children in order.
  if (path === '_list') {
    const keys = Object.keys(q.props).sort((a, b) => Number(a) - Number(b));
    let out = '';
    for (const k of keys) out += await renderValue(ctx, scope, q.props[k]!);
    return out;
  }

  switch (path) {
    case 'page/container': {
      const inner = await renderValue(ctx, scope, q.props.content ?? null);
      return `<div class="container">${inner}</div>`;
    }
    case 'page/content': {
      const title = q.props.title  ? await renderValue(ctx, scope, q.props.title)  : '';
      const intro = q.props.intro  ? await renderValue(ctx, scope, q.props.intro)  : '';
      const body  = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `${title}${intro}${body}`;
    }
    case 'page/title': {
      const label = q.props.label ? await renderValue(ctx, scope, q.props.label) : '';
      return `<h1>${label}</h1>`;
    }
    case 'page/html': {
      // The first positional or the `_value` slot — `<@page/html '...html...'>`
      // passes the literal as a positional. We emit it raw.
      const positional = q.props['0'] ?? q.props._value ?? null;
      if (positional !== null) return await renderValue(ctx, scope, positional);
      // Some call sites pass it via a backtick template, with no key. The
      // expression already evaluated to a string — same path.
      return '';
    }
  }

  // Fallback: render any nested children we can find, plus a marker.
  let out = `<!-- TODO render: <@${path}> -->`;
  for (const k of Object.keys(q.props)) {
    out += await renderValue(ctx, scope, q.props[k]!);
  }
  return out;
}

/**
 * resolveTemplate("…{{ expr }}…") — substitutes each `{{…}}` block with
 * the eval'd expression. The expression is parsed and evaluated using the
 * current request scope.
 */
export async function resolveTemplate(ctx: Ctx, scope: Scope, tpl: string): Promise<string> {
  let out = '';
  let i = 0;
  while (i < tpl.length) {
    const open = tpl.indexOf('{{', i);
    if (open === -1) { out += tpl.slice(i); break; }
    out += tpl.slice(i, open);
    const close = tpl.indexOf('}}', open + 2);
    if (close === -1) throw new Error(`resolveTemplate: unmatched '{{' starting at ${open}`);
    const exprSrc = tpl.slice(open + 2, close);
    try {
      const tokens = lex(exprSrc, '<template>');
      const ast    = parseExpression(tokens, '<template>');
      const v      = await evalExpr(ctx, scope, ast);
      // Qualifier values inside {{…}} are rendered recursively. This is
      // how `{{[main]}}` in a shell substitutes the inner page body.
      if (isQualifier(v)) out += await renderValue(ctx, scope, v);
      else                out += stringifyForTemplate(v);
    } catch (e: any) {
      out += `<!-- template error: ${e?.message ?? String(e)} -->`;
    }
    i = close + 2;
  }
  return out;
}

function stringifyForTemplate(v: Value): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isQualifier(v)) {
    // We can't synchronously render a qualifier from inside a sync template;
    // the rendered top-level path is async. For Phase 2 we ignore — most
    // {{…}} inside templates returns scalars (var refs, formatString, etc.)
    return '';
  }
  return '';
}

function isQualifier(v: Value): v is Qualifier {
  return typeof v === 'object' && v !== null && (v as any).__kind === 'Qualifier';
}
