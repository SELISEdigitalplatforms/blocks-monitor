// Product sanitization reads: Data Gateway through src/blocks/data, always inside the workspace clause and filtered by project.
import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { blocksAllOptions, blocksItemOptions } from "../data/hooks";
import { whereOf, type Where } from "../data/gql";
import { FORMER_MEMBER as FORMER, useBlocksContext } from "../context";
import { useSession } from "../session";
import { looksLikeEmail } from "../workspaces/store";
import { can } from "@/madp/domain/rbac";
import { byNewest } from "@/madp/lib/newest";
import { parseOutputRef } from "@/madp/domain/engineJob";
import type { EngineJob } from "../engine/types";
import type { BlocksDataError } from "../data/errors";
import {
  CLARIFICATION_FIELDS, COMMENT_FIELDS, DECISION_FIELDS, DOC_FILE_FIELDS, DOC_FOLDER_FIELDS, DOC_NOTE_FIELDS,
  ITEM_VERSION_FIELDS, MEMBERSHIP_ROW_FIELDS, OBJECTIVE_FIELDS, PROJECT_FIELDS, REQUIREMENT_FIELDS, TECH_DECISION_FIELDS, THREAD_FIELDS,
  type AssistFocus, type BusinessRef, type ClarificationRow, type CommentRow, type DecisionRow, type DocFileRow, type DocFolderRow,
  type DocNoteRow, type ItemVersionRow, type Member, type MemberDirectory, type MembershipRow, type ObjectiveRow, type ProjectRow,
  type RequirementRow, type SanitizationCtx, type StepAccess, type TechDecisionRow, type ThreadRow,
} from "./types";

const ready = (ctx: SanitizationCtx) => Boolean(ctx.workspaceId && ctx.projectId);
const byProject = <T extends { ProjectId: string }>(ctx: SanitizationCtx, ...more: (Where<T> | false)[]): Where<T> => {
  const w = whereOf<T>();
  return w.and(w.eq("ProjectId" as never, ctx.projectId as never), ...more);
};
const withReady = <O extends { enabled: boolean }>(ctx: SanitizationCtx, o: O): O => ({ ...o, enabled: o.enabled && ready(ctx) });

export function projectOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksItemOptions<ProjectRow>("Project", ctx.projectId, { workspaceId: ctx.workspaceId, fields: PROJECT_FIELDS }));
}
export function useSanitizationProject(ctx: SanitizationCtx): UseQueryResult<ProjectRow | null, BlocksDataError> {
  return useQuery(projectOptions(ctx));
}

export function clarificationsOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<ClarificationRow>("Clarification", {
    workspaceId: ctx.workspaceId, fields: CLARIFICATION_FIELDS, where: byProject<ClarificationRow>(ctx),
    sort: [{ field: "Number", dir: "asc" }, { field: "ItemId", dir: "asc" }], maxItems: 500,
  }));
}
export const useClarifications = (ctx: SanitizationCtx) => useQuery(clarificationsOptions(ctx));

export function decisionsOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<DecisionRow>("Decision", {
    workspaceId: ctx.workspaceId, fields: DECISION_FIELDS, where: byProject<DecisionRow>(ctx),
    sort: [{ field: "CreatedDate", dir: "desc" }, { field: "Number", dir: "desc" }], maxItems: 500,
  }));
}
export const useDecisions = (ctx: SanitizationCtx) => useQuery(decisionsOptions(ctx));

export function techDecisionsOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<TechDecisionRow>("TechDecision", {
    workspaceId: ctx.workspaceId, fields: TECH_DECISION_FIELDS, where: byProject<TechDecisionRow>(ctx),
    sort: [{ field: "CreatedDate", dir: "desc" }, { field: "Number", dir: "desc" }], maxItems: 300,
  }));
}
export const useTechDecisions = (ctx: SanitizationCtx) => useQuery(techDecisionsOptions(ctx));

export function requirementsOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<RequirementRow>("Requirement", {
    workspaceId: ctx.workspaceId, fields: REQUIREMENT_FIELDS, where: byProject<RequirementRow>(ctx),
    sort: [{ field: "SortOrder", dir: "asc" }, { field: "Number", dir: "asc" }, { field: "ItemId", dir: "asc" }], maxItems: 300,
  }));
}
export function objectiveOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<ObjectiveRow>("Objective", {
    workspaceId: ctx.workspaceId, fields: OBJECTIVE_FIELDS, where: byProject<ObjectiveRow>(ctx),
    sort: [{ field: "ItemId", dir: "asc" }], maxItems: 1,
  }));
}
export function useRequirementsV1(ctx: SanitizationCtx) {
  const reqs = useQuery(requirementsOptions(ctx));
  const obj = useQuery(objectiveOptions(ctx));
  return {
    requirements: reqs.data,
    objective: obj.data?.[0] ?? null,
    objectiveLoaded: obj.data !== undefined,
    isLoading: reqs.isLoading || obj.isLoading,
    isError: reqs.isError || obj.isError,
    refetch: () => Promise.all([reqs.refetch(), obj.refetch()]),
  };
}

export function v1VersionsOptions(ctx: SanitizationCtx) {
  const w = whereOf<ItemVersionRow>();
  return withReady(ctx, blocksAllOptions<ItemVersionRow>("ItemVersion", {
    workspaceId: ctx.workspaceId, fields: ITEM_VERSION_FIELDS, where: byProject<ItemVersionRow>(ctx, w.eq("N", 1)),
    sort: [{ field: "ItemKey", dir: "asc" }, { field: "ItemId", dir: "asc" }], maxItems: 400,
  }));
}
export const useV1Versions = (ctx: SanitizationCtx) => useQuery(v1VersionsOptions(ctx));

export function threadOptions(ctx: SanitizationCtx) {
  const w = whereOf<ThreadRow>();
  return withReady(ctx, blocksAllOptions<ThreadRow>("FeedbackThread", {
    workspaceId: ctx.workspaceId, fields: THREAD_FIELDS,
    where: byProject<ThreadRow>(ctx, w.eq("TargetType", "sanitization"), w.eq("TargetId", ctx.projectId)),
    sort: [{ field: "ItemId", dir: "asc" }], maxItems: 1,
  }));
}
export function commentsOptions(ctx: SanitizationCtx, threadId: string | null | undefined) {
  const w = whereOf<CommentRow>();
  const o = blocksAllOptions<CommentRow>("FeedbackComment", {
    workspaceId: ctx.workspaceId, fields: COMMENT_FIELDS, where: byProject<CommentRow>(ctx, w.eq("ThreadId", threadId ?? "")),
    sort: [{ field: "At", dir: "asc" }, { field: "ItemId", dir: "asc" }], maxItems: 1000,
  });
  return { ...o, enabled: o.enabled && ready(ctx) && Boolean(threadId) };
}
export function useSanitizationDiscussion(ctx: SanitizationCtx) {
  const t = useQuery(threadOptions(ctx));
  const thread = t.data?.[0] ?? null;
  const c = useQuery(commentsOptions(ctx, thread?.ItemId));
  return {
    thread,
    comments: c.data ?? ([] as CommentRow[]),
    isLoading: t.isLoading || c.isLoading,
    isError: t.isError || c.isError,
    refetch: () => Promise.all([t.refetch(), c.refetch()]),
  };
}

/** The Business material newest first, so the newest rows stay inside the cap. */
const CREATED_DESC = { field: "CreatedDate", dir: "desc" } as const;
export function businessFoldersOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<DocFolderRow>("DocFolder", {
    workspaceId: ctx.workspaceId, fields: DOC_FOLDER_FIELDS, where: byProject<DocFolderRow>(ctx),
    sort: [CREATED_DESC], maxItems: 500,
  }));
}
export function businessNotesOptions(ctx: SanitizationCtx) {
  return withReady(ctx, blocksAllOptions<DocNoteRow>("DocNote", {
    workspaceId: ctx.workspaceId, fields: DOC_NOTE_FIELDS, where: byProject<DocNoteRow>(ctx),
    sort: [CREATED_DESC], maxItems: 500,
  }));
}
export function businessFilesOptions(ctx: SanitizationCtx) {
  const w = whereOf<DocFileRow>();
  return withReady(ctx, blocksAllOptions<DocFileRow>("DocFile", {
    workspaceId: ctx.workspaceId, fields: DOC_FILE_FIELDS, where: byProject<DocFileRow>(ctx, w.eq("Status", "ready")),
    sort: [CREATED_DESC], maxItems: 500,
  }));
}

export function toBusinessRefs(folders: readonly DocFolderRow[], notes: readonly DocNoteRow[], files: readonly DocFileRow[]): BusinessRef[] {
  const at = (r: { CreatedDate?: string | null }) => r.CreatedDate ?? null;
  const refs: BusinessRef[] = [
    ...folders.map((r): BusinessRef => ({ id: r.ItemId, type: "folder", title: r.Name, folderId: r.ParentId || null, createdAt: at(r) })),
    ...notes.map((r): BusinessRef => ({ id: r.ItemId, type: "note", title: r.Title, folderId: r.FolderId || null, createdAt: at(r) })),
    ...files.map((r): BusinessRef => ({ id: r.ItemId, type: "file", title: r.Name, folderId: r.FolderId || null, createdAt: at(r) })),
  ];
  // newest first (a row without a date last); the same time by id, so the order is stable
  return byNewest(refs, (r) => r.createdAt, (r) => r.id);
}

export function useBusinessRefs(ctx: SanitizationCtx) {
  const f = useQuery(businessFoldersOptions(ctx));
  const n = useQuery(businessNotesOptions(ctx));
  const d = useQuery(businessFilesOptions(ctx));
  const refs = useMemo(() => toBusinessRefs(f.data ?? [], n.data ?? [], d.data ?? []), [f.data, n.data, d.data]);
  return {
    refs,
    isLoading: f.isLoading || n.isLoading || d.isLoading,
    isError: f.isError || n.isError || d.isError,
    refetch: () => Promise.all([f.refetch(), n.refetch(), d.refetch()]),
  };
}

export function membersOptions(ctx: SanitizationCtx) {
  const w = whereOf<MembershipRow>();
  return blocksAllOptions<MembershipRow>("Membership", {
    workspaceId: ctx.workspaceId, fields: MEMBERSHIP_ROW_FIELDS, where: w.eq("Status", "active"),
    sort: [{ field: "DisplayName", dir: "asc" }, { field: "ItemId", dir: "asc" }], maxItems: 500,
  });
}

export const FORMER_MEMBER = FORMER;

export function toMemberDirectory(
  rows: readonly MembershipRow[],
  opts?: { loading?: boolean; nameFor?: (userId: string) => string | undefined },
): MemberDirectory {
  // The invite-time DisplayName is often the email: a name that looks like an email is never shown.
  const real = (s: string | null | undefined) => {
    const t = s?.trim();
    return t && !looksLikeEmail(t) ? t : "";
  };
  const fallback = opts?.loading ? "…" : FORMER_MEMBER;
  const list: Member[] = rows.map((r) => ({
    userId: r.UserId,
    name: real(opts?.nameFor?.(r.UserId)) || real(r.DisplayName) || fallback,
    email: r.Email,
    roleKey: r.RoleKey,
  }));
  const byId = new Map(list.map((m) => [m.userId, m]));
  return {
    list,
    nameOf: (userId) => {
      if (!userId) return "";
      return byId.get(userId)?.name || fallback;
    },
  };
}

export function useWorkspaceMembers(ctx: SanitizationCtx) {
  const q = useQuery(membersOptions(ctx));
  const profile = useSession((s) => s.profile);
  const known = useBlocksContext().members;
  const loading = q.data === undefined;
  const directory = useMemo(() => toMemberDirectory(q.data ?? [], {
    loading,
    nameFor: (userId) => {
      if (profile && profile.userId === userId) return profile.displayName || undefined;
      const m = known.find((x) => x.id === userId);
      return m && m.name && m.name !== m.email && !looksLikeEmail(m.name) ? m.name : undefined;
    },
  }), [q.data, loading, profile, known]);
  return { directory, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

export function useStepAccess(ctx: SanitizationCtx): StepAccess {
  const bc = useBlocksContext();
  return useMemo(() => {
    const permissions = bc.permissions;
    return {
      userId: bc.userId,
      permissions,
      isSuperAdmin: bc.isSuperAdmin,
      canEdit: can(permissions, "sanitization.edit"),
      canComment: can(permissions, "comment"),
      canManage: can(permissions, "workspace.manage"),
      loading: !ctx.workspaceId || bc.workspaceId === null,
    };
  }, [bc, ctx.workspaceId]);
}

// ---- pure helpers ----

/** Ids of one schema in the OutputRefs of succeeded jobs of one kind. */
export function engineOutputIds(jobs: readonly EngineJob[], kind: string, schema: string): Set<string> {
  const ids = new Set<string>();
  for (const j of jobs) {
    if (j.kind !== kind || j.status !== "succeeded") continue;
    for (const raw of j.outputRefs) {
      const ref = parseOutputRef(typeof raw === "string" ? raw : `${raw.schema}:${raw.id}`);
      if (ref && ref.schema === schema) ids.add(ref.id);
    }
  }
  return ids;
}

function jobFocus(job: EngineJob): { focus?: string; refId?: string } {
  if (!job.inputJson) return {};
  try {
    const v: unknown = JSON.parse(job.inputJson);
    if (typeof v !== "object" || v === null) return {};
    const o = v as Record<string, unknown>;
    return {
      focus: typeof o.focus === "string" ? o.focus : undefined,
      refId: typeof o.refId === "string" ? o.refId : undefined,
    };
  } catch {
    return {};
  }
}

/** The newest sanitization.assist job whose input focus matches. */
export function latestAssistJob(jobs: readonly EngineJob[], focus: AssistFocus): EngineJob | null {
  let best: EngineJob | null = null;
  let bestAt = -Infinity;
  for (const j of jobs) {
    if (j.kind !== "sanitization.assist" || jobFocus(j).focus !== focus) continue;
    const at = j.createdAt === null ? -Infinity : Date.parse(j.createdAt);
    if (best === null || at > bestAt) {
      best = j;
      bestAt = at;
    }
  }
  return best;
}

/** When and by whom v1 was completed (the objective:main N=1 row). */
export function v1CompletedInfo(versions: readonly ItemVersionRow[] | null | undefined): { at: string | null; byUserId: string | null } | null {
  const row = (versions ?? []).find((v) => v.ItemKey === "objective:main" && v.N === 1);
  return row ? { at: row.CreatedDate ?? null, byUserId: row.CreatedByUserId ?? null } : null;
}

/** True when the item was created after the Business hand-over. */
export function isNewSinceHandOver(createdAt: string | null | undefined, handedOverAt: string | null | undefined): boolean {
  if (!createdAt || !handedOverAt) return false;
  const c = Date.parse(createdAt);
  const h = Date.parse(handedOverAt);
  return Number.isFinite(c) && Number.isFinite(h) && c > h;
}
