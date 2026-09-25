import { KIND_TYPES, LINK_TYPES, type ParsedQuery, type TypeName } from "../shared/query";
import { colorFamily, hexToLab } from "./colors";

export type SortOrder = "newest" | "oldest" | "updated" | "title" | "random" | "relevance";

export interface SearchSql {
  /** Extra FROM clause (a ranked FTS join) or empty string. */
  join: string;
  joinParams: unknown[];
  where: string[];
  params: unknown[];
  hasRank: boolean;
}

/** Quotes a user term for FTS5, optionally as a prefix match. */
export function ftsTerm(term: string, prefix = true): string {
  const clean = term.replace(/"/g, '""').trim();
  if (!clean) return "";
  return prefix ? `"${clean}"*` : `"${clean}"`;
}

function ftsMatchFor(words: string[], phrases: string[]): string {
  return [...words.map((w) => ftsTerm(w, true)), ...phrases.map((p) => ftsTerm(p, false))]
    .filter(Boolean)
    .join(" ");
}

function typeCondition(types: TypeName[], params: unknown[]): string {
  const kinds = types.filter((t) => KIND_TYPES.includes(t));
  const linkTypes = types.filter((t) => LINK_TYPES.includes(t) || t === "video");
  const parts: string[] = [];
  if (kinds.length) {
    parts.push(`items.kind IN (${kinds.map(() => "?").join(",")})`);
    params.push(...kinds);
  }
  if (linkTypes.length) {
    parts.push(`items.link_type IN (${linkTypes.map(() => "?").join(",")})`);
    params.push(...linkTypes);
  }
  return parts.length ? `(${parts.join(" OR ")})` : "0";
}

function colorCondition(color: string, params: unknown[]): string {
  const family = colorFamily(color);
  if (family) {
    params.push(family);
    return "EXISTS (SELECT 1 FROM item_colors c WHERE c.item_id = items.id AND c.name = ? AND c.weight >= 0.08)";
  }
  const lab = hexToLab(color);
  params.push(lab.l, lab.l, lab.a, lab.a, lab.b, lab.b);
  return `EXISTS (SELECT 1 FROM item_colors c WHERE c.item_id = items.id AND c.weight >= 0.05
    AND ((c.l - ?) * (c.l - ?) + (c.a - ?) * (c.a - ?) + (c.b - ?) * (c.b - ?)) < 400)`;
}

export function buildSearch(q: ParsedQuery): SearchSql {
  const where: string[] = [];
  const params: unknown[] = [];
  let join = "";
  const joinParams: unknown[] = [];

  const match = ftsMatchFor(q.words, q.phrases);
  if (match) {
    join = `JOIN (SELECT item_id, bm25(items_fts, 0.0, 10.0, 4.0, 6.0, 2.0) AS rank
                  FROM items_fts WHERE items_fts MATCH ?) f ON f.item_id = items.id`;
    joinParams.push(match);
  }

  for (const soft of q.soft) {
    const alt: string[] = [];
    const altParams: unknown[] = [];
    if (soft.color) alt.push(colorCondition(soft.color, altParams));
    if (soft.type) alt.push(typeCondition([soft.type], altParams));
    where.push(
      `(items.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ?) OR ${alt.join(" OR ")})`,
    );
    params.push(ftsTerm(soft.word), ...altParams);
  }

  for (const w of q.notWords) {
    where.push("items.id NOT IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ?)");
    params.push(ftsTerm(w, !w.includes(" ")));
  }

  if (q.types.length) where.push(typeCondition(q.types, params));
  if (q.notTypes.length) where.push(`NOT ${typeCondition(q.notTypes, params)}`);

  for (const tag of q.tags) {
    where.push("EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id AND t.tag = ?)");
    params.push(tag);
  }
  for (const tag of q.notTags) {
    where.push("NOT EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id AND t.tag = ?)");
    params.push(tag);
  }

  if (q.sites.length) {
    where.push(`(${q.sites.map(() => "(items.domain = ? OR items.domain LIKE ?)").join(" OR ")})`);
    for (const s of q.sites) params.push(s, `%.${s}`);
  }
  for (const s of q.notSites) {
    where.push("NOT (COALESCE(items.domain, '') = ? OR COALESCE(items.domain, '') LIKE ?)");
    params.push(s, `%.${s}`);
  }

  for (const c of q.colors) where.push(colorCondition(c, params));

  for (const name of q.collections) {
    where.push(`items.id IN (SELECT ci.item_id FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
      WHERE c.deleted_at IS NULL AND lower(c.name) = lower(?))`);
    params.push(name);
  }

  const hasCondition = (what: string): string | null => {
    switch (what) {
      case "note":
      case "notes":
        return "(items.note IS NOT NULL AND items.note != '')";
      case "tag":
      case "tags":
        return "EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = items.id)";
      case "url":
      case "link":
        return "items.url IS NOT NULL";
      case "image":
      case "preview":
        return "(items.preview IS NOT NULL OR items.kind = 'image')";
      case "summary":
        return "items.summary IS NOT NULL";
      case "collection":
        return "EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = items.id)";
      default:
        return null;
    }
  };
  for (const h of q.has) {
    const c = hasCondition(h);
    if (c) where.push(c);
  }
  for (const h of q.notHas) {
    const c = hasCondition(h);
    if (c) where.push(`NOT ${c}`);
  }

  if (q.pinned !== undefined) where.push(q.pinned ? "items.pinned_at IS NOT NULL" : "items.pinned_at IS NULL");
  if (q.after !== undefined) {
    where.push("items.created_at >= ?");
    params.push(q.after);
  }
  if (q.before !== undefined) {
    where.push("items.created_at < ?");
    params.push(q.before);
  }

  return { join, joinParams, where, params, hasRank: !!match };
}

export function orderClause(sort: SortOrder, hasRank: boolean, seed = 1): string {
  switch (sort) {
    case "oldest":
      return "items.created_at ASC, items.id ASC";
    case "updated":
      return "items.updated_at DESC, items.id DESC";
    case "title":
      return "lower(COALESCE(items.title, items.asset_name, items.body, '')) ASC, items.id ASC";
    case "random":
      // Stable pseudo-random order for a given seed, so pagination works.
      return `((unicode(substr(items.id, 26, 1)) * ${seed % 9973} + unicode(substr(items.id, 23, 1)) * 31 + unicode(substr(items.id, 20, 1)) * 7 + unicode(substr(items.id, 17, 1))) % 1009), items.id`;
    case "relevance":
      return hasRank ? "f.rank ASC, items.created_at DESC" : "items.created_at DESC, items.id DESC";
    case "newest":
    default:
      return "items.created_at DESC, items.id DESC";
  }
}
