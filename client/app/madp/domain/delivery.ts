/**
 * Delivery rules for board, build, change requests, releases and approvals.
 * Pure functions: the mf-delivery Logic Functions bundle this file and the web
 * imports the same code. The `reason` strings are web copy only; the server
 * sends only `messageKey`s. Imports only ./promotion and ./numbering.
 */
import {
  ENVIRONMENTS,
  canPromote,
  decideRight,
  type ApprovalPolicy,
  type ApprovalPolicyStep,
  type ApprovalRequest,
  type ApprovalRequestStep,
  type ApprovalStepType,
  type Decision,
  type Environment,
  type GatedEnvironment,
} from "./promotion";
import { bumpVersion, compareVersions, formatVersion, parseVersion } from "./numbering";

// ---------------------------------------------------------------- vocabularies

export const TICKET_COLUMNS = ["planned", "dev", "review", "test", "security", "docs", "gate", "done"] as const;
export type TicketColumn = (typeof TICKET_COLUMNS)[number];
export function isTicketColumn(x: unknown): x is TicketColumn {
  return typeof x === "string" && (TICKET_COLUMNS as readonly string[]).includes(x);
}

export const CHANGE_LANES = ["change", "enhance", "add", "fix"] as const;
export type ChangeLane = (typeof CHANGE_LANES)[number];
export function isChangeLane(x: unknown): x is ChangeLane {
  return typeof x === "string" && (CHANGE_LANES as readonly string[]).includes(x);
}

/**
 * ChangeRequest.Status (CHANGE-PROCESS-31.10): draft -> analysing -> questions (only when the analysis asks) ->
 * review -> approved | rejected -> building -> released-dev -> promoted-stage -> promoted-production.
 * failed: the analysis or the build failed (retry allowed). "requested" and "cancelled" exist on older rows only.
 */
export const CHANGE_STATUSES = [
  "draft",
  "analysing",
  "questions",
  "review",
  "approved",
  "rejected",
  "building",
  "released-dev",
  "promoted-stage",
  "promoted-production",
  "failed",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export function isChangeStatus(x: unknown): x is ChangeStatus {
  return typeof x === "string" && (CHANGE_STATUSES as readonly string[]).includes(x);
}

/** Change requests still on their way to development: not released, rejected or cancelled ("requested": older rows). */
export const OPEN_CHANGE_STATUSES: readonly string[] = [
  "draft", "requested", "analysing", "questions", "review", "approved", "building", "failed",
];
export function isOpenChange(status: unknown): boolean {
  return typeof status === "string" && OPEN_CHANGE_STATUSES.includes(status);
}

/** The steps of the change lifecycle bar, in order. */
export const CHANGE_STEPS = ["requested", "analysis", "questions", "approval", "build", "dev", "stage", "production"] as const;
export type ChangeStep = (typeof CHANGE_STEPS)[number];

/**
 * The lifecycle step a change request stands at. `decided` is true once it was approved (DecidedAt set), so a failed
 * change shows at Build (its build failed) rather than at Analysis. Unknown statuses read as "requested".
 */
export function changeStepOf(status: unknown, decided = false): ChangeStep {
  switch (status) {
    case "analysing": return "analysis";
    case "questions": return "questions";
    case "review":
    case "rejected": return "approval";
    case "approved":
    case "building": return "build";
    case "failed": return decided ? "build" : "analysis";
    case "released-dev": return "dev";
    case "promoted-stage": return "stage";
    case "promoted-production": return "production";
    default: return "requested";
  }
}

/** Position of changeStepOf in CHANGE_STEPS (0 to 7). */
export function changeStepIndex(status: unknown, decided = false): number {
  return CHANGE_STEPS.indexOf(changeStepOf(status, decided));
}

export const MILESTONE_STATUSES = ["planned", "building", "preview-ready", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export function isMilestoneStatus(x: unknown): x is MilestoneStatus {
  return typeof x === "string" && (MILESTONE_STATUSES as readonly string[]).includes(x);
}

export const LIMITS = {
  comment: 5000,
  crTitle: 120,
  crDescription: 10000,
  approvalComment: 2000,
  customLabel: 40,
  policySteps: 8,
  stepApprovers: 20,
} as const;

export type RuleFail = {
  ok: false;
  code: "invalid_input" | "conflict";
  messageKey: string;
  reason: string;
  field?: string;
};
export type Rule<T> = { ok: true; value: T } | RuleFail;

function fail(
  code: RuleFail["code"],
  messageKey: string,
  reason: string,
  field?: string,
): RuleFail {
  return field === undefined
    ? { ok: false, code, messageKey, reason }
    : { ok: false, code, messageKey, reason, field };
}

function spaced(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// ---------------------------------------------------------------------- board

/**
 * Validates a ticket move. `doneAt: null` means "leave DoneAt untouched":
 * DoneAt cannot be cleared (MF-B14) and IsDone is the truth.
 */
export function checkTicketMove(
  stored: string,
  from: unknown,
  to: unknown,
  at: string,
): Rule<{ column: TicketColumn; isDone: boolean; doneAt: string | null }> {
  if (!isTicketColumn(from)) {
    return fail("invalid_input", "delivery.ticket.badColumn", "Pick one of the board columns.", "fromColumn");
  }
  if (!isTicketColumn(to)) {
    return fail("invalid_input", "delivery.ticket.badColumn", "Pick one of the board columns.", "toColumn");
  }
  if (stored !== from) {
    return fail("conflict", "delivery.ticket.moved", "This ticket moved meanwhile. Reload and try again.");
  }
  if (to === from) {
    return fail("invalid_input", "delivery.ticket.sameColumn", "The ticket is already in that column.", "toColumn");
  }
  if (to === "done") return { ok: true, value: { column: to, isDone: true, doneAt: at } };
  return { ok: true, value: { column: to, isDone: false, doneAt: null } };
}

export function checkComment(text: unknown, max: number = LIMITS.comment): Rule<string> {
  if (typeof text !== "string") {
    return fail("invalid_input", "delivery.comment.invalid", "Write a comment first.", "text");
  }
  const t = text.trim();
  if (!t) return fail("invalid_input", "delivery.comment.empty", "Write a comment first.", "text");
  if (t.length > max) {
    return fail("invalid_input", "delivery.comment.tooLong", `Keep it under ${spaced(max)} characters.`, "text");
  }
  return { ok: true, value: t };
}

// ------------------------------------------------------------ change requests

/** Strict MAJOR.MINOR.PATCH only. */
export function checkVersion(x: unknown): Rule<string> {
  const v = typeof x === "string" ? parseVersion(x) : null;
  if (typeof x === "string" && v && formatVersion(v) === x) return { ok: true, value: x };
  return fail("invalid_input", "delivery.version.invalid", "Use a version like 1.2.0.", "version");
}

export function checkChangeDraft(
  input: { lane: unknown; featureRef: unknown; title: unknown; description: unknown },
  featureRefs: readonly string[],
): Rule<{ lane: ChangeLane; featureRef: string; title: string; description: string }> {
  const lane = input.lane;
  if (!isChangeLane(lane)) {
    return fail("invalid_input", "delivery.cr.badLane", "Pick a kind of change.", "lane");
  }
  const str = (v: unknown, field: string): string | RuleFail =>
    v === undefined || v === null
      ? ""
      : typeof v === "string"
        ? v.trim()
        : fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", field);
  const featureRef = str(input.featureRef, "featureRef");
  if (typeof featureRef !== "string") return featureRef;
  const title = str(input.title, "title");
  if (typeof title !== "string") return title;
  const description = str(input.description, "description");
  if (typeof description !== "string") return description;

  // a product with no locked scope (an existing product attached as it is live) takes changes about the product as a
  // whole; with a scope, a change or an enhancement names its feature
  if (lane !== "add" && !featureRef && featureRefs.length > 0) {
    return fail("invalid_input", "delivery.cr.featureRequired", "Pick the feature this change is about.", "featureRef");
  }
  if (featureRef && !featureRefs.includes(featureRef)) {
    return fail("invalid_input", "delivery.cr.unknownFeature", "Pick a feature from the locked scope.", "featureRef");
  }
  if (title.length > LIMITS.crTitle) {
    return fail("invalid_input", "delivery.cr.titleTooLong", "Keep the title under 120 characters.", "title");
  }
  if (description.length > LIMITS.crDescription) {
    return fail(
      "invalid_input",
      "delivery.cr.descriptionTooLong",
      "Keep the description under 10 000 characters.",
      "description",
    );
  }
  if (!title && !description) {
    return fail("invalid_input", "delivery.cr.empty", "Add a title or a description.");
  }
  return { ok: true, value: { lane, featureRef, title, description } };
}

/** Title and description are both needed before a change is analysed or built. */
function checkChangeText(cr: { title: string; description: string }): Rule<null> {
  if (!cr.title.trim() || !cr.description.trim()) {
    return fail(
      "invalid_input",
      "delivery.cr.needsTitleAndDescription",
      "Add a title and a description before the build.",
    );
  }
  return { ok: true, value: null };
}

/**
 * cr.submit: a draft, or a change whose analysis failed (failed and never decided), goes to analysis.
 * Change requests open after the first release to dev.
 */
export function checkChangeForSubmit(
  cr: { status: string; title: string; description: string; decidedAt?: string | null; analysisStopped?: boolean },
  devReleaseCount: number,
): Rule<null> {
  if (devReleaseCount < 1) {
    return fail("invalid_input", "delivery.cr.noDevRelease", "Change requests open after the first release to dev.");
  }
  // `analysisStopped`: the change is analysing (or refining its answered questions) but its newest change.analyse job was
  // stopped by the system (time limit, last attempt) and none runs, so nothing would ever move it on
  const analysisFailed = (cr.status === "failed" && !cr.decidedAt)
    || ((cr.status === "analysing" || cr.status === "questions") && cr.analysisStopped === true && !cr.decidedAt);
  if (cr.status !== "draft" && !analysisFailed) {
    return fail("conflict", "delivery.cr.notDraft", "This change request is no longer a draft.");
  }
  return checkChangeText(cr);
}

/**
 * cr.startBuild: only an approved change on the fast route, or an approved feature delivery on a product without a
 * Factory scope (route "feature", built increment by increment: back at "approved" between increments), builds. A
 * change whose build failed may build again:
 * status failed after its approval, or still building while its change.build job failed or was cancelled
 * (`lastBuildFailed`: no active job and a stopped one). `route` is the Analysis route; without an analysis there is no approval.
 */
export function checkChangeForBuild(
  cr: {
    status: string;
    title: string;
    description: string;
    route?: string | null;
    decidedAt?: string | null;
    lastBuildFailed?: boolean;
  },
  devReleaseCount: number,
): Rule<null> {
  if (devReleaseCount < 1) {
    return fail("invalid_input", "delivery.cr.noDevRelease", "Change requests open after the first release to dev.");
  }
  const buildFailed =
    (cr.status === "failed" && !!cr.decidedAt) || (cr.status === "building" && cr.lastBuildFailed === true);
  if (cr.status !== "approved" && !buildFailed) {
    return fail("conflict", "delivery.cr.notApproved", "Approve the change first.");
  }
  if (cr.route !== "fast" && cr.route !== "feature") {
    return cr.route === "scope"
      ? fail("conflict", "delivery.cr.scopeRoute", "This is a new feature: add it through Scope & success.")
      : fail("conflict", "delivery.cr.notApproved", "Approve the change first.");
  }
  return checkChangeText(cr);
}

/** cr.answer: answers are taken only while the change waits for them. */
export function checkChangeForAnswer(cr: { status: string }): Rule<null> {
  if (cr.status !== "questions") {
    return fail("conflict", "delivery.cr.notQuestions", "This change has no open questions.");
  }
  return { ok: true, value: null };
}

/** cr.decide: only a change waiting for approval is decided. */
export function checkChangeForDecision(cr: { status: string }): Rule<null> {
  if (cr.status !== "review") {
    return fail("conflict", "delivery.cr.notInReview", "This change isn't waiting for approval.");
  }
  return { ok: true, value: null };
}

/**
 * Who may approve or reject a change request: the same people as the release approvals, so the approvers of the
 * project's stage and production policies who are still active. Without a saved policy every active member may
 * decide (each built-in role holds release.approve). The order is kept and duplicates are dropped.
 */
export function changeApproverIds(
  policySteps: readonly { approverUserIds: readonly string[] }[],
  activeMemberIds: readonly string[],
): string[] {
  const active = new Set(activeMemberIds);
  const fromPolicies = [...new Set(policySteps.flatMap((s) => [...s.approverUserIds]))].filter((id) => active.has(id));
  return fromPolicies.length > 0 ? fromPolicies : [...new Set(activeMemberIds)];
}

export type ChangeDecideRight =
  | { ok: true; self: boolean }
  | { ok: false; reason: "notApprover" | "ownRequest"; others: string[] };

/**
 * The release rule (promotion.decideRight) applied to a change request: an approver may decide; the requester
 * decides their own change only when no other eligible approver exists, which is a recorded self-approval.
 */
export function changeDecideRight(
  userId: string,
  o: { requesterId: string | null | undefined; approverIds: readonly string[]; activeMemberIds: readonly string[] },
): ChangeDecideRight {
  const request: ApprovalRequest = {
    environment: "stage",
    version: "0.0.0",
    status: "pending",
    steps: [
      { type: "custom", label: "Change", approverUserIds: [...o.approverIds], decision: "pending", decidedBy: null, decidedAt: null, comment: null },
    ],
  };
  const r = decideRight(request, 0, userId, { requesterId: o.requesterId, activeMemberIds: o.activeMemberIds });
  if (r.ok) return { ok: true, self: r.self };
  return { ok: false, reason: r.reason === "ownRequest" ? "ownRequest" : "notApprover", others: [...r.others] };
}

/** The highest valid version of a list; null without one (pure). */
function highestVersion(versions: readonly (string | null | undefined)[]): string | null {
  let highest: string | null = null;
  for (const v of versions) {
    if (typeof v !== "string" || !parseVersion(v)) continue;
    if (highest === null || compareVersions(v, highest) > 0) highest = v;
  }
  return highest;
}

/** Highest valid version bumped (patch for a fix, minor otherwise); null without a valid one. Pass every version a new
 *  build must not reuse (takenVersions), not only the dev releases: a build that started and never finished still
 *  holds its version, so two builds never get the same one. */
export function changeVersionAtStart(lane: ChangeLane, versions: readonly string[]): string | null {
  const highest = highestVersion(versions);
  return highest === null ? null : bumpVersion(highest, lane === "fix" ? "patch" : "minor");
}

/** Compares two release versions; an invalid one sorts lowest (pure). */
export function compareReleaseVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  return compareVersions(a, b);
}

/** The version of a fix round of a change (the checks of its deploy failed): the highest taken version with its patch
 *  bumped; null without one (pure). */
export function fixRoundVersion(taken: readonly string[]): string | null {
  const highest = highestVersion(taken);
  return highest === null ? null : bumpVersion(highest, "patch");
}

/** `wanted`, or the next patch version after it that none of `taken` holds: a version is never given to two deploys
 *  (pure). */
export function freeVersion(wanted: string, taken: readonly string[]): string {
  if (!parseVersion(wanted)) return wanted;
  const held = new Set(taken.filter((v) => typeof v === "string" && parseVersion(v)).map((v) => formatVersion(parseVersion(v)!)));
  let v = formatVersion(parseVersion(wanted)!);
  for (let i = 0; held.has(v) && i < 1000; i += 1) v = bumpVersion(v, "patch");
  return v;
}

/** The versions a new build must not reuse (pure): every release's (any environment), every change request's (set
 *  when its build started), and every version a delivery build was started with (its input's `version`). */
export function takenVersions(o: {
  releases?: readonly (string | null | undefined)[];
  changes?: readonly (string | null | undefined)[];
  jobs?: readonly { inputJson?: string | null }[];
}): string[] {
  const fromJob = (json: string | null | undefined): string => {
    if (!json) return "";
    try {
      const v = (JSON.parse(json) as { version?: unknown } | null)?.version;
      return typeof v === "string" ? v : "";
    } catch {
      return "";
    }
  };
  const all = [...(o.releases ?? []), ...(o.changes ?? []), ...(o.jobs ?? []).map((j) => fromJob(j.inputJson))];
  return [...new Set(all.filter((v): v is string => typeof v === "string" && !!parseVersion(v)))];
}

/** FX-<n> for fixes, CR-001 style for everything else. */
export function changeCode(cr: { lane: string; number: number }): string {
  return cr.lane === "fix" ? `FX-${cr.number}` : `CR-${String(cr.number).padStart(3, "0")}`;
}

// ------------------------------------------------------------------ approvals

const STEP_TYPES: readonly ApprovalStepType[] = ["architect", "security", "qa", "custom"];
function isStepType(x: unknown): x is ApprovalStepType {
  return typeof x === "string" && (STEP_TYPES as readonly string[]).includes(x);
}

const POLICY_STEP_KEYS = ["type", "label", "required", "approverUserIds"];

/** Shape-checks a policy from the client. Returns it un-normalised; callers run normalizePolicy and validatePolicy. */
export function checkPolicyInput(environment: unknown, steps: unknown): Rule<ApprovalPolicy> {
  if (environment !== "stage" && environment !== "production") {
    return fail("invalid_input", "delivery.approvals.badEnvironment", "Pick stage or production.", "environment");
  }
  if (!Array.isArray(steps) || steps.length < 1) {
    return fail("invalid_input", "delivery.approvals.noSteps", "Add at least one approval step.", "steps");
  }
  if (steps.length > LIMITS.policySteps) {
    return fail("invalid_input", "delivery.approvals.tooManySteps", "Use at most 8 approval steps.", "steps");
  }
  const out: ApprovalPolicyStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s: unknown = steps[i];
    const at = `steps.${i}`;
    if (!isPlainObject(s)) {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", at);
    }
    for (const key of Object.keys(s)) {
      if (!POLICY_STEP_KEYS.includes(key)) {
        return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.${key}`);
      }
    }
    if (!isStepType(s.type)) {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.type`);
    }
    const type = s.type;
    let label: string | undefined;
    if (s.label !== undefined && s.label !== null && typeof s.label !== "string") {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.label`);
    }
    const rawLabel = typeof s.label === "string" ? s.label.trim() : "";
    if (type === "custom") {
      if (!rawLabel) {
        return fail("invalid_input", "delivery.approvals.labelMissing", "Name the custom step.", `${at}.label`);
      }
      if (rawLabel.length > LIMITS.customLabel) {
        return fail(
          "invalid_input",
          "delivery.approvals.labelTooLong",
          "Keep the step name under 40 characters.",
          `${at}.label`,
        );
      }
      label = rawLabel;
    } else if (rawLabel) {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.label`);
    }
    if (typeof s.required !== "boolean") {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.required`);
    }
    const ids = s.approverUserIds;
    if (!Array.isArray(ids)) {
      return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.approverUserIds`);
    }
    if (ids.length > LIMITS.stepApprovers) {
      return fail(
        "invalid_input",
        "delivery.approvals.tooManyApprovers",
        "A step has at most 20 approvers.",
        `${at}.approverUserIds`,
      );
    }
    const seen = new Set<string>();
    for (const id of ids as unknown[]) {
      if (typeof id !== "string" || !id || id.length > 128) {
        return fail("invalid_input", "delivery.args.invalid", "Check the form and try again.", `${at}.approverUserIds`);
      }
      if (seen.has(id)) {
        return fail(
          "invalid_input",
          "delivery.approvals.duplicateApprover",
          "Someone is listed twice in one step.",
          `${at}.approverUserIds`,
        );
      }
      seen.add(id);
    }
    out.push({
      type,
      ...(label !== undefined ? { label } : {}),
      required: s.required,
      approverUserIds: [...seen],
    });
  }
  return { ok: true, value: { environment, steps: out } };
}

/** Deterministic StepKey per position and type. */
export function stepKeyFor(index: number, type: ApprovalStepType): string {
  return `${index}-${type}`;
}

export function approvalStepLabel(type: ApprovalStepType, label?: string): string {
  if (type === "architect") return "Architect";
  if (type === "security") return "Security";
  if (type === "qa") return "QA tester";
  return (label ?? "").trim() || "Custom step";
}

/** Recomputes a request's status from its steps under the current policy. */
export function recomputeRequestStatus(
  request: ApprovalRequest,
  policy: ApprovalPolicy,
): ApprovalRequest["status"] {
  if (request.status === "cancelled") return "cancelled";
  if (request.steps.some((s) => s.decision === "rejected")) return "rejected";
  return canPromote(policy, { ...request, status: "pending" }, request.version).ok ? "approved" : "pending";
}

// ------------------------------------------------------------------- releases

export interface ReleaseLike {
  id: string;
  environment: string;
  version: string;
  releasedAt: string | null;
  url: string;
}
export interface EnvironmentState<R extends ReleaseLike = ReleaseLike> {
  environment: Environment;
  current: R | null;
  history: R[];
}

function isStrictVersion(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const p = parseVersion(v);
  return p !== null && formatVersion(p) === v;
}

/**
 * Per environment: history newest first by semver (ties: later releasedAt,
 * then larger id); current is its head. Unknown environments and invalid
 * versions are ignored. All three environments are always present.
 */
export function environmentStates<R extends ReleaseLike>(
  releases: readonly R[],
): Record<Environment, EnvironmentState<R>> {
  const result = {} as Record<Environment, EnvironmentState<R>>;
  for (const env of ENVIRONMENTS) {
    const history = releases
      .filter((r) => r.environment === env && isStrictVersion(r.version))
      .sort(
        (a, b) =>
          compareVersions(b.version, a.version) ||
          (b.releasedAt ?? "").localeCompare(a.releasedAt ?? "") ||
          (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
      );
    result[env] = { environment: env, current: history[0] ?? null, history };
  }
  return result;
}

export function sourceEnvironment(target: GatedEnvironment): Environment {
  return target === "stage" ? "dev" : "stage";
}

export function checkPromotionVersion(
  states: Record<Environment, EnvironmentState>,
  target: GatedEnvironment,
  version: string,
): Rule<null> {
  const source = sourceEnvironment(target);
  if (!states[source].history.some((r) => r.version === version)) {
    return fail("invalid_input", "delivery.release.notInSource", `v${version} isn't released to ${source} yet.`, "version");
  }
  const current = states[target].current;
  if (current && compareVersions(version, current.version) <= 0) {
    const name = target === "stage" ? "Stage" : "Production";
    return fail("invalid_input", "delivery.release.notNewer", `${name} already has v${current.version}.`, "version");
  }
  return { ok: true, value: null };
}

/** The source environment's current version, when the target is empty or behind it. */
export function promotionCandidate(
  states: Record<Environment, EnvironmentState>,
  target: GatedEnvironment,
): string | null {
  const src = states[sourceEnvironment(target)].current;
  if (!src) return null;
  const cur = states[target].current;
  return !cur || compareVersions(src.version, cur.version) > 0 ? src.version : null;
}

/** The pending request of env first; otherwise the highest attempt for (env, version). */
export function currentApprovalRequest<
  Q extends { environment: string; version: string; status: string; attempt: number },
>(requests: readonly Q[], env: GatedEnvironment, version: string | null): Q | null {
  const ofEnv = requests.filter((q) => q.environment === env);
  const pending = ofEnv.find((q) => q.status === "pending");
  if (pending) return pending;
  if (version === null) return null;
  let best: Q | null = null;
  for (const q of ofEnv) {
    if (q.version === version && (best === null || q.attempt > best.attempt)) best = q;
  }
  return best;
}

/** Change requests released in the source environment that a promotion to target at version carries along. */
export function changeRequestsToPromote<C extends { id: string; status: string; version: string | null }>(
  crs: readonly C[],
  target: GatedEnvironment,
  version: string,
): C[] {
  if (!isStrictVersion(version)) return [];
  return crs.filter((c) => {
    const ok = c.status === "released-dev" || (target === "production" && c.status === "promoted-stage");
    return ok && isStrictVersion(c.version) && compareVersions(c.version, version) <= 0;
  });
}

// ------------------------------------------------------------ board and build

export function nextMilestoneToBuild<
  M extends { id: string; number: number; name: string; sortOrder: number; status: string },
>(
  milestones: readonly M[],
  ticketCounts: Readonly<Record<string, number>>,
): { milestone: M | null; messageKey: string | null; reason: string | null } {
  if (milestones.length === 0) {
    return { milestone: null, messageKey: "delivery.build.noMilestones", reason: "Lock the scope and milestones first." };
  }
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const next = sorted.find((m) => m.status !== "preview-ready" && m.status !== "done");
  if (!next) {
    return { milestone: null, messageKey: "delivery.build.allBuilt", reason: "Every milestone is built." };
  }
  if ((ticketCounts[next.id] ?? 0) < 1) {
    return {
      milestone: next,
      messageKey: "delivery.build.noTickets",
      reason: `The board for milestone ${next.number} isn't planned yet.`,
    };
  }
  return { milestone: next, messageKey: null, reason: null };
}

/** Lane key for tickets without (or with an unknown) milestone. */
export const NO_MILESTONE = "__changes";

export function groupTicketsByMilestone<
  T extends { milestoneId: string | null; sortOrder: number; number: number },
  M extends { id: string; sortOrder: number; number: number },
>(tickets: readonly T[], milestones: readonly M[]): { milestone: M | null; tickets: T[] }[] {
  const byTicket = (a: T, b: T) => a.sortOrder - b.sortOrder || a.number - b.number;
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  const known = new Set(sorted.map((m) => m.id));
  const lanes: { milestone: M | null; tickets: T[] }[] = sorted.map((m) => ({
    milestone: m,
    tickets: tickets.filter((t) => t.milestoneId === m.id).sort(byTicket),
  }));
  const loose = tickets.filter((t) => t.milestoneId === null || !known.has(t.milestoneId)).sort(byTicket);
  if (loose.length > 0) lanes.push({ milestone: null, tickets: loose });
  return lanes;
}

// ------------------------------------------------------------ approval step rows

export type StepRowMeta = { itemId: string; stepKey: string; sortOrder: number; required: boolean };

type ParsedSteps<S> = { ok: true; steps: S[]; meta: StepRowMeta[] } | { ok: false; error: string };

export function parseApprovalSteps(
  rows: readonly unknown[],
  parentType: "policy",
  parentId: string,
): ParsedSteps<ApprovalPolicyStep>;
export function parseApprovalSteps(
  rows: readonly unknown[],
  parentType: "request",
  parentId: string,
): ParsedSteps<ApprovalRequestStep>;
export function parseApprovalSteps(
  rows: readonly unknown[],
  parentType: "policy" | "request",
  parentId: string,
): ParsedSteps<ApprovalPolicyStep> | ParsedSteps<ApprovalRequestStep> {
  type Parsed = {
    meta: StepRowMeta;
    type: ApprovalStepType;
    label: string | undefined;
    approverUserIds: string[];
    decision: Decision;
    decidedBy: string | null;
    decidedAt: string | null;
    comment: string | null;
  };
  const parsed: Parsed[] = [];
  const keys = new Set<string>();
  const orders = new Set<number>();
  const nullable = (v: unknown): string | null | undefined =>
    v === undefined || v === null || v === "" ? null : typeof v === "string" ? v : undefined;

  for (let i = 0; i < rows.length; i++) {
    const row: unknown = rows[i];
    if (!isPlainObject(row)) return { ok: false, error: `Approval step ${i}: not an object` };
    const id = typeof row.ItemId === "string" && row.ItemId ? row.ItemId : null;
    if (id === null) return { ok: false, error: `Approval step ${i}: ItemId is missing` };
    const bad = (what: string) => ({ ok: false as const, error: `Approval step ${id}: ${what}` });
    if (row.ParentType !== parentType) return bad("ParentType does not match");
    if (row.ParentId !== parentId) return bad("ParentId does not match");
    if (typeof row.StepKey !== "string" || !row.StepKey) return bad("StepKey is missing");
    if (keys.has(row.StepKey)) return bad("StepKey is duplicated");
    if (!isStepType(row.StepType)) return bad("StepType is unknown");
    if (row.Label !== undefined && row.Label !== null && typeof row.Label !== "string") return bad("Label is not text");
    const label = typeof row.Label === "string" ? row.Label : "";
    if (row.StepType === "custom" && !label.trim()) return bad("custom step has no Label");
    if (typeof row.Required !== "boolean") return bad("Required is not a boolean");
    const approvers = row.ApproverUserIds;
    if (!Array.isArray(approvers) || !approvers.every((a) => typeof a === "string")) {
      return bad("ApproverUserIds is not a list of ids");
    }
    const order = row.SortOrder;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) return bad("SortOrder is not valid");
    if (orders.has(order)) return bad("SortOrder is duplicated");
    let decision: Decision = "pending";
    let decidedBy: string | null = null;
    let decidedAt: string | null = null;
    let comment: string | null = null;
    if (parentType === "request") {
      if (row.Decision !== "pending" && row.Decision !== "approved" && row.Decision !== "rejected") {
        return bad("Decision is unknown");
      }
      decision = row.Decision;
      const by = nullable(row.DecidedByUserId);
      const at = nullable(row.DecidedAt);
      const cm = nullable(row.Comment);
      if (by === undefined) return bad("DecidedByUserId is not text");
      if (at === undefined) return bad("DecidedAt is not text");
      if (cm === undefined) return bad("Comment is not text");
      decidedBy = by;
      decidedAt = at;
      comment = cm;
    }
    keys.add(row.StepKey);
    orders.add(order);
    parsed.push({
      meta: { itemId: id, stepKey: row.StepKey, sortOrder: order, required: row.Required },
      type: row.StepType,
      label: row.StepType === "custom" ? label : undefined,
      approverUserIds: [...(approvers as string[])],
      decision,
      decidedBy,
      decidedAt,
      comment,
    });
  }
  parsed.sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
  const meta = parsed.map((p) => p.meta);
  if (parentType === "policy") {
    const steps: ApprovalPolicyStep[] = parsed.map((p) => ({
      type: p.type,
      ...(p.label !== undefined ? { label: p.label } : {}),
      required: p.meta.required,
      approverUserIds: p.approverUserIds,
    }));
    return { ok: true, steps, meta };
  }
  const steps: ApprovalRequestStep[] = parsed.map((p) => ({
    type: p.type,
    ...(p.label !== undefined ? { label: p.label } : {}),
    approverUserIds: p.approverUserIds,
    decision: p.decision,
    decidedBy: p.decidedBy,
    decidedAt: p.decidedAt,
    comment: p.comment,
  }));
  return { ok: true, steps, meta };
}

// ----------------------------------------------------------------------- links

/** The href of an https URL (max 2 048 chars, no credentials), otherwise null. */
export function safeExternalUrl(x: unknown): string | null {
  if (typeof x !== "string" || x.length === 0 || x.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(x);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return url.href;
}
