/** Reads the rows a scope job wrote as soon as the job ends (not on the next poll): the plan the business analyst
 *  drafted shows up by itself. */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { blocksKeys } from "@/blocks/data/keys";
import type { ScopeContext } from "@/blocks/scope/context";

const ACTIVE = new Set(["queued", "claimed", "running"]);

export function useJobRefresh(ctx: ScopeContext, job: { status: string } | null | undefined, schemas: readonly string[]): void {
  const client = useQueryClient();
  const last = useRef(job?.status);
  useEffect(() => {
    if (last.current && ACTIVE.has(last.current) && job && !ACTIVE.has(job.status) && ctx.workspaceId) {
      for (const s of schemas) void client.invalidateQueries({ queryKey: [...blocksKeys.schema(ctx.workspaceId, s)] });
    }
    last.current = job?.status;
  }, [job, job?.status, client, ctx.workspaceId, schemas]);
}
