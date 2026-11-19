// Warms a project step before it opens: the step's lazy chunk and its first-paint reads (one /api/data call via the transport).
import type { QueryClient } from "@tanstack/react-query";
import type { JourneyStep } from "@/madp/domain/journey";
import { stepPath } from "@/madp/domain/phases";
import { docTreeQueries } from "@/madp/blocks/projects/docReads";
import { objectiveQueryOptions, requirementsQueryOptions, itemVersionsMetaQueryOptions } from "@/madp/blocks/requirements/hooks";
import {
  clarificationsOptions, projectOptions, membersOptions,
} from "@/madp/blocks/sanitization/hooks";

/** The segment after /p/:id/, e.g. "business"; null when the path is not a project step. Matches both /p/:id/:slug and /app/:itemId/p/:id/:slug. */
export function stepSlugOf(pathname: string): string | null {
  const m = /\/p\/[^/]+\/([^/?#]+)/.exec(pathname);
  return m ? m[1] : null;
}

/** The page slug a project at `step` opens on (/p/:id opens stepPath): "analysis" for the Business Analysis steps. */
export function openSlugOf(step: JourneyStep): string {
  return stepSlugOf(stepPath("_", step)) ?? "business";
}

// The same specifiers App.tsx lazy-loads (Business Analysis: the route's module and the approved page it shows).
const CHUNKS: Record<string, () => Promise<unknown>> = {
  business: () => import("@/madp/pages/ProjectStep"),
  requirements: () => import("@/madp/pages/ProjectStep"),
  sanitization: () => import("@/madp/pages/Sanitization"),
  scope: () => import("@/madp/pages/Scope"),
  analysis: () => Promise.all([import("@/madp/pages/Analysis"), import("@/madp/pages/AnalysisNext")]),
  board: () => import("@/madp/pages/Board"),
  build: () => import("@/madp/pages/Build"),
  delivered: () => import("@/madp/pages/Delivered"),
  wiki: () => import("@/madp/pages/Wiki"),
};

/** The step whose page an address opens: /p/:id/analysis-next redirects to /p/:id/analysis. */
const pageSlug = (slug: string): string => (slug === "analysis-next" ? "analysis" : slug);

const loaded = new Set<string>();

/** Starts loading the step's chunk (at most once per page module; errors are swallowed). */
export function preloadStepChunk(slug: string): void {
  slug = pageSlug(slug);
  const load = CHUNKS[slug];
  if (!load) return;
  const key = slug === "requirements" ? "business" : slug;
  if (loaded.has(key)) return;
  loaded.add(key);
  try {
    load().catch(() => loaded.delete(key));
  } catch {
    loaded.delete(key);
  }
}

/** Starts the step's first-paint reads with the exact options its hooks use; fresh data costs no request. */
export function prefetchProjectStep(client: QueryClient, workspaceId: string, projectId: string, slug: string): void {
  const start = (o: Parameters<QueryClient["prefetchQuery"]>[0]) => void client.prefetchQuery(o).catch(() => {});
  slug = pageSlug(slug);
  if (slug === "business") {
    const q = docTreeQueries(workspaceId, projectId);
    start(q.folders);
    start(q.notes);
    start(q.files);
  } else if (slug === "requirements" || slug === "analysis") {
    start(objectiveQueryOptions(workspaceId, projectId));
    start(requirementsQueryOptions(workspaceId, projectId));
    start(itemVersionsMetaQueryOptions(workspaceId, projectId));
  }
  if (slug === "sanitization" || slug === "analysis") {
    const ctx = { workspaceId, projectId };
    start(projectOptions(ctx));
    start(membersOptions(ctx));
    start(clarificationsOptions(ctx));
  }
}
