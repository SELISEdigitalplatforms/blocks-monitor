// The ONE adapter of the scope page onto the data layer. The Project bootstrap is a gateway read (queryById; the row policy
// limits it to members); members and permissions come from src/blocks/context.ts. Permissions here only gate the UI; the
// functions check them again.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryById } from "../data/gql";
import { FORMER_MEMBER as FORMER, useBlocksContext } from "../context";
import type { WorkspacePermission } from "../../domain/rbac";
import {
  PROJECT_FIELDS,
  SCHEMA,
  projectFromRow,
  type ProjectRecord,
  type RawRow,
} from "./records";

export const FORMER_MEMBER = FORMER;

/** The scope page's private Project cache entry (a mapped ProjectRecord): lock and unlock patch it. */
export const scopeProjectKey = (projectId: string) => ["scope", "project", projectId] as const;

export interface ScopeMember {
  userId: string;
  name: string;
}

export interface ScopeContext {
  status: "loading" | "ready" | "notFound" | "error";
  error: unknown;
  projectId: string;
  workspaceId: string | null;
  project: ProjectRecord | null;
  userId: string | null;
  isSuperAdmin: boolean;
  permissions: readonly WorkspacePermission[];
  can(permission: WorkspacePermission): boolean;
  members: readonly ScopeMember[];
  memberName(userId: string): string;
}

export function useScopeContext(projectId: string): ScopeContext {
  const bc = useBlocksContext();
  const { userId, isSuperAdmin } = bc;

  const boot = useQuery<ProjectRecord | "unreadable" | null>({
    queryKey: scopeProjectKey(projectId),
    queryFn: async () => {
      const row = await queryById<RawRow>(SCHEMA.project, projectId, PROJECT_FIELDS);
      if (!row) return null;
      return projectFromRow(row) ?? "unreadable";
    },
    enabled: Boolean(projectId),
  });
  const project = boot.data && boot.data !== "unreadable" ? boot.data : null;
  const workspaceId = project?.workspaceId ?? null;

  // Members and permissions come from the shared context (the active workspace); the project may belong to another one.
  const sameWorkspace = !workspaceId || workspaceId === bc.workspaceId;
  const members = useMemo<ScopeMember[]>(
    () =>
      bc.members
        .filter((m) => m.status === "active" && m.id)
        .map((m) => ({ userId: m.id, name: m.name || m.email || FORMER_MEMBER })),
    [bc.members],
  );
  const permissions = sameWorkspace ? bc.permissions : [];

  let status: ScopeContext["status"] = "ready";
  let error: unknown = null;
  if (boot.isError) (status = "error"), (error = boot.error);
  else if (boot.isLoading) status = "loading";
  else if (boot.data === null) status = "notFound";
  else if (boot.data === "unreadable") (status = "error"), (error = new Error("The project record is unreadable."));

  return {
    status,
    error,
    projectId,
    workspaceId,
    project,
    userId,
    isSuperAdmin,
    permissions,
    can: (p) => permissions.includes(p),
    members,
    memberName: (id) => bc.memberName(id),
  };
}
