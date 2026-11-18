/**
 * Wiki: shared rules for WikiPage and WikiPageHistory.
 * Pure (imports only other src/domain files), so the collab functions and the web bundle it alike.
 */
export const WIKI_GROUP_IDS = ["overview", "guide", "features", "logic", "technical", "decisions", "releases"] as const;
export type WikiGroup = (typeof WIKI_GROUP_IDS)[number];

export const WIKI_GROUPS: readonly { id: WikiGroup; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "guide", label: "Guide" },
  { id: "features", label: "Features" },
  { id: "logic", label: "Logic" },
  { id: "technical", label: "Technical" },
  { id: "decisions", label: "Decisions" },
  { id: "releases", label: "Releases" },
];

export function isWikiGroup(x: unknown): x is WikiGroup {
  return typeof x === "string" && (WIKI_GROUP_IDS as readonly string[]).includes(x);
}

export const WIKI_ORIGINS = ["factory", "person"] as const;
export type WikiOrigin = (typeof WIKI_ORIGINS)[number];

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9/-]{0,120}$/;
const SLUG_MAX = 121;

export const TITLE_MAX = 200;
export const BODY_MAX = 200000;
export const SOURCES_MAX = 20000;
export const HISTORY_CAP = 50;
export const HISTORY_PRUNE_PER_CALL = 10;
export const MAX_PAGES = 300;

const cut = (s: string, max: number): string => s.slice(0, max).replace(/-+$/, "");

export function slugify(title: string): string {
  const s = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const out = cut(s, SLUG_MAX);
  return out === "" ? "page" : out;
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${cut(base, SLUG_MAX - suffix.length)}${suffix}`;
    if (!set.has(candidate)) return candidate;
  }
}

/** Rows beyond the newest HISTORY_CAP (by at, then id, descending). */
export function historyToPrune<T extends { id: string; at: string }>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort((a, b) =>
    a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id !== b.id ? (a.id < b.id ? 1 : -1) : 0,
  );
  return sorted.slice(HISTORY_CAP);
}

export interface WikiSources {
  order: number | null;
  items: { label: string; ref: string }[];
}

const NO_SOURCES = (): WikiSources => ({ order: null, items: [] });

export function parseSources(json: string | null | undefined): WikiSources {
  if (typeof json !== "string" || json.length === 0 || json.length > SOURCES_MAX) return NO_SOURCES();
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return NO_SOURCES();
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return NO_SOURCES();
  const o = v as Record<string, unknown>;
  let order: number | null = null;
  if (o.order !== undefined) {
    if (typeof o.order !== "number" || !Number.isFinite(o.order)) return NO_SOURCES();
    order = o.order;
  }
  const items: { label: string; ref: string }[] = [];
  if (o.items !== undefined) {
    if (!Array.isArray(o.items) || o.items.length > 100) return NO_SOURCES();
    for (const it of o.items) {
      if (typeof it !== "object" || it === null) return NO_SOURCES();
      const { label, ref } = it as Record<string, unknown>;
      if (typeof label !== "string" || typeof ref !== "string") return NO_SOURCES();
      items.push({ label, ref });
    }
  }
  return { order, items };
}

export function sortPages<T extends { group: string; title: string; sourcesJson?: string | null }>(
  pages: readonly T[],
): T[] {
  const rank = (g: string): number => {
    const i = (WIKI_GROUP_IDS as readonly string[]).indexOf(g);
    return i < 0 ? WIKI_GROUP_IDS.length : i;
  };
  return pages
    .map((p) => ({ p, order: parseSources(p.sourcesJson).order }))
    .sort((a, b) => {
      const g = rank(a.p.group) - rank(b.p.group);
      if (g !== 0) return g;
      if (a.order !== b.order) {
        if (a.order === null) return 1;
        if (b.order === null) return -1;
        return a.order - b.order;
      }
      return a.p.title.localeCompare(b.p.title, undefined, { sensitivity: "base" });
    })
    .map((x) => x.p);
}

export function canDeletePage(origin: string): boolean {
  return origin === "person";
}
export function canRetitlePage(origin: string): boolean {
  return origin === "person";
}

export function wikiJobInput(projectId: string): { projectId: string } {
  return { projectId };
}
