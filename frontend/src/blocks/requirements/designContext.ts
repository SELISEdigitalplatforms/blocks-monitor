import { useQuery } from "@tanstack/react-query";
import { callFunction } from "../fn";
import { blocksKeys } from "../data/keys";
import { freshnessQuery } from "../data/freshness";
import { useActiveWorkspaceId } from "./context";
import type { DesignIntent, DesignSources } from "@/domain/factoryDesign";

/** The design context's cache key: under the workspace's DesignBrief schema, so a design job that ends (its outputs are
 *  DesignBrief, src/domain/engineJob.ts) and every DesignBrief write read it again at once. */
export const designContextKey = (workspaceId: string, projectId: string) =>
  [...blocksKeys.schema(workspaceId, "DesignBrief"), { kind: "design-intent", id: projectId }] as const;

/** What the design is drawn from (the project's answers, requirements and brief), read at the LIVE tier (30 s, paused
 *  while the tab is hidden): it was read every 10 s with no cache for as long as a page showed it. */
export function useDesignContext(projectId: string) {
  const workspaceId = useActiveWorkspaceId();
  return useQuery({ queryKey: designContextKey(workspaceId ?? "", projectId), enabled: Boolean(workspaceId && projectId),
    queryFn: async () => (await callFunction<{ intent: DesignIntent } & DesignSources>("project", "designBrief.context", { projectId })).data,
    ...freshnessQuery("live"),
  });
}
