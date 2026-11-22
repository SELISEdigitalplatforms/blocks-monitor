/** The project lifecycle as a pure state machine. No React, fully tested.
 *  The journey order is Business → Product sanitization → Requirements & objective → Scope confirmation → Board → Build → Release;
 *  journeyAt maps a stored state onto it (see src/domain/journey.ts).
 *  The project owner writes the brief and confirms the requirements, the objective and the scope, then starts the build.
 *  From there the factory runs on its own (plan, code, review, test, security, docs, release, deploy, smoke test) and the
 *  app goes live. There are no approval queues or sign-offs; quality gates inside the build send work back automatically. */
import { TRANSITIONS, journeyFromStored, type StepState } from "@/domain/journey";
import type { ProjectStatus, Role } from "./types";

export type { StepState };

export interface JourneyState {
  status: ProjectStatus;
  /** where a paused project resumes */
  resumeTo?: ProjectStatus;
  /** false from the hand-over until the product sanitization is completed; missing on older saved states and once the requirements are confirmed (counts as done) */
  sanitized?: boolean;
  /** automatic send-backs inside the build (a gate found something; the agent fixed it) */
  sendBacks: number;
  /** kept for older saved states; the automated flow needs no approvals */
  needs: { techlead: boolean; management: boolean };
  approvals: { techlead: boolean; management: boolean };
  accepted: boolean;
  consent: boolean;
  signoff: boolean;
}

export type Action =
  | "submitIntake" | "completeSanitization" | "confirmUnderstanding" | "confirmObjective" | "startBuild" | "sendBack" | "goLive" | "deliver"
  | "pause" | "resume" | "abandon"
  /** retired with the approval flow: always refused (or mapped, see step) */
  | "submitForApproval" | "approve" | "requestChanges" | "reject" | "reviseScope" | "decide" | "previewReady"
  | "startAcceptance" | "accept" | "requestChange" | "consent" | "signoff";

export type Actor = Role | "system";

export interface Result { ok: boolean; state: JourneyState; reason?: string }

/** The main path, in order. */
export const FLOW: ProjectStatus[] = ["intake", "understanding", "objective", "scope", "building", "live", "delivered"];

/** Position on the main path (-1 for paused or abandoned). */
export const flowIndex = (s: ProjectStatus) => FLOW.indexOf(s);

/** Kept for older callers: the automated flow needs no approvals. */
export function approvalsNeeded(_o?: { customerData: boolean; estimateCHF: number }) {
  return { techlead: false, management: false };
}

export function initialState(): JourneyState {
  return { status: "intake", sendBacks: 0, needs: approvalsNeeded(), approvals: { techlead: false, management: false }, accepted: false, consent: false, signoff: false };
}

/** Kept for older callers: nothing to approve. */
export const fullyApproved = (_s: JourneyState) => true;

const ACTIVE: ProjectStatus[] = ["intake", "understanding", "objective", "scope", "building"];

const deny = (state: JourneyState, reason: string): Result => ({ ok: false, state, reason });
const go = (state: JourneyState, patch: Partial<JourneyState>): Result => ({ ok: true, state: { ...state, ...patch } });

export function step(s: JourneyState, action: Action, actor: Actor): Result {
  const is = (...st: ProjectStatus[]) => st.includes(s.status);
  const by = (...a: Actor[]) => a.includes(actor);
  switch (action) {
    case "submitIntake":
      if (!is("intake")) return deny(s, "This brief was already sent to the factory.");
      if (!by("requester")) return deny(s, "Only the project owner sends the brief.");
      return go(s, { status: "understanding", sanitized: false });
    case "completeSanitization":
      if (s.status !== "understanding" || journeyFromStored(s).step !== TRANSITIONS["sanitization.complete"].from) {
        return deny(s, "Understanding your project isn't open.");
      }
      if (!by("requester")) return deny(s, "Only the project owner confirms the project understanding.");
      return go(s, { sanitized: true });
    case "confirmUnderstanding":
      if (!is("understanding")) return deny(s, "Nothing to confirm yet.");
      if (!by("requester")) return deny(s, "Only the project owner confirms the requirements.");
      return go(s, { status: "objective", sanitized: undefined });
    case "confirmObjective":
      if (!is("objective")) return deny(s, "The objective is not open.");
      if (!by("requester")) return deny(s, "Only the project owner confirms the objective.");
      return go(s, { status: "scope" });
    case "submitForApproval": // older screens: the scope now goes straight to the build
    case "startBuild":
      if (!is("scope")) return deny(s, "The build starts from a confirmed scope.");
      if (!by("requester", "system")) return deny(s, "Only the project owner starts the build.");
      return go(s, { status: "building", sendBacks: 0 });
    case "sendBack":
      if (!is("building")) return deny(s, "Send-backs happen only during the build.");
      if (!by("system")) return deny(s, "Only the pipeline sends work back.");
      return go(s, { sendBacks: s.sendBacks + 1 });
    case "previewReady": // older screens: the end of the build is the automated release
    case "goLive":
      if (!is("building")) return deny(s, "The app goes live at the end of the build.");
      if (!by("system")) return deny(s, "The factory releases the app.");
      return go(s, { status: "live" });
    case "deliver":
      if (!is("live")) return deny(s, "Only a live app is delivered.");
      if (!by("system")) return deny(s, "The factory hands over the delivery.");
      return go(s, { status: "delivered" });
    case "pause":
      if (!ACTIVE.includes(s.status)) return deny(s, "Only an active project can be paused.");
      if (!by("requester", "pm")) return deny(s, "Only the project owner pauses a project.");
      return go(s, { status: "paused", resumeTo: s.status });
    case "resume":
      if (!is("paused") || !s.resumeTo) return deny(s, "The project is not paused.");
      if (!by("requester", "pm")) return deny(s, "Only the project owner resumes a project.");
      return go(s, { status: s.resumeTo, resumeTo: undefined });
    case "abandon":
      if (is("live", "delivered", "abandoned")) return deny(s, "This project can no longer be abandoned.");
      if (!by("requester", "pm")) return deny(s, "Only the project owner stops a project.");
      return go(s, { status: "abandoned" });
    default:
      return deny(s, "The factory is automated: there are no approvals or sign-offs.");
  }
}

/** Where a stored project stands in the journey steps. */
export function journeyAt(j: Pick<JourneyState, "status" | "resumeTo" | "sanitized">, scopeLocked = false): StepState {
  return journeyFromStored({ status: j.status, resumeTo: j.resumeTo, sanitized: j.sanitized, scopeLocked });
}

/** True while the product sanitization is the open step. */
export const sanitizationOpen = (j: Pick<JourneyState, "status" | "resumeTo" | "sanitized">): boolean =>
  journeyAt(j).step === "sanitization";

/** Replay a list of actions from a fresh state (each as its natural actor). */
export function replay(actions: Action[]): JourneyState {
  const actor = (a: Action): Actor => (a === "sendBack" || a === "goLive" || a === "deliver" ? "system" : "requester");
  return actions.reduce((s, a) => {
    const r = step(s, a, actor(a));
    return r.ok ? r.state : s;
  }, initialState());
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  intake: "New", understanding: "Understanding", objective: "Objective", scope: "Scope", approval: "Scope",
  changes: "Scope", rejected: "Stopped", approved: "Building", building: "Building",
  "needs-decision": "Building", preview: "Building", acceptance: "Building", ready: "Going live",
  live: "Live", delivered: "Live", paused: "Paused", abandoned: "Abandoned",
};
