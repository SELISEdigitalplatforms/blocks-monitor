import { WIKI_GROUPS, isWikiGroup, type WikiGroup, type WikiOrigin } from "@/domain/wiki";

export { WIKI_GROUPS, isWikiGroup };
export type { WikiGroup, WikiOrigin };

/** The kind of record a source line points at. */
export type WikiSourceKind =
  | "brief"
  | "requirement"
  | "feature"
  | "story"
  | "screen"
  | "slice"
  | "artifact"
  | "gate"
  | "release"
  | "change"
  | "fix"
  | "decision";

/** One source line shown under a page. */
export interface WikiSource {
  kind: WikiSourceKind | string;
  label: string;
  ref?: string;
}

/** A wiki page as the screen and the search read it (built from a WikiPage record). */
export interface WikiPage {
  id: string;
  projectId: string;
  slug: string;
  group: WikiGroup;
  title: string;
  /** Position inside the group, ascending. */
  order: number;
  bodyMd: string;
  sources: WikiSource[];
  origin: WikiOrigin;
  updatedWithVersion: string;
  /** ISO timestamp of the last write; the stale check of wiki.page.save compares it. */
  updatedAt: string;
}

/** Lower-case, accent-free, hyphenated anchor id (max 60 characters); "section" when empty. */
export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "section";
}

/** A new array of pages sorted by group, then order, then title. */
export function sortPages(pages: WikiPage[]): WikiPage[] {
  const gi = (g: WikiGroup) => WIKI_GROUPS.findIndex((x) => x.id === g);
  return [...pages].sort(
    (a, b) => gi(a.group) - gi(b.group) || a.order - b.order || a.title.localeCompare(b.title),
  );
}
