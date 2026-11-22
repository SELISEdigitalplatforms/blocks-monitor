// Delivery reads: Board, Build and Release data straight from the Data Gateway (browser -> gateway, row policies
// `UserId IN ReaderIds`). The WorkspaceId clause from blocksAllOptions and the ProjectId filters here are only scoping;
// nothing the server must enforce is filtered on the client. Reads are hooks, never function operations.
// Every WRITE goes through the `delivery` Logic Function (see actions.ts), never from this file.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { blocksAllOptions, blocksAllResultOptions } from "../data/hooks";
import { byOldest } from "@/lib/newest";
import { whereOf, type Where } from "../data/gql";
import { liveMeta, type LiveClass, type LiveMode } from "../data/livePoll";
import { engineJobsListOptions } from "../engine/jobs";
import { latestEngineJob, type EngineJob } from "../engine/types";
import type { EngineJobKind } from "../../domain/engineJob";
import type { DeliveryContext } from "./context";
import {
  APPROVAL_POLICY_FIELDS,
  APPROVAL_REQUEST_FIELDS,
  APPROVAL_STEP_FIELDS,
  CHANGE_REQUEST_FIELDS,
  FEATURE_NAME_FIELDS,
  MILESTONE_FIELDS,
  PREVIEW_FIELDS,
  RELEASE_FIELDS,
  TICKET_EVENT_FIELDS,
  TICKET_FIELDS,
  featureNamesOf,
  parseAll,
  parseChangeRequest,
  parseMilestone,
  parsePolicy,
  parsePreview,
  parseRelease,
  parseRequest,
  parseTicket,
  parseTicketEvent,
  type ApprovalPolicyRow,
  type ApprovalRequestRow,
  type ApprovalStepRow,
  type ChangeRequestRow,
  type DeliveryChangeRequest,
  type DeliveryMilestone,
  type FeatureNameRow,
  type DeliveryPreview,
  type DeliveryRelease,
  type DeliveryTicket,
  type DeliveryTicketEvent,
  type MilestoneRow,
  type Parsed,
  type PolicyRecord,
  type PreviewRow,
  type ReleaseRow,
  type RequestRecord,
  type TicketEventRow,
  type TicketRow,
} from "./types";

/** The engine job kinds the delivery pages show. */
export const DELIVERY_JOB_KINDS: readonly EngineJobKind[] = ["board.plan", "build.run", "change.analyse", "change.build", "preview.deploy"];

export interface DeliveryList<T> {
  data: T[];
  unreadable: { id: string; error: string }[];
  isLoading: boolean;
  error: string | null;
}

const MAX_ROWS = 5000;
const EMPTY: never[] = [];

const messageOf = (e: unknown): string | null =>
  e ? (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.") : null;

const isReady = (ctx: DeliveryContext) => ctx.status === "ready" && ctx.workspaceId !== null;

// ------------------------------------------------------------- pure helpers

/** The tickets of the locked scope version's milestones plus tickets without a milestone (changes and fixes).
 *  Ticket has no ScopeVersion and an unlock keeps older tickets, so the filter is on the milestone ids. */
export function currentScopeTickets(tickets: readonly DeliveryTicket[], milestoneIds: ReadonlySet<string>): DeliveryTicket[] {
  return tickets.filter((t) => t.milestoneId === null || milestoneIds.has(t.milestoneId));
}

export interface JobInput {
  milestoneId?: string;
  changeRequestId?: string;
  version?: string;
}

/** The input fields the delivery pages match jobs on (docs/ENGINE-CONTRACT.md); string fields only, null if unparsable. */
export function jobInput(job: Pick<EngineJob, "inputJson">): JobInput | null {
  if (!job.inputJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(job.inputJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  const out: JobInput = {};
  if (typeof p.milestoneId === "string") out.milestoneId = p.milestoneId;
  if (typeof p.changeRequestId === "string") out.changeRequestId = p.changeRequestId;
  if (typeof p.version === "string") out.version = p.version;
  return out;
}

/** The newest job of a kind that matches the milestone / change request; with no match keys, the newest of the kind. */
export function latestJobFor(
  jobs: readonly EngineJob[],
  kind: EngineJobKind,
  match: { milestoneId?: string; changeRequestId?: string } = {},
): EngineJob | null {
  const matching = jobs.filter((j) => {
    if (j.kind !== kind) return false;
    if (match.milestoneId === undefined && match.changeRequestId === undefined) return true;
    const input = jobInput(j);
    if (!input) return false;
    if (match.milestoneId !== undefined && input.milestoneId !== match.milestoneId) return false;
    if (match.changeRequestId !== undefined && input.changeRequestId !== match.changeRequestId) return false;
    return true;
  });
  return latestEngineJob(matching, kind);
}

// ------------------------------------------------------------ query options

const projectWhere = <T extends { ProjectId?: string | null }>(ctx: Pick<DeliveryContext, "projectId">): Where<T> =>
  ({ op: "eq", field: "ProjectId", value: ctx.projectId }) as unknown as Where<T>;

/** A pending approval request: a person is asked to act elsewhere (the lists follow at the "waiting" pace). */
export function approvalsBusy(data: unknown): LiveMode | null {
  return Array.isArray(data) && data.some((r) => (r as { Status?: unknown } | null)?.Status === "pending") ? "waiting" : null;
}

function requestRowsOptions(ctx: DeliveryContext) {
  return blocksAllOptions<ApprovalRequestRow>("ApprovalRequest", {
    workspaceId: ctx.workspaceId,
    fields: APPROVAL_REQUEST_FIELDS,
    where: projectWhere<ApprovalRequestRow>(ctx),
    sort: [{ field: "RequestedAt", dir: "asc" }],
    maxItems: MAX_ROWS,
  });
}

function policyRowsOptions(ctx: DeliveryContext) {
  return blocksAllOptions<ApprovalPolicyRow>("ApprovalPolicy", {
    workspaceId: ctx.workspaceId,
    fields: APPROVAL_POLICY_FIELDS,
    where: projectWhere<ApprovalPolicyRow>(ctx),
    maxItems: MAX_ROWS,
  });
}

/** The project's delivery jobs; same keys as E1's cancelEngineJob / retryEngineJob invalidate.
 *  E1's useEngineJobs wrapper is not used: it reads the workspace from src/state/workspaces (forbidden here) and the
 *  project's workspace is Project.WorkspaceId. */
export function useDeliveryJobs(
  ctx: DeliveryContext,
  kinds?: readonly EngineJobKind[],
): { jobs: EngineJob[]; isLoading: boolean; error: string | null } {
  const q = useQuery({
    ...engineJobsListOptions(ctx.workspaceId, ctx.projectId, kinds),
    enabled: isReady(ctx),
  });
  return { jobs: q.data ?? EMPTY, isLoading: q.isLoading, error: messageOf(q.error) };
}

/** One subscription per list: how often it is read again is the live clock's (src/blocks/data/livePoll.ts), by the
 *  list's class, never a timer of each component that shows it. `live` null: settings, read again only when an action
 *  changes them (their mutation, the bell) or the tab is shown again. */
function useRows<R>(
  ctx: DeliveryContext,
  options: ReturnType<typeof blocksAllOptions<R>>,
  live: LiveClass | null,
  enabled = true,
  busy?: (data: unknown) => LiveMode | null,
): { rows: R[] | undefined; isLoading: boolean; error: string | null } {
  const q = useQuery({ ...options, enabled: options.enabled && isReady(ctx) && enabled, ...(live ? { meta: liveMeta(live, busy) } : {}) });
  return { rows: q.data, isLoading: q.isLoading, error: messageOf(q.error) };
}

function toList<T>(
  rows: readonly unknown[] | undefined,
  parse: (row: unknown) => Parsed<T>,
  isLoading: boolean,
  error: string | null,
): DeliveryList<T> {
  const { data, unreadable } = parseAll(rows, parse);
  return { data, unreadable, isLoading, error };
}

// -------------------------------------------------------------------- hooks

/** The locked scope version's feature names by ref ("feature:<Key>"), so pickers show names, not keys. */
export function useFeatureNames(ctx: DeliveryContext): ReadonlyMap<string, string> {
  const version = ctx.project?.currentScopeVersion ?? null;
  const w = whereOf<FeatureNameRow>();
  const r = useRows(
    ctx,
    blocksAllOptions<FeatureNameRow>("Feature", {
      workspaceId: ctx.workspaceId,
      fields: FEATURE_NAME_FIELDS,
      where: w.and(w.eq("ProjectId", ctx.projectId), version !== null && w.eq("ScopeVersion", version)),
      maxItems: MAX_ROWS,
    }),
    null,
    version !== null,
  );
  return useMemo(() => featureNamesOf(r.rows), [r.rows]);
}

/** The locked scope version's milestones, SortOrder ascending; off when the project has no scope version yet. */
export function useMilestones(ctx: DeliveryContext): DeliveryList<DeliveryMilestone> {
  const version = ctx.project?.currentScopeVersion ?? null;
  const w = whereOf<MilestoneRow>();
  const r = useRows(
    ctx,
    blocksAllOptions<MilestoneRow>("Milestone", {
      workspaceId: ctx.workspaceId,
      fields: MILESTONE_FIELDS,
      where: w.and(w.eq("ProjectId", ctx.projectId), version !== null && w.eq("ScopeVersion", version)),
      sort: [{ field: "SortOrder", dir: "asc" }],
      maxItems: MAX_ROWS,
    }),
    "records",
    version !== null,
  );
  return useMemo(() => toList(r.rows, parseMilestone, r.isLoading, r.error), [r.rows, r.isLoading, r.error]);
}

/** Tickets of the locked version's milestones plus those without a milestone (changes and fixes). */
export function useTickets(ctx: DeliveryContext): DeliveryList<DeliveryTicket> {
  const milestones = useMilestones(ctx);
  const r = useRows(
    ctx,
    blocksAllOptions<TicketRow>("Ticket", {
      workspaceId: ctx.workspaceId,
      fields: TICKET_FIELDS,
      where: projectWhere<TicketRow>(ctx),
      sort: [{ field: "SortOrder", dir: "asc" }],
      maxItems: MAX_ROWS,
    }),
    "work",
  );
  return useMemo(() => {
    const all = parseAll(r.rows, parseTicket);
    const ids = new Set(milestones.data.map((m) => m.id));
    return {
      data: currentScopeTickets(all.data, ids),
      unreadable: all.unreadable,
      isLoading: r.isLoading || milestones.isLoading,
      error: r.error ?? milestones.error,
    };
  }, [r.rows, r.isLoading, r.error, milestones]);
}

/** One ticket's history, newest first (At descending); off without a ticket id. */
export function useTicketEvents(ctx: DeliveryContext, ticketId: string | null): DeliveryList<DeliveryTicketEvent> {
  const w = whereOf<TicketEventRow>();
  const r = useRows(
    ctx,
    blocksAllOptions<TicketEventRow>("TicketEvent", {
      workspaceId: ctx.workspaceId,
      fields: TICKET_EVENT_FIELDS,
      where: w.and(w.eq("ProjectId", ctx.projectId), w.eq("TicketId", ticketId ?? "")),
      sort: [{ field: "At", dir: "desc" }],
      maxItems: MAX_ROWS,
    }),
    "work",
    ticketId !== null && ticketId !== "",
  );
  return useMemo(() => toList(r.rows, parseTicketEvent, r.isLoading, r.error), [r.rows, r.isLoading, r.error]);
}

/** The most ticket events of a project read at once (the newest; older ones are left out and the list says so). */
export const MAX_PROJECT_EVENTS = MAX_ROWS;

/** A project's ticket events, with whether older ones were left out (more rows than MAX_PROJECT_EVENTS). */
export interface ProjectEventList extends DeliveryList<DeliveryTicketEvent> {
  /** True when the project has more events than were read: the oldest ones are missing from `data`. */
  capped: boolean;
  /** How many events the project has in all (the gateway's count). */
  totalCount: number;
}

/** Every ticket event of the project, At ascending: the Build step's Studio feed and Timeline tracks read the real
 *  column moves, comments, notes and artifacts from here. Read newest first (At descending) under the cap, so when a
 *  project has more events than MAX_PROJECT_EVENTS the oldest are the ones left out (`capped`), never the newest; then
 *  put back in time order here for the logic that follows a ticket through the columns. */
export function useProjectTicketEvents(ctx: DeliveryContext): ProjectEventList {
  const options = projectTicketEventsOptions(ctx);
  const q = useQuery({ ...options, enabled: options.enabled && isReady(ctx), meta: liveMeta("work") });
  return useMemo(() => projectEventList(q.data, q.isLoading, messageOf(q.error)), [q.data, q.isLoading, q.error]);
}

/** The read of a project's ticket events: newest first (At descending), at most MAX_PROJECT_EVENTS, with the count. */
export function projectTicketEventsOptions(ctx: Pick<DeliveryContext, "workspaceId" | "projectId">) {
  return blocksAllResultOptions<TicketEventRow>("TicketEvent", {
    workspaceId: ctx.workspaceId,
    fields: TICKET_EVENT_FIELDS,
    where: projectWhere<TicketEventRow>(ctx),
    sort: [{ field: "At", dir: "desc" }],
    maxItems: MAX_PROJECT_EVENTS,
  });
}

/** The read's rows as the project's events in time order, with what the read says about the cap (pure). */
export function projectEventList(
  read: { items: readonly unknown[]; capped: boolean; totalCount: number } | undefined,
  isLoading: boolean,
  error: string | null,
): ProjectEventList {
  const list = toList(read?.items, parseTicketEvent, isLoading, error);
  return { ...list, data: byOldest(list.data, (e) => e.at), capped: read?.capped === true, totalCount: read?.totalCount ?? list.data.length };
}

export function usePreviews(ctx: DeliveryContext): DeliveryList<DeliveryPreview> {
  const r = useRows(
    ctx,
    blocksAllOptions<PreviewRow>("Preview", {
      workspaceId: ctx.workspaceId,
      fields: PREVIEW_FIELDS,
      where: projectWhere<PreviewRow>(ctx),
      maxItems: MAX_ROWS,
    }),
    "records",
  );
  return useMemo(() => toList(r.rows, parsePreview, r.isLoading, r.error), [r.rows, r.isLoading, r.error]);
}

/** Change requests, Number ascending. */
export function useChangeRequests(ctx: DeliveryContext): DeliveryList<DeliveryChangeRequest> {
  const r = useRows(
    ctx,
    blocksAllOptions<ChangeRequestRow>("ChangeRequest", {
      workspaceId: ctx.workspaceId,
      fields: CHANGE_REQUEST_FIELDS,
      where: projectWhere<ChangeRequestRow>(ctx),
      sort: [{ field: "Number", dir: "asc" }],
      maxItems: MAX_ROWS,
    }),
    "records",
  );
  return useMemo(() => toList(r.rows, parseChangeRequest, r.isLoading, r.error), [r.rows, r.isLoading, r.error]);
}

export function useReleases(ctx: DeliveryContext): DeliveryList<DeliveryRelease> {
  const r = useRows(
    ctx,
    blocksAllOptions<ReleaseRow>("Release", {
      workspaceId: ctx.workspaceId,
      fields: RELEASE_FIELDS,
      where: projectWhere<ReleaseRow>(ctx),
      maxItems: MAX_ROWS,
    }),
    "records",
  );
  return useMemo(() => toList(r.rows, parseRelease, r.isLoading, r.error), [r.rows, r.isLoading, r.error]);
}

/** ApprovalStep rows of the given parents in one query (ParentId IN ids); off when there are no ids. A policy's steps
 *  are settings (`live` null); a request's steps change as people decide ("records"). */
function useStepRows(ctx: DeliveryContext, parentIds: readonly string[], live: LiveClass | null) {
  const ids = useMemo(() => [...new Set(parentIds)].sort(), [parentIds]);
  const w = whereOf<ApprovalStepRow>();
  return useRows(
    ctx,
    blocksAllOptions<ApprovalStepRow>("ApprovalStep", {
      workspaceId: ctx.workspaceId,
      fields: APPROVAL_STEP_FIELDS,
      where: w.in("ParentId", ids),
      sort: [{ field: "SortOrder", dir: "asc" }],
      maxItems: MAX_ROWS,
    }),
    live,
    ids.length > 0,
  );
}

export function useApprovalPolicies(ctx: DeliveryContext): DeliveryList<PolicyRecord> {
  const rowsQ = useRows(ctx, policyRowsOptions(ctx), null);
  const policyIds = useMemo(() => (rowsQ.rows ?? EMPTY).map((r) => r.ItemId), [rowsQ.rows]);
  const stepsQ = useStepRows(ctx, policyIds, null);
  return useMemo(
    () =>
      toList(
        rowsQ.rows,
        (row) => parsePolicy(row, stepsQ.rows ?? []),
        rowsQ.isLoading || stepsQ.isLoading || policyStepsPending(policyIds, stepsQ.rows, stepsQ.error),
        rowsQ.error ?? stepsQ.error,
      ),
    [rowsQ.rows, rowsQ.isLoading, rowsQ.error, stepsQ.rows, stepsQ.isLoading, stepsQ.error, policyIds],
  );
}

/** The step query is disabled until the policy ids are known and a disabled query is not "loading": true while the steps are still on their way. */
export function policyStepsPending(policyIds: readonly string[], stepRows: readonly unknown[] | undefined, stepsError: string | null): boolean {
  return policyIds.length > 0 && stepRows === undefined && !stepsError;
}

/** Approval requests with their step rows; a pending request with no steps yet is still being prepared. */
export function useApprovalRequests(ctx: DeliveryContext): DeliveryList<RequestRecord> {
  const rowsQ = useRows(ctx, requestRowsOptions(ctx), "records", true, approvalsBusy);
  const requestIds = useMemo(() => (rowsQ.rows ?? EMPTY).map((r) => r.ItemId), [rowsQ.rows]);
  const stepsQ = useStepRows(ctx, requestIds, "records");
  return useMemo(
    () => toList(rowsQ.rows, (row) => parseRequest(row, stepsQ.rows ?? []), rowsQ.isLoading || stepsQ.isLoading, rowsQ.error ?? stepsQ.error),
    [rowsQ.rows, rowsQ.isLoading, rowsQ.error, stepsQ.rows, stepsQ.isLoading, stepsQ.error],
  );
}
