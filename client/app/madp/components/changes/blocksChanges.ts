// Change controls on a Blocks project (C11): ChangeRequest and Release rows come from L8's delivery hooks (browser ->
// Data Gateway under the row policies); every write is a delivery op (cr.saveDraft, cr.submit, cr.answer, cr.decide,
// cr.startBuild) through src/blocks/fn.ts.
// Nothing here touches the local store. A target L8 cannot express (a requirement) has no change control.
import { useEffect, useMemo } from "react";
import { useDeliveryContext, type DeliveryContext } from "@/madp/blocks/delivery/context";
import { NotStartedError, deliveryActionMessage, deliveryMutationConfig, notStartedProblem } from "@/madp/blocks/delivery/actions";
import { jobInput, useChangeRequests, useFeatureNames, useMilestones, useReleases } from "@/madp/blocks/delivery/hooks";
import type { EngineJob } from "@/madp/blocks/engine/types";
import type { DeliveryChangeRequest } from "@/madp/blocks/delivery/types";
import { useBlocksCan } from "@/madp/blocks/context";
import { FunctionError, useFunctionMutation } from "@/madp/blocks/fn";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { livePoller } from "@/madp/blocks/data/livePoll";
import { isBlocksProjectId } from "@/madp/domain/projects";
import type { ChangeLane } from "@/madp/domain/delivery";
import type { ParamDraft } from "./changeUi";
import { t } from "@/madp/i18n";

/** The permission cr.saveDraft and cr.startBuild declare in functions/delivery/ops/changes. */
export const CHANGE_PERMISSION = "build.run" as const;

/** The lanes the panel offers (fix is raised from the build, as on the local path). */
export const BLOCKS_LANES: readonly ChangeLane[] = ["change", "enhance", "add"];
export const BLOCKS_LANE_META: Readonly<Record<ChangeLane, { label: string; line: string; badge: string }>> = {
  get change() { return { label: t("changes.laneMeta.change.label", "Change feature"), line: t("changes.laneMeta.change.line", "The business changed and the feature works differently now."), badge: t("changes.laneMeta.change.badge", "Changed") }; },
  get enhance() { return { label: t("changes.laneMeta.enhance.label", "Enhance feature"), line: t("changes.laneMeta.enhance.line", "A partial change or an addition to the feature."), badge: t("changes.laneMeta.enhance.badge", "Enhanced") }; },
  get add() { return { label: t("changes.laneMeta.add.label", "Add feature"), line: t("changes.laneMeta.add.line", "A new feature."), badge: t("changes.laneMeta.add.badge", "New") }; },
  get fix() { return { label: t("changes.laneMeta.fix.label", "Fix"), line: t("changes.laneMeta.fix.line", "Something does not work as the scope says; MADP fixes it."), badge: t("changes.laneMeta.fix.badge", "Fix") }; },
};

/** The lane's line in the change request window. On a product without a Factory scope (an existing product attached as
 *  it is live) a new feature is built on the product as it is, in small builds, instead of going through Scope & success. */
export function laneLine(lane: ChangeLane, scoped: boolean): string {
  if (!scoped && lane === "add") return t("changes.laneLine.addLive", "A new feature built on the existing product. The business analyst plans it in small builds; each one goes to development for you to try before the next.");
  if (!scoped && (lane === "change" || lane === "enhance")) return lane === "change" ? t("changes.laneLine.changeLive", "Something the product does today should work differently now.") : t("changes.laneLine.enhanceLive", "A partial change or an addition to something the product does today.");
  return BLOCKS_LANE_META[lane].line;
}

/** CR-001 style code for the draft lanes this panel creates. */
export const crCodeOf = (n: number): string => `CR-${String(n).padStart(3, "0")}`;

export const blocksFeatureRef = (key: string): string => `feature:${key}`;
export const isBlocksFeatureTarget = (t: { type: string } | null | undefined): boolean => !!t && t.type === "feature";

const RELEASED = new Set(["released-dev", "promoted-stage", "promoted-production"]);

function cmpVersion(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** "Changed in v1.1" badges of one feature: released change and enhance requests, oldest version first. */
export function blocksBadgesFor(ref: string, rows: readonly DeliveryChangeRequest[]): { key: string; label: string }[] {
  return rows
    .filter((r) => RELEASED.has(r.status) && r.version !== null && (r.lane === "change" || r.lane === "enhance") && r.featureRef === ref)
    .sort((a, b) => cmpVersion(a.version!, b.version!))
    .map((r) => ({ key: r.id, label: t("changes.badgeIn", "{badge} in v{version}", { badge: BLOCKS_LANE_META[r.lane].badge, version: r.version! }) }));
}

/** The newest draft for the same lane and feature (the panel reopens it instead of starting a second one). */
export function newestBlocksDraft(rows: readonly DeliveryChangeRequest[], lane: ChangeLane, ref: string): DeliveryChangeRequest | null {
  return rows.filter((r) => r.status === "draft" && r.lane === lane && r.featureRef === ref).reduce<DeliveryChangeRequest | null>(
    (a, r) => (!a || r.number > a.number ? r : a),
    null,
  );
}

/** The ?change=<number> lookup shape of changeUi.changeParamAction. */
export function paramDrafts(projectId: string, rows: readonly DeliveryChangeRequest[]): ParamDraft[] {
  return rows.map((r) => ({ id: r.id, projectId, number: r.number, status: r.status, lane: r.lane, featureRef: r.featureRef }));
}

/** Whether change requests exist yet (the project has a dev release) and what the signed-in person may do with them. */
export function useBlocksChangeAccess(projectId: string | null | undefined): { available: boolean; canRun: boolean; role: "member" | "viewer" } {
  const id = projectId && isBlocksProjectId(projectId) ? projectId : "";
  const ctx = useDeliveryContext(id);
  const releases = useReleases(ctx);
  const may = useBlocksCan(CHANGE_PERMISSION);
  const available = !!id && releases.data.some((r) => r.environment === "dev");
  return { available, canRun: available && may, role: may ? "member" : "viewer" };
}

/** The project's ChangeRequest rows (parsed; unreadable rows are skipped). */
export function useBlocksChangeRequests(projectId: string | null | undefined): { data: DeliveryChangeRequest[]; isLoading: boolean; error: string | null } {
  const id = projectId && isBlocksProjectId(projectId) ? projectId : "";
  const ctx = useDeliveryContext(id);
  const list = useChangeRequests(ctx);
  return { data: list.data, isLoading: list.isLoading, error: list.error };
}

/** The features a change can target: the locked milestones' feature refs, in milestone order. */
export function useBlocksFeatureRefs(ctx: DeliveryContext): { ref: string; key: string; name: string; milestone: string }[] {
  const milestones = useMilestones(ctx);
  const names = useFeatureNames(ctx);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: { ref: string; key: string; name: string; milestone: string }[] = [];
    for (const m of milestones.data) {
      for (const ref of m.featureRefs) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        const key = ref.startsWith("feature:") ? ref.slice(8) : ref;
        // the picker shows the feature's name; never its key or ref (a plain word while the name is not read yet)
        out.push({ ref, key, name: names.get(ref) ?? "A feature", milestone: `Milestone ${m.number}: ${m.name}` });
      }
    }
    return out;
  }, [milestones.data, names]);
}

export interface SavedDraft { changeRequestId: string; number: number }
export interface StartedBuild { jobId: string; version: string; existing: boolean; /** additive (05.11): the job's status */ jobStatus?: string }

/** The exact cr.saveDraft arguments (the server refuses unknown keys; the title and description are trimmed). */
export function draftArgs(projectId: string, a: { changeRequestId?: string | null; lane: ChangeLane; featureRef: string; title: string; description: string; attachmentIds?: string[]; draftKey?: string }): Record<string, unknown> {
  return {
    projectId,
    ...(a.changeRequestId ? { changeRequestId: a.changeRequestId } : {}),
    lane: a.lane,
    featureRef: a.lane === "add" ? "" : a.featureRef,
    title: a.title.trim(),
    description: a.description.trim(),
    // the files sent with the request (ready uploads of the form)
    ...(a.attachmentIds?.length ? { attachmentIds: a.attachmentIds, draftKey: a.draftKey } : {}),
  };
}

/** cr.saveDraft; one requestId per call (one user action). Throws a FunctionError; `blocksChangeMessage` words it. */
export function useSaveBlocksDraft(workspaceId: string | null, projectId: string) {
  const m = useFunctionMutation<Record<string, unknown>, SavedDraft>(deliveryMutationConfig("cr.saveDraft", workspaceId, projectId));
  return {
    save: async (a: { changeRequestId?: string; lane: ChangeLane; featureRef: string; title: string; description: string; attachmentIds?: string[]; draftKey?: string }): Promise<SavedDraft> =>
      (await m.mutateAsync(draftArgs(projectId, a))).data,
    pending: m.isPending,
  };
}

/** The schemas a change request op touches (the delivery mutation config lists only the older ops). */
function changeOpConfig(op: string, workspaceId: string | null, projectId: string) {
  const ws = workspaceId ?? "";
  const base = deliveryMutationConfig(op, workspaceId, projectId);
  const extra = ["ChangeRequest", "EngineJob", "Ticket", "Attachment"].map((n) => blocksKeys.schema(ws, n));
  return { ...base, invalidate: [...(Array.isArray(base.invalidate) ? base.invalidate : []), ...extra] };
}

/** cr.submit: draft → analysing; the business analyst (change.analyse) analyses it. Also the retry of a failed analysis. */
export function useSubmitBlocksChange(workspaceId: string | null, projectId: string) {
  const m = useFunctionMutation<Record<string, unknown>, unknown>(changeOpConfig("cr.submit", workspaceId, projectId));
  return {
    submit: async (changeRequestId: string): Promise<void> => { await m.mutateAsync({ changeRequestId, projectId }); },
    pending: m.isPending,
  };
}

/** cr.answer: saves answers into the analysis questions; the last answer queues the refined analysis. */
export function useAnswerBlocksChange(workspaceId: string | null, projectId: string) {
  const m = useFunctionMutation<Record<string, unknown>, unknown>(changeOpConfig("cr.answer", workspaceId, projectId));
  return {
    answer: async (changeRequestId: string, answers: { id: string; answer: string }[], files?: { attachmentIds: string[]; draftKey: string }): Promise<void> => {
      await m.mutateAsync({ changeRequestId, projectId, answers, ...(files?.attachmentIds.length ? files : {}) });
    },
    pending: m.isPending,
  };
}

/** cr.decide: approve (the planned tickets go on the board) or reject, with an optional note. Allowed only in review. */
export function useDecideBlocksChange(workspaceId: string | null, projectId: string) {
  const m = useFunctionMutation<Record<string, unknown>, unknown>(changeOpConfig("cr.decide", workspaceId, projectId));
  return {
    /** `route` "fast": approve a scope-route change to build it now as a change to what is there (cr.decide records it). */
    decide: async (changeRequestId: string, decision: "approve" | "reject", note: string, route?: "fast"): Promise<void> => {
      await m.mutateAsync({ changeRequestId, projectId, decision, ...(note.trim() ? { note: note.trim() } : {}), ...(route ? { route } : {}) });
    },
    pending: m.isPending,
  };
}

/** The line for a start whose answer named ANOTHER change's build (a server from before 09.11.2026 keyed every change
 *  build per project, so with parallel streams it answered the build that was running): nothing of this change runs. */
export const OTHER_BUILD_MESSAGE = "Another change's build is running and answered this start, so this change's build was not started. Start it again in a moment.";

/** A start whose answer names another change's build (startProblem). */
export class OtherBuildError extends Error {
  constructor() {
    super(OTHER_BUILD_MESSAGE);
    this.name = "OtherBuildError";
  }
}

/** Why a start's answer is not this change's build starting (pure): a job that is not running (notStartedProblem), or a
 *  running job the page knows as another change's; null when it is this change's (or a job the page does not know yet,
 *  just made). */
export function startProblem(data: unknown, changeRequestId: string, jobs: readonly Pick<EngineJob, "id" | "inputJson">[] = []): "not-started" | "other-change" | null {
  if (notStartedProblem(data)) return "not-started";
  const id = data && typeof data === "object" ? (data as { jobId?: unknown }).jobId : undefined;
  const job = typeof id === "string" ? jobs.find((j) => j.id === id) : undefined;
  const owner = job ? jobInput(job)?.changeRequestId : undefined;
  return job && owner !== changeRequestId ? "other-change" : null;
}

/** cr.startBuild through the same config (also invalidates the change request and its tickets). */
export function useStartChangeBuild(workspaceId: string | null, projectId: string) {
  const m = useFunctionMutation<Record<string, unknown>, StartedBuild>(changeOpConfig("cr.startBuild", workspaceId, projectId));
  return {
    /** Throws NotStartedError when the answer names a build that is not running, OtherBuildError when it names another
     *  change's build (`jobs`: the page's job list): the page never shows a build that is not this change's then. A
     *  failed write (the transport already retried 429 and 5xx answers with back-off) throws its plain error and the
     *  button stays. */
    start: async (changeRequestId: string, jobs?: readonly Pick<EngineJob, "id" | "inputJson">[]): Promise<StartedBuild> => {
      const data = (await m.mutateAsync({ changeRequestId, projectId })).data;
      const problem = startProblem(data, changeRequestId, jobs);
      if (problem === "not-started") throw new NotStartedError();
      if (problem === "other-change") throw new OtherBuildError();
      return data;
    },
    pending: m.isPending,
  };
}

/** While an engine job works on a change request (analysis, refinement, build), the change request and the jobs are
 *  read on every fast tick of the live clock (src/blocks/data/livePoll.ts), so the page moves on by itself when the job
 *  settles: in the same request as the clock's other reads, paused while the tab is hidden or the server asks for a
 *  pause, never a timer of its own. */
export function useChangeWait(workspaceId: string | null, on: boolean): void {
  useEffect(() => {
    if (!on || !workspaceId) return;
    return livePoller.boost([blocksKeys.schema(workspaceId, "ChangeRequest"), blocksKeys.schema(workspaceId, "EngineJob")]);
  }, [on, workspaceId]);
}

/** Plain texts for the change request message keys the delivery function sends (cr.submit, cr.answer, cr.decide,
 *  cr.startBuild); every other key goes through the delivery messages. */
export const CHANGE_MESSAGES: Readonly<Record<string, string>> = {
  get "delivery.cr.analysing"() { return t("changes.error.analysing", "The business analyst is already analysing this change."); },
  get "delivery.cr.noAnalysis"() { return t("changes.error.noAnalysis", "This change has no analysis yet. Send it for analysis first."); },
  get "delivery.cr.notApproved"() { return t("changes.error.notApproved", "Approve the change first."); },
  get "delivery.cr.scopeRoute"() { return t("changes.error.scopeRoute", "This is a new feature: add it through Scope & success."); },
  get "delivery.cr.notQuestions"() { return t("changes.error.notQuestions", "This change has no open questions."); },
  get "delivery.cr.notInReview"() { return t("changes.error.notInReview", "This change isn't waiting for approval."); },
  get "delivery.cr.needsTitleAndDescription"() { return t("changes.error.needsTitleAndDescription", "Add a title and a description first."); },
  get "delivery.cr.noQuestions"() { return t("changes.error.noQuestions", "This change has no questions to answer."); },
  get "delivery.cr.noAnswers"() { return t("changes.error.noAnswers", "Answer at least one question."); },
  get "delivery.cr.unknownQuestion"() { return t("changes.error.unknownQuestion", "That question is not part of this change any more. Reload the page."); },
  get "delivery.cr.emptyAnswer"() { return t("changes.error.emptyAnswer", "Pick an option or write an answer."); },
  get "delivery.cr.answerTooLong"() { return t("changes.error.answerTooLong", "Keep the answer under 2 000 characters."); },
  get "delivery.cr.notFound"() { return t("changes.error.notFound", "This change request doesn't exist any more."); },
  get "delivery.cr.notDraft"() { return t("changes.error.notDraft", "This change request is already in progress."); },
  get "delivery.cr.notApprover"() { return t("changes.error.notApprover", "You aren't an approver for this change."); },
  get "delivery.cr.ownRequest"() { return t("changes.error.ownRequest", "You asked for this change, so someone else must approve it."); },
  get "delivery.cr.noteTooLong"() { return t("changes.error.noteTooLong", "Keep the note under 2 000 characters."); },
  get "delivery.cr.openQuestions"() { return t("changes.error.openQuestions", "Answer the open questions first."); },
};

/** The plain sentence of a failed change action. */
export function blocksChangeMessage(e: unknown): string {
  if (e instanceof OtherBuildError) return t("changes.error.otherBuild", "Another change's build is running and answered this start, so this change's build was not started. Start it again in a moment.");
  const key = e instanceof FunctionError ? e.messageKey : undefined;
  if (key && Object.prototype.hasOwnProperty.call(CHANGE_MESSAGES, key)) return CHANGE_MESSAGES[key];
  return deliveryActionMessage(e);
}
