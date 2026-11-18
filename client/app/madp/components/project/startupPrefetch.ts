// Start-up prefetch: as soon as the workspace is known, starts the project and step reads named by the URL (one batched /api/data call).
import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "@/madp/blocks/queryClient";
import { projectItemOptions } from "@/madp/blocks/projects/reads";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { preloadStepChunk, prefetchProjectStep, stepSlugOf } from "./stepPrefetch";

let stop: (() => void) | null = null;

/** Prefetches the project and step reads from the URL once the workspace id is set; idempotent, returns the unsubscribe. */
export function startProjectStartupPrefetch(o: { client?: QueryClient; path?: () => string } = {}): () => void {
  if (stop) return stop;
  const client = o.client ?? queryClient;
  const path = o.path ?? (() => globalThis.location?.pathname ?? "");
  const run = (ws: string) => {
    const p = path();
    const id = /^\/p\/([^/?#]+)/.exec(p)?.[1];
    if (!id || !isBlocksProjectId(id)) return;
    void client.prefetchQuery(projectItemOptions(ws, id) as never).catch(() => {});
    const slug = stepSlugOf(p);
    if (slug) {
      preloadStepChunk(slug);
      prefetchProjectStep(client, ws, id, slug);
    }
  };
  const unsubscribe = useWorkspaces.subscribe((state, prev) => {
    if (state.workspaceId && state.workspaceId !== prev.workspaceId) run(state.workspaceId);
  });
  const current = useWorkspaces.getState().workspaceId;
  if (current) run(current);
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}
