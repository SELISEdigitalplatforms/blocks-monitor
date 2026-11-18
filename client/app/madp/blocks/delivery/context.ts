// The delivery context of one Blocks project: the Project row, its workspace, the active members and my permissions.
// The Project row is read from the Data Gateway under the row policies (UserId IN ReaderIds); members and permissions come
// from src/blocks/context.ts. The permissions here are for UI gating only, the Logic Function decides.
import { useQuery } from "@tanstack/react-query";
import { queryById } from "../data/gql";
import { useSession } from "../session";
import { FORMER_MEMBER as FORMER, useBlocksContext } from "../context";
import { workspacePermissionsFor, type RoleDef } from "../../domain/roles";
import type { WorkspacePermission } from "../../domain/rbac";
import { JOURNEY_STEPS, stepIndex, type JourneyStep } from "../../domain/journey";
import { isBlocksProjectId } from "./projectKind";
import {
  PROJECT_FIELDS,
  type MembershipRow,
  type ProjectRow,
  type WorkspaceRoleRow,
} from "./types";

export const FORMER_MEMBER = FORMER;
const MSG_UNREADABLE = "This project could not be read.";
const MSG_GENERIC = "Something went wrong. Please try again.";

export const deliveryProjectKey = (projectId: string) => ["delivery", "project", projectId] as const;

export interface DeliveryProject {
  id: string;
  workspaceId: string;
  name: string;
  stage: string;
  currentScopeVersion: number | null;
  scopeLocked: boolean;
  /** When the scope was last locked; stays set after an unlock, so read it only while scopeLocked. */
  scopeLockedAt: string | null;
  assigneeUserId: string | null;
  createdByUserId: string | null;
}

export interface DeliveryMember {
  userId: string;
  displayName: string;
  roleKey: string;
}

export interface DeliveryContext {
  projectId: string;
  status: "loading" | "ready" | "not_found" | "error";
  error: string | null;
  workspaceId: string | null;
  project: DeliveryProject | null;
  userId: string | null;
  isSuperAdmin: boolean;
  me: DeliveryMember | null;
  permissions: readonly WorkspacePermission[];
  can(p: WorkspacePermission): boolean;
  /** Active members only. */
  members: readonly DeliveryMember[];
  activeMemberIds: readonly string[];
  /** Display name; "Former member" when not an active member; "" for an empty id. */
  memberName(userId: string | null | undefined): string;
}

interface QueryPart<T> {
  loading: boolean;
  error: string | null;
  rows: readonly T[] | null | undefined;
}

export interface DeliveryContextInput {
  projectId: string;
  signedIn: boolean;
  profile: { userId: string; isSuperAdmin: boolean } | null;
  /** The bootstrap read of the Project row: `row` null means the row policy showed nothing. */
  project: { loading: boolean; error: string | null; row: ProjectRow | null | undefined };
  members: QueryPart<MembershipRow>;
  roles: QueryPart<WorkspaceRoleRow>;
  /** The shared Blocks context: when given, members, roles and permissions come from it, not from the two parts. */
  shared?: {
    permissions: readonly WorkspacePermission[];
    members: readonly { id: string; name: string; status: string; roleKey: string }[];
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The scope is locked from the Board step on. ScopeLockedAt stays set after an unlock (a DateTime cannot be cleared),
 *  so the real Stage decides; an unknown stage is not locked. */
/** True when the project stands at Build or later; a paused or abandoned project counts at the step it resumes at. */
function lockedAtStage(stage: string, resumeTo?: string): boolean {
  const step = stage === "paused" || stage === "abandoned" ? resumeTo ?? "" : stage;
  return (JOURNEY_STEPS as readonly string[]).includes(step) && stepIndex(step as JourneyStep) >= stepIndex("board");
}

/** A Project row as the context shape, or null when it is unusable. */
export function toDeliveryProject(row: ProjectRow | null | undefined): DeliveryProject | null {
  if (!row || typeof row.ItemId !== "string" || !row.ItemId) return null;
  const workspaceId = str(row.WorkspaceId);
  if (!workspaceId) return null;
  const v = row.CurrentScopeVersion;
  return {
    id: row.ItemId,
    workspaceId,
    name: str(row.Name),
    stage: str(row.Stage),
    currentScopeVersion: typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null,
    scopeLocked: lockedAtStage(str(row.Stage), str(row.ResumeTo)),
    scopeLockedAt: strOrNull(row.ScopeLockedAt),
    assigneeUserId: strOrNull(row.AssigneeUserId),
    createdByUserId: strOrNull(row.CreatedByUserId),
  };
}

/** Custom roles as RoleDefs; a row without a key or name is skipped. */
function toRoleDefs(rows: readonly WorkspaceRoleRow[] | null | undefined): RoleDef[] {
  const out: RoleDef[] = [];
  for (const r of rows ?? []) {
    if (typeof r.Key !== "string" || !r.Key) continue;
    out.push({
      key: r.Key,
      name: str(r.Name) || r.Key,
      permissions: Array.isArray(r.Permissions) ? r.Permissions.filter((p): p is string => typeof p === "string") : [],
      isBuiltIn: r.IsBuiltIn === true,
    });
  }
  return out;
}

/** The pure core of useDeliveryContext (tested directly). */
export function buildDeliveryContext(input: DeliveryContextInput): DeliveryContext {
  const { projectId, profile } = input;
  const project = toDeliveryProject(input.project.row);
  const workspaceId = project?.workspaceId ?? null;

  const members: DeliveryMember[] = [];
  if (input.shared) {
    for (const m of input.shared.members) {
      if (m.status !== "active" || !m.id) continue;
      members.push({ userId: m.id, displayName: m.name, roleKey: m.roleKey });
    }
  } else {
    for (const m of input.members.rows ?? []) {
      if (m.Status !== "active" || typeof m.UserId !== "string" || !m.UserId) continue;
      members.push({ userId: m.UserId, displayName: str(m.DisplayName), roleKey: str(m.RoleKey) });
    }
  }
  const userId = profile?.userId ?? null;
  const isSuperAdmin = profile?.isSuperAdmin === true;
  const me = userId ? (members.find((m) => m.userId === userId) ?? null) : null;
  const permissions: readonly WorkspacePermission[] =
    input.shared?.permissions ??
    workspacePermissionsFor({ roleKey: me?.roleKey, isSuperAdmin, customRoles: toRoleDefs(input.roles.rows) });
  const names = new Map(members.map((m) => [m.userId, m.displayName]));

  let status: DeliveryContext["status"] = "ready";
  let error: string | null = null;
  if (!input.signedIn || input.project.loading) status = "loading";
  else if (input.project.error) [status, error] = ["error", input.project.error];
  else if (input.project.row === null || input.project.row === undefined) status = "not_found";
  else if (!project) [status, error] = ["error", MSG_UNREADABLE];
  else if (input.members.error || input.roles.error) [status, error] = ["error", input.members.error ?? input.roles.error];
  else if (input.members.loading || input.roles.loading) status = "loading";

  return {
    projectId,
    status,
    error,
    workspaceId,
    project,
    userId,
    isSuperAdmin,
    me,
    permissions,
    can: (p) => permissions.includes(p),
    members,
    activeMemberIds: members.map((m) => m.userId),
    memberName: (id) => (!id ? "" : names.has(id) ? names.get(id) || FORMER_MEMBER : FORMER_MEMBER),
  };
}

const messageOf = (e: unknown): string | null => (e ? (e instanceof Error && e.message ? e.message : MSG_GENERIC) : null);

/** The delivery context of a Blocks project; disabled for ids that are not Blocks ids or while signed out. */
export function useDeliveryContext(projectId: string): DeliveryContext {
  const status = useSession((s) => s.status);
  const profile = useSession((s) => s.profile);
  const signedIn = status === "signed-in";
  const enabled = isBlocksProjectId(projectId) && signedIn;

  const projectQ = useQuery({
    queryKey: deliveryProjectKey(projectId),
    queryFn: () => queryById<ProjectRow>("Project", projectId, PROJECT_FIELDS),
    enabled,
  });
  const row = projectQ.data;
  const shared = useBlocksContext();

  return buildDeliveryContext({
    projectId,
    signedIn,
    profile: profile ? { userId: profile.userId, isSuperAdmin: profile.isSuperAdmin } : null,
    project: {
      loading: enabled && projectQ.isPending,
      error: messageOf(projectQ.error),
      row: enabled ? row : null,
    },
    members: { loading: false, error: null, rows: null },
    roles: { loading: false, error: null, rows: null },
    shared: {
      permissions: shared.permissions,
      members: shared.members.map((m) => ({ id: m.id, name: m.name, status: m.status, roleKey: m.roleKey })),
    },
  });
}
