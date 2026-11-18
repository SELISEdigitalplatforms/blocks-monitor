// Dashboard reads: ONE parallel wave straight from the Data Gateway (browser -> gateway, row policies), each read scoped to the
// active workspace by the src/blocks/data options. Newest first, capped at 200 rows per schema, read in pages of 100; the page says when a cap is reached. Writes live elsewhere.
// A project being deleted (Status "deleting") and every row of a project not listed never reach the records
// (liveDashboardRecords): nothing of a deleted project counts or waits for anyone.
// "Released" has ONE rule: only Release rows with Status "released" reach the records (read filter plus a mapping guard), so the
// Released KPI, the Releases card and the activity feed agree; rolled-back and failed rows never count or use up the row cap.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { blocksAllResultOptions, useBlocksAllResult } from "../data/hooks";
import { whereOf } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { useBlocksContext } from "../context";
import { useWorkspaces } from "../workspaces/store";
import { isEngineJobKind, isEngineJobStatus, isTerminal } from "../../domain/engineJob";
import { assistFocusOf, byRecent, deployTargetOf, jobInputFacts, latestActivity, liveDashboardRecords, policyApproversOf, stepOfStage, type DashboardRecords, type DashRelease, type ReleaseEnv } from "../../domain/dashboard";

/** Every S1 field the dashboard selects, per schema (the fields contract test reads this). */
export const DASHBOARD_FIELDS = {
  Project: [
    "ItemId", "Name", "ClientName", "Stage", "ResumeTo", "AssigneeUserId", "CreatedByUserId", "LastUpdatedDate",
    "CreatedDate", "BusinessHandedOverAt", "SanitizationCompletedAt", "RequirementsConfirmedAt", "ScopeLockedAt",
    "ApprovalOwnerUserId", "RepoMode", "Status",
  ],
  EngineJob: ["ItemId", "ProjectId", "Kind", "Status", "Progress", "RequestedByUserId", "CreatedDate", "FinishedAt", "ErrorCode", "InputJson"],
  Release: ["ProjectId", "Environment", "Version", "Status", "ReleasedAt", "EngineJobId"],
  Preview: ["ProjectId", "MilestoneId", "Url", "Status", "ReadyAt"],
  ApprovalStep: ["ItemId", "ProjectId", "ParentType", "ParentId", "StepType", "Label", "Required", "ApproverUserIds"],
  ApprovalRequest: ["ItemId", "ProjectId", "Status", "RequestedByUserId"],
  Clarification: ["ItemId", "ProjectId", "Number", "Question", "OwnerUserId"],
  Ticket: ["ItemId", "ProjectId", "Title", "DoneAt"],
  ChangeRequest: ["ItemId", "ProjectId", "Number", "Title", "Status", "CreatedDate"],
  Milestone: ["ItemId", "ProjectId", "Name", "Status"],
  /** the change requests still on their way, with what decides what they wait for (the Team panel's rule) */
  OpenChangeRequest: ["ItemId", "ProjectId", "Number", "Lane", "Status", "Analysis", "DecidedAt", "RequestedByUserId", "CreatedByUserId"],
  /** the release approval policies and their steps: the people who approve a project's change requests */
  ApprovalPolicy: ["ItemId", "ProjectId"],
  PolicyStep: ["ItemId", "ParentId", "ApproverUserIds"],
} as const;

/** The change request statuses in which a change can wait for someone (src/components/team/changeWaiting.ts). */
export const WAITING_CHANGE_STATUSES = ["analysing", "questions", "review", "approved", "building", "failed"] as const;

/** The schema each read of DASHBOARD_FIELDS reads (a second, narrower read of a schema has its own name). */
const SCHEMA_OF: Partial<Record<keyof typeof DASHBOARD_FIELDS, string>> = { OpenChangeRequest: "ChangeRequest", PolicyStep: "ApprovalStep" };

/** The most rows read from any one schema. */
export const DASHBOARD_MAX_ROWS = 200;

/** Shown on the dashboard when any read hit the row cap. */
export const DASHBOARD_CAPPED_TEXT = `Showing the newest ${DASHBOARD_MAX_ROWS} records of each kind. Older records are not counted here.`;

type Raw = Record<string, unknown>;
const w = whereOf<Raw>();

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const ENVS: readonly string[] = ["dev", "stage", "production"];

const read = (schema: keyof typeof DASHBOARD_FIELDS, workspaceId: string | null, sortField: string, where?: ReturnType<typeof w.eq>) =>
  useBlocksAllResult<Raw>(SCHEMA_OF[schema] ?? schema, {
    workspaceId,
    fields: DASHBOARD_FIELDS[schema],
    where,
    sort: [{ field: sortField, dir: "desc" }],
    maxItems: DASHBOARD_MAX_ROWS,
  });

/** While a job of the workspace is queued or running, its list is read again this often, so "Live now", the working
 *  lines and the step counts follow the work (a finished job also refreshes what it wrote, see blocks/engine/jobs.ts). */
export const DASHBOARD_JOBS_POLL_MS = 10_000;

/** The poll of the dashboard's EngineJob read: on while any listed job is not finished, off otherwise. */
export function dashboardJobsPollInterval(data: { items?: readonly Raw[] } | undefined): number | false {
  const active = (data?.items ?? []).some((r) => isEngineJobStatus(r.Status) && !isTerminal(r.Status));
  return active ? DASHBOARD_JOBS_POLL_MS : false;
}

export interface DashboardData {
  records: DashboardRecords;
  capped: boolean;
  isLoading: boolean;
  error: BlocksDataError | null;
  refetch: () => void;
}

const EMPTY: DashboardRecords = { projects: [], jobs: [], releases: [], approvals: [], clarifications: [], tickets: [], changes: [], milestones: [], openChanges: [], policyApprovers: {} };

export function useDashboardData(): DashboardData {
  const { workspaceId } = useBlocksContext();
  const ready = useWorkspaces((s) => s.ready);
  const projects = read("Project", workspaceId, "LastUpdatedDate");
  // the jobs are polled while one is active: progress and "working" never freeze until the next notification
  const jobs = useQuery({
    ...blocksAllResultOptions<Raw>("EngineJob", {
      workspaceId, fields: DASHBOARD_FIELDS.EngineJob, sort: [{ field: "CreatedDate", dir: "desc" }], maxItems: DASHBOARD_MAX_ROWS,
    }),
    refetchInterval: (query: { state: { data: { items?: readonly Raw[] } | undefined } }) => dashboardJobsPollInterval(query.state.data),
  });
  const releases = read("Release", workspaceId, "ReleasedAt", w.eq("Status", "released"));
  const previews = read("Preview", workspaceId, "ReadyAt");
  const approvals = read("ApprovalStep", workspaceId, "CreatedDate", w.and(w.eq("Decision", "pending"), w.eq("ParentType", "request")));
  // only the steps of requests still waiting count (an approved request can keep an optional step open)
  const requests = read("ApprovalRequest", workspaceId, "CreatedDate", w.eq("Status", "pending"));
  const clarifications = read("Clarification", workspaceId, "CreatedDate", w.eq("Status", "open"));
  const tickets = read("Ticket", workspaceId, "DoneAt", w.eq("Column", "done"));
  const changes = read("ChangeRequest", workspaceId, "CreatedDate");
  // "Preview ready to try": only the milestones whose preview waits for the client
  const milestones = read("Milestone", workspaceId, "LastUpdatedDate", w.eq("Status", "preview-ready"));
  // what change requests wait for (the Team panel's rule): the open ones with their analysis, and who approves them
  const openChanges = read("OpenChangeRequest", workspaceId, "CreatedDate", w.in("Status", [...WAITING_CHANGE_STATUSES]));
  const policies = read("ApprovalPolicy", workspaceId, "CreatedDate");
  const policySteps = read("PolicyStep", workspaceId, "CreatedDate", w.eq("ParentType", "policy"));
  const results = [projects, jobs, releases, previews, approvals, requests, clarifications, tickets, changes, milestones, openChanges, policies, policySteps];
  const records = useMemo<DashboardRecords>(() => {
    if (!projects.data) return EMPTY;
    const pendingRequests = new Map(((requests.data?.items ?? []) as Raw[]).map((r) => [str(r.ItemId), r]));
    const base: DashboardRecords = liveDashboardRecords({
      projects: (projects.data.items as Raw[]).map((r) => ({
        id: str(r.ItemId), name: str(r.Name), clientName: str(r.ClientName), stage: str(r.Stage),
        step: stepOfStage(str(r.Stage), str(r.ResumeTo)), assigneeUserId: str(r.AssigneeUserId), createdByUserId: str(r.CreatedByUserId),
        updatedAt: str(r.LastUpdatedDate), createdAt: str(r.CreatedDate), handedOverAt: str(r.BusinessHandedOverAt), sanitizedAt: str(r.SanitizationCompletedAt),
        confirmedAt: str(r.RequirementsConfirmedAt), lockedAt: str(r.ScopeLockedAt),
        approverUserId: str(r.ApprovalOwnerUserId), repoMode: str(r.RepoMode), status: str(r.Status) || "active",
      })).filter((p) => p.id !== ""),
      jobs: ((jobs.data?.items ?? []) as Raw[]).flatMap((r) =>
        isEngineJobKind(r.Kind) && isEngineJobStatus(r.Status) && str(r.ItemId) !== ""
          ? [{
              id: str(r.ItemId), projectId: str(r.ProjectId), kind: r.Kind, status: r.Status,
              progress: Math.min(100, Math.max(0, num(r.Progress))), requestedByUserId: str(r.RequestedByUserId),
              createdAt: str(r.CreatedDate), finishedAt: str(r.FinishedAt), errorCode: str(r.ErrorCode),
              ...(r.Kind === "preview.deploy" ? { deployTo: deployTargetOf(str(r.InputJson)) } : {}),
              ...(r.Kind === "sanitization.assist" ? { focus: assistFocusOf(str(r.InputJson)) } : {}),
              ...jobInputFacts(r.Kind, str(r.InputJson)),
            }]
          : []),
      releases: ((releases.data?.items ?? []) as Raw[]).flatMap((r): DashRelease[] =>
        ENVS.includes(str(r.Environment)) && str(r.Status) === "released"
          ? [{ projectId: str(r.ProjectId), env: str(r.Environment) as ReleaseEnv, version: str(r.Version), status: str(r.Status), releasedAt: str(r.ReleasedAt), ...(str(r.EngineJobId) ? { jobId: str(r.EngineJobId) } : {}) }]
          : []),
      approvals: ((approvals.data?.items ?? []) as Raw[]).flatMap((r) => {
        const request = pendingRequests.get(str(r.ParentId));
        if (!request) return [];
        return [{
          id: str(r.ItemId), projectId: str(r.ProjectId), label: str(r.Label), stepType: str(r.StepType),
          required: r.Required === true, approverUserIds: list(r.ApproverUserIds),
          requestId: str(r.ParentId), requestedByUserId: str(request.RequestedByUserId),
        }];
      }),
      clarifications: ((clarifications.data?.items ?? []) as Raw[]).map((r) => ({
        id: str(r.ItemId), projectId: str(r.ProjectId), number: num(r.Number), question: str(r.Question), ownerUserId: str(r.OwnerUserId),
      })),
      tickets: ((tickets.data?.items ?? []) as Raw[]).map((r) => ({ id: str(r.ItemId), projectId: str(r.ProjectId), title: str(r.Title), doneAt: str(r.DoneAt) })),
      changes: ((changes.data?.items ?? []) as Raw[]).map((r) => ({
        id: str(r.ItemId), projectId: str(r.ProjectId), number: num(r.Number), title: str(r.Title), status: str(r.Status), createdAt: str(r.CreatedDate),
      })),
      milestones: ((milestones.data?.items ?? []) as Raw[]).map((r) => ({
        id: str(r.ItemId), projectId: str(r.ProjectId), name: str(r.Name), status: str(r.Status),
      })),
      openChanges: ((openChanges.data?.items ?? []) as Raw[]).map((r) => ({
        id: str(r.ItemId), projectId: str(r.ProjectId), number: num(r.Number), lane: str(r.Lane), status: str(r.Status),
        analysis: str(r.Analysis).trim() ? str(r.Analysis) : null, decidedAt: str(r.DecidedAt) || null,
        createdByUserId: str(r.RequestedByUserId) || str(r.CreatedByUserId) || null,
      })).filter((c) => c.id !== "" && c.number > 0),
      policyApprovers: policyApproversOf((policies.data?.items ?? []) as Raw[], (policySteps.data?.items ?? []) as Raw[]),
    });
    // newest first: the projects by their latest activity, so every list that follows the records' order (what waits
    // for you, the project lists) has the project with the newest release, job, change or task on top
    return { ...base, projects: byRecent(base.projects, latestActivity(base)) };
  }, [projects.data?.items, jobs.data?.items, releases.data?.items, approvals.data?.items, requests.data?.items, clarifications.data?.items, tickets.data?.items, changes.data?.items, milestones.data?.items, openChanges.data?.items, policies.data?.items, policySteps.data?.items]);
  const error = (results.find((r) => r.error)?.error ?? null) as BlocksDataError | null;
  return {
    records,
    capped: results.some((r) => r.data?.capped === true),
    // loading until the workspace store is ready and every enabled read has answered; ready with no workspace is not loading
    isLoading: !ready || (Boolean(workspaceId) && results.some((r) => r.isPending)),
    error,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}
