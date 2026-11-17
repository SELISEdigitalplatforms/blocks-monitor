/**
 * Product sanitization rules as pure functions: clarification state machine, input
 * parsers and caps, completion blockers, v1 snapshots and the stage mapping.
 * No React, DOM, storage, timer or network, so the server functions can bundle this file.
 */
import { can } from "./rbac";
import type { WorkspacePermission } from "./rbac";
import { JOURNEY_STEPS, stepIndex } from "./journey";
import type { JourneyStep, StepState } from "./journey";

// ---- Types ----------------------------------------------------------------

export type ClarificationStatus = "open" | "answered" | "deferred";
export type ClarificationEvent = "answer" | "defer" | "reopen";
export type SanitizationPhase = "unavailable" | "notOpen" | "open" | "completed";
export type TechArea = "stack" | "architecture" | "integration" | "nfr" | "security" | "data" | "hosting" | "other";
export type TechStatus = "proposed" | "accepted" | "rejected";
export type NfrCategory =
  | "performance"
  | "security"
  | "availability"
  | "scalability"
  | "accessibility"
  | "privacy"
  | "compliance"
  | "operability"
  | "other";
export type RequirementPriority = "must" | "nice" | "later";
export type AssistFocus = "clarifications" | "technical" | "requirements";
export type DecisionStatus = "proposed" | "accepted" | "rejected" | "superseded";

export const SANITIZATION_MESSAGE_KEYS = [
  "sanitization.notOpen",
  "sanitization.unavailable",
  "sanitization.paused",
  "sanitization.forbidden",
  "sanitization.v1Frozen",
  "sanitization.alreadyComplete",
  "sanitization.notReady",
  "sanitization.invalidField",
  "sanitization.transition",
  "sanitization.cantAnswer",
  "sanitization.attachmentNotReady",
  "sanitization.notMember",
  "sanitization.badReference",
  "sanitization.notFound",
  "sanitization.clarificationInUse",
  "sanitization.supersedeTarget",
  "sanitization.decisionSuperseded",
  "sanitization.limit",
  "sanitization.stale",
  "sanitization.notAuthor",
  "sanitization.batchTooLarge",
  "sanitization.journeyRefused",
  "sanitization.blocker.noRequirements",
  "sanitization.blocker.requirementIncomplete",
  "sanitization.blocker.noObjective",
  "sanitization.blocker.openClarifications",
  "sanitization.blocker.draftRunning",
] as const;

export type SanitizationMessageKey = (typeof SANITIZATION_MESSAGE_KEYS)[number];

export type Check<T> =
  | { ok: true; value: T }
  | { ok: false; messageKey: SanitizationMessageKey; params: Record<string, unknown> };

export interface Blocker {
  messageKey: SanitizationMessageKey;
  params: Record<string, unknown>;
}

// ---- Constants ------------------------------------------------------------

export const SANITIZATION_CAPS = {
  question: 2000,
  answer: 5000,
  deferReason: 1000,
  decisionTitle: 200,
  decisionText: 5000,
  decisionRationale: 5000,
  techTopic: 200,
  techChoice: 500,
  techRationale: 5000,
  techAlternatives: 5000,
  consulted: 10,
  nfrTarget: 500,
  integrationSystem: 200,
  requirementTitle: 200,
  requirementText: 5000,
  criteriaPerRequirement: 20,
  criterion: 500,
  objectiveStatement: 2000,
  highLevel: 20000,
  architecture: 20000,
  comment: 5000,
  instruction: 2000,
} as const;

export const PROJECT_LIMITS = { clarifications: 500, decisions: 500, techDecisions: 300, requirements: 300 } as const;
export const BATCH_MAX = 50;

export const CLARIFICATION_STATUSES: readonly ClarificationStatus[] = ["open", "answered", "deferred"];
export const TECH_AREAS: readonly TechArea[] = [
  "stack",
  "architecture",
  "integration",
  "nfr",
  "security",
  "data",
  "hosting",
  "other",
];
export const TECH_AREA_GROUPS: readonly TechArea[] = ["stack", "architecture", "integration", "nfr"];
export const TECH_STATUSES: readonly TechStatus[] = ["proposed", "accepted", "rejected"];
export const NFR_CATEGORIES: readonly NfrCategory[] = [
  "performance",
  "security",
  "availability",
  "scalability",
  "accessibility",
  "privacy",
  "compliance",
  "operability",
  "other",
];
export const REQUIREMENT_PRIORITIES: readonly RequirementPriority[] = ["must", "nice", "later"];
export const ASSIST_FOCUSES: readonly AssistFocus[] = ["clarifications", "technical", "requirements"];

export const CLARIFICATION_STATUS_LABEL: Record<ClarificationStatus, string> = {
  open: "Open",
  answered: "Answered",
  deferred: "Deferred",
};
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: "Proposed",
  accepted: "Active",
  rejected: "Rejected",
  superseded: "Superseded",
};
export const TECH_STATUS_LABEL: Record<TechStatus, string> = {
  proposed: "Proposed",
  accepted: "Agreed",
  rejected: "Rejected",
};
export const TECH_AREA_LABEL: Record<TechArea, string> = {
  stack: "Tech stack",
  architecture: "Architecture",
  integration: "Integrations",
  nfr: "Non-functional requirements",
  security: "Security",
  data: "Data",
  hosting: "Hosting",
  other: "Other",
};
export const NFR_CATEGORY_LABEL: Record<NfrCategory, string> = {
  performance: "Performance",
  security: "Security",
  availability: "Availability",
  scalability: "Scalability",
  accessibility: "Accessibility",
  privacy: "Privacy",
  compliance: "Compliance",
  operability: "Operability",
  other: "Other",
};
export const PRIORITY_LABEL: Record<RequirementPriority, string> = {
  must: "Must",
  nice: "Nice to have",
  later: "Later",
};

/** Business reference types the Clarification source can point at (S1 has no folder value yet). */
export const SOURCE_TYPE_FOR_REF = { note: "doc-note", file: "doc-file" } as const;
export const REF_FOR_SOURCE_TYPE = { "doc-note": "note", "doc-file": "file" } as const;

export const ITEM_KEY_PATTERN =
  /^((requirement|feature|story|screen|acceptance|milestone|clarification|decision|tech-decision):[a-z0-9][a-z0-9-]{0,62}|objective:main)$/;
export const OBJECTIVE_ITEM_KEY = "objective:main";
export const OBJECTIVE_ACCEPTANCE_KEY = "acceptance:objective";

// ---- Text -----------------------------------------------------------------

// Everything below U+0020 except tab (U+0009) and newline (U+000A), plus DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function cleanText(v: unknown): string {
  return typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim() : "";
}

const bad = (field: string, rule: string, max?: number): Check<never> => ({
  ok: false,
  messageKey: "sanitization.invalidField",
  params: max === undefined ? { field, rule } : { field, rule, max },
});

export function checkText(
  field: string,
  v: unknown,
  opts: { max: number; required?: boolean },
): Check<string> {
  const s = cleanText(v);
  if (opts.required && s === "") return bad(field, "required");
  if (s.length > opts.max) return bad(field, "tooLong", opts.max);
  return { ok: true, value: s };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkEnum<T extends string>(field: string, v: unknown, allowed: readonly T[], required = true): Check<T | ""> {
  if (v === undefined || v === null || v === "") return required ? bad(field, "required") : { ok: true, value: "" };
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) return bad(field, "enum");
  return { ok: true, value: v as T };
}

// ---- Parsers --------------------------------------------------------------

export function parseClarificationInput(
  args: unknown,
): Check<{ question: string; ownerUserId: string; sourceType: "doc-note" | "doc-file" | ""; sourceRef: string }> {
  const a = isRecord(args) ? args : {};
  const q = checkText("question", a.question, { max: SANITIZATION_CAPS.question, required: true });
  if (!q.ok) return q;
  const ownerUserId = cleanText(a.ownerUserId);
  const t = checkEnum("sourceType", a.sourceType, ["note", "file"] as const, false);
  if (!t.ok) return t;
  if (t.value === "") return { ok: true, value: { question: q.value, ownerUserId, sourceType: "", sourceRef: "" } };
  const sourceRef = cleanText(a.sourceId);
  if (sourceRef === "") return bad("sourceId", "required");
  return {
    ok: true,
    value: { question: q.value, ownerUserId, sourceType: SOURCE_TYPE_FOR_REF[t.value], sourceRef },
  };
}

export const parseAnswer = (v: unknown): Check<string> =>
  checkText("answer", v, { max: SANITIZATION_CAPS.answer, required: true });

export const parseDeferReason = (v: unknown): Check<string> =>
  checkText("reason", v, { max: SANITIZATION_CAPS.deferReason, required: true });

export function parseDecisionInput(
  args: unknown,
): Check<{ title: string; statement: string; rationale: string; clarificationId: string; supersedesId: string }> {
  const a = isRecord(args) ? args : {};
  const title = checkText("title", a.title, { max: SANITIZATION_CAPS.decisionTitle, required: true });
  if (!title.ok) return title;
  const statement = checkText("decisionText", a.decisionText, { max: SANITIZATION_CAPS.decisionText, required: true });
  if (!statement.ok) return statement;
  const rationale = checkText("rationale", a.rationale, { max: SANITIZATION_CAPS.decisionRationale });
  if (!rationale.ok) return rationale;
  return {
    ok: true,
    value: {
      title: title.value,
      statement: statement.value,
      rationale: rationale.value,
      clarificationId: cleanText(a.clarificationId),
      supersedesId: cleanText(a.supersedesId),
    },
  };
}

export function parseTechDecisionInput(args: unknown): Check<{
  area: TechArea;
  title: string;
  choice: string;
  rationale: string;
  alternatives: string;
  status: TechStatus;
  nfrCategory: NfrCategory | "";
  nfrTarget: string;
  integrationSystem: string;
  expertUserIds: string[];
}> {
  const a = isRecord(args) ? args : {};
  const area = checkEnum("area", a.area, TECH_AREAS);
  if (!area.ok) return area;
  const title = checkText("topic", a.topic, { max: SANITIZATION_CAPS.techTopic, required: true });
  if (!title.ok) return title;
  const choice = checkText("choice", a.choice, { max: SANITIZATION_CAPS.techChoice });
  if (!choice.ok) return choice;
  const rationale = checkText("rationale", a.rationale, { max: SANITIZATION_CAPS.techRationale });
  if (!rationale.ok) return rationale;
  const alternatives = checkText("alternativesConsidered", a.alternativesConsidered, {
    max: SANITIZATION_CAPS.techAlternatives,
  });
  if (!alternatives.ok) return alternatives;
  const rawStatus = a.status === undefined || a.status === null || a.status === "" ? "proposed" : a.status;
  const status = checkEnum("status", rawStatus, TECH_STATUSES);
  if (!status.ok) return status;

  let nfrCategory: NfrCategory | "" = "";
  let nfrTarget = "";
  let integrationSystem = "";
  if (area.value === "nfr") {
    const cat = checkEnum("nfrCategory", a.nfrCategory, NFR_CATEGORIES);
    if (!cat.ok) return cat;
    const target = checkText("target", a.target, { max: SANITIZATION_CAPS.nfrTarget, required: true });
    if (!target.ok) return target;
    nfrCategory = cat.value;
    nfrTarget = target.value;
  } else if (area.value === "integration") {
    const sys = checkText("integrationSystem", a.integrationSystem, {
      max: SANITIZATION_CAPS.integrationSystem,
      required: true,
    });
    if (!sys.ok) return sys;
    integrationSystem = sys.value;
  }

  const expertUserIds: string[] = [];
  if (a.consultedUserIds !== undefined && a.consultedUserIds !== null) {
    if (!Array.isArray(a.consultedUserIds)) return bad("consultedUserIds", "format");
    for (const raw of a.consultedUserIds) {
      const id = cleanText(raw);
      if (id === "") return bad("consultedUserIds", "format");
      if (!expertUserIds.includes(id)) expertUserIds.push(id);
    }
    if (expertUserIds.length > SANITIZATION_CAPS.consulted)
      return bad("consultedUserIds", "tooMany", SANITIZATION_CAPS.consulted);
  }

  return {
    ok: true,
    value: {
      area: area.value as TechArea,
      title: title.value,
      choice: choice.value,
      rationale: rationale.value,
      alternatives: alternatives.value,
      status: status.value as TechStatus,
      nfrCategory,
      nfrTarget,
      integrationSystem,
      expertUserIds,
    },
  };
}

export interface ParsedRequirementUpsert {
  id: string;
  clientKey: string;
  title: string;
  text: string;
  priority: RequirementPriority;
  acceptanceCriteria: string[];
  sortOrder: number;
  expectedUpdatedAt?: string;
}

export interface ParsedObjectiveInput {
  statement?: string;
  highLevelMd?: string;
  architectureMd?: string;
  expectedUpdatedAt?: string;
}

const CLIENT_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

function optionalStamp(field: string, v: unknown): Check<string | undefined> {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  if (typeof v !== "string") return bad(field, "format");
  return { ok: true, value: v };
}

export function parseInitialRequirementsInput(
  args: unknown,
): Check<{ objective: ParsedObjectiveInput | null; upsert: ParsedRequirementUpsert[]; remove: string[] }> {
  const a = isRecord(args) ? args : {};
  const tooBig = (): Check<never> => ({
    ok: false,
    messageKey: "sanitization.batchTooLarge",
    params: { max: BATCH_MAX },
  });

  for (const name of ["upsert", "remove"] as const) {
    const list = a[name];
    if (list !== undefined && list !== null) {
      if (!Array.isArray(list)) return bad(name, "format");
      if (list.length > BATCH_MAX) return tooBig();
    }
  }

  let objective: ParsedObjectiveInput | null = null;
  if (a.objective !== undefined && a.objective !== null) {
    if (!isRecord(a.objective)) return bad("objective", "format");
    const o = a.objective;
    objective = {};
    if (o.statement !== undefined) {
      const r = checkText("objective.statement", o.statement, { max: SANITIZATION_CAPS.objectiveStatement });
      if (!r.ok) return r;
      objective.statement = r.value;
    }
    if (o.highLevelDetails !== undefined) {
      const r = checkText("objective.highLevelDetails", o.highLevelDetails, { max: SANITIZATION_CAPS.highLevel });
      if (!r.ok) return r;
      objective.highLevelMd = r.value;
    }
    if (o.architectureSummary !== undefined) {
      const r = checkText("objective.architectureSummary", o.architectureSummary, {
        max: SANITIZATION_CAPS.architecture,
      });
      if (!r.ok) return r;
      objective.architectureMd = r.value;
    }
    const stamp = optionalStamp("objective.expectedUpdatedAt", o.expectedUpdatedAt);
    if (!stamp.ok) return stamp;
    if (stamp.value !== undefined) objective.expectedUpdatedAt = stamp.value;
  }

  const upsert: ParsedRequirementUpsert[] = [];
  for (const raw of (a.upsert as unknown[] | undefined) ?? []) {
    if (!isRecord(raw)) return bad("upsert", "format");
    const id = cleanText(raw.id);
    const rawKey = cleanText(raw.clientKey).toLowerCase();
    if ((id === "") === (rawKey === "")) return bad("upsert.id", "format");
    if (rawKey !== "" && !CLIENT_KEY.test(rawKey)) return bad("upsert.clientKey", "format");
    const title = checkText("upsert.title", raw.title, { max: SANITIZATION_CAPS.requirementTitle, required: true });
    if (!title.ok) return title;
    const text = checkText("upsert.description", raw.description, { max: SANITIZATION_CAPS.requirementText });
    if (!text.ok) return text;
    const priority = checkEnum("upsert.priority", raw.priority, REQUIREMENT_PRIORITIES);
    if (!priority.ok) return priority;

    const criteria: string[] = [];
    if (raw.acceptanceCriteria !== undefined && raw.acceptanceCriteria !== null) {
      if (!Array.isArray(raw.acceptanceCriteria)) return bad("upsert.acceptanceCriteria", "format");
      for (const c of raw.acceptanceCriteria) {
        const r = checkText("upsert.acceptanceCriteria", c, { max: SANITIZATION_CAPS.criterion });
        if (!r.ok) return r;
        if (r.value !== "") criteria.push(r.value);
      }
      if (criteria.length > SANITIZATION_CAPS.criteriaPerRequirement)
        return bad("upsert.acceptanceCriteria", "tooMany", SANITIZATION_CAPS.criteriaPerRequirement);
    }

    if (raw.sortOrder === undefined || raw.sortOrder === null) return bad("upsert.sortOrder", "required");
    const so = raw.sortOrder;
    if (typeof so !== "number" || !Number.isInteger(so) || so < 0 || so > 1_000_000)
      return bad("upsert.sortOrder", "format");

    const stamp = optionalStamp("upsert.expectedUpdatedAt", raw.expectedUpdatedAt);
    if (!stamp.ok) return stamp;
    const row: ParsedRequirementUpsert = {
      id,
      clientKey: rawKey,
      title: title.value,
      text: text.value,
      priority: priority.value as RequirementPriority,
      acceptanceCriteria: criteria,
      sortOrder: so,
    };
    if (stamp.value !== undefined) row.expectedUpdatedAt = stamp.value;
    upsert.push(row);
  }

  const remove: string[] = [];
  for (const raw of (a.remove as unknown[] | undefined) ?? []) {
    const id = cleanText(raw);
    if (id === "") return bad("remove", "format");
    if (!remove.includes(id)) remove.push(id);
  }

  return { ok: true, value: { objective, upsert, remove } };
}

export const parseComment = (v: unknown): Check<string> =>
  checkText("text", v, { max: SANITIZATION_CAPS.comment, required: true });

export const parseInstruction = (v: unknown): Check<string> =>
  checkText("instruction", v, { max: SANITIZATION_CAPS.instruction });

export function parseAssistInput(args: unknown): Check<{ focus: AssistFocus; refId: string; question: string }> {
  const a = isRecord(args) ? args : {};
  const focus = checkEnum("focus", a.focus, ASSIST_FOCUSES);
  if (!focus.ok) return focus;
  const question = checkText("question", a.question, { max: SANITIZATION_CAPS.instruction });
  if (!question.ok) return question;
  return { ok: true, value: { focus: focus.value as AssistFocus, refId: cleanText(a.refId), question: question.value } };
}

// ---- Clarification state machine -------------------------------------------

export function clarificationTransition(
  current: ClarificationStatus,
  event: ClarificationEvent,
  input: { answer?: string; reason?: string } = {},
): { ok: true; next: ClarificationStatus } | { ok: false; messageKey: SanitizationMessageKey } {
  if (event === "answer" && (current === "open" || current === "answered")) {
    if (cleanText(input.answer) === "") return { ok: false, messageKey: "sanitization.invalidField" };
    return { ok: true, next: "answered" };
  }
  if (event === "defer" && current === "open") {
    if (cleanText(input.reason) === "") return { ok: false, messageKey: "sanitization.invalidField" };
    return { ok: true, next: "deferred" };
  }
  if (event === "reopen" && (current === "answered" || current === "deferred")) return { ok: true, next: "open" };
  return { ok: false, messageKey: "sanitization.transition" };
}

export function canAnswerClarification(
  caller: { userId: string; permissions: readonly string[] },
  clarification: { ownerUserId: string },
): boolean {
  if (can(caller.permissions, "sanitization.edit" satisfies WorkspacePermission)) return true;
  const owner = clarification.ownerUserId;
  return owner !== "" && owner === caller.userId && can(caller.permissions, "comment");
}

// ---- Completion -----------------------------------------------------------

export const isActiveDraftStatus = (status: string): boolean =>
  status === "queued" || status === "claimed" || status === "running";

export function completionBlockers(input: {
  clarifications: readonly { status: string }[];
  requirements: readonly { number: number; title: string; acceptanceCriteria: readonly string[] }[];
  objective: { statement: string } | null;
  activeDraftJob: { id: string; status: string } | null;
}): Blocker[] {
  const out: Blocker[] = [];
  if (input.requirements.length === 0) out.push({ messageKey: "sanitization.blocker.noRequirements", params: {} });
  const sorted = [...input.requirements].sort((x, y) => x.number - y.number);
  for (const r of sorted) {
    if (cleanText(r.title) === "")
      out.push({ messageKey: "sanitization.blocker.requirementIncomplete", params: { number: r.number, missing: "title" } });
    else if (!r.acceptanceCriteria.some((c) => cleanText(c) !== ""))
      out.push({ messageKey: "sanitization.blocker.requirementIncomplete", params: { number: r.number, missing: "criteria" } });
  }
  if (!input.objective || cleanText(input.objective.statement) === "")
    out.push({ messageKey: "sanitization.blocker.noObjective", params: {} });
  const open = input.clarifications.filter((c) => c.status === "open").length;
  if (open > 0) out.push({ messageKey: "sanitization.blocker.openClarifications", params: { count: open } });
  if (input.activeDraftJob && isActiveDraftStatus(input.activeDraftJob.status))
    out.push({ messageKey: "sanitization.blocker.draftRunning", params: { jobId: input.activeDraftJob.id } });
  return out;
}

// ---- Snapshots (shared byte-for-byte with L6 versioning) -------------------

export function requirementSnapshot(req: { title?: string; text?: string; priority?: string }): string {
  return JSON.stringify({ priority: req.priority ?? "", text: req.text ?? "", title: req.title ?? "" });
}

export function objectiveSnapshot(obj: {
  statement?: string;
  highLevelMd?: string;
  architectureMd?: string;
}): string {
  return JSON.stringify({
    architectureMd: obj.architectureMd ?? "",
    highLevelMd: obj.highLevelMd ?? "",
    statement: obj.statement ?? "",
  });
}

export function acceptanceSnapshot(criteria: readonly string[]): string {
  return criteria
    .map((c) => cleanText(c))
    .filter((c) => c !== "")
    .join("\n");
}

function itemKey(prefix: "requirement" | "acceptance", id: string): string | null {
  const key = `${prefix}:${String(id).toLowerCase()}`;
  return ITEM_KEY_PATTERN.test(key) ? key : null;
}
export const requirementItemKey = (id: string): string | null => itemKey("requirement", id);
export const acceptanceItemKey = (id: string): string | null => itemKey("acceptance", id);

export function v1VersionRows(input: {
  requirements: readonly {
    id: string;
    title: string;
    text: string;
    priority: string;
    acceptanceCriteria: readonly string[];
    engineDrafted: boolean;
  }[];
  objective: {
    statement: string;
    highLevelMd: string;
    architectureMd: string;
    acceptanceCriteria?: readonly string[];
    engineDrafted: boolean;
  } | null;
}): Check<{ itemKey: string; text: string; origin: "person" | "engine" }[]> {
  const rows: { itemKey: string; text: string; origin: "person" | "engine" }[] = [];
  for (const r of input.requirements) {
    const origin = r.engineDrafted ? "engine" : "person";
    const rk = requirementItemKey(r.id);
    if (rk === null) return bad("itemKey", "format");
    rows.push({ itemKey: rk, text: requirementSnapshot(r), origin });
    const criteria = acceptanceSnapshot(r.acceptanceCriteria);
    if (criteria !== "") {
      const ak = acceptanceItemKey(r.id);
      if (ak === null) return bad("itemKey", "format");
      rows.push({ itemKey: ak, text: criteria, origin });
    }
  }
  const o = input.objective;
  if (o) {
    const origin = o.engineDrafted ? "engine" : "person";
    rows.push({ itemKey: OBJECTIVE_ITEM_KEY, text: objectiveSnapshot(o), origin });
    const criteria = acceptanceSnapshot(o.acceptanceCriteria ?? []);
    if (criteria !== "") rows.push({ itemKey: OBJECTIVE_ACCEPTANCE_KEY, text: criteria, origin });
  }
  return { ok: true, value: rows };
}

// ---- Journey --------------------------------------------------------------

const isStep = (v: unknown): v is JourneyStep =>
  typeof v === "string" && (JOURNEY_STEPS as readonly string[]).includes(v);

function phaseOfStep(step: JourneyStep): SanitizationPhase {
  if (step === "business") return "notOpen";
  if (step === "sanitization") return "open";
  return "completed";
}

export function sanitizationPhase(p: { stage: string; resumeTo?: string }): SanitizationPhase {
  if (isStep(p.stage)) return phaseOfStep(p.stage);
  if (p.stage === "paused") {
    if (!p.resumeTo) return "notOpen";
    return isStep(p.resumeTo) ? phaseOfStep(p.resumeTo) : "notOpen";
  }
  return "unavailable";
}

export const projectPaused = (p: { stage: string }): boolean => p.stage === "paused";

export function stepStateFromProject(p: { stage: string; resumeTo?: string }): StepState | null {
  let step: JourneyStep | null = null;
  if (isStep(p.stage)) step = p.stage;
  else if (p.stage === "paused" || p.stage === "abandoned") step = isStep(p.resumeTo) ? p.resumeTo : "business";
  if (step === null) return null;
  return { step, scopeLocked: stepIndex(step) >= stepIndex("board") };
}
