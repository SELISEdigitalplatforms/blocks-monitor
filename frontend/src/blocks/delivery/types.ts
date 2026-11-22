// Delivery rows as the web reads them from the Data Gateway (design 3 and 6, Appendix A): row shapes, field lists and
// shape-checking parsers. A malformed row is reported as unreadable with an error; it is never guessed or defaulted
// into validity. Writes never happen here: every write goes through the `delivery` Logic Function (see actions.ts).
import {
  isChangeLane,
  isChangeStatus,
  isMilestoneStatus,
  isTicketColumn,
  parseApprovalSteps,
  type ChangeLane,
  type ChangeStatus,
  type MilestoneStatus,
  type TicketColumn,
} from "../../domain/delivery";
import { parseVersion } from "../../domain/numbering";
import {
  ENVIRONMENTS,
  type ApprovalPolicy,
  type ApprovalRequest,
  type Environment,
  type GatedEnvironment,
} from "../../domain/promotion";

export type Parsed<T> = { ok: true; value: T } | { ok: false; id: string; error: string };

// ------------------------------------------------------------------ raw rows

export interface ProjectRow {
  ItemId: string;
  WorkspaceId?: string | null;
  Name?: string | null;
  Stage?: string | null;
  /** The step a paused or abandoned project resumes at. */
  ResumeTo?: string | null;
  CurrentScopeVersion?: number | null;
  ScopeLockedAt?: string | null;
  AssigneeUserId?: string | null;
  CreatedByUserId?: string | null;
}
export const PROJECT_FIELDS: readonly Extract<keyof ProjectRow, string>[] = [
  "ItemId", "WorkspaceId", "Name", "Stage", "ResumeTo", "CurrentScopeVersion", "ScopeLockedAt", "AssigneeUserId", "CreatedByUserId",
];

export interface TicketRow {
  ItemId: string;
  ProjectId?: string | null;
  MilestoneId?: string | null;
  Number?: number | null;
  Title?: string | null;
  TicketType?: string | null;
  FeatureRef?: string | null;
  AgentRole?: string | null;
  Column?: string | null;
  EstimateHours?: number | null;
  Acceptance?: string[] | null;
  SortOrder?: number | null;
  PlanRef?: string | null;
  Description?: string | null;
  IsDone?: boolean | null;
  DoneAt?: string | null;
  Source?: string | null;
  DependsOn?: string[] | null;
}
export const TICKET_FIELDS: readonly Extract<keyof TicketRow, string>[] = [
  "ItemId", "ProjectId", "MilestoneId", "Number", "Title", "TicketType", "FeatureRef", "AgentRole", "Column",
  "EstimateHours", "Acceptance", "SortOrder", "PlanRef", "Description", "IsDone", "DoneAt", "Source", "DependsOn",
];

export interface TicketEventRow {
  ItemId: string;
  ProjectId?: string | null;
  TicketId?: string | null;
  Kind?: string | null;
  FromColumn?: string | null;
  ToColumn?: string | null;
  AuthorUserId?: string | null;
  AuthorLabel?: string | null;
  Text?: string | null;
  At?: string | null;
  IsAuto?: boolean | null;
}
export const TICKET_EVENT_FIELDS: readonly Extract<keyof TicketEventRow, string>[] = [
  "ItemId", "ProjectId", "TicketId", "Kind", "FromColumn", "ToColumn", "AuthorUserId", "AuthorLabel", "Text", "At", "IsAuto",
];

export interface MilestoneRow {
  ItemId: string;
  ProjectId?: string | null;
  ScopeVersion?: number | null;
  Number?: number | null;
  Name?: string | null;
  Goal?: string | null;
  FeatureRefs?: string[] | null;
  SortOrder?: number | null;
  Status?: string | null;
  AcceptedAt?: string | null;
  AcceptedByUserId?: string | null;
}
export const MILESTONE_FIELDS: readonly Extract<keyof MilestoneRow, string>[] = [
  "ItemId", "ProjectId", "ScopeVersion", "Number", "Name", "Goal", "FeatureRefs", "SortOrder", "Status",
  "AcceptedAt", "AcceptedByUserId",
];

/** The two fields of a scope Feature that delivery needs: its ref key and its name. */
export interface FeatureNameRow {
  ItemId: string;
  ProjectId?: string | null;
  ScopeVersion?: number | null;
  Key?: string | null;
  Title?: string | null;
}
export const FEATURE_NAME_FIELDS: readonly Extract<keyof FeatureNameRow, string>[] = ["ItemId", "ProjectId", "ScopeVersion", "Key", "Title"];

/** "feature:<Key>" → the feature's name; rows without a key or a name are left out (the ref is shown instead). */
export function featureNamesOf(rows: readonly FeatureNameRow[] | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) {
    const key = (r.Key ?? "").trim(), name = (r.Title ?? "").trim();
    if (key && name) out.set(`feature:${key}`, name);
  }
  return out;
}

export interface PreviewRow {
  ItemId: string;
  ProjectId?: string | null;
  MilestoneId?: string | null;
  Url?: string | null;
  Version?: string | null;
  Status?: string | null;
  ReadyAt?: string | null;
}
export const PREVIEW_FIELDS: readonly Extract<keyof PreviewRow, string>[] = [
  "ItemId", "ProjectId", "MilestoneId", "Url", "Version", "Status", "ReadyAt",
];

export interface ChangeRequestRow {
  ItemId: string;
  ProjectId?: string | null;
  Number?: number | null;
  Lane?: string | null;
  FeatureRef?: string | null;
  Title?: string | null;
  Description?: string | null;
  Status?: string | null;
  Version?: string | null;
  RequestedByUserId?: string | null;
  CreatedByUserId?: string | null;
  /** Analysis JSON (src/domain/changeAnalysis.ts), written by change.analyse; answers added by cr.answer. */
  Analysis?: string | null;
  AnalysedAt?: string | null;
  DecidedAt?: string | null;
  DecidedByUserId?: string | null;
  DecisionNote?: string | null;
  SelfApproved?: boolean | null;
  /** The change's own checks after each deploy, its fix rounds and a revert (src/domain/changeChecks.ts), by the engine. */
  Checks?: string | null;
  /** When the row was last written (a start sets "building" right after its job was queued). */
  LastUpdatedDate?: string | null;
}
export const CHANGE_REQUEST_FIELDS: readonly Extract<keyof ChangeRequestRow, string>[] = [
  "ItemId", "ProjectId", "Number", "Lane", "FeatureRef", "Title", "Description", "Status", "Version",
  "RequestedByUserId", "CreatedByUserId", "Analysis", "AnalysedAt", "DecidedAt", "DecidedByUserId", "DecisionNote",
  "SelfApproved", "Checks", "LastUpdatedDate",
];

export interface ReleaseRow {
  ItemId: string;
  ProjectId?: string | null;
  Environment?: string | null;
  Version?: string | null;
  Url?: string | null;
  ChangeRequestIds?: string[] | null;
  ReleasedAt?: string | null;
  ReleasedByUserId?: string | null;
  ApprovalRequestId?: string | null;
  /** The source commit the release was built from (null when it is not recorded). */
  SourceCommit?: string | null;
  /** released | failed | rolled-back (a build taken off development again after its checks failed). */
  Status?: string | null;
  /** The build that deployed it: its checks say whether it is usable there (src/domain/afterDeploy.ts releaseBroken). */
  EngineJobId?: string | null;
}
export const RELEASE_FIELDS: readonly Extract<keyof ReleaseRow, string>[] = [
  "ItemId", "ProjectId", "Environment", "Version", "Url", "ChangeRequestIds", "ReleasedAt", "ReleasedByUserId",
  "ApprovalRequestId", "SourceCommit", "Status", "EngineJobId",
];

export interface ApprovalPolicyRow {
  ItemId: string;
  ProjectId?: string | null;
  Environment?: string | null;
  LastUpdatedDate?: string | null;
}
export const APPROVAL_POLICY_FIELDS: readonly Extract<keyof ApprovalPolicyRow, string>[] = [
  "ItemId", "ProjectId", "Environment", "LastUpdatedDate",
];

export interface ApprovalRequestRow {
  ItemId: string;
  ProjectId?: string | null;
  Environment?: string | null;
  Version?: string | null;
  Status?: string | null;
  PolicyId?: string | null;
  Attempt?: number | null;
  RequestedByUserId?: string | null;
  RequestedAt?: string | null;
}
export const APPROVAL_REQUEST_FIELDS: readonly Extract<keyof ApprovalRequestRow, string>[] = [
  "ItemId", "ProjectId", "Environment", "Version", "Status", "PolicyId", "Attempt", "RequestedByUserId", "RequestedAt",
];

export interface ApprovalStepRow {
  ItemId: string;
  ParentType?: string | null;
  ParentId?: string | null;
  StepKey?: string | null;
  StepType?: string | null;
  Label?: string | null;
  Required?: boolean | null;
  ApproverUserIds?: string[] | null;
  Decision?: string | null;
  DecidedByUserId?: string | null;
  DecidedAt?: string | null;
  Comment?: string | null;
  SortOrder?: number | null;
}
export const APPROVAL_STEP_FIELDS: readonly Extract<keyof ApprovalStepRow, string>[] = [
  "ItemId", "ParentType", "ParentId", "StepKey", "StepType", "Label", "Required", "ApproverUserIds", "Decision",
  "DecidedByUserId", "DecidedAt", "Comment", "SortOrder",
];

export interface MembershipRow {
  ItemId: string;
  WorkspaceId?: string | null;
  UserId?: string | null;
  DisplayName?: string | null;
  RoleKey?: string | null;
  Status?: string | null;
}
export const MEMBERSHIP_FIELDS: readonly Extract<keyof MembershipRow, string>[] = [
  "ItemId", "WorkspaceId", "UserId", "DisplayName", "RoleKey", "Status",
];

export interface WorkspaceRoleRow {
  ItemId: string;
  WorkspaceId?: string | null;
  Key?: string | null;
  Name?: string | null;
  Permissions?: string[] | null;
  IsBuiltIn?: boolean | null;
}
export const WORKSPACE_ROLE_FIELDS: readonly Extract<keyof WorkspaceRoleRow, string>[] = [
  "ItemId", "WorkspaceId", "Key", "Name", "Permissions", "IsBuiltIn",
];

// ------------------------------------------------------------- parsed shapes

export type TicketKind = "story" | "task" | "fix";
export const TICKET_KINDS: readonly TicketKind[] = ["story", "task", "fix"];
const isTicketKind = (x: unknown): x is TicketKind => typeof x === "string" && (TICKET_KINDS as readonly string[]).includes(x);

export interface DeliveryTicket {
  id: string;
  number: number;
  title: string;
  type: TicketKind;
  featureRef: string;
  agent: string;
  column: TicketColumn;
  isDone: boolean;
  doneAt: string | null;
  milestoneId: string | null;
  sortOrder: number;
  description: string;
  acceptance: string[];
  planRef: string;
  source: string;
  estimateHours: number | null;
  /** ItemIds of the tickets (same project) that must be done before this one starts; [] = independent. */
  dependsOn: string[];
}

export type TicketEventKind = "move" | "comment" | "artifact" | "note";
const EVENT_KINDS: readonly TicketEventKind[] = ["move", "comment", "artifact", "note"];
const isEventKind = (x: unknown): x is TicketEventKind => typeof x === "string" && (EVENT_KINDS as readonly string[]).includes(x);

export interface DeliveryTicketEvent {
  id: string;
  ticketId: string;
  kind: TicketEventKind;
  fromColumn: TicketColumn | null;
  toColumn: TicketColumn | null;
  authorUserId: string | null;
  authorLabel: string | null;
  text: string;
  at: string;
  isAuto: boolean;
}

export interface DeliveryMilestone {
  id: string;
  scopeVersion: number;
  number: number;
  name: string;
  goal: string;
  featureRefs: string[];
  sortOrder: number;
  status: MilestoneStatus;
  /** When and by whom the client accepted the milestone's preview (milestone.accept); null before. */
  acceptedAt: string | null;
  acceptedByUserId: string | null;
}

export interface DeliveryPreview {
  id: string;
  /** The project (set by parsePreview; the app page link needs it). */
  projectId?: string;
  milestoneId: string;
  url: string;
  version: string;
  status: string;
  createdAt: string | null;
}

export interface DeliveryChangeRequest {
  id: string;
  number: number;
  lane: ChangeLane;
  featureRef: string;
  title: string;
  description: string;
  status: ChangeStatus;
  version: string | null;
  createdByUserId: string | null;
  /** The row stores ids only; the UI resolves the name through the member list. */
  createdByName: string;
  /** The stored Analysis text (parse it with parseChangeAnalysis); null before the first analysis. */
  analysis: string | null;
  analysedAt: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  selfApproved: boolean;
  /** The stored Checks text (parse it with parseChangeChecks); null before its first checked deploy. */
  checks?: string | null;
  /** When the row was last written; null when the read did not say (src/components/changes/changeFlow.ts buildLost). */
  updatedAt?: string | null;
}

export interface DeliveryRelease {
  id: string;
  /** The project (set by parseRelease; the app page link needs it). */
  projectId?: string;
  environment: Environment;
  version: string;
  url: string;
  changeRequestIds: string[];
  releasedAt: string | null;
  releasedByUserId: string | null;
  approvalRequestId: string | null;
  /** The source commit it was built from; null when the record does not name one ("commit unknown"). */
  sourceCommit?: string | null;
  /** "rolled-back": taken off the environment again (its checks failed); null for an older row. */
  status?: string | null;
  /** The build that deployed it; null for an older row. */
  engineJobId?: string | null;
}

export interface PolicyRecord {
  id: string;
  environment: GatedEnvironment;
  policy: ApprovalPolicy;
  updatedAt: string | null;
}

export interface RequestRecord {
  id: string;
  environment: GatedEnvironment;
  version: string;
  status: ApprovalRequest["status"];
  policyId: string;
  attempt: number;
  requestedByUserId: string;
  createdAt: string | null;
  request: ApprovalRequest;
  /** Per step, whether the policy that opened the request marked it required (same order as request.steps). */
  stepRequired: boolean[];
}

// ------------------------------------------------------------------- helpers

type Raw = Record<string, unknown>;
type Field<T> = { ok: true; value: T } | { ok: false; error: string };

const isRaw = (x: unknown): x is Raw => typeof x === "object" && x !== null && !Array.isArray(x);
const fieldOk = <T>(value: T): Field<T> => ({ ok: true, value });
const fieldBad = (error: string): Field<never> => ({ ok: false, error });

/** The row's id, or "" when unusable (the error then names no id). */
const rowId = (x: unknown): string => (isRaw(x) && typeof x.ItemId === "string" ? x.ItemId : "");

/** Text: null/undefined/"" count as empty text; any other type is an error. */
function text(r: Raw, key: string): Field<string> {
  const v = r[key];
  if (v === undefined || v === null) return fieldOk("");
  return typeof v === "string" ? fieldOk(v) : fieldBad(`${key} is not text`);
}

function requiredText(r: Raw, key: string): Field<string> {
  const f = text(r, key);
  if (!f.ok) return f;
  return f.value === "" ? fieldBad(`${key} is missing`) : f;
}

function optionalText(r: Raw, key: string): Field<string | null> {
  const f = text(r, key);
  return f.ok ? fieldOk(f.value === "" ? null : f.value) : f;
}

function int(r: Raw, key: string, min = 0): Field<number> {
  const v = r[key];
  return typeof v === "number" && Number.isInteger(v) && v >= min ? fieldOk(v) : fieldBad(`${key} is not a valid number`);
}

function date(r: Raw, key: string): Field<string | null> {
  const f = optionalText(r, key);
  if (!f.ok) return f;
  if (f.value !== null && !Number.isFinite(Date.parse(f.value))) return fieldBad(`${key} is not a date`);
  return f;
}

function requiredDate(r: Raw, key: string): Field<string> {
  const f = date(r, key);
  if (!f.ok) return f;
  return f.value === null ? fieldBad(`${key} is missing`) : fieldOk(f.value);
}

function bool(r: Raw, key: string): Field<boolean> {
  const v = r[key];
  if (v === undefined || v === null) return fieldOk(false);
  return typeof v === "boolean" ? fieldOk(v) : fieldBad(`${key} is not true/false`);
}

function textList(r: Raw, key: string): Field<string[]> {
  const v = r[key];
  if (v === undefined || v === null) return fieldOk([]);
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? fieldOk([...(v as string[])]) : fieldBad(`${key} is not a list of text`);
}

function semver(r: Raw, key: string): Field<string> {
  const f = requiredText(r, key);
  if (!f.ok) return f;
  return parseVersion(f.value) ? f : fieldBad(`${key} is not a version`);
}

/** Runs the field reads of one row; the first failure becomes the row's error. */
function build<T>(row: unknown, make: (r: Raw, fail: (f: Field<never>) => never) => T): Parsed<T> {
  const id = rowId(row);
  if (!isRaw(row)) return { ok: false, id, error: "The row is not an object." };
  if (!id) return { ok: false, id, error: "ItemId is missing." };
  class Bail extends Error {}
  let message = "";
  try {
    return {
      ok: true,
      value: make(row, (f) => {
        message = f.ok ? "" : f.error;
        throw new Bail();
      }),
    };
  } catch (e) {
    if (e instanceof Bail) return { ok: false, id, error: message };
    throw e;
  }
}

/** Unwraps a field read or aborts the row. */
function need<T>(f: Field<T>, fail: (f: Field<never>) => never): T {
  if (!f.ok) return fail(f);
  return f.value;
}

// -------------------------------------------------------------------- parsers

export function parseTicket(row: unknown): Parsed<DeliveryTicket> {
  return build(row, (r, fail) => {
    const column = need(text(r, "Column"), fail);
    if (!isTicketColumn(column)) fail(fieldBad("Column is not a board column"));
    const type = need(text(r, "TicketType"), fail);
    if (!isTicketKind(type)) fail(fieldBad("TicketType is unknown"));
    const hours = r.EstimateHours;
    if (hours !== undefined && hours !== null && !(typeof hours === "number" && Number.isFinite(hours) && hours >= 0)) {
      fail(fieldBad("EstimateHours is not a valid number"));
    }
    return {
      id: r.ItemId as string,
      number: need(int(r, "Number"), fail),
      title: need(requiredText(r, "Title"), fail),
      type: type as TicketKind,
      featureRef: need(text(r, "FeatureRef"), fail),
      agent: need(text(r, "AgentRole"), fail),
      column: column as TicketColumn,
      isDone: need(bool(r, "IsDone"), fail),
      doneAt: need(date(r, "DoneAt"), fail),
      milestoneId: need(optionalText(r, "MilestoneId"), fail),
      sortOrder: need(int(r, "SortOrder"), fail),
      description: need(text(r, "Description"), fail),
      acceptance: need(textList(r, "Acceptance"), fail),
      planRef: need(text(r, "PlanRef"), fail),
      source: need(text(r, "Source"), fail),
      estimateHours: typeof hours === "number" ? hours : null,
      dependsOn: [...new Set(need(textList(r, "DependsOn"), fail))].filter((x) => x !== "" && x !== r.ItemId),
    };
  });
}

export function parseTicketEvent(row: unknown): Parsed<DeliveryTicketEvent> {
  return build(row, (r, fail) => {
    const kind = need(text(r, "Kind"), fail);
    if (!isEventKind(kind)) fail(fieldBad("Kind is unknown"));
    const column = (key: string): TicketColumn | null => {
      const v = need(optionalText(r, key), fail);
      if (v === null) return null;
      if (!isTicketColumn(v)) fail(fieldBad(`${key} is not a board column`));
      return v as TicketColumn;
    };
    return {
      id: r.ItemId as string,
      ticketId: need(requiredText(r, "TicketId"), fail),
      kind: kind as TicketEventKind,
      fromColumn: column("FromColumn"),
      toColumn: column("ToColumn"),
      authorUserId: need(optionalText(r, "AuthorUserId"), fail),
      authorLabel: need(optionalText(r, "AuthorLabel"), fail),
      text: need(text(r, "Text"), fail),
      at: need(requiredDate(r, "At"), fail),
      isAuto: need(bool(r, "IsAuto"), fail),
    };
  });
}

export function parseMilestone(row: unknown): Parsed<DeliveryMilestone> {
  return build(row, (r, fail) => {
    const status = need(text(r, "Status"), fail);
    if (!isMilestoneStatus(status)) fail(fieldBad("Status is unknown"));
    return {
      id: r.ItemId as string,
      scopeVersion: need(int(r, "ScopeVersion", 1), fail),
      number: need(int(r, "Number", 1), fail),
      name: need(requiredText(r, "Name"), fail),
      goal: need(text(r, "Goal"), fail),
      featureRefs: need(textList(r, "FeatureRefs"), fail),
      sortOrder: need(int(r, "SortOrder"), fail),
      status: status as MilestoneStatus,
      acceptedAt: typeof r.AcceptedAt === "string" && Number.isFinite(Date.parse(r.AcceptedAt)) ? r.AcceptedAt : null,
      acceptedByUserId: typeof r.AcceptedByUserId === "string" && r.AcceptedByUserId ? r.AcceptedByUserId : null,
    };
  });
}

const projectOf = (r: Record<string, unknown>): { projectId?: string } =>
  typeof r.ProjectId === "string" && r.ProjectId ? { projectId: r.ProjectId } : {};

export function parsePreview(row: unknown): Parsed<DeliveryPreview> {
  return build(row, (r, fail) => ({
    id: r.ItemId as string,
    ...projectOf(r),
    milestoneId: need(requiredText(r, "MilestoneId"), fail),
    url: need(text(r, "Url"), fail),
    version: need(semver(r, "Version"), fail),
    status: need(requiredText(r, "Status"), fail),
    createdAt: need(date(r, "ReadyAt"), fail),
  }));
}

const lenientDate = (v: unknown): string | null =>
  typeof v === "string" && v && !Number.isNaN(Date.parse(v)) ? v : null;

export function parseChangeRequest(row: unknown): Parsed<DeliveryChangeRequest> {
  return build(row, (r, fail) => {
    const lane = need(text(r, "Lane"), fail);
    if (!isChangeLane(lane)) fail(fieldBad("Lane is unknown"));
    const status = need(text(r, "Status"), fail);
    if (!isChangeStatus(status)) fail(fieldBad("Status is unknown"));
    const version = need(optionalText(r, "Version"), fail);
    if (version !== null && !parseVersion(version)) fail(fieldBad("Version is not a version"));
    return {
      id: r.ItemId as string,
      number: need(int(r, "Number", 1), fail),
      lane: lane as ChangeLane,
      featureRef: need(text(r, "FeatureRef"), fail),
      title: need(text(r, "Title"), fail),
      description: need(text(r, "Description"), fail),
      status: status as ChangeStatus,
      version,
      createdByUserId: need(optionalText(r, "RequestedByUserId"), fail) ?? need(optionalText(r, "CreatedByUserId"), fail),
      createdByName: "",
      // additive fields (absent on older rows): never a reason to drop the row
      analysis: typeof r.Analysis === "string" && r.Analysis.trim() ? r.Analysis : null,
      analysedAt: lenientDate(r.AnalysedAt),
      decidedAt: lenientDate(r.DecidedAt),
      decidedByUserId: typeof r.DecidedByUserId === "string" && r.DecidedByUserId ? r.DecidedByUserId : null,
      decisionNote: typeof r.DecisionNote === "string" && r.DecisionNote.trim() ? r.DecisionNote : null,
      selfApproved: r.SelfApproved === true,
      checks: typeof r.Checks === "string" && r.Checks.trim() ? r.Checks : null,
      updatedAt: lenientDate(r.LastUpdatedDate),
    };
  });
}

const isEnvironment = (x: unknown): x is Environment => typeof x === "string" && (ENVIRONMENTS as readonly string[]).includes(x);
const isGated = (x: unknown): x is GatedEnvironment => x === "stage" || x === "production";

export function parseRelease(row: unknown): Parsed<DeliveryRelease> {
  return build(row, (r, fail) => {
    const env = need(text(r, "Environment"), fail);
    if (!isEnvironment(env)) fail(fieldBad("Environment is unknown"));
    return {
      id: r.ItemId as string,
      ...projectOf(r),
      environment: env as Environment,
      version: need(semver(r, "Version"), fail),
      url: need(text(r, "Url"), fail),
      changeRequestIds: need(textList(r, "ChangeRequestIds"), fail),
      releasedAt: need(date(r, "ReleasedAt"), fail),
      releasedByUserId: need(optionalText(r, "ReleasedByUserId"), fail),
      approvalRequestId: need(optionalText(r, "ApprovalRequestId"), fail),
      // never fails a release: an unreadable commit is only "commit unknown"
      sourceCommit: typeof r.SourceCommit === "string" && r.SourceCommit.trim() ? r.SourceCommit.trim() : null,
      status: typeof r.Status === "string" && r.Status ? r.Status : null,
      engineJobId: typeof r.EngineJobId === "string" && r.EngineJobId ? r.EngineJobId : null,
    };
  });
}

/** The step rows that belong to one parent (other parents' rows are not this parent's problem). */
function stepsOf(stepRows: readonly unknown[], parentType: "policy" | "request", parentId: string): unknown[] {
  return stepRows.filter((s) => isRaw(s) && s.ParentType === parentType && s.ParentId === parentId);
}

/** A policy whose steps are malformed is unreadable. */
export function parsePolicy(row: unknown, stepRows: readonly unknown[]): Parsed<PolicyRecord> {
  return build(row, (r, fail) => {
    const env = need(text(r, "Environment"), fail);
    if (!isGated(env)) fail(fieldBad("Environment is not stage or production"));
    const id = r.ItemId as string;
    const steps = parseApprovalSteps(stepsOf(stepRows, "policy", id), "policy", id);
    if (!steps.ok) return fail(fieldBad(steps.error));
    return {
      id,
      environment: env as GatedEnvironment,
      policy: { environment: env as GatedEnvironment, steps: steps.steps },
      updatedAt: need(date(r, "LastUpdatedDate"), fail),
    };
  });
}

const REQUEST_STATUSES: readonly ApprovalRequest["status"][] = ["pending", "approved", "rejected", "cancelled"];

/** A pending request with zero steps is valid: it is still being prepared and can never promote. */
export function parseRequest(row: unknown, stepRows: readonly unknown[]): Parsed<RequestRecord> {
  return build(row, (r, fail) => {
    const env = need(text(r, "Environment"), fail);
    if (!isGated(env)) fail(fieldBad("Environment is not stage or production"));
    const status = need(text(r, "Status"), fail);
    if (!(REQUEST_STATUSES as readonly string[]).includes(status)) fail(fieldBad("Status is unknown"));
    const id = r.ItemId as string;
    const steps = parseApprovalSteps(stepsOf(stepRows, "request", id), "request", id);
    if (!steps.ok) return fail(fieldBad(steps.error));
    const version = need(semver(r, "Version"), fail);
    return {
      id,
      environment: env as GatedEnvironment,
      version,
      status: status as ApprovalRequest["status"],
      policyId: need(requiredText(r, "PolicyId"), fail),
      attempt: need(int(r, "Attempt", 1), fail),
      requestedByUserId: need(requiredText(r, "RequestedByUserId"), fail),
      createdAt: need(date(r, "RequestedAt"), fail),
      request: {
        environment: env as GatedEnvironment,
        version,
        status: status as ApprovalRequest["status"],
        steps: steps.steps,
      },
      stepRequired: steps.meta.map((m) => m.required),
    };
  });
}

/** Parses every row; readable ones go to `data`, the rest to `unreadable` with their error. */
export function parseAll<T>(
  rows: readonly unknown[] | null | undefined,
  parse: (row: unknown) => Parsed<T>,
): { data: T[]; unreadable: { id: string; error: string }[] } {
  const data: T[] = [];
  const unreadable: { id: string; error: string }[] = [];
  for (const row of rows ?? []) {
    const p = parse(row);
    if (p.ok) data.push(p.value);
    else unreadable.push({ id: p.id, error: p.error });
  }
  return { data, unreadable };
}
