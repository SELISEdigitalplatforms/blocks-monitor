/** The Release step (step 6 of STEP-STANDARD.md) on the shared step frame: the release manager releases the app to development,
 *  staging and production with release notes; you approve the release or request changes. Pure: the frame's status
 *  line, its one primary action, the chips and the release notes (and their tests) read this one state. Only real
 *  records go in: the releases per environment, the approval policies and requests, the change requests. */
import { canPromote, countedRequest, decideRight, type ApprovalPolicy, type ApprovalRequest, type Environment, type GatedEnvironment } from "@/madp/domain/promotion";
import { approvalStepLabel, currentApprovalRequest, promotionCandidate, type EnvironmentState } from "@/madp/domain/delivery";
import { compareVersions } from "@/madp/domain/numbering";
import { policyGap } from "@/madp/components/approvals/approvalsUi";
import type { PolicyRecord } from "@/madp/blocks/delivery/types";
import { releaseKey, sendLabel } from "./liveRelease";
import { ENV_LABEL, envName, envWord } from "./releaseUi";
import { t } from "@/madp/i18n";

/** The role line of the step, in the current language (each read when it is read). */
export const RELEASE_ROLE: { readonly who: string; readonly delivers: string; readonly you: string } = {
  get who() { return t("build.release.role.who", "Release manager"); },
  get delivers() { return t("build.release.role.delivers", "releases to development, staging and production with release notes"); },
  get you() { return t("build.release.role.you", "approve the release or request changes"); },
};

/** The environments in plain words (releaseUi.ts ENV_LABEL). */
export const ENV_PLAIN: Record<Environment, string> = ENV_LABEL;

export interface StepRelease {
  id: string;
  environment: string;
  version: string;
  releasedAt: string | null;
  url: string;
  releasedByUserId: string | null;
  changeRequestIds: string[];
  /** The source commit it was built from (null or absent: not recorded). */
  sourceCommit?: string | null;
}
export interface StepRequest {
  id: string;
  environment: GatedEnvironment;
  version: string;
  status: ApprovalRequest["status"];
  attempt: number;
  request: ApprovalRequest;
  stepRequired: boolean[];
  /** Who asked for the promotion (four-eyes: they approve it only as its only approver). */
  requestedByUserId?: string | null;
}
export interface StepPolicy { id: string; environment: GatedEnvironment; policy: ApprovalPolicy }
export interface StepChange { id: string; number: number; lane: string; title: string; status: string; version: string | null }

export type ReleasePhase =
  | "notReleased" // nothing on development yet
  | "approve" // a release waits for your approval
  | "promote" // its approvals are complete: release it
  | "changes" // an approver asked for changes to the version waiting
  | "request" // a newer version can be sent for approval
  | "setup" // the approvals for the next environment are not set up
  | "waiting" // a release waits for other people's approval
  | "live"; // production runs the newest version

export type ReleasePrimaryKind = "build" | "approve" | "promote" | "request" | "setup" | "wait" | "change";
export interface ReleasePrimary { kind: ReleasePrimaryKind; label: string; disabled: boolean; reason: string | null }

export type ReleaseChipId = "dev" | "stage" | "production" | "changes" | "approvals";
export interface ReleaseChip { id: ReleaseChipId; label: string; value: string; state: "done" | "todo" | "attention" | "info"; title: string }

export interface ReleaseStepInput {
  states: Record<Environment, EnvironmentState<StepRelease>>;
  requests: readonly StepRequest[];
  policies: readonly StepPolicy[];
  /** The saved approval policies are still being read (the Approvals chip waits instead of saying "not set up"). */
  policiesLoading?: boolean;
  changes: readonly StepChange[];
  userId: string | null;
  /** The workspace's active members (who can still approve); unknown: every approver named on the request. */
  activeMemberIds?: readonly string[];
  can: { approve: boolean; promote: boolean; request: boolean };
  /** "Florian Weber" for a user id. */
  nameOf: (userId: string) => string;
  /** Environments the records know to be live although the Factory has not released a version there (an existing
   *  product's staging documented from the live product): their chip says "live", never "not yet". */
  liveWithoutRelease?: readonly Environment[];
}

export interface ReleaseStepState {
  phase: ReleasePhase;
  /** Where the release goes next, the version and its approval request. */
  target: GatedEnvironment | null;
  version: string | null;
  request: StepRequest | null;
  /** The approval step the signed-in person decides now, or null. */
  myStep: number | null;
  /** Every open step the signed-in person may decide now, in the order to approve them (optional ones first, so the
   *  request settles on the last one). */
  mySteps: number[];
  /** True when the signed-in person asked for this promotion and approves it as its only approver. */
  selfApproval: boolean;
  /** The approvers who must decide (a request you asked for, while someone else can approve it): "Florian Weber". */
  mustApprove: string[];
  /** "Security (Florian Weber)", for the approvals still open. */
  waitingFor: string[];
  status: string;
  tone: "done" | "progress" | "waiting" | "attention";
  primary: ReleasePrimary;
  chips: ReleaseChip[];
  /** Production runs the newest version: who released it and when. */
  live: StepRelease | null;
  /** What waits for each environment that has a newer version to take. */
  plans: Partial<Record<GatedEnvironment, { phase: ReleasePhase; version: string; waitingFor: string[]; changes: RequestedChanges | null }>>;
  /** The changes an approver asked for on the version the step is about (phase "changes"). */
  changes: RequestedChanges | null;
}

/** "Jan Kowalski asked for changes: …" — who asked (a name) and what they wrote. */
export interface RequestedChanges { by: string; comment: string }

const ORDER: readonly GatedEnvironment[] = ["stage", "production"];
// a newer version to send on beats changes asked for an older one (the newer one is how the changes arrive)
const RANK: Record<ReleasePhase, number> = { approve: 0, promote: 1, request: 2, changes: 3, setup: 4, waiting: 5, live: 6, notReleased: 7 };
/** "1 approval", "3 approvals" */
const approvalsCount = (n: number): string => (n === 1 ? t("build.release.step.approvalOne", "1 approval") : t("build.release.step.approvalMany", "{count} approvals", { count: n }));
/** "1 change request", "3 change requests" */
const changeRequestsCount = (n: number): string => (n === 1 ? t("build.release.step.changeRequestOne", "1 change request")
  : t("build.release.step.changeRequestMany", "{count} change requests", { count: n }));

/** Which environments have a saved approval policy with at least one step (unsaved suggestions never count). */
export function approvalsSaved(policies: readonly StepPolicy[]): { stage: boolean; production: boolean } {
  const has = (env: GatedEnvironment) => policies.some((p) => p.environment === env && p.policy.steps.length > 0);
  return { stage: has("stage"), production: has("production") };
}

/** "Who approves staging and production is not set up yet" (the Scope step's wording). */
export function approvalsSetupText(saved: { stage: boolean; production: boolean }): string {
  return saved.stage && saved.production ? t("build.release.step.approvalsSetUp", "Staging and production approvals are set up")
    : saved.stage ? t("build.release.step.productionNotSetUp", "Production approvals are not set up yet")
    : saved.production ? t("build.release.step.stagingNotSetUp", "Staging approvals are not set up yet")
    : t("build.release.step.noneSetUp", "Who approves staging and production is not set up yet");
}

/** The approval steps still open on a request, in plain words: "Security (Florian Weber)". */
export function openApprovals(req: StepRequest | null, nameOf: (id: string) => string): string[] {
  if (!req || req.status !== "pending") return [];
  return req.request.steps
    .map((s, i) => ({ s, required: req.stepRequired[i] ?? true }))
    .filter(({ s }) => s.decision === "pending")
    .map(({ s, required }) => {
      const who = s.approverUserIds.map(nameOf).filter(Boolean).join(", ");
      return `${approvalStepLabel(s.type, s.label)}${who ? ` (${who})` : ""}${required ? "" : ` · ${t("build.release.step.optional", "optional")}`}`;
    });
}

/** How many required approval steps of a pending request are still open. */
function requiredOpen(req: StepRequest | null): number {
  if (!req || req.status !== "pending") return 0;
  return req.request.steps.filter((st, i) => st.decision === "pending" && (req.stepRequired[i] ?? true)).length;
}

interface EnvPlan {
  env: GatedEnvironment; phase: ReleasePhase; version: string; request: StepRequest | null; myStep: number | null; reason: string | null; changes?: RequestedChanges | null;
  mySteps?: number[]; selfApproval?: boolean; mustApprove?: string[];
}

/** The active members to judge a request by: the workspace's, else everyone it names as an approver. */
function membersFor(req: StepRequest, input: ReleaseStepInput): readonly string[] {
  return input.activeMemberIds ?? [...new Set(req.request.steps.flatMap((s) => [...s.approverUserIds]))];
}

/** The request as the server counts it: a decision by the requester counts only while they are the only approver. */
function counted(req: StepRequest, input: ReleaseStepInput): StepRequest {
  const request = countedRequest(req.request, req.requestedByUserId, membersFor(req, input));
  return request === req.request ? req : { ...req, request };
}

/** The open steps the signed-in person may decide (four-eyes with the one-person fallback, decideRight). */
export function decidableSteps(req: StepRequest, input: Pick<ReleaseStepInput, "userId" | "activeMemberIds" | "can">): { steps: number[]; self: boolean; others: string[] } {
  const me = input.userId;
  if (!me || !input.can.approve || req.status !== "pending") return { steps: [], self: false, others: [] };
  const members = input.activeMemberIds ?? [...new Set(req.request.steps.flatMap((s) => [...s.approverUserIds]))];
  const mine: { i: number; required: boolean }[] = [];
  let self = false;
  const others = new Set<string>();
  req.request.steps.forEach((_, i) => {
    const r = decideRight(req.request, i, me, { requesterId: req.requestedByUserId, activeMemberIds: members });
    if (r.ok) {
      mine.push({ i, required: req.stepRequired[i] ?? true });
      self = self || r.self;
    } else if (r.reason === "ownRequest") r.others.forEach((o) => others.add(o));
  });
  // optional steps first: the request is approved (and closed) once the required ones are in
  const steps = [...mine.filter((m) => !m.required), ...mine.filter((m) => m.required)].map((m) => m.i);
  return { steps, self, others: [...others] };
}

/** The changes asked for on a rejected request: the first rejected step's approver and comment. */
export function requestedChanges(req: StepRequest | null, nameOf: (id: string) => string): RequestedChanges | null {
  if (!req || req.status !== "rejected") return null;
  const s = req.request.steps.find((x) => x.decision === "rejected");
  if (!s) return null;
  return { by: s.decidedBy ? nameOf(s.decidedBy) : approvalStepLabel(s.type, s.label), comment: (s.comment ?? "").trim() };
}

function planFor(env: GatedEnvironment, input: ReleaseStepInput): EnvPlan | null {
  const version = promotionCandidate(input.states, env);
  if (!version) return null;
  const policy = input.policies.find((p) => p.environment === env) ?? null;
  const found = currentApprovalRequest(input.requests, env, version);
  const request = found ? counted(found, input) : null;
  if (request && request.status === "pending" && request.version === version) {
    const mine = decidableSteps(request, input);
    if (mine.steps.length > 0) {
      return { env, phase: "approve", version, request, myStep: mine.steps[0]!, reason: null, mySteps: mine.steps, selfApproval: mine.self };
    }
    const ok = policy ? canPromote(policy.policy, request.request, version) : null;
    if (ok?.ok) return { env, phase: "promote", version, request, myStep: null, reason: input.can.promote ? null : t("build.release.step.managerReleases", "Your release manager releases it.") };
    // you asked for it and someone else can approve it: say who must
    const must = mine.others.map(input.nameOf).filter(Boolean);
    const reason = must.length
      ? t("build.release.step.othersMustApprove", "You asked for this release, so {names} must approve it.", { names: must.join(t("build.release.step.or", " or ")) })
      : null;
    return { env, phase: "waiting", version, request, myStep: null, reason, mustApprove: must };
  }
  if (request && request.status === "pending") return { env, phase: "waiting", version, request, myStep: null, reason: t("build.release.step.waitingFirst", "v{version} is waiting for its approvals first.", { version: request.version }) };
  // an approver asked for changes to exactly this version: the team makes them (a change request), or it is sent again
  const asked = request && request.version === version ? requestedChanges(request, input.nameOf) : null;
  if (asked) return { env, phase: "changes", version, request, myStep: null, reason: null, changes: asked };
  const gap = policyGap(env, policy as PolicyRecord | null);
  if (gap) return { env, phase: "setup", version, request, myStep: null, reason: gap };
  const ok = canPromote(policy!.policy, request?.request ?? null, version);
  if (ok.ok) return { env, phase: "promote", version, request, myStep: null, reason: input.can.promote ? null : t("build.release.step.managerReleases", "Your release manager releases it.") };
  return {
    env, phase: "request", version, request: request && request.version === version ? request : null, myStep: null,
    reason: input.can.request ? null : t("build.release.step.managerSends", "Your release manager sends it for approval."),
  };
}

/** The Release step's state. */
export function releaseStep(input: ReleaseStepInput): ReleaseStepState {
  const { states } = input;
  const dev = states.dev.current;
  const prod = states.production.current;
  const plans = ORDER.map((e) => planFor(e, input)).filter((p): p is EnvPlan => p !== null)
    .sort((a, b) => RANK[a.phase] - RANK[b.phase]);
  const plan = plans[0] ?? null;
  const phase: ReleasePhase = !dev ? "notReleased" : plan ? plan.phase : "live";
  const target = plan?.env ?? null;
  const version = plan?.version ?? null;
  const request = plan?.request ?? null;
  const waitingFor = openApprovals(request, input.nameOf);
  const where = target ? envName(target) : "";

  let status: string;
  let tone: ReleaseStepState["tone"];
  let primary: ReleasePrimary;
  switch (phase) {
    case "notReleased":
      status = t("build.release.step.waitingForBuild", "Waiting for the build"); tone = "waiting";
      primary = { kind: "build", label: t("build.release.step.goToEngineering", "Go to Software Engineering"), disabled: false, reason: null };
      break;
    case "approve":
      status = t("build.release.step.approveStatus", "v{version} for {env} waits for your approval", { version: version!, env: where }); tone = "attention";
      primary = {
        kind: "approve", label: t("build.release.step.approveLabel", "Approve v{version} for {env}", { version: version!, env: where }), disabled: false,
        reason: plan!.selfApproval ? t("build.release.step.onlyApprover", "You're the only approver, so you can approve this yourself.") : null,
      };
      break;
    case "promote":
      status = t("build.release.step.promoteStatus", "v{version} is approved for {env}", { version: version!, env: where }); tone = input.can.promote ? "attention" : "waiting";
      primary = { kind: "promote", label: t("build.release.step.promoteLabel", "Release v{version} to {env}", { version: version!, env: where }), disabled: !input.can.promote, reason: plan!.reason };
      break;
    case "changes":
      status = t("build.release.step.changesStatus", "{by} asked for changes to v{version} before {env}", { by: plan!.changes!.by, version: version!, env: where }); tone = "attention";
      primary = { kind: "change", label: t("build.release.step.requestChange", "Request a change"), disabled: false, reason: null };
      break;
    case "request":
      status = t("build.release.step.requestStatus", "v{version} is ready to go to {env}", { version: version!, env: where }); tone = "waiting";
      primary = { kind: "request", label: sendLabel(version!, target!), disabled: !input.can.request, reason: plan!.reason };
      break;
    case "setup":
      status = t("build.release.step.setupStatus", "v{version} can go to {env} once the approvals are set up", { version: version!, env: where }); tone = "waiting";
      primary = { kind: "setup", label: t("build.release.step.setupLabel", "Set up the approvals"), disabled: false, reason: null };
      break;
    case "waiting":
      // optional approvals never hold a release: only the required ones are counted
      status = t("build.release.step.waitingStatus", "v{version} for {env} waits for {approvals}",
        { version: version!, env: where, approvals: approvalsCount(requiredOpen(request) || waitingFor.length || 1) }); tone = "waiting";
      primary = {
        kind: "wait", label: t("build.release.step.waitingLabel", "Waiting for approval"), disabled: true,
        reason: plan!.reason ?? (waitingFor.length ? t("build.release.step.waitingFor", "Waiting for {who}.", { who: waitingFor.join(", ") }) : null),
      };
      break;
    default:
      // a release row is written before its deployment finishes: live only once production has its address
      status = !prod ? t("build.release.step.released", "Released")
        : prod.url ? t("build.release.step.liveInProduction", "v{version} is live in production", { version: prod.version })
          : t("build.release.step.releasedToProduction", "v{version} is released to production · going live in a moment", { version: prod.version });
      tone = "done";
      primary = { kind: "change", label: t("build.release.step.requestChange", "Request a change"), disabled: false, reason: null };
  }

  // the chips: where it runs, the open change requests, the approvals
  const envChip = (env: Environment): ReleaseChip => {
    const cur = states[env].current;
    const src = env === "dev" ? null : states[env === "stage" ? "dev" : "stage"].current;
    const behind = Boolean(cur && src && compareVersions(src.version, cur.version) > 0);
    const goingThere = target === env && version;
    // live before the Factory released anything there (documented from the live product): live, never "not yet"
    const liveOnly = !cur && (input.liveWithoutRelease ?? []).includes(env);
    return {
      id: env, label: envName(env), value: cur ? `v${cur.version}` : liveOnly ? t("build.release.chip.live", "live") : t("build.release.chip.notYet", "not yet"),
      // where a version goes next is the primary button's work, not a chip to fill in: info, never "to do"
      state: liveOnly ? "done" : !cur ? "info" : behind && goingThere ? "info" : "done",
      title: cur
        ? `${t("build.release.chip.runs", "{env} runs v{version}", { env: envName(env), version: cur.version })}${goingThere
          ? ` · ${t("build.release.chip.onItsWay", "v{version} is on its way", { version: version! })}`
          : behind ? ` · ${t("build.release.chip.canFollow", "v{version} can follow", { version: src!.version })}` : ""}`
        : liveOnly
          ? `${t("build.release.chip.liveNoRelease", "{env} is live · the Factory has not released a version there yet", { env: envName(env) })}${goingThere
            ? ` · ${t("build.release.chip.onItsWay", "v{version} is on its way", { version: version! })}` : ""}`
          : t("build.release.chip.nothingReleased", "Nothing released to {env} yet", { env: envWord(env) }),
    };
  };
  // a rejected change request is closed; every other one is open until it is in production
  const openChanges = input.changes.filter((c) => c.status !== "promoted-production" && c.status !== "rejected").length;
  const pendingSteps = input.requests.filter((r) => r.status === "pending")
    .reduce((n, r) => n + r.request.steps.filter((s) => s.decision === "pending").length, 0);
  // the same rule as the Scope step's Approvals chip: a saved policy with steps, for staging and for production
  const saved = approvalsSaved(input.policies);
  const notSetUp = phase === "setup" || !saved.stage || !saved.production;
  const approvalsWord = t("build.release.chip.approvals", "Approvals");
  const waitingForText = t("build.release.chip.waitingFor", "Waiting for {who}", { who: waitingFor.join(", ") });
  const approvalsChip: ReleaseChip = input.policiesLoading
    ? { id: "approvals", label: approvalsWord, value: "…", state: "info", title: t("build.release.chip.readingApprovals", "Reading who approves a release…") }
    : phase === "approve"
      ? { id: "approvals", label: approvalsWord, value: t("build.release.chip.yours", "yours"), state: "attention", title: waitingFor.length ? waitingForText : t("build.release.chip.yourApproval", "Your approval is waiting") }
      : notSetUp
        ? { id: "approvals", label: approvalsWord, value: t("build.release.chip.notSetUp", "not set up"), state: "todo", title: phase === "setup" ? plan!.reason ?? approvalsSetupText(saved) : approvalsSetupText(saved) }
        : pendingSteps
          ? {
            id: "approvals", label: approvalsWord, value: t("build.release.chip.waitingCount", "{count} waiting", { count: pendingSteps }), state: "info",
            title: waitingFor.length ? waitingForText : t("build.release.chip.approvalsWaiting", "{approvals} waiting", { approvals: approvalsCount(pendingSteps) }),
          }
          : { id: "approvals", label: approvalsWord, value: t("build.release.chip.setUp", "set up"), state: "done", title: t("build.release.chip.allSetUp", "Staging and production approvals are set up · no approval is waiting") };
  const chips: ReleaseChip[] = [
    envChip("dev"), envChip("stage"), envChip("production"),
    {
      id: "changes", label: t("build.release.chip.changes", "Change requests"),
      value: openChanges ? t("build.release.chip.openCount", "{count} open", { count: openChanges }) : t("build.release.chip.noneOpen", "none open"),
      state: openChanges ? "info" : "done",
      title: openChanges ? t("build.release.chip.notInProduction", "{changes} not in production yet", { changes: changeRequestsCount(openChanges) })
        : t("build.release.chip.allInProduction", "Every change request is in production"),
    },
    approvalsChip,
  ];

  return {
    phase, target, version, request, myStep: plan?.myStep ?? null, mySteps: plan?.mySteps ?? [], selfApproval: plan?.selfApproval ?? false,
    mustApprove: plan?.mustApprove ?? [], waitingFor, status, tone, primary, chips,
    live: phase === "live" ? prod : null,
    plans: Object.fromEntries(plans.map((p) => [p.env, { phase: p.phase, version: p.version, waitingFor: openApprovals(p.request, input.nameOf), changes: p.changes ?? null }])),
    changes: plan?.changes ?? null,
  };
}

/* ── release notes ────────────────────────────────────────────────────────── */

/** The word before a change in the notes: "New", "Improved", "Changed", "Fixed". */
function laneWord(lane: string): string {
  switch (lane) {
    case "add": return t("build.release.notes.new", "New");
    case "enhance": return t("build.release.notes.improved", "Improved");
    case "fix": return t("build.release.notes.fixed", "Fixed");
    default: return t("build.release.notes.changed", "Changed");
  }
}

export interface NoteItem { word: string; text: string; code: string | null }
export interface NoteSection {
  version: string; releasedAt: string | null; first: boolean; items: NoteItem[];
  /** A release documented from the live product (it ran before the Factory released it), not one the Factory made. */
  documented: boolean;
  /** The release's source commit as recorded (null: "commit unknown"). */
  commit: string | null;
}

/** The release notes from the development releases newer than `after` up to `upTo` (newest first): each version's change
 *  requests; the first release the Factory made lists the milestones it delivered. Releases documented from the live
 *  product (`documented`: "dev@1.2.0" keys) are marked as such and are never the Factory's first release. */
export function releaseNotes(input: {
  devHistory: readonly StepRelease[];
  changes: readonly StepChange[];
  milestones: readonly { number: number; name: string }[];
  after: string | null;
  upTo: string | null;
  code: (c: StepChange) => string;
  documented?: ReadonlySet<string>;
}): NoteSection[] {
  const isDocumented = (r: StepRelease) => input.documented?.has(releaseKey(r)) ?? false;
  const first = input.devHistory.filter((r) => !isDocumented(r)).sort((a, b) => compareVersions(a.version, b.version))[0]?.version ?? null;
  return input.devHistory
    .filter((r) => (input.after === null || compareVersions(r.version, input.after) > 0) && (input.upTo === null || compareVersions(r.version, input.upTo) <= 0))
    .map((r) => {
      const isFirst = r.version === first;
      const crs = r.changeRequestIds.map((id) => input.changes.find((c) => c.id === id)).filter((c): c is StepChange => Boolean(c));
      const items: NoteItem[] = crs.map((c) => ({ word: laneWord(c.lane), text: c.title || t("build.release.notes.untitled", "Untitled change"), code: input.code(c) }));
      if (isFirst && items.length === 0) {
        for (const m of [...input.milestones].sort((a, b) => a.number - b.number)) items.push({ word: t("build.release.notes.milestone", "Milestone {number}", { number: m.number }), text: m.name, code: null });
      }
      return { version: r.version, releasedAt: r.releasedAt, first: isFirst, items, commit: r.sourceCommit ?? null, documented: isDocumented(r) };
    });
}
