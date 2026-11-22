// The ONE adapter of this module onto the shared Blocks context (src/blocks/context.ts).
import { useMemo } from "react";
import { FORMER_MEMBER as FORMER, getBlocksContext, useBlocksContext } from "../context";
import type { WorkspacePermission } from "../../domain/rbac";

export interface ProjectsContext {
  workspaceId: string | null;
  userId: string | null;
  permissions: readonly WorkspacePermission[];
  isSuperAdmin: boolean;
}

export const FORMER_MEMBER = FORMER;

export function useProjectsContext(): ProjectsContext {
  const { workspaceId, userId, permissions, isSuperAdmin } = useBlocksContext();
  return useMemo(() => ({ workspaceId, userId, permissions, isSuperAdmin }), [workspaceId, userId, permissions, isSuperAdmin]);
}

export function useCan(permission: WorkspacePermission): boolean {
  return useBlocksContext().can(permission);
}

/** Display name of a member; "" stays "", anyone who is not an active or invited member is "Former member". */
export function memberName(userId: string): string {
  return getBlocksContext().memberName(userId);
}

export function useMemberName(userId: string): string {
  return useBlocksContext().memberName(userId);
}

export interface MemberOption {
  userId: string;
  name: string;
  email: string;
  status: "active" | "invited";
  isSelf: boolean;
}

/** Active and invited members as options; the caller is left out unless `includeSelf`, then listed first. */
export function memberOptionsFrom(
  members: readonly { id: string; name: string; email: string; status: string }[],
  userId: string | null,
  includeSelf: boolean,
): MemberOption[] {
  const all = members.flatMap((m): MemberOption[] =>
    (m.status === "active" || m.status === "invited") && (includeSelf || m.id !== userId)
      ? [{ userId: m.id, name: m.name, email: m.email, status: m.status, isSelf: m.id === userId }]
      : []);
  return [...all.filter((m) => m.isSelf), ...all.filter((m) => !m.isSelf)];
}

/** Assignable people and share recipients: the workspace members, the caller only when `includeSelf`. */
export function useMemberOptions(opts: { includeSelf?: boolean } = {}): MemberOption[] {
  const { members, userId } = useBlocksContext();
  const includeSelf = opts.includeSelf === true;
  return useMemo(() => memberOptionsFrom(members, userId, includeSelf), [members, userId, includeSelf]);
}
