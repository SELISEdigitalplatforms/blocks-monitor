// A new bell item tells which cached data just changed; refresh exactly that (polled and doorbell arrivals alike).
import { useEffect, useRef } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { isEngineJobKind } from "@/domain/engineJob";
import { finishRefreshSchemas } from "../engine/jobs";
import { blocksKeys } from "../data/keys";
import { queryClient } from "../queryClient";
import { useSession } from "../session";
import { useBell, type BellItem } from "../workspaces/bell";
import { meKeys } from "../workspaces/queries";
import { currentWorkspace, useWorkspaces } from "../workspaces/store";

/** Notification kind -> the schemas whose cached lists it makes stale. job.* adds what the job kind writes
 *  (finishRefreshSchemas: its outputs and the rows it moves besides them). */
export const REFRESH_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  assigned: ["Project", "ProjectAssignment"],
  shared: ["Share"],
  "business.handed-over": ["Project", "Requirement", "Objective", "ItemVersion"],
  "requirements.ready": ["Project", "Requirement", "Objective", "ItemVersion"],
  "scope.ready": ["Project", "Requirement", "Objective", "ItemVersion"],
  "build.started": ["EngineJob", "Project"],
  "job.succeeded": ["EngineJob"],
  "job.failed": ["EngineJob"],
  "approval.requested": ["ApprovalRequest", "ApprovalStep"],
  "approval.decided": ["ApprovalRequest", "ApprovalStep"],
  // the build that made the release moved its milestone and the project (src/blocks/engine/jobs.ts build.run)
  "release.created": ["Release", "ChangeRequest", "Milestone", "Project"],
  "release.promoted": ["Release", "ChangeRequest"],
  "change.released": ["Release", "ChangeRequest"],
  "preview.ready": ["Preview", "Milestone"],
};

export function arrivalKeys(item: BellItem, activeWorkspaceId: string | null, userId?: string): QueryKey[] {
  if (item.kind === "invited") {
    const uid = userId ?? useSession.getState().profile?.userId ?? "";
    return uid ? [meKeys.memberships(uid), meKeys.workspaces(uid)] : [];
  }
  if (item.kind === "access-requested") {
    const uid = userId ?? useSession.getState().profile?.userId ?? "";
    return uid ? [meKeys.admin(uid, "accessRequest.list") as QueryKey] : [];
  }
  const base = REFRESH_BY_KIND[item.kind];
  if (!base || !activeWorkspaceId) return [];
  if ((item.workspaceId ?? item.params.workspaceId) !== activeWorkspaceId) return [];
  const schemas = [...base];
  if (item.kind === "job.succeeded" || item.kind === "job.failed") {
    const jobKind = item.params.jobKind;
    // the same rows the job list reads again when it sees the job end (its outputs and what else that kind writes)
    if (isEngineJobKind(jobKind)) schemas.push(...finishRefreshSchemas(jobKind));
  }
  const keys = [...new Set(schemas)].map((s) => blocksKeys.schema(activeWorkspaceId, s) as QueryKey);
  // the Scope and Build/Release pages keep the project row under their own keys (scopeProjectKey, deliveryProjectKey)
  if (schemas.includes("Project")) keys.push(["scope", "project"], ["delivery", "project"]);
  return keys;
}

/** Mount once (Shell). The first load only records ids; later new unread items refresh their data. */
export function useBellArrivals(): void {
  const { items, isLoading } = useBell();
  const uid = useSession((s) => s.profile?.userId ?? "");
  const wsState = useWorkspaces((s) => s);
  const activeWs = currentWorkspace(wsState)?.id ?? null;
  const seen = useRef<Set<string> | null>(null);
  const owner = useRef("");
  useEffect(() => {
    if (owner.current !== uid) {
      owner.current = uid;
      seen.current = null;
    }
    if (!uid || isLoading) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    for (const item of items) {
      if (seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      if (item.read) continue;
      for (const key of arrivalKeys(item, activeWs, uid)) {
        void Promise.resolve(queryClient.invalidateQueries({ queryKey: key })).catch(() => undefined);
      }
    }
  }, [items, isLoading, uid, activeWs]);
}
