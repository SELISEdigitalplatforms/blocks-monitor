/** Warming the app pages the cinematic walk ends on, while the visitor is still walking: the lazy page chunks, then
 *  the first-paint reads of the Business step (as soon as the project exists) and of step 2 (once it is handed over),
 *  with the exact query options the pages use, so they open from cache. Failures are ignored (the page loads itself). */
import { queryClient } from "@/blocks/queryClient";
import { projectItemOptions } from "@/blocks/projects/reads";
import { preloadStepChunk, prefetchProjectStep } from "@/components/project/stepPrefetch";

/** the Business and step-2 page chunks (no data needed) */
export function warmStepChunks(): void {
  preloadStepChunk("business");
  preloadStepChunk("sanitization");
}

/** the project and the Business step's document tree */
export function warmBusinessStep(workspaceId: string, projectId: string): void {
  warmStepChunks();
  void queryClient.prefetchQuery(projectItemOptions(workspaceId, projectId) as never).catch(() => {});
  prefetchProjectStep(queryClient, workspaceId, projectId, "business");
}

/** step 2 (Product sanitization / Existing product analysis) right after the hand-over */
export function warmStep2(workspaceId: string, projectId: string): void {
  preloadStepChunk("sanitization");
  prefetchProjectStep(queryClient, workspaceId, projectId, "sanitization");
}
