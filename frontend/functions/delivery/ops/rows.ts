/**
 * Row contract and shared loaders for the mf-delivery handlers.
 * DELIVERY_FIELDS mirrors blocks/data/schemas/*.json and ROW_ENUMS / ROW_CAPS / ROW_PATTERNS mirror
 * blocks/data/validations.json; checkRowShape stands in for L2's assertRowValid. Never invent a field:
 * a missing one is reported to the schema owner (S1).
 */
import {
  type EnvironmentState,
  type ReleaseLike,
  type StepRowMeta,
  environmentStates,
  parseApprovalSteps,
  stepKeyFor,
} from "../../../src/domain/delivery";
import type { EngineJobKind } from "../../../src/domain/engineJob";
import type {
  ApprovalPolicy,
  ApprovalPolicyStep,
  ApprovalRequest,
  Environment,
  GatedEnvironment,
} from "../../../src/domain/promotion";
import { decisionCounts } from "../../../src/domain/promotion";
import { fail, type OpContext } from "./common";
import type { DeliverySchema, ReadPorts, Row } from "./ports";

type FieldType = "string" | "int" | "float" | "bool" | "date" | "string[]";

const BASE: Record<string, FieldType> = {
  WorkspaceId: "string",
  ReaderIds: "string[]",
  CreatedByUserId: "string",
  UpdatedByUserId: "string",
  RequestKey: "string",
};

const withBase = (f: Record<string, FieldType>): Readonly<Record<string, FieldType>> => ({ ...BASE, ...f });

export const DELIVERY_FIELDS: Readonly<Record<DeliverySchema, Readonly<Record<string, FieldType>>>> = {
  Project: withBase({
    Name: "string", ClientName: "string", ClientContact: "string", ClientIndustry: "string", ClientRegion: "string",
    Brief: "string", NameSuggested: "bool", Stage: "string", ResumeTo: "string", CurrentScopeVersion: "int",
    AssigneeUserId: "string", BusinessHandedOverAt: "date", SanitizationCompletedAt: "date",
    RequirementsConfirmedAt: "date", ScopeLockedAt: "date", RepoProvider: "string", RepoOwner: "string",
    RepoName: "string", RepoMode: "string", RepoVisibility: "string", RepoBranch: "string", RepoExisting: "string",
    RepoNameEdited: "bool", IsExample: "bool", SeedKey: "string", Rev: "int", ChecksPolicy: "string",
    ParallelStreams: "string", StreamsAdvice: "string", ContinueIncrements: "string",
  }),
  Ticket: withBase({
    ProjectId: "string", Number: "int", PlanRef: "string", Title: "string", TicketType: "string",
    FeatureRef: "string", StoryRef: "string", MilestoneId: "string", AgentRole: "string", Column: "string",
    EstimateHours: "float", Acceptance: "string[]", SortOrder: "int", Description: "string", IsDone: "bool",
    DoneAt: "date", Source: "string", ChangeRequestId: "string", EngineJobId: "string", DependsOn: "string[]",
  }),
  TicketEvent: withBase({
    ProjectId: "string", TicketId: "string", Kind: "string", FromColumn: "string", ToColumn: "string",
    AuthorUserId: "string", AuthorLabel: "string", Text: "string", At: "date", IsAuto: "bool", EngineJobId: "string",
  }),
  Milestone: withBase({
    ProjectId: "string", ScopeVersion: "int", Number: "int", Name: "string", Goal: "string",
    FeatureRefs: "string[]", SortOrder: "int", PreviewPoint: "string", Status: "string", EngineJobId: "string",
    AcceptedAt: "date", AcceptedByUserId: "string",
  }),
  Preview: withBase({
    ProjectId: "string", MilestoneId: "string", Environment: "string", Version: "string", Url: "string",
    Status: "string", ReadyAt: "date", EngineJobId: "string",
  }),
  ChangeRequest: withBase({
    ProjectId: "string", Number: "int", Lane: "string", FeatureRef: "string", Title: "string",
    Description: "string", Status: "string", Version: "string", RequestedByUserId: "string", EngineJobId: "string",
    Analysis: "string", AnalysedAt: "date", DecidedAt: "date", DecidedByUserId: "string", DecisionNote: "string",
    SelfApproved: "bool", Checks: "string",
  }),
  Release: withBase({
    ProjectId: "string", Environment: "string", Version: "string", Url: "string", Status: "string",
    ChangeRequestIds: "string[]", MilestoneId: "string", ApprovalRequestId: "string", ReleasedAt: "date",
    ReleasedByUserId: "string", EngineJobId: "string",
  }),
  ApprovalPolicy: withBase({
    ProjectId: "string", Environment: "string", Status: "string", AllApproversRequired: "bool", Note: "string",
  }),
  ApprovalRequest: withBase({
    ProjectId: "string", PolicyId: "string", Environment: "string", Version: "string", Attempt: "int",
    ReleaseId: "string", Status: "string", RequestedByUserId: "string", RequestedAt: "date", DecidedAt: "date",
  }),
  ApprovalStep: withBase({
    ProjectId: "string", ParentType: "string", ParentId: "string", StepKey: "string", StepType: "string",
    Label: "string", Required: "bool", ApproverUserIds: "string[]", Decision: "string",
    DecidedByUserId: "string", DecidedAt: "date", Comment: "string", SortOrder: "int",
  }),
  EngineJob: withBase({
    ProjectId: "string", Kind: "string", Status: "string", ActiveKey: "string", TargetType: "string",
    TargetId: "string", InputJson: "string", OutputRefs: "string[]", Progress: "int", Message: "string",
    Attempts: "int", ClaimedBy: "string", ClaimedAt: "date", StartedAt: "date", FinishedAt: "date",
    ErrorCode: "string", RequestedByUserId: "string",
  }),
  Attachment: withBase({
    ProjectId: "string", OwnerType: "string", OwnerId: "string", FileId: "string", FileName: "string", StoredName: "string",
    Kind: "string", Mime: "string", SizeBytes: "int", Origin: "string", Meta: "string", Status: "string",
  }),
};

const COLUMNS = ["", "planned", "dev", "review", "test", "security", "docs", "gate", "done"];
const VERSION_RE = "^[0-9]+[.][0-9]+([.][0-9]+)?$";
const FEATURE_RE = "^(|feature:[a-z0-9][a-z0-9-]{0,62})$";

export const ROW_ENUMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  Project: {
    Stage: ["business", "sanitization", "requirements", "scope", "board", "build", "release", "paused", "abandoned"],
    ResumeTo: ["", "business", "sanitization", "requirements", "scope", "board", "build", "release"],
  },
  Ticket: {
    TicketType: ["story", "task", "fix"],
    AgentRole: ["", "planner", "dev", "reviewer", "qa", "secops", "docs", "shipper"],
    Column: COLUMNS.slice(1),
    Source: ["plan", "change-request", "fix", "chat", "feedback"],
  },
  TicketEvent: {
    Kind: ["move", "comment", "artifact", "note"],
    FromColumn: COLUMNS,
    ToColumn: COLUMNS,
  },
  Milestone: { Status: ["planned", "building", "preview-ready", "done"] },
  Preview: { Environment: ["dev"], Status: ["queued", "deploying", "ready", "failed", "expired"] },
  ChangeRequest: {
    Lane: ["change", "enhance", "add", "fix"],
    Status: [
      "draft", "requested", "analysing", "questions", "review", "approved", "rejected", "building", "released-dev",
      "promoted-stage", "promoted-production", "failed", "cancelled",
    ],
  },
  Release: { Environment: ["dev", "stage", "production"], Status: ["released", "failed", "rolled-back"] },
  ApprovalPolicy: { Environment: ["stage", "production"], Status: ["active", "disabled"] },
  ApprovalRequest: {
    Environment: ["stage", "production"],
    Status: ["pending", "approved", "rejected", "cancelled"],
  },
  ApprovalStep: {
    ParentType: ["policy", "request"],
    StepType: ["architect", "security", "qa", "custom"],
    Decision: ["", "pending", "approved", "rejected"],
  },
  EngineJob: {
    Kind: [
      "requirements.draft", "sanitization.assist", "design.generate", "scope.draft", "scope.grill", "scope.success", "milestones.suggest",
      "board.plan", "build.run", "change.build", "change.analyse", "fix.analyse", "preview.deploy", "wiki.generate", "chat.reply",
    ],
    Status: ["queued", "claimed", "running", "succeeded", "failed", "cancelled"],
  },
};

export const ROW_CAPS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  Project: { Name: 120, ClientName: 120, ClientContact: 120, Brief: 50000, ChecksPolicy: 200, ParallelStreams: 1000, StreamsAdvice: 1000, ContinueIncrements: 300 },
  Ticket: { PlanRef: 200, Title: 200, Description: 10000 },
  TicketEvent: { AuthorLabel: 60, Text: 5000 },
  Milestone: { Name: 120, Goal: 2000, PreviewPoint: 500 },
  ChangeRequest: { Title: 200, Description: 10000, Analysis: 100000, DecisionNote: 2000, Checks: 20000 },
  ApprovalPolicy: { Note: 1000 },
  ApprovalStep: { Label: 60, Comment: 5000 },
  EngineJob: { ActiveKey: 200, InputJson: 200000, Message: 2000 },
};

/** Applied to every element of an array field. */
export const ROW_PATTERNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Ticket: { FeatureRef: FEATURE_RE },
  Milestone: { FeatureRefs: "^feature:[a-z0-9][a-z0-9-]{0,62}$" },
  Preview: { Version: VERSION_RE, Url: "^(|https://.+)$" },
  ChangeRequest: { FeatureRef: FEATURE_RE, Version: "^(|[0-9]+[.][0-9]+([.][0-9]+)?)$" },
  Release: { Version: VERSION_RE, Url: "^(|https://.+)$" },
  ApprovalRequest: { Version: VERSION_RE },
  ApprovalStep: { StepKey: "^[a-z0-9][a-z0-9-]{0,62}$" },
};

function checkType(type: FieldType, v: unknown): boolean {
  switch (type) {
    case "string": return typeof v === "string";
    case "int": return typeof v === "number" && Number.isSafeInteger(v);
    case "float": return typeof v === "number" && Number.isFinite(v);
    case "bool": return typeof v === "boolean";
    case "date": return typeof v === "string" && (v === "" || !Number.isNaN(Date.parse(v)));
    case "string[]": return Array.isArray(v) && v.every((x) => typeof x === "string");
  }
}

/** null when the row (or a partial patch) is valid; otherwise a short reason for tests and logs. */
export function checkRowShape(schema: DeliverySchema, row: Record<string, unknown>): string | null {
  const fields = DELIVERY_FIELDS[schema];
  for (const [name, value] of Object.entries(row)) {
    const type = fields[name];
    if (!type) return `${schema}.${name}: unknown field`;
    if (!checkType(type, value)) return `${schema}.${name}: wrong type (${type})`;
    const items: string[] = Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];
    const allowed = ROW_ENUMS[schema]?.[name];
    if (allowed && items.some((x) => !allowed.includes(x))) return `${schema}.${name}: not an allowed value`;
    const cap = ROW_CAPS[schema]?.[name];
    if (cap !== undefined && items.some((x) => x.length > cap)) return `${schema}.${name}: over ${cap} characters`;
    const pattern = ROW_PATTERNS[schema]?.[name];
    if (pattern && items.some((x) => !new RegExp(pattern).test(x))) return `${schema}.${name}: bad format`;
  }
  return null;
}

/** InputJson of an EngineJob row, or null when it is not a JSON object. */
export function parseJobInput(row: Row): Record<string, unknown> | null {
  if (typeof row.InputJson !== "string") return null;
  try {
    const v: unknown = JSON.parse(row.InputJson);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Every milestone of the project, ordered. A prefetch makes this exact read so lockedMilestones costs no round. */
export function readMilestones(ports: ReadPorts, projectId: string): Promise<Row[]> {
  return ports.query("Milestone", { ProjectId: projectId }, { sort: [{ field: "SortOrder", dir: "asc" }] });
}

/** The milestones of the project's locked scope version, ordered; [] unless the scope is locked. */
export async function lockedMilestones(ctx: OpContext): Promise<Row[]> {
  const version = ctx.project.CurrentScopeVersion;
  const lockedAt = ctx.project.ScopeLockedAt;
  if (typeof version !== "number" || !Number.isInteger(version)) return [];
  if (typeof lockedAt !== "string" || !lockedAt) return [];
  return (await readMilestones(ctx.ports, ctx.projectId)).filter((m) => m.ScopeVersion === version);
}

const DELIVERY_JOB_KINDS: readonly EngineJobKind[] = ["build.run", "change.build"];

/** Queued, claimed or running build.run / change.build jobs of the project. */
export function activeDeliveryJobs(ctx: OpContext): Promise<Row[]> {
  return ctx.ports.query("EngineJob", {
    ProjectId: ctx.projectId,
    Kind: { in: DELIVERY_JOB_KINDS },
    Status: { in: ["queued", "claimed", "running"] },
  });
}

export function readReleases(ports: ReadPorts, projectId: string): Promise<Row[]> {
  return ports.query("Release", { ProjectId: projectId });
}

export async function loadReleaseStates(
  ctx: OpContext,
): Promise<{ rows: Row[]; states: Record<Environment, EnvironmentState<ReleaseLike>> }> {
  return releaseStatesOf(await readReleases(ctx.ports, ctx.projectId));
}

/** The environment states of already-read release rows. */
export function releaseStatesOf(rows: Row[]): { rows: Row[]; states: Record<Environment, EnvironmentState<ReleaseLike>> } {
  const like: ReleaseLike[] = rows.map((r) => ({
    id: r.ItemId,
    environment: String(r.Environment),
    version: String(r.Version),
    releasedAt: typeof r.ReleasedAt === "string" && r.ReleasedAt ? r.ReleasedAt : null,
    url: typeof r.Url === "string" ? r.Url : "",
  }));
  return { rows, states: environmentStates(like) };
}

const byId = (a: Row, b: Row) => (a.ItemId < b.ItemId ? -1 : a.ItemId > b.ItemId ? 1 : 0);

export type PolicyLoad =
  | { status: "missing" }
  | { status: "unreadable"; row: Row }
  | { status: "ok"; row: Row; policy: ApprovalPolicy; meta: StepRowMeta[] };

/** The policy of an environment from already-read rows (the lowest ItemId wins); steps are matched by ParentId. */
export function policyFromRows(env: GatedEnvironment, policyRows: readonly Row[], stepRows: readonly Row[]): PolicyLoad {
  const row = policyRows.filter((r) => r.Environment === env).sort(byId)[0];
  if (!row) return { status: "missing" };
  const parsed = parseApprovalSteps(
    stepRows.filter((s) => s.ParentType === "policy" && s.ParentId === row.ItemId),
    "policy",
    row.ItemId,
  );
  if (!parsed.ok) return { status: "unreadable", row };
  return { status: "ok", row, policy: { environment: env, steps: parsed.steps }, meta: parsed.meta };
}

/** One round: the project's policy rows (at most one per environment) and policy step rows. */
export async function loadPolicyRows(ctx: OpContext): Promise<{ policyRows: Row[]; policyStepRows: Row[] }> {
  return readPolicyRows(ctx.ports, ctx.projectId);
}

/** The same two reads over bare ports, so a prefetch can start them. */
export async function readPolicyRows(ports: ReadPorts, projectId: string): Promise<{ policyRows: Row[]; policyStepRows: Row[] }> {
  const [policyRows, policyStepRows] = await Promise.all([
    ports.query("ApprovalPolicy", { ProjectId: projectId }),
    ports.query("ApprovalStep", { ProjectId: projectId, ParentType: "policy" }),
  ]);
  return { policyRows, policyStepRows };
}

export async function loadPolicy(ctx: OpContext, env: GatedEnvironment): Promise<PolicyLoad> {
  const { policyRows, policyStepRows } = await loadPolicyRows(ctx);
  return policyFromRows(env, policyRows, policyStepRows);
}

export interface RequestLoad {
  id: string;
  row: Row;
  environment: GatedEnvironment;
  version: string;
  status: ApprovalRequest["status"];
  attempt: number;
  policyId: string;
  requestedByUserId: string;
  request: ApprovalRequest;
  meta: StepRowMeta[];
}

const isGated = (v: unknown): v is GatedEnvironment => v === "stage" || v === "production";
const isStatus = (v: unknown): v is ApprovalRequest["status"] =>
  v === "pending" || v === "approved" || v === "rejected" || v === "cancelled";

function toRequestLoad(row: Row, stepRows: readonly Row[]): RequestLoad | null {
  if (!isGated(row.Environment) || !isStatus(row.Status) || typeof row.Version !== "string") return null;
  // A request with no step rows is still being prepared (steps follow the request row under F0).
  if (stepRows.length === 0) return null;
  const parsed = parseApprovalSteps(stepRows, "request", row.ItemId);
  if (!parsed.ok) return null;
  return {
    id: row.ItemId,
    row,
    environment: row.Environment,
    version: row.Version,
    status: row.Status,
    attempt: typeof row.Attempt === "number" ? row.Attempt : 1,
    policyId: typeof row.PolicyId === "string" ? row.PolicyId : "",
    requestedByUserId: typeof row.RequestedByUserId === "string" ? row.RequestedByUserId : "",
    request: { environment: row.Environment, version: row.Version, status: row.Status, steps: parsed.steps },
    meta: parsed.meta,
  };
}

export async function loadRequestById(ctx: OpContext, id: string): Promise<RequestLoad> {
  const row = await ctx.ports.getById("ApprovalRequest", id);
  if (!row || row.ProjectId !== ctx.projectId || row.WorkspaceId !== ctx.workspaceId) {
    return fail("not_found", "delivery.approvals.notFound");
  }
  const stepRows = await ctx.ports.query("ApprovalStep", { ParentType: "request", ParentId: row.ItemId });
  const load = toRequestLoad(row, stepRows);
  if (!load) {
    return fail("conflict", stepRows.length === 0 ? "delivery.approvals.preparing" : "delivery.approvals.unreadable");
  }
  return load;
}

/**
 * Separation of duties on read step rows: a decision by the request's own requester counts only while no other active
 * approver of that step exists (decisionCounts in src/domain/promotion: the one-person fallback); otherwise the step
 * is read as pending, so someone else still decides it. `requesterOf` answers the requester of a request id.
 */
export function countedStepRows<T extends Record<string, unknown>>(
  steps: readonly T[],
  requesterOf: (requestId: string) => unknown,
  activeMemberIds: readonly string[],
): T[] {
  return steps.map((s) => {
    const requester = requesterOf(String(s.ParentId ?? ""));
    const decision = s.Decision === "approved" || s.Decision === "rejected" ? s.Decision : "pending";
    const counts = decisionCounts(
      {
        decision,
        decidedBy: typeof s.DecidedByUserId === "string" ? s.DecidedByUserId : null,
        approverUserIds: Array.isArray(s.ApproverUserIds) ? s.ApproverUserIds.map(String) : [],
      },
      typeof requester === "string" ? requester : null,
      activeMemberIds,
    );
    return counts ? s : { ...s, Decision: "pending" };
  });
}

/** Parsed requests from already-read rows (newest first). */
export function requestsFromRows(rows: readonly Row[], steps: readonly Row[]): RequestLoad[] {
  const readable: RequestLoad[] = [];
  for (const row of [...rows].sort((a, b) => byId(b, a))) {
    const load = toRequestLoad(row, steps.filter((s) => s.ParentId === row.ItemId));
    if (load) readable.push(load);
  }
  return readable;
}

/** All requests of an environment (newest first by ItemId); `readable` has parsed steps, the rest are unreadable or still being prepared. */
export async function loadRequests(
  ctx: OpContext,
  env: GatedEnvironment,
): Promise<{ rows: Row[]; readable: RequestLoad[] }> {
  const rows = [...(await ctx.ports.query("ApprovalRequest", { ProjectId: ctx.projectId, Environment: env }))].sort(
    (a, b) => byId(b, a),
  );
  if (rows.length === 0) return { rows, readable: [] };
  const steps = await ctx.ports.query("ApprovalStep", {
    ParentType: "request",
    ParentId: { in: rows.map((r) => r.ItemId) },
  });
  const readable: RequestLoad[] = [];
  for (const row of rows) {
    const load = toRequestLoad(row, steps.filter((s) => s.ParentId === row.ItemId));
    if (load) readable.push(load);
  }
  return { rows, readable };
}

/** A stamped ApprovalStep row (policy or request) for the given position. */
export function approvalStepRow(
  ctx: OpContext,
  p: {
    parentType: "policy" | "request";
    parentId: string;
    index: number;
    step: ApprovalPolicyStep;
    required: boolean;
  },
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    ProjectId: ctx.projectId,
    ParentType: p.parentType,
    ParentId: p.parentId,
    StepKey: stepKeyFor(p.index, p.step.type),
    StepType: p.step.type,
    Label: p.step.label ?? "",
    Required: p.required,
    ApproverUserIds: [...p.step.approverUserIds],
    SortOrder: p.index,
  };
  if (p.parentType === "request") {
    row.Decision = "pending";
    row.DecidedByUserId = "";
    row.Comment = "";
  }
  return ctx.stamp(row);
}
