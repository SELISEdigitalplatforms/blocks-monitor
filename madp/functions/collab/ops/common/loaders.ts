// Shared loaders. Independent reads run in ONE parallel round (the router allows at most 3 sequential rounds per op).
import { f } from "../../../_lib";
import type { OpCtx, OpDeps, Row, ScopedGateway } from "../../../_lib";
import { MAX_OPEN_REPLY_JOBS } from "../../../../src/domain/agentChat";
import { ENGINE_JOB_STATUSES, isTerminal } from "../../../../src/domain/engineJob";
import { FIELDS, SCHEMA, num, rowsOf, str } from "./records";

const PROJECT_FIELDS = ["Name", "Stage", "ResumeTo", "ScopeLockedAt", "RequirementsConfirmedAt", "Status"] as const;
const DEFAULT_MAX = 500;

/**
 * The project row with the fields collab needs. Never re-reads when ctx.project already carries these fields
 * (the router's row does); otherwise it reads them once through refs (start it in the same Promise.all as the op's other reads). A missing or "deleting" project answers not_found.
 */
export async function liveProject(ctx: OpCtx, deps: OpDeps): Promise<Row> {
  const id = str(ctx.project, "ItemId");
  if (!id) return deps.fail("not_found");
  const have = PROJECT_FIELDS.every((k) => ctx.project !== null && k in ctx.project);
  const row = have ? (ctx.project as Row) : await deps.refs.project(id, PROJECT_FIELDS);
  if (str(row, "Status") === "deleting") return deps.fail("not_found");
  return row;
}

/** A row of `schema` that belongs to THIS project; otherwise not_found. */
export function childOf(deps: OpDeps, schema: string, id: string, projectId: string, fields?: readonly string[]): Promise<Row> {
  return deps.refs.child(schema, id, "ProjectId", projectId, fields);
}

/** listOf over a gateway: a prefetch (round 1) and the handler's read share one memo entry only when both call this. */
export async function listVia(
  gw: ScopedGateway,
  schema: string,
  where: ReturnType<typeof f.eq>,
  fields: readonly string[],
  opts: { pageSize?: number; max?: number; sort?: { field: string; dir: "asc" | "desc" } } = {},
): Promise<Row[]> {
  const res = await gw.findAll(schema, { where, fields, sort: opts.sort, max: opts.max ?? DEFAULT_MAX });
  return rowsOf(res);
}

export function listOf(
  deps: OpDeps,
  schema: string,
  where: ReturnType<typeof f.eq>,
  fields: readonly string[],
  opts: { pageSize?: number; max?: number; sort?: { field: string; dir: "asc" | "desc" } } = {},
): Promise<Row[]> {
  return listVia(deps.gw, schema, where, fields, opts);
}

/** The first `n` rows (1-100) of a query, newest or oldest per `sort`: one page, never throws when more rows exist. */
export async function topVia(
  gw: ScopedGateway,
  schema: string,
  where: ReturnType<typeof f.eq>,
  fields: readonly string[],
  n: number,
  sort?: { field: string; dir: "asc" | "desc" },
): Promise<Row[]> {
  const res = await gw.find(schema, { where, fields, sort, page: 1, pageSize: n });
  return rowsOf(res.items);
}

export function topOf(
  deps: OpDeps,
  schema: string,
  where: ReturnType<typeof f.eq>,
  fields: readonly string[],
  n: number,
  sort?: { field: string; dir: "asc" | "desc" },
): Promise<Row[]> {
  return topVia(deps.gw, schema, where, fields, n, sort);
}

/** How many rows match, without reading them (one row is fetched; the total comes from the page). */
export async function countOf(deps: OpDeps, schema: string, where: ReturnType<typeof f.eq>): Promise<number> {
  const res = await deps.gw.find(schema, { where, fields: ["ItemId"], page: 1, pageSize: 1 });
  return res.totalCount ?? res.items.length;
}

export interface FactsRows {
  project: Row;
  lockedVersion: Row | null;
  features: Row[];
  stories: Row[];
  milestones: Row[];
  tickets: Row[];
  changeRequests: Row[];
  releases: Row[];
  jobs: Row[];
}

export interface FactsNeed {
  scope?: boolean;
  milestones?: boolean;
  tickets?: boolean;
  changeRequests?: boolean;
  releases?: boolean;
  jobKinds?: string[];
}

const VERSION_FIELDS = ["ItemId", "Number", "Status", "Title"] as const;
const FEATURE_FIELDS = ["ItemId", "ScopeVersion", "Key", "Title", "Priority", "Status"] as const;
const STORY_FIELDS = ["ItemId", "ScopeVersion", "FeatureRef", "Key", "Title", "Priority"] as const;
const MILESTONE_FIELDS = ["ItemId", "ScopeVersion", "Number", "Name", "Goal", "Status", "FeatureRefs"] as const;
const TICKET_FIELDS = ["ItemId", "Number", "Title", "TicketType", "AgentRole", "Column", "MilestoneId", "IsDone", "FeatureRef", "SortOrder"] as const;
const CR_FIELDS = ["ItemId", "Number", "Lane", "FeatureRef", "Title", "Status", "Version", "RequestedByUserId"] as const;
const RELEASE_FIELDS = ["ItemId", "Environment", "Version", "Status", "ReleasedAt", "ChangeRequestIds"] as const;
const JOB_FIELDS = ["ItemId", "Kind", "Status", "Progress", "TargetType", "TargetId", "RequestedByUserId", "CreatedDate"] as const;

/** The reads of loadFacts, started together (without the project row). A prefetch calls this with the handler's own `need`. */
function factReads(gw: ScopedGateway, projectId: string, need: FactsNeed) {
  const mine = f.eq("ProjectId", projectId);
  const read = (want: boolean | undefined, schema: string, fields: readonly string[], where = mine): Promise<Row[]> =>
    want ? listVia(gw, schema, where, fields) : Promise.resolve([]);
  const jobKinds = need.jobKinds?.length ? need.jobKinds : null;
  return Promise.all([
    read(need.scope, SCHEMA.scopeVersion, VERSION_FIELDS, f.and(mine, f.eq("Status", "locked"))),
    read(need.scope, SCHEMA.feature, FEATURE_FIELDS),
    read(need.scope, SCHEMA.story, STORY_FIELDS),
    read(need.milestones, SCHEMA.milestone, MILESTONE_FIELDS),
    read(need.tickets, SCHEMA.ticket, TICKET_FIELDS),
    read(need.changeRequests, SCHEMA.changeRequest, CR_FIELDS),
    read(need.releases, SCHEMA.release, RELEASE_FIELDS),
    jobKinds ? listVia(gw, SCHEMA.engineJob, f.and(mine, f.in("Kind", jobKinds)), JOB_FIELDS) : Promise.resolve([] as Row[]),
  ]);
}

/** Round 1: starts loadFacts' reads so the handler's identical loadFacts costs no round. */
export function prefetchFacts(gw: ScopedGateway, projectId: string, need: FactsNeed): Promise<unknown> {
  return factReads(gw, projectId, need);
}

/** One parallel round over everything a factual reply needs. Unrequested parts are [] or null. */
export async function loadFacts(ctx: OpCtx, deps: OpDeps, need: FactsNeed): Promise<FactsRows> {
  const projectId = str(ctx.project, "ItemId");
  const [project, [versions, features, stories, milestones, tickets, changeRequests, releases, jobs]] = await Promise.all([
    liveProject(ctx, deps),
    factReads(deps.gw, projectId, need),
  ]);
  const lockedVersion = versions.reduce<Row | null>((best, v) => (best === null || num(v, "Number") > num(best, "Number") ? v : best), null);
  const n = lockedVersion ? num(lockedVersion, "Number") : -1;
  return {
    project,
    lockedVersion,
    features: lockedVersion ? features.filter((r) => num(r, "ScopeVersion") === n) : [],
    stories: lockedVersion ? stories.filter((r) => num(r, "ScopeVersion") === n) : [],
    milestones,
    tickets,
    changeRequests,
    releases,
    jobs,
  };
}

const ACTIVE_JOB_STATUSES = ENGINE_JOB_STATUSES.filter((s) => !isTerminal(s));

/** The caller's chat.reply jobs of this project that are still queued, claimed or running. */
export function activeReplyJobCount(deps: OpDeps, projectId: string, userId: string): Promise<number> {
  return activeReplyJobCountVia(deps.gw, projectId, userId);
}

export async function activeReplyJobCountVia(gw: ScopedGateway, projectId: string, userId: string): Promise<number> {
  const rows = await topVia(
    gw,
    SCHEMA.engineJob,
    f.and(f.eq("ProjectId", projectId), f.eq("Kind", "chat.reply"), f.eq("RequestedByUserId", userId), f.in("Status", ACTIVE_JOB_STATUSES)),
    ["ItemId"],
    MAX_OPEN_REPLY_JOBS,
  );
  return rows.length;
}

export { FIELDS };
