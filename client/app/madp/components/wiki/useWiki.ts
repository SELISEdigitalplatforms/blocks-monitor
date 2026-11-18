/** The wiki of one Blocks project as the screen reads it: the page tree, the open page's body and what the person may do. */
import { useMemo } from "react";
import { formatDateTime } from "@/madp/lib/dates";
import type { WikiPage } from "@/madp/data/wiki/types";
import { useCan } from "@/madp/blocks/collab/context";
import { useWikiBody, useWikiPages } from "@/madp/blocks/collab/wiki";
import { t } from "@/madp/i18n";

/** Same classes as the key hints elsewhere in the app. */
export const KBD = "rounded-md bg-surface2 px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink2 ring-1 ring-inset ring-line";

/** Scrolling in script follows the reduced-motion setting too (the CSS rule only covers animations). */
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "19 Oct 2026, 14:05" in the reader's time zone; "" for anything that is not a date. */
export function formatWhen(iso: string): string {
  return formatDateTime(iso);
}

/** Client and project, joined with a dot. */
export function wikiEyebrow(name: string, client: string | undefined): string {
  return [client?.trim() ?? "", name.trim()].filter(Boolean).join(" · ") || t("wiki.view.eyebrowFallback", "Project");
}

/** Only people with wiki.edit change the wiki. */
export function useCanEditWiki(): boolean {
  return useCan("wiki.edit");
}

export function useWikiData(projectId: string) {
  const tree = useWikiPages(projectId);
  const pages: WikiPage[] = useMemo(() => tree.data ?? [], [tree.data]);
  return { pages, loading: tree.isLoading, error: tree.error ?? null, refetch: () => void tree.refetch() };
}

/** The open page with its body; `loading` until the body is read. */
export function useOpenPage(page: WikiPage | undefined): { page: WikiPage | undefined; loading: boolean; error: Error | null } {
  const body = useWikiBody(page?.id);
  const full = body.data ?? undefined;
  return {
    page: page && full ? { ...page, bodyMd: full.bodyMd, updatedAt: full.updatedAt || page.updatedAt } : undefined,
    loading: Boolean(page) && body.isLoading,
    error: (body.error as Error | null) ?? null,
  };
}
