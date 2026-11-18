// The ONE adapter for the active workspace, the project's journey step and the caller's workspace permissions.
// Workspace, caller and permissions come from src/blocks/context.ts.
import { useMemo } from "react";
import { useBlocksItem } from "../data/hooks";
import { useSession } from "../session";
import { useBlocksContext } from "../context";
import { can, type WorkspacePermission } from "../../domain/rbac";
import { JOURNEY_STEPS, stepIndex, type JourneyStep } from "../../domain/journey";
import { isRequirementsStepOpen } from "../../domain/requirements";
import { PROJECT_FIELDS, SCHEMA, toProjectRecord, type ProjectRecord, type ProjectRow } from "./records";

export function useActiveWorkspaceId(): string | null {
  return useBlocksContext().workspaceId;
}

export interface RequirementsContext {
  ready: boolean;
  workspaceId: string | null;
  projectId: string | null;
  project: ProjectRecord | null;
  stage: string | null;
  /** The journey step is `requirements`: edits are allowed. */
  open: boolean;
  /** The project is past the requirements step. */
  past: boolean;
  /** The project is before the requirements step. */
  before: boolean;
  permissions: readonly WorkspacePermission[];
  canView: boolean;
  canEditRequirements: boolean;
  canEditDesign: boolean;
  actorUserId: string | null;
}

const isJourneyStep = (s: string | null): s is JourneyStep => !!s && (JOURNEY_STEPS as readonly string[]).includes(s);

export function useRequirementsContext(projectId: string | null | undefined): RequirementsContext {
  const { workspaceId, permissions, userId } = useBlocksContext();
  const q = useBlocksItem<ProjectRow>(SCHEMA.project, projectId, { workspaceId, fields: PROJECT_FIELDS });
  const row = q.data ?? null;
  const project = useMemo(() => (row ? toProjectRecord(row) : null), [row]);
  const stage = project?.stage ?? null;
  const reqIdx = stepIndex("requirements");
  const known = isJourneyStep(stage);
  return {
    ready: Boolean(workspaceId && projectId && project),
    workspaceId,
    projectId: projectId ?? null,
    project,
    stage,
    open: isRequirementsStepOpen(stage),
    past: known && stepIndex(stage) > reqIdx,
    before: known && stepIndex(stage) < reqIdx,
    permissions,
    canView: can(permissions, "view"),
    canEditRequirements: can(permissions, "requirements.edit"),
    canEditDesign: can(permissions, "design.edit"),
    actorUserId: userId,
  };
}

/** Resolves a workspace member's name from the members held today (matched by the signed-in person's email); null when unknown. */
export function useMemberName(): (userId: string | null | undefined) => string | null {
  const { members } = useBlocksContext();
  const profile = useSession((s) => s.profile);
  return useMemo(
    () => (userId) => {
      if (!userId) return null;
      const byId = members.find((m) => m.id === userId);
      if (byId) return byId.name || null;
      if (profile && profile.userId === userId) {
        const mine = members.find((m) => m.email.toLowerCase() === profile.email.toLowerCase());
        return mine?.name || profile.displayName || null;
      }
      return null;
    },
    [members, profile],
  );
}
