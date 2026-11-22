// Delivery writes: EVERY write goes through the `delivery` Logic Function (slug mf-delivery) with useFunctionMutation.
// The server takes the caller from its context and decides every permission; the client only reports the outcome.
// Failures show plain messages from codes and message keys, never server free text.
import { useCallback } from "react";
import { FunctionError, functionErrorMessage, useFunctionMutation, type FunctionMutationConfig } from "../fn";
import { FunctionNotConfiguredError } from "../functions";
import { BlocksDataError } from "../data/errors";
import { blocksKeys } from "../data/keys";
import { deliveryProjectKey, type DeliveryContext } from "./context";
import { serializeChecksPolicy } from "../../domain/changeChecks";
import { parseStreamsChoice, serializeStreamsChoice } from "../../domain/parallelStreams";
import { parseContinueSetting, serializeContinueSetting } from "../../domain/continueIncrements";
import type { TicketColumn, ChangeLane } from "../../domain/delivery";
import type { ApprovalStepType, GatedEnvironment } from "../../domain/promotion";

export const NOT_CONFIGURED_MESSAGE =
  "Delivery actions aren't available yet: the delivery function isn't connected.";

/** Plain texts for the function's message keys. */
export const DELIVERY_MESSAGES: Readonly<Record<string, string>> = {
  "delivery.cr.noDevRelease": "Change requests open after the first release to dev.",
  "delivery.files.notReady": "A file is still uploading or could not be added. Wait for it, or remove it and try again.",
  "delivery.files.tooMany": "Attach up to 5 files at a time.",
  "delivery.approvals.noPolicy": "Set up the approval policy first.",
  "delivery.build.notNext": "Build the milestones in order.",
  "delivery.build.noTickets": "The board for this milestone isn't planned yet.",
  "delivery.build.active": "Another build is running for this project.",
  "delivery.approvals.pending": "An approval request is already open for this environment.",
  "delivery.approvals.stepDecided": "This step was decided meanwhile. Reload to see the decision.",
  "delivery.approvals.commentRequired": "Add a comment to explain the rejection.",
  "delivery.release.notInSource": "This version isn't released to the previous environment yet.",
  "delivery.release.notNewer": "This environment already has this version or a newer one.",
  "delivery.release.devNotTarget": "Dev releases come from the build.",
  "delivery.ticket.moved": "This ticket moved meanwhile. Reload and try again.",
  "delivery.build.scopeNotLocked": "Lock the scope first.",
  "delivery.build.noMilestones": "There are no milestones to build yet.",
  "delivery.build.allBuilt": "Every milestone is already built.",
  "delivery.build.otherScopeVersion": "This milestone belongs to an older scope version.",
  "delivery.approvals.notPending": "This approval request isn't open any more.",
  "delivery.approvals.notApprover": "You aren't an approver for this step.",
  "delivery.approvals.ownRequest": "You requested this promotion, so someone else must approve it.",
  "delivery.approvals.notRequester": "Only the person who asked, or a release manager, can cancel this request.",
  "delivery.approvals.invalidEnvironment": "Choose stage or production.",
  "delivery.approvals.invalidPolicy": "Check the approval steps: approvers must be active members.",
  "delivery.cr.notDraft": "This change request is already in progress.",
  // cr.saveDraft's refusals (src/domain/delivery.ts checkChangeDraft)
  "delivery.cr.badLane": "Pick a kind of change.",
  "delivery.cr.featureRequired": "Pick the feature this change is about.",
  "delivery.cr.unknownFeature": "Pick a feature from the locked scope.",
  "delivery.cr.titleTooLong": "Keep the title under 120 characters.",
  "delivery.cr.descriptionTooLong": "Keep the description under 10 000 characters.",
  "delivery.cr.empty": "Add a title or a description.",
  "delivery.cr.notFound": "This change request isn't part of the project any more.",
  "delivery.cr.needsTitleAndDescription": "Add a title and a description first.",
  "delivery.cr.notApproved": "Approve the change first.",
  "delivery.cr.scopeRoute": "This is a new feature: add it through Scope & success.",
  "delivery.cr.notQuestions": "This change has no open questions.",
  "delivery.cr.noAnalysis": "The analysis of this change isn't ready yet.",
  "delivery.cr.analysing": "The analysis is being updated with your answers.",
  "delivery.cr.noQuestions": "This change has no questions to answer.",
  "delivery.cr.noAnswers": "Answer at least one question.",
  "delivery.cr.unknownQuestion": "That question is not part of this change.",
  "delivery.cr.emptyAnswer": "Pick an option or write an answer.",
  "delivery.cr.answerTooLong": "Keep the answer under 2 000 characters.",
  "delivery.cr.notInReview": "This change isn't waiting for approval.",
  "delivery.cr.openQuestions": "Answer the open questions first.",
  "delivery.cr.notApprover": "You aren't an approver for this project.",
  "delivery.cr.ownRequest": "You asked for this change, so someone else must approve it.",
  "delivery.cr.noteTooLong": "Keep the note under 2 000 characters.",
  "delivery.release.invalidVersion": "Choose a released version.",
  "delivery.release.approvalRequired": "The approvals for this version aren't complete. Check its approval request.",
  "delivery.milestone.notFound": "This milestone isn't part of the project any more.",
  "delivery.milestone.notReady": "This milestone's preview isn't ready yet.",
  "delivery.milestone.noPreview": "This milestone has no preview online yet.",
  "delivery.milestone.building": "The team is still updating this milestone. Accept it once the new preview is online.",
  "delivery.milestone.openFeedback": "Some feedback on this milestone is still open. The team is on it; accept it once it is done.",
  "delivery.milestone.accepted": "This milestone is already accepted. Ask for a change on the Release page.",
  "delivery.job.notStarted": "This could not be started. Try again in a moment.",
  "delivery.afterDeploy.notFound": "This build isn't part of the project any more.",
  "delivery.afterDeploy.nothingOpen": "The steps after the deploy are finished already.",
  "delivery.afterDeploy.needsPerson": "Running the steps again can't finish this; the engine team takes care of it.",
  "delivery.release.checksFailed": "This version carries a change whose own checks failed on development, so it is not usable yet. Fix it or put development back first; then promote.",
  "delivery.checks.notUsable": "Its own checks failed on development, so it is not usable there yet. Fix what they found, or put development back, before the next build.",
  "delivery.checks.nothingFailed": "Its checks on the development environment pass now; there is nothing to fix.",
  "delivery.checks.reverted": "Development was put back without this build already.",
  "delivery.checks.markReason": "Say in a few words why it failed before this change (3 to 200 characters).",
  "delivery.checks.markUnknownCheck": "Only a check that failed in one of this change's builds can be marked.",
  "delivery.streams.aboveSuggestion": "That is more than the product's set-up allows right now. Pick the tech lead's suggestion or fewer.",
};

/** The query key of the project's "continue with the next increment" setting (Project.ContinueIncrements, read on its
 *  own: a tenant without the field answers off). */
export const continueKey = (projectId: string) => ["delivery", "continueIncrements", projectId] as const;

/** The query key of the project's parallel streams (Project.ParallelStreams and .StreamsAdvice, read on their own). */
export const streamsKey = (projectId: string) => ["delivery", "parallelStreams", projectId] as const;

/** The query key of the project's policy for failed checks (BlocksChangeBuildView reads it on its own). */
export const checksPolicyKey = (projectId: string) => ["delivery", "checksPolicy", projectId] as const;

const isRow = (v: unknown): v is { ItemId: string } => !!v && typeof v === "object" && typeof (v as { ItemId?: unknown }).ItemId === "string";

/** The line for a start whose answer names work that is not running: nothing was started, whatever else it says (a
 *  server from before 05.11 could answer an earlier, finished job for a key it had used before). */
export const NOT_STARTED_MESSAGE = "Nothing was started: the request matched work that had already finished. Try again in a moment.";

/** A start whose answer named work that is not running (notStartedProblem); its message is NOT_STARTED_MESSAGE. */
export class NotStartedError extends Error {
  constructor() {
    super(NOT_STARTED_MESSAGE);
    this.name = "NotStartedError";
  }
}

/** NOT_STARTED_MESSAGE when a start's answer names a job that is not queued, claimed or running; else null (pure). An
 *  answer without a job status (an op that started nothing, an older server) is taken as it is. */
export function notStartedProblem(data: unknown): string | null {
  const status = data && typeof data === "object" ? (data as { jobStatus?: unknown }).jobStatus : undefined;
  return typeof status === "string" && status !== "" && !["queued", "claimed", "running"].includes(status) ? NOT_STARTED_MESSAGE : null;
}

/** The message shown for a failed delivery action. */
export function deliveryActionMessage(e: unknown): string {
  if (e instanceof FunctionNotConfiguredError) return NOT_CONFIGURED_MESSAGE;
  if (e instanceof NotStartedError) return e.message;
  if (e instanceof FunctionError) {
    if (e.messageKey === "delivery.approvals.ownRequest") return DELIVERY_MESSAGES["delivery.approvals.ownRequest"];
    if (e.messageKey === "delivery.cr.ownRequest") return DELIVERY_MESSAGES["delivery.cr.ownRequest"];
    const missing = e.params?.missing;
    if (e.code === "approval_required" && Array.isArray(missing) && missing.length > 0 && missing.every((m) => typeof m === "string")) {
      return `Waiting for: ${(missing as string[]).join(", ")}.`;
    }
    if (e.messageKey && Object.prototype.hasOwnProperty.call(DELIVERY_MESSAGES, e.messageKey)) {
      return DELIVERY_MESSAGES[e.messageKey];
    }
    return functionErrorMessage(e.code);
  }
  if (e instanceof BlocksDataError) return e.message;
  return functionErrorMessage("unknown");
}

export interface DeliveryAction<A> {
  /** Never throws: resolves true on success, false on failure (see `error`). */
  run(args: A): Promise<boolean>;
  pending: boolean;
  error: string | null;
  success: string | null;
  reset(): void;
}

/** The mutation config of one delivery op, invalidating the schemas it touches. */
export function deliveryMutationConfig(
  op: string,
  workspaceId: string | null,
  projectId: string,
): FunctionMutationConfig<Record<string, unknown>, unknown> {
  const ws = workspaceId ?? "";
  const schemas = (...names: string[]) => names.map((n) => blocksKeys.schema(ws, n));
  const invalidate: Record<string, readonly (readonly unknown[])[]> = {
    // a comment on a finished ticket of a milestone waiting for review adds a fix ticket and may queue its build.run
    "ticket.comment": schemas("Ticket", "TicketEvent", "EngineJob"),
    "ticket.move": schemas("Ticket", "TicketEvent"),
    // the first start moves the project from Board to Build (Project.Stage): the journey bar, Projects and Dashboard
    "build.start": [...schemas("EngineJob", "Milestone", "Project"), deliveryProjectKey(projectId)],
    "build.retryAfterDeploy": schemas("EngineJob", "TicketEvent"),
    "cr.saveDraft": schemas("ChangeRequest", "Attachment"),
    "cr.startBuild": schemas("ChangeRequest", "EngineJob"),
    "cr.submit": schemas("ChangeRequest", "EngineJob"),
    "cr.answer": schemas("ChangeRequest", "EngineJob", "Attachment"),
    "cr.decide": schemas("ChangeRequest", "Ticket", "TicketEvent"),
    "cr.fixChecks": schemas("ChangeRequest", "EngineJob"),
    // the project row carries the policy: the delivery context reads it again; the policy itself comes from the answer
    // (apply below), never from a read right after the write, which can still answer the old value
    "cr.checksPolicy": [deliveryProjectKey(projectId)],
    // the change's checks record comes from the answer (apply below)
    "cr.markKnown": [],
    // the choice comes from the answer (apply below); the plan follows the jobs
    "cr.parallelStreams": [deliveryProjectKey(projectId)],
    "cr.continueIncrements": [deliveryProjectKey(projectId)],
    "approvalPolicy.save": schemas("ApprovalPolicy", "ApprovalStep"),
    "approvalRequest.create": schemas("ApprovalRequest", "ApprovalStep"),
    "approvalRequest.decide": schemas("ApprovalRequest", "ApprovalStep"),
    "approvalRequest.cancel": schemas("ApprovalRequest", "ApprovalStep"),
    // the promotion queues its deployment: the job list is read again, so the page follows it and re-reads the release
    "release.promote": schemas("Release", "ChangeRequest", "ApprovalRequest", "EngineJob"),
    "milestone.accept": [...schemas("Milestone", "EngineJob"), deliveryProjectKey(projectId)],
    "milestone.feedback": schemas("Ticket", "TicketEvent", "EngineJob", "Attachment"),
  };
  // read-your-write: what the op stored, from its answer
  const apply: Record<string, FunctionMutationConfig<Record<string, unknown>, unknown>["apply"]> = {
    "cr.checksPolicy": (data, _args, client) => {
      const p = (data as { policy?: { autoFixRounds?: unknown; autoRevert?: unknown } } | null)?.policy;
      if (!p || typeof p.autoFixRounds !== "number" || typeof p.autoRevert !== "boolean") return;
      client.setQueryData(checksPolicyKey(projectId), (old: unknown) => ({ ...(isRow(old) ? old : { ItemId: projectId }), ChecksPolicy: serializeChecksPolicy({ autoFixRounds: p.autoFixRounds as number, autoRevert: p.autoRevert as boolean }) }));
    },
    "cr.parallelStreams": (data, _args, client) => {
      const c = parseStreamsChoice((data as { streams?: unknown } | null)?.streams ?? null);
      if (!c) return;
      client.setQueryData(streamsKey(projectId), (old: unknown) => ({ ...(isRow(old) ? old : { ItemId: projectId }), ParallelStreams: serializeStreamsChoice(c) }));
    },
    "cr.continueIncrements": (data, _args, client) => {
      const c = parseContinueSetting((data as { continueIncrements?: unknown } | null)?.continueIncrements ?? null);
      if (!c) return;
      client.setQueryData(continueKey(projectId), (old: unknown) => ({ ...(isRow(old) ? old : { ItemId: projectId }), ContinueIncrements: serializeContinueSetting(c) }));
    },
    "cr.markKnown": (data, args, client) => {
      const checks = (data as { checks?: unknown } | null)?.checks;
      const id = args.changeRequestId;
      if (typeof checks !== "string" || typeof id !== "string") return;
      const put = (x: unknown) => (isRow(x) && x.ItemId === id ? { ...x, Checks: checks } : x);
      client.setQueriesData({ queryKey: blocksKeys.schema(ws, "ChangeRequest") }, (old: unknown) => {
        if (Array.isArray(old)) return old.map(put);
        if (old && typeof old === "object" && Array.isArray((old as { items?: unknown }).items)) return { ...(old as object), items: (old as { items: unknown[] }).items.map(put) };
        return isRow(old) ? put(old) : old;
      });
    },
  };
  return { fn: "delivery", op, invalidate: invalidate[op] ?? [], ...(apply[op] ? { apply: apply[op] } : {}) };
}

/** One delivery op as a hook: adds projectId from the context, reports progress, error and a visible success (a text,
 *  or one read from the op's answer, so the page says what really happened). */
function useDeliveryAction<A>(ctx: DeliveryContext, op: string, successText: string | ((data: unknown) => string)): DeliveryAction<A> {
  const m = useFunctionMutation<Record<string, unknown>, unknown>(deliveryMutationConfig(op, ctx.workspaceId, ctx.projectId));
  const { mutateAsync, reset } = m;
  const run = useCallback(
    async (args: A): Promise<boolean> => {
      try {
        const res = await mutateAsync({ ...(args as Record<string, unknown>), projectId: ctx.projectId });
        // an answer that names work which is not running started nothing: never a success
        return notStartedProblem(res?.data) === null;
      } catch {
        return false;
      }
    },
    [mutateAsync, ctx.projectId],
  );
  const notStarted = m.isSuccess ? notStartedProblem(m.data?.data) : null;
  return {
    run,
    pending: m.isPending,
    error: m.isError ? deliveryActionMessage(m.error) : notStarted,
    success: m.isSuccess && !notStarted ? (typeof successText === "function" ? successText(m.data?.data) : successText) : null,
    reset,
  };
}

export type StepInput = { type: ApprovalStepType; label?: string; required: boolean; approverUserIds: string[] };

export const useTicketComment = (ctx: DeliveryContext) =>
  useDeliveryAction<{ ticketId: string; text: string }>(ctx, "ticket.comment", "Comment added.");

export const useTicketMove = (ctx: DeliveryContext) =>
  useDeliveryAction<{ ticketId: string; fromColumn: TicketColumn; toColumn: TicketColumn }>(ctx, "ticket.move", "Moved.");

/** What build.start did, in plain words: its answer names the job kind and whether that job was running already (pure). */
export function buildStartText(data: unknown): string {
  const d = data && typeof data === "object" ? (data as { kind?: unknown; existing?: unknown }) : {};
  const preview = d.kind === "preview.deploy";
  if (d.existing === true) return preview ? "The preview of this milestone is already going online." : "The build of this milestone is already running.";
  return preview ? "The preview was requested. The development team puts it online in a moment." : "The build was requested. The development team picks it up in a moment.";
}

export const useBuildStart = (ctx: DeliveryContext) =>
  useDeliveryAction<{ milestoneId: string }>(ctx, "build.start", buildStartText);

/** "Finish the steps after the deploy": the data tables and the texts of a build whose code is live but whose steps after
 *  the deploy did not all finish (src/domain/afterDeploy.ts); `jobId` is that build. */
export const useRetryAfterDeploy = (ctx: DeliveryContext) =>
  useDeliveryAction<{ jobId: string }>(ctx, "build.retryAfterDeploy", (data) =>
    (data as { existing?: unknown } | null)?.existing === true
      ? "The steps after the deploy are already being finished."
      : "Requested. The development team finishes the steps after the deploy in a moment.");

export const useCrSaveDraft = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId?: string; lane: ChangeLane; featureRef: string; title: string; description: string; attachmentIds?: string[]; draftKey?: string }>(
    ctx,
    "cr.saveDraft",
    "Draft saved.",
  );

export const useCrStartBuild = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string }>(ctx, "cr.startBuild", "Build requested.");

/** draft -> analysing; queues change.analyse. */
export const useCrSubmit = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string }>(ctx, "cr.submit", "Sent for analysis.");

/** Saves answers ({id, answer}[]); with every question answered the analysis is refined. */
export const useCrAnswer = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string; answers: { id: string; answer: string }[] }>(ctx, "cr.answer", "Answers saved.");

/** Approve or reject a change waiting for approval. */
export const useCrDecide = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string; decision: "approve" | "reject"; note?: string }>(ctx, "cr.decide", "Decision recorded.");

/** What cr.fixChecks started, in plain words (pure). */
export function fixChecksText(data: unknown): string {
  const d = data && typeof data === "object" ? (data as { action?: unknown; existing?: unknown; round?: unknown }) : {};
  if (d.action === "revert") return d.existing === true ? "Development is already being put back." : "Requested. The development team puts development back to the last build whose checks passed.";
  const round = typeof d.round === "number" ? ` (round ${d.round})` : "";
  return d.existing === true ? `The fix round${round} is already running.` : `Requested. The development team starts the fix round${round} in a moment.`;
}

/** "Fix what the checks found" (action "fix") or "Put development back" (action "revert") for a change whose own checks
 *  failed after its deploy (src/domain/changeChecks.ts). */
export const useFixChecks = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string; action: "fix" | "revert" }>(ctx, "cr.fixChecks", fixChecksText);

/** The project's policy for checks that failed after a deploy (Project.ChecksPolicy); the page shows what was saved at
 *  once (the op's answer), never a read that can still answer the old value. */
export const useChecksPolicy = (ctx: DeliveryContext) =>
  useDeliveryAction<{ autoFixRounds: number; autoRevert: boolean }>(ctx, "cr.checksPolicy", "Saved.");

/** What cr.markKnown did, in plain words (pure). */
export function markKnownText(data: unknown): string {
  const d = data && typeof data === "object" ? (data as { action?: unknown; marked?: unknown }) : {};
  return d.action === "unmark" ? "The mark was taken back: it counts as this change's failure again." : "Marked as known before this change: it no longer counts against this change, and the next checks report it apart.";
}

/** "Known before this change" on a failing check of a change (action "mark", with a short reason), or the mark taken
 *  back ("unmark") (src/domain/changeChecks.ts KnownMark). */
export const useMarkKnown = (ctx: DeliveryContext) =>
  useDeliveryAction<{ changeRequestId: string; repo: string; name: string; reason?: string; action: "mark" | "unmark" }>(ctx, "cr.markKnown", markKnownText);

export const useApprovalPolicySave = (ctx: DeliveryContext) =>
  useDeliveryAction<{ environment: GatedEnvironment; steps: StepInput[] }>(ctx, "approvalPolicy.save", "Approval policy saved.");

export const useApprovalRequestCreate = (ctx: DeliveryContext) =>
  useDeliveryAction<{ environment: GatedEnvironment; version: string }>(ctx, "approvalRequest.create", "Approval requested.");

export const useApprovalRequestDecide = (ctx: DeliveryContext) =>
  useDeliveryAction<{ approvalRequestId: string; stepIndex: number; decision: "approved" | "rejected"; comment?: string }>(
    ctx,
    "approvalRequest.decide",
    "Decision recorded.",
  );

export const useApprovalRequestCancel = (ctx: DeliveryContext) =>
  useDeliveryAction<{ approvalRequestId: string }>(ctx, "approvalRequest.cancel", "Request cancelled.");

export const useReleasePromote = (ctx: DeliveryContext) =>
  useDeliveryAction<{ environment: GatedEnvironment; version: string }>(ctx, "release.promote", "Promoted.");

export const useMilestoneAccept = (ctx: DeliveryContext) =>
  useDeliveryAction<{ milestoneId: string }>(ctx, "milestone.accept", "Milestone accepted.");

export const useMilestoneFeedback = (ctx: DeliveryContext) =>
  useDeliveryAction<{ milestoneId: string; text: string; attachmentIds?: string[]; draftKey?: string }>(ctx, "milestone.feedback", "Feedback sent to the development team.");

/** What cr.parallelStreams stored, in plain words (pure). */
export function streamsChoiceText(data: unknown): string {
  const n = parseStreamsChoice((data as { streams?: unknown } | null)?.streams ?? null)?.chosen;
  return n === 1 ? "Saved: one change request is built at a time." : n ? `Saved: up to ${n} independent change requests are built side by side.` : "Saved.";
}

/** "Parallel streams: [1]..[5]": how many independent change requests build side by side (Project.ParallelStreams). */
export const useParallelStreams = (ctx: DeliveryContext) =>
  useDeliveryAction<{ chosen: number }>(ctx, "cr.parallelStreams", streamsChoiceText);

/** "Continue with the next increment when the checks pass" on or off (Project.ContinueIncrements). */
export const useContinueIncrements = (ctx: DeliveryContext) =>
  useDeliveryAction<{ on: boolean }>(ctx, "cr.continueIncrements", (data) =>
    parseContinueSetting((data as { continueIncrements?: unknown } | null)?.continueIncrements ?? null)?.on
      ? "Saved: the next increment starts by itself when a change's checks pass."
      : "Saved: every next increment waits for someone to start it.");
