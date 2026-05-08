/**
 * BO registry — Phase 3.
 *
 * CaseMaster `<@bo>` declarations live inside `resource main` of files
 * under `bo/`. We extract them statically (no DB / runtime needed) by
 * walking the AST: the resource body is a `<@bo>` qualifier with literal
 * props, including `table: '…'` and `attributes: <name1: <@bo/attribute
 * column: '…'>, …>`.
 *
 * The result is a flat `Map<boName, BOInfo>` keyed by the path-derived
 * name (e.g. `bo/qr/labelTemplate.cms` → `qr/labelTemplate`). The
 * iterator builtin uses this to translate `entity: 'qr/labelTemplate'`
 * into `SELECT … FROM qr_label_template`.
 */

import * as A from './ast.js';

export interface BOAttr {
  column: string;
  label?: string;            // human-readable header for tables/forms
  dataType?: string;
  foreignKey?: string;
}

export interface BOInfo {
  name: string;
  table: string;
  primaryKey: string;
  attributes: Map<string, BOAttr>;
  // attributeGroups: { list: [...], description: [...], search: [...] }.
  // The page table renderer reads `groups.get('list')` when a page declares
  // `<@page/data/table group: 'list'>`. listGroup is kept as a back-compat
  // alias for the 'list' group.
  groups: Map<string, string[]>;
  listGroup: string[];
}

/**
 * Extract a BOInfo from a parsed `resource main` body. Returns null when
 * the resource isn't a `<@bo>` declaration (most resources aren't).
 */
export function tryExtractBo(name: string, resource: A.Resource): BOInfo | null {
  const q = unwrapQualifier(resource.body);
  if (!q || q.path.join('/') !== 'bo') return null;

  const table      = readString(q.props.table)      ?? '';
  const primaryKey = readString(q.props.primaryKey) ?? 'id';
  if (!table) return null;

  const attributes = new Map<string, BOAttr>();
  const attrList = q.props.attributes;
  if (attrList && attrList.kind === 'Qualifier' && attrList.path[0] === '_list') {
    for (const [attrName, attrExpr] of Object.entries(attrList.props)) {
      // Skip positional entries (numeric keys) — only named attrs matter.
      if (/^\d+$/.test(attrName)) continue;
      const aq = unwrapQualifier(attrExpr);
      if (!aq) continue;
      const column = readString(aq.props.column) ?? attrName;
      attributes.set(attrName, {
        column,
        label: readString(aq.props.label),
        dataType: readMember(aq.props.dataType),
        foreignKey: readString(aq.props.foreignKey),
      });
    }
  }

  // Capture every attribute group, not just `list` — pages also bind
  // `group: 'description'` / `'search'` / etc. The map keys are the group
  // names; values are the ordered attribute-name lists.
  const groups = new Map<string, string[]>();
  const grp = q.props.attributeGroups;
  if (grp && grp.kind === 'Qualifier' && grp.path[0] === '_list') {
    for (const [groupName, groupExpr] of Object.entries(grp.props)) {
      if (/^\d+$/.test(groupName)) continue;
      const gq = unwrapQualifier(groupExpr);
      if (!gq || gq.path[0] !== '_list') continue;
      const items: string[] = [];
      for (const [k, v] of Object.entries(gq.props)) {
        if (!/^\d+$/.test(k)) continue;
        const s = readString(v);
        if (s) items.push(s);
      }
      groups.set(groupName, items);
    }
  }
  const listGroup = groups.get('list') ?? [];

  return { name, table, primaryKey, attributes, groups, listGroup };
}

function unwrapQualifier(e: A.Expr | undefined): A.Qualifier | null {
  if (!e) return null;
  if (e.kind === 'Qualifier') return e;
  return null;
}
function readString(e: A.Expr | undefined): string | undefined {
  if (!e) return undefined;
  if (e.kind === 'StrLit') return e.value;
  return undefined;
}
function readMember(e: A.Expr | undefined): string | undefined {
  if (!e) return undefined;
  if (e.kind === 'MemberAcc' && e.object.kind === 'Ident') {
    return `${e.object.name}.${e.member}`;
  }
  return undefined;
}
