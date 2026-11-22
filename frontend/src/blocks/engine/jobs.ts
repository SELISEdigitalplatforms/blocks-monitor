// The EngineJob read side: one workspace-scoped list per project, read again by the live clock (src/blocks/data/livePoll.ts):
// every 5 s while a job of the project is active, every minute otherwise (a job queued elsewhere shows up on its own).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { blocksListOptions } from "../data/hooks";
import { whereOf, type Page } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { blocksKeys } from "../data/keys";
import { LIVE_MS, liveMeta, type LiveMode } from "../data/livePoll";
import { useBlocksContext } from "../context";
import { queryClient } from "../queryClient";
import { createJobStateTracker, invalidateUsage } from "../billing/usage";
import { ENGINE_JOB_OUTPUTS, isEngineJobKind, isEngineJobStatus, isTerminal, type EngineJobKind } from "@/domain/engineJob";
import { ENGINE_JOB_FIELDS, ENGINE_JOB_SCHEMA, toEngineJob, type EngineJob, type EngineJobRow } from "./types";

/** How often the web re-reads the job list while any job is active (docs/ENGINE-CONTRACT.md section 6). */
export const ENGINE_JOBS_POLL_MS = LIVE_MS.jobs.running!;

/** The newest jobs a project's job list holds (one page). */
export const JOBS_PAGE_SIZE = 100;

/** "running" while any job of the list is queued, claimed or running: the live clock then follows at its fast pace. */
export function engineJobsBusy(page: unknown): LiveMode | null {
  const items = (page as Page<EngineJobRow> | undefined)?.items;
  return Array.isArray(items) && items.some((r) => isEngineJobStatus(r?.Status) && !isTerminal(r.Status)) ? "running" : null;
}

/** Rows a finished job of each kind changed besides its outputs (ENGINE_JOB_OUTPUTS). The scope jobs (scope.draft,
 *  scope.success, milestones.suggest, design.generate) write only their outputs, which the Scope page reads. */
const FINISH_REFRESH: Partial<Record<EngineJobKind, readonly string[]>> = {
  // the questions it asks where an answer and a document differ (server/local/engine/kinds/analysis/followAnswers.ts)
  "requirements.draft": ["Suggestion", "RequirementExtra", "DesignBrief", "Clarification"],
  "board.plan": ["TicketEvent", "Board"],
  "build.run": ["TicketEvent", "Milestone", "Preview", "Release", "Project"],
  // a change whose checks failed: the engine may queue its fix round or the revert (src/domain/changeChecks.ts)
  "change.build": ["Ticket", "TicketEvent", "Release", "EngineJob"],
  "preview.deploy": ["Release", "Project"],
  "fix.analyse": ["AssistantMessage"],
  "wiki.generate": ["WikiPageHistory"],
  "docs.generate": [],
  "chat.reply": ["AgentChatMessage"],
};

/** The schemas to read again once a job of this kind has finished. */
export function finishRefreshSchemas(kind: EngineJobKind): string[] {
  return [...new Set([...ENGINE_JOB_OUTPUTS[kind], ...(FINISH_REFRESH[kind] ?? [])])];
}

const seenActive = new Map<string, boolean>();
/** Job lists read at least once. A job that first appears in a later read of the same list, already finished, was
 *  queued and done between two reads (a fast job, or one queued by the server as a side effect): it is fresh too. */
const knownLists = new Set<string>();

/** The kinds whose output must be read again: jobs seen active that are now finished, and jobs new to a known list that
 *  arrive finished. Pure apart from the two maps it keeps (exported for tests). */
export function finishedKinds(listKey: string, rows: readonly EngineJobRow[]): EngineJobKind[] {
  const known = knownLists.has(listKey);
  const kinds = new Set<EngineJobKind>();
  for (const r of rows) {
    if (!r.ItemId || !isEngineJobStatus(r.Status)) continue;
    const active = !isTerminal(r.Status);
    const before = seenActive.get(r.ItemId);
    if (!active && (before === true || (before === undefined && known)) && isEngineJobKind(r.Kind)) kinds.add(r.Kind);
    seenActive.set(r.ItemId, active);
  }
  knownLists.add(listKey);
  return [...kinds];
}

/** When a job finishes, the rows it wrote are read again at once (screens that do not poll included). */
function refreshFinished(workspaceId: string, listKey: string, rows: readonly EngineJobRow[]): void {
  const schemas = new Set<string>();
  for (const kind of finishedKinds(listKey, rows)) for (const s of finishRefreshSchemas(kind)) schemas.add(s);
  for (const s of schemas) void Promise.resolve(queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, s) })).catch(() => undefined);
  // the Scope and Build/Release pages keep the project row under their own keys (src/blocks/scope/context.ts
  // scopeProjectKey, src/blocks/delivery/context.ts deliveryProjectKey): a job that moved the project is read there too
  if (schemas.has("Project")) {
    for (const prefix of [["scope", "project"], ["delivery", "project"]]) {
      void Promise.resolve(queryClient.invalidateQueries({ queryKey: prefix })).catch(() => undefined);
    }
  }
}

/** Job lists whose jobs started or ended since their last read: the usage figures follow at once (../billing/usage.ts). */
const usageJobs = createJobStateTracker();

queryClient.getQueryCache().subscribe((e) => {
  if (e.type !== "updated" || e.action.type !== "success") return;
  const key = e.query.queryKey;
  if (key[0] !== "ws" || typeof key[1] !== "string" || key[2] !== ENGINE_JOB_SCHEMA) return;
  const items = (e.query.state.data as Page<EngineJobRow> | undefined)?.items;
  if (!Array.isArray(items)) return;
  refreshFinished(key[1], e.query.queryHash, items);
  if (usageJobs.changed(e.query.queryHash, items)) void Promise.resolve(invalidateUsage(queryClient, key[1])).catch(() => undefined);
});

const selectors = new Map<string, (page: Page<EngineJobRow>) => EngineJob[]>();

/** One stable select per kinds signature, so a re-render does not re-run it. */
function selectorFor(kinds?: readonly EngineJobKind[]): (page: Page<EngineJobRow>) => EngineJob[] {
  const kindList = kinds && kinds.length > 0 ? [...new Set(kinds)].sort() : null;
  const signature = kindList ? kindList.join(",") : "";
  let select = selectors.get(signature);
  if (!select) {
    select = (page) => {
      const jobs = page.items.map(toEngineJob).filter((j): j is EngineJob => j !== null);
      return kindList ? jobs.filter((j) => kindList.includes(j.kind)) : jobs;
    };
    selectors.set(signature, select);
  }
  return select;
}

/** Query options for a project's jobs, newest first. Every kinds list shares one read (one key); `kinds` only filters in select. */
export function engineJobsListOptions(
  workspaceId: string | null | undefined,
  projectId: string | null | undefined,
  kinds?: readonly EngineJobKind[],
) {
  const w = whereOf<EngineJobRow>();
  const base = blocksListOptions<EngineJobRow>(ENGINE_JOB_SCHEMA, {
    workspaceId,
    fields: ENGINE_JOB_FIELDS,
    where: w.and(w.eq("ProjectId", projectId ?? "")),
    sort: [{ field: "CreatedDate", dir: "desc" }],
    pageSize: JOBS_PAGE_SIZE,
  });
  return {
    ...base,
    enabled: base.enabled && Boolean(projectId),
    select: selectorFor(kinds),
    // one read per tick of the live clock, however many components show the list
    meta: liveMeta("jobs", engineJobsBusy),
  };
}

/** A project's newest delivery builds (change.build and build.run, newest first), read on their own: the project's job
 *  list is its newest 100 jobs of every kind, where a long build can drop out behind chat replies and analyses. The
 *  parallel streams read the running and queued builds from here, only when the job list may miss one (it is full, or a
 *  change being built has no build in it), and on the records' pace of the live clock. */
export function buildJobsListOptions(workspaceId: string | null | undefined, projectId: string | null | undefined) {
  const w = whereOf<EngineJobRow>();
  const base = blocksListOptions<EngineJobRow>(ENGINE_JOB_SCHEMA, {
    workspaceId,
    fields: ENGINE_JOB_FIELDS,
    where: w.and(w.eq("ProjectId", projectId ?? ""), w.in("Kind", ["change.build", "build.run"])),
    sort: [{ field: "CreatedDate", dir: "desc" }],
    pageSize: JOBS_PAGE_SIZE,
  });
  return {
    ...base,
    enabled: base.enabled && Boolean(projectId),
    select: selectorFor(),
    // on the records' pace of the live clock (src/blocks/data/livePoll.ts): the job list itself follows a build closely
    meta: liveMeta("records"),
  };
}

/** A project's engine jobs (optionally of some kinds), newest first. */
export function useEngineJobs(
  projectId: string | null | undefined,
  kinds?: readonly EngineJobKind[],
): UseQueryResult<EngineJob[], BlocksDataError> {
  const { workspaceId } = useBlocksContext();
  return useQuery<Page<EngineJobRow>, BlocksDataError, EngineJob[]>(engineJobsListOptions(workspaceId, projectId, kinds));
}
