// Scope page reads. ARCHITECTURE: reads go browser → Data Gateway through the src/blocks/data options under the row policies.
// Every list carries the workspace clause (the workspaceId param, added by blocksListOptions / blocksAllOptions) plus a
// ProjectId filter. Reads are hooks, never function operations; the two signed-URL reads are the exception (they need a
// server signature). At most 2 sequential reads: the Project bootstrap (context.ts), then everything in parallel.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { blocksAllOptions, blocksListOptions } from "../data/hooks";
import { liveEvery } from "../data/livePoll";
import { whereOf, type Page } from "../data/gql";
import { callFunction } from "../fn";
import { isActiveEngineJob, latestEngineJob, type EngineJob } from "../engine/types";
import { useEngineJobs } from "../engine/jobs";
import type { EngineJobKind } from "../../domain/engineJob";
import type { ScopeContext } from "./context";
import {
  APPROVAL_POLICY_FIELDS,
  APPROVAL_STEP_FIELDS,
  ATTACHMENT_FIELDS,
  CHALLENGE_FIELDS,
  COMMENT_FIELDS,
  DESIGN_BRIEF_FIELDS,
  DESIGN_SCREEN_FIELDS,
  FEATURE_FIELDS,
  MILESTONE_FIELDS,
  OBJECTIVE_FIELDS,
  REQUIREMENT_FIELDS,
  SCHEMA,
  SCOPE_FEEDBACK_TARGETS,
  SCOPE_VERSION_FIELDS,
  SECOND_OPINION_FIELDS,
  STORY_FIELDS,
  THREAD_FIELDS,
  approvalPolicyFor,
  attachmentFromRow,
  challengeFromRow,
  commentFromRow,
  designBriefFromRow,
  designScreenFromRow,
  featureFromRow,
  mapRows,
  milestoneFromRow,
  objectiveFromRow,
  requirementFromRow,
  scopeVersionFromRow,
  secondOpinionFromRow,
  sortedMapped,
  storyFromRow,
  threadFromRow,
  type AttachmentRecord,
  type ChallengeRecord,
  type DesignBriefRecord,
  type DesignScreenRecord,
  type FeatureRecord,
  type FeedbackCommentRecord,
  type FeedbackThreadRecord,
  type Mapped,
  type MilestoneRecord,
  type ObjectiveRecord,
  type PolicyState,
  type RawRow,
  type RequirementRecord,
  type ScopeFeedbackTarget,
  type ScopeVersionRecord,
  type SecondOpinionRecord,
  type StoryRecord,
} from "./records";

const w = whereOf<RawRow>();

/** The common shape of a query result this module returns (UseQueryResult satisfies it). */
export interface ScopeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  /** a read is on its way (the first one or a re-read) */
  isFetching?: boolean;
  /** when the data was last read (ms), 0 before the first read */
  dataUpdatedAt?: number;
}

/** The engine job kinds this page shows. */
export const SCOPE_JOB_KINDS: readonly EngineJobKind[] = ["scope.draft", "design.generate", "milestones.suggest", "scope.grill", "scope.success", "board.plan"];
const BUILD_JOB_KINDS: readonly EngineJobKind[] = ["build.run", "change.build"];

/** How often output lists are re-read while one of the jobs is active (L10 adds the doorbell). */
export const OUTPUT_POLL_MS = 20_000;

export interface ScopeJobs {
  jobs: EngineJob[];
  design: EngineJob | null;
  suggest: EngineJob | null;
  grill: EngineJob | null;
  /** the business analyst's proposals / answers for Success & performance */
  success: EngineJob | null;
  /** the first draft of the plan (features, stories, milestones, targets) from the requirements */
  draft: EngineJob | null;
  boardPlan: EngineJob | null;
  anyActive: boolean;
  isLoading: boolean;
  error: unknown;
}

export function useScopeJobs(ctx: ScopeContext): ScopeJobs {
  const q = useEngineJobs(ctx.workspaceId ? ctx.projectId : null, SCOPE_JOB_KINDS);
  const jobs = q.data;
  return useMemo<ScopeJobs>(() => {
    const list = jobs ?? [];
    return {
      jobs: list,
      design: latestEngineJob(list, "design.generate"),
      suggest: latestEngineJob(list, "milestones.suggest"),
      grill: latestEngineJob(list, "scope.grill"),
      success: latestEngineJob(list, "scope.success"),
      draft: latestEngineJob(list, "scope.draft"),
      boardPlan: latestEngineJob(list, "board.plan"),
      anyActive: list.some(isActiveEngineJob),
      isLoading: q.isLoading,
      error: q.error,
    };
  }, [jobs, q.isLoading, q.error]);
}

export function useBuildJobs(ctx: ScopeContext): { jobs: EngineJob[]; isLoading: boolean } {
  const q = useEngineJobs(ctx.workspaceId ? ctx.projectId : null, BUILD_JOB_KINDS);
  return { jobs: q.data ?? [], isLoading: q.isLoading };
}

/** 20 s while a job is queued, claimed or running; otherwise only refetch on focus. On the live clock
 *  (src/blocks/data/livePoll.ts): one read per list on the clock's ticks, however many parts of a page show it. */
function usePoll(ctx: ScopeContext): number | false {
  return useScopeJobs(ctx).anyActive ? OUTPUT_POLL_MS : false;
}

const projectWhere = (ctx: ScopeContext, ...more: (ReturnType<typeof w.eq> | ReturnType<typeof w.in> | null)[]) =>
  w.and(w.eq("ProjectId", ctx.projectId), ...more);

function allOptions(ctx: ScopeContext, schema: string, fields: readonly string[], opts: {
  more?: (ReturnType<typeof w.eq> | ReturnType<typeof w.in> | null)[];
  sort?: { field: string; dir?: "asc" | "desc" }[];
  maxItems?: number;
  enabled?: boolean;
} = {}) {
  const base = blocksAllOptions<RawRow>(schema, {
    workspaceId: ctx.workspaceId,
    fields,
    where: projectWhere(ctx, ...(opts.more ?? [])),
    sort: opts.sort,
    maxItems: opts.maxItems ?? 1000,
  });
  return { ...base, enabled: base.enabled && Boolean(ctx.projectId) && (opts.enabled ?? true) };
}

function firstOptions(ctx: ScopeContext, schema: string, fields: readonly string[], sort?: { field: string; dir?: "asc" | "desc" }[]) {
  const base = blocksListOptions<RawRow>(schema, {
    workspaceId: ctx.workspaceId,
    fields,
    where: projectWhere(ctx),
    sort,
    pageSize: 1,
  });
  return { ...base, enabled: base.enabled && Boolean(ctx.projectId) };
}

const versionNumber = (v: ScopeVersionRecord | number | null | undefined): number | null =>
  typeof v === "number" ? v : (v?.number ?? null);

// ── Scope content ───────────────────────────────────────────────────────────────────────────────────────────────

/** The highest ScopeVersion of the project (draft or locked), or null before the first save. */
export function useScopeVersion(ctx: ScopeContext): ScopeQuery<ScopeVersionRecord | null> {
  const poll = usePoll(ctx);
  return useQuery({
    ...firstOptions(ctx, SCHEMA.scopeVersion, SCOPE_VERSION_FIELDS, [{ field: "Number", dir: "desc" }]),
    select: (p: Page<RawRow>) => (p.items[0] ? scopeVersionFromRow(p.items[0]) : null),
    meta: liveEvery(poll),
  });
}

export function useRequirements(ctx: ScopeContext): ScopeQuery<Mapped<RequirementRecord>> {
  return useQuery({
    ...allOptions(ctx, SCHEMA.requirement, REQUIREMENT_FIELDS, {
      more: [w.in("Status", ["draft", "confirmed", "assumed"])],
      sort: [{ field: "SortOrder" }],
    }),
    select: (rows: RawRow[]) => sortedMapped(mapRows(rows, requirementFromRow)),
  });
}

export function useObjective(ctx: ScopeContext): ScopeQuery<ObjectiveRecord | null> {
  return useQuery({
    ...firstOptions(ctx, SCHEMA.objective, OBJECTIVE_FIELDS),
    select: (p: Page<RawRow>) => (p.items[0] ? objectiveFromRow(p.items[0]) : null),
  });
}

export function useFeatures(ctx: ScopeContext, version: ScopeVersionRecord | number | null | undefined): ScopeQuery<Mapped<FeatureRecord>> {
  const n = versionNumber(version);
  const poll = usePoll(ctx);
  const reqs = useRequirements(ctx);
  const byKey = useMemo(() => new Map((reqs.data?.items ?? []).map((r) => [r.key, r.id])), [reqs.data]);
  return useQuery({
    ...allOptions(ctx, SCHEMA.feature, FEATURE_FIELDS, {
      more: [n === null ? null : w.eq("ScopeVersion", n)],
      sort: [{ field: "SortOrder" }],
      enabled: n !== null,
    }),
    select: (rows: RawRow[]) => sortedMapped(mapRows(rows, (r) => featureFromRow(r, byKey))),
    meta: liveEvery(poll),
  });
}

export function useStories(ctx: ScopeContext, version: ScopeVersionRecord | number | null | undefined): ScopeQuery<Mapped<StoryRecord>> {
  const n = versionNumber(version);
  const poll = usePoll(ctx);
  const features = useFeatures(ctx, version);
  const featureIdByKey = useMemo(() => new Map((features.data?.items ?? []).map((f) => [f.key, f.id])), [features.data]);
  const select = useCallback(
    (rows: RawRow[]) => sortedMapped(mapRows(rows, (r) => storyFromRow(r, featureIdByKey))),
    [featureIdByKey],
  );
  return useQuery({
    ...allOptions(ctx, SCHEMA.story, STORY_FIELDS, {
      more: [n === null ? null : w.eq("ScopeVersion", n)],
      sort: [{ field: "SortOrder" }],
      enabled: n !== null,
    }),
    select,
    meta: liveEvery(poll),
  });
}

export function useMilestones(ctx: ScopeContext, version: ScopeVersionRecord | number | null | undefined): ScopeQuery<Mapped<MilestoneRecord>> {
  const n = versionNumber(version);
  const poll = usePoll(ctx);
  return useQuery({
    ...allOptions(ctx, SCHEMA.milestone, MILESTONE_FIELDS, {
      more: [n === null ? null : w.eq("ScopeVersion", n)],
      sort: [{ field: "SortOrder" }],
      maxItems: 200,
      enabled: n !== null,
    }),
    select: (rows: RawRow[]) => sortedMapped(mapRows(rows, milestoneFromRow)),
    meta: liveEvery(poll),
  });
}

// ── Design ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function useDesignBrief(ctx: ScopeContext): ScopeQuery<DesignBriefRecord | null> {
  const poll = usePoll(ctx);
  return useQuery({
    ...firstOptions(ctx, SCHEMA.designBrief, DESIGN_BRIEF_FIELDS),
    select: (p: Page<RawRow>) => (p.items[0] ? designBriefFromRow(p.items[0]) : null),
    meta: liveEvery(poll),
  });
}

/** The one read of the current screens (useDesignScreens and useScreenVersions share it). */
const currentScreensOptions = (ctx: ScopeContext) =>
  allOptions(ctx, SCHEMA.designScreen, DESIGN_SCREEN_FIELDS, {
    more: [w.in("Status", ["generated", "accepted", "changes-requested"])],
    sort: [{ field: "SortOrder" }],
    maxItems: 200,
  });

/** The project's current screens (older versions that the engine superseded are left out). */
export function useDesignScreens(ctx: ScopeContext): ScopeQuery<Mapped<DesignScreenRecord>> {
  const poll = usePoll(ctx);
  return useQuery({
    ...currentScreensOptions(ctx),
    select: (rows: RawRow[]) => sortedMapped(mapRows(rows, designScreenFromRow)),
    meta: liveEvery(poll),
  });
}

/** A screen's place in its history: the engine's Key (one per screen and device) and the Version (1 = first design). */
export interface ScreenVersion { key: string; version: number }

export function screenVersionFromRow(r: RawRow): ScreenVersion | null {
  const key = typeof r.Key === "string" ? r.Key.trim() : "";
  if (!key) return null;
  const v = typeof r.Version === "number" ? r.Version : Number(r.Version);
  return { key, version: Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1 };
}

export function selectScreenVersions(rows: readonly RawRow[]): Map<string, ScreenVersion> {
  const out = new Map<string, ScreenVersion>();
  for (const r of rows) {
    const id = typeof r.ItemId === "string" ? r.ItemId : "";
    const v = screenVersionFromRow(r);
    if (id && v) out.set(id, v);
  }
  return out;
}

/** The Key and Version of each current screen, by screen id (the same read as useDesignScreens, no extra request). */
export function useScreenVersions(ctx: ScopeContext): ScopeQuery<Map<string, ScreenVersion>> {
  const poll = usePoll(ctx);
  return useQuery({ ...currentScreensOptions(ctx), select: selectScreenVersions, meta: liveEvery(poll) });
}

/** An older version of a screen (Status "superseded"), kept when the engine redesigned it. */
export type PreviousScreen = DesignScreenRecord & ScreenVersion;

export interface PreviousScreens {
  /** The newest older version of a current screen (same Key, lower Version), or null. */
  of(current: ScreenVersion | null | undefined): PreviousScreen | null;
}

export function selectPreviousScreens(rows: readonly RawRow[]): PreviousScreens {
  const byKey = new Map<string, PreviousScreen[]>();
  for (const r of rows) {
    if (r.Status !== "superseded") continue;
    const rec = designScreenFromRow(r);
    const v = screenVersionFromRow(r);
    if (!rec || !v) continue;
    byKey.set(v.key, [...(byKey.get(v.key) ?? []), { ...rec, ...v }]);
  }
  for (const list of byKey.values()) list.sort((a, b) => b.version - a.version || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return {
    of: (current) => (current ? (byKey.get(current.key)?.find((p) => p.version < current.version) ?? null) : null),
  };
}

/** The older (superseded) versions of the project's screens, newest first; read only while `enabled` (a current screen
 *  has a version above 1). It never changes what useDesignScreens returns. */
export function usePreviousScreens(ctx: ScopeContext, enabled: boolean): ScopeQuery<PreviousScreens> {
  return useQuery({
    ...allOptions(ctx, SCHEMA.designScreen, DESIGN_SCREEN_FIELDS, {
      more: [w.eq("Status", "superseded")],
      sort: [{ field: "CreatedDate", dir: "desc" }],
      maxItems: 500,
      enabled,
    }),
    select: selectPreviousScreens,
  });
}

export type ScreenUrls = Record<string, { url: string | null; expiresAt: string | null }>;

export const SCREEN_URLS_STALE_MS = 4 * 60_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the answer of scope.screens.urls: a map by screen id, or a list of {screenId|id, url, expiresAt}. */
export function screenUrlsFromAnswer(data: unknown): ScreenUrls {
  const out: ScreenUrls = {};
  const put = (id: unknown, v: unknown) => {
    if (typeof id !== "string" || !isRecord(v)) return;
    out[id] = {
      url: typeof v.url === "string" && v.url !== "" ? v.url : null,
      expiresAt: typeof v.expiresAt === "string" ? v.expiresAt : null,
    };
  };
  const root = isRecord(data) ? (data.urls ?? data.screens ?? data) : data;
  if (Array.isArray(root)) {
    for (const e of root) if (isRecord(e)) put(e.screenId ?? e.id, e);
  } else if (isRecord(root)) {
    for (const [id, v] of Object.entries(root)) put(id, v);
  }
  return out;
}

/** Short-lived screenshot URLs from the function (a server signature is needed); refetch() on an image error. */
export function useScreenUrls(ctx: ScopeContext, screenIds: readonly string[]): ScopeQuery<ScreenUrls> {
  const ids = useMemo(() => [...new Set(screenIds)].sort().slice(0, 50), [screenIds]);
  return useQuery({
    queryKey: ["scope", "screenUrls", ctx.workspaceId ?? "", ctx.projectId, ids],
    queryFn: async () => {
      const res = await callFunction<unknown>("project", "scope.screens.urls", { projectId: ctx.projectId, screenIds: ids });
      return screenUrlsFromAnswer(res.data);
    },
    enabled: Boolean(ctx.workspaceId && ctx.projectId && ids.length > 0),
    staleTime: SCREEN_URLS_STALE_MS,
  });
}

// ── Feedback ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ThreadWithCount = FeedbackThreadRecord & { commentCount: number };

export interface ScopeThreads extends Mapped<ThreadWithCount> {
  byTarget(type: ScopeFeedbackTarget, id: string): ThreadWithCount | null;
}

export function useScopeThreads(ctx: ScopeContext): ScopeQuery<ScopeThreads> {
  const threads = useQuery({
    ...allOptions(ctx, SCHEMA.thread, THREAD_FIELDS, { more: [w.in("TargetType", SCOPE_FEEDBACK_TARGETS)] }),
  });
  const comments = useQuery({
    ...allOptions(ctx, SCHEMA.comment, ["ItemId", "ThreadId", "Kind"], { maxItems: 5000 }),
  });
  const tRows = threads.data;
  const cRows = comments.data;
  const data = useMemo<ScopeThreads | undefined>(() => {
    if (!tRows || !cRows) return undefined;
    const counts = new Map<string, number>();
    for (const c of cRows) {
      if (c.Kind === "system" || typeof c.ThreadId !== "string") continue;
      counts.set(c.ThreadId, (counts.get(c.ThreadId) ?? 0) + 1);
    }
    const m = mapRows(tRows, threadFromRow);
    const items = m.items.map((t) => ({ ...t, commentCount: counts.get(t.id) ?? 0 }));
    return {
      items,
      unreadable: m.unreadable,
      byTarget: (type, id) => items.find((t) => t.targetType === type && t.targetId === id) ?? null,
    };
  }, [tRows, cRows]);
  return {
    data,
    isLoading: threads.isLoading || comments.isLoading,
    isError: threads.isError || comments.isError,
    error: threads.error ?? comments.error,
    refetch: () => Promise.all([threads.refetch(), comments.refetch()]),
  };
}

export function useThreadComments(ctx: ScopeContext, threadId: string | null | undefined): ScopeQuery<Mapped<FeedbackCommentRecord>> {
  return useQuery({
    ...allOptions(ctx, SCHEMA.comment, COMMENT_FIELDS, {
      more: [threadId ? w.eq("ThreadId", threadId) : null],
      sort: [{ field: "At" }],
      enabled: Boolean(threadId),
    }),
    select: (rows: RawRow[]) => mapRows(rows, commentFromRow),
  });
}

export function useCommentAttachments(ctx: ScopeContext, attachmentIds: readonly string[]): ScopeQuery<Mapped<AttachmentRecord>> {
  const ids = useMemo(() => [...new Set(attachmentIds)].sort(), [attachmentIds]);
  return useQuery({
    ...allOptions(ctx, SCHEMA.attachment, ATTACHMENT_FIELDS, {
      more: [ids.length > 0 ? w.in("ItemId", ids) : null],
      enabled: ids.length > 0,
    }),
    select: (rows: RawRow[]) => mapRows(rows, attachmentFromRow),
  });
}

// ── Second opinion ──────────────────────────────────────────────────────────────────────────────────────────────

export function useLatestSecondOpinion(ctx: ScopeContext): ScopeQuery<SecondOpinionRecord | null> {
  const poll = usePoll(ctx);
  return useQuery({
    ...firstOptions(ctx, SCHEMA.secondOpinion, SECOND_OPINION_FIELDS, [{ field: "CreatedDate", dir: "desc" }]),
    select: (p: Page<RawRow>) => (p.items[0] ? secondOpinionFromRow(p.items[0]) : null),
    meta: liveEvery(poll),
  });
}

export function useChallenges(ctx: ScopeContext, secondOpinionId: string | null | undefined): ScopeQuery<Mapped<ChallengeRecord>> {
  const poll = usePoll(ctx);
  return useQuery({
    ...allOptions(ctx, SCHEMA.challenge, CHALLENGE_FIELDS, {
      more: [secondOpinionId ? w.eq("OpinionId", secondOpinionId) : null],
      maxItems: 200,
      enabled: Boolean(secondOpinionId),
    }),
    select: (rows: RawRow[]) => mapRows(rows, challengeFromRow),
    meta: liveEvery(poll),
  });
}

// ── Approvals (read only) ───────────────────────────────────────────────────────────────────────────────────────

export function useApprovalPolicies(ctx: ScopeContext): ScopeQuery<{ stage: PolicyState; production: PolicyState }> {
  const policies = useQuery(allOptions(ctx, SCHEMA.approvalPolicy, APPROVAL_POLICY_FIELDS, { maxItems: 20 }));
  const steps = useQuery(allOptions(ctx, SCHEMA.approvalStep, APPROVAL_STEP_FIELDS, { more: [w.eq("ParentType", "policy")], maxItems: 200 }));
  const p = policies.data;
  const s = steps.data;
  const data = useMemo(
    () => (p && s ? { stage: approvalPolicyFor("stage", p, s), production: approvalPolicyFor("production", p, s) } : undefined),
    [p, s],
  );
  return {
    data,
    isLoading: policies.isLoading || steps.isLoading,
    isError: policies.isError || steps.isError,
    error: policies.error ?? steps.error,
    refetch: () => Promise.all([policies.refetch(), steps.refetch()]),
  };
}
