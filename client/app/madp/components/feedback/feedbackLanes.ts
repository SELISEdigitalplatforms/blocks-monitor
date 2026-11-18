/** The write side of the one feedback card, per step. Goals & requirements (requirement, extra) writes through the
 *  collab feedback ops; Scope & success (feature, story, screen, milestone, success target) writes through the scope
 *  feedback ops. Both keep their threads in the same FeedbackThread / FeedbackComment rows, so the card reads them the
 *  same way; only the gate, the permissions and the write calls differ. */
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useCollabContext } from "@/madp/blocks/collab/context";
import { openAttachment, useAddComment, useSetThreadStatus } from "@/madp/blocks/collab/feedback";
import { checkFeedbackFile, discardFeedbackFile, uploadFeedbackFiles, type FeedbackFileState } from "@/madp/blocks/collab/feedbackUpload";
import { collabErrorMessage } from "@/madp/blocks/collab/messages";
import type { FeedbackAttachmentRecord } from "@/madp/blocks/collab/records";
import { useProject } from "@/madp/blocks/projects/reads";
import { callFunction } from "@/madp/blocks/fn";
import { scopeMutationOptions, FEEDBACK_RESOLVE_PERMISSION, type FeedbackAddArgs, type FeedbackAddAnswer, type FeedbackStatusArgs, type FeedbackStatusAnswer } from "@/madp/blocks/scope/mutations";
import { scopeErrorMessage } from "@/madp/blocks/scope/messages";
import { SCOPE_FEEDBACK_ACCEPT, checkScopeFeedbackFile, discardScopeFeedbackFile, uploadScopeFeedbackFiles } from "@/madp/blocks/scope/uploads";
import type { FeedbackTargetType } from "@/madp/data/feedback";
import { RESOLVE_PERMISSION, feedbackGate } from "../../domain/feedback";
import type { FeedbackTarget } from "./feedbackUi";
import { t } from "@/madp/i18n";

// the plain sentences of the lanes, in the person's language (read at render time)
export const closedMessage = (): string => t("settings.feedback.lane.closed", "The requirements are confirmed, so this item stays as it is.");
export const notYetMessage = (): string => t("settings.feedback.lane.notYet", "Feedback opens when the project reaches the requirements step.");
export const noCommentMessage = (): string => t("settings.feedback.lane.noComment", "You can read this thread but not add to it.");
export const noResolveMessage = (): string => t("settings.feedback.lane.noResolve", "Only people who can edit the requirements can accept and close this.");
/** The English of scopeLockedMessage(), for callers that still pass it as is; prefer scopeLockedMessage(). */
export const SCOPE_LOCKED_MESSAGE = "The build follows this scope, so this item stays as it is.";
export const scopeLockedMessage = (): string => t("settings.feedback.lane.scopeLocked", "The build follows this scope, so this item stays as it is.");
/** Shown near the composer once the scope is locked: a comment still goes to the team, as a change request. */
export const scopeChangeRequestNote = (): string => t("settings.feedback.lane.scopeChangeRequest", "The scope is locked, so your comment goes to the team as a change request.");
const noResolveScope = (): string => t("settings.feedback.lane.noResolveScope", "Only people who can lock the scope can accept and close this.");
const noResolveScreen = (): string => t("settings.feedback.lane.noResolveScreen", "Only people who can edit the designs can accept and close this.");

type RequirementsType = "requirement" | "extra";
type ScopeType = Exclude<FeedbackTargetType, RequirementsType>;

export const isRequirementsTarget = (t: FeedbackTargetType): t is RequirementsType => t === "requirement" || t === "extra";
export const isScopeTarget = (t: FeedbackTargetType): t is ScopeType => !isRequirementsTarget(t);

/** The composer's writes: send a comment, upload / check / discard its files. */
export interface ComposerLane {
  send(a: { text: string; draftKey: string; attachmentIds: string[] }): Promise<unknown>;
  upload(a: { draftKey: string; files: readonly File[]; onState: (index: number, state: FeedbackFileState) => void }): Promise<unknown>;
  check(file: File): string | null;
  discard(attachmentId: string): Promise<void>;
  errorMessage(e: unknown): string;
  /** The file input's accept list (none: the server decides). */
  accept?: string;
}

export interface FeedbackLane {
  /** The item takes new comments and status changes (the step is open for it). */
  open: boolean;
  closedReason: string | null;
  /** A plain note shown near the composer while it is open (the scope is locked: comments become change requests). */
  note: string | null;
  canComment: boolean;
  canResolve: boolean;
  noResolveMessage: string;
  /** A person reopens ("open") or accepts and closes ("resolved"); `decision` records what happened to a suggested change. */
  setStatus(threadId: string, status: "open" | "resolved", decision?: "applied" | "kept"): Promise<unknown>;
  openFile(a: FeedbackAttachmentRecord): Promise<void>;
  errorMessage(e: unknown): string;
  composer: ComposerLane;
}

/** Goals & requirements: open while the project is at the requirements step. */
export function useRequirementsLane(projectId: string, target: FeedbackTarget): FeedbackLane {
  const { permissions } = useCollabContext();
  const project = useProject(projectId).data ?? null;
  const add = useAddComment(projectId);
  const status = useSetThreadStatus(projectId);
  const kind: RequirementsType = target.type === "extra" ? "extra" : "requirement";
  const gate = project ? feedbackGate(kind, { stage: project.stage, resumeTo: null }) : null;
  const closedReason = gate && !gate.open ? (gate.reason === "requirementsConfirmed" ? closedMessage() : notYetMessage()) : null;
  return {
    open: gate?.open === true,
    closedReason,
    note: null,
    canComment: permissions.includes("comment"),
    canResolve: permissions.includes(RESOLVE_PERMISSION[kind]),
    noResolveMessage: noResolveMessage(),
    setStatus: (threadId, s, decision) => status.mutateAsync({ threadId, status: s, ...(decision ? { decision } : {}) }),
    openFile: (a) => openAttachment(projectId, a),
    errorMessage: collabErrorMessage,
    composer: {
      send: ({ text, draftKey, attachmentIds }) => add.mutateAsync({
        targetType: kind, targetId: target.id, text, ...(attachmentIds.length ? { draftKey, attachmentIds } : {}),
      }),
      upload: ({ draftKey, files, onState }) => uploadFeedbackFiles({ projectId, targetType: kind, targetId: target.id, draftKey, files, onState }),
      check: checkFeedbackFile,
      discard: (id) => discardFeedbackFile(projectId, id),
      errorMessage: collabErrorMessage,
    },
  };
}

/** A short-lived link to a scope comment's file, through the scope attachment op. */
const scopeUrlCall = ((_fn: string, _op: string, args?: Record<string, unknown>, opts?: Parameters<typeof callFunction>[3]) =>
  callFunction("project", "scope.attachment.url", args, opts)) as typeof callFunction;

/** Scope & success: always takes comments; once the scope is locked (`target.locked`) the team turns a comment into a
 *  change request, which the note near the composer says. The scope ops check it again. */
export function useScopeLane(projectId: string, target: FeedbackTarget): FeedbackLane {
  const { workspaceId, permissions, isSuperAdmin } = useCollabContext();
  const ws = workspaceId ?? "";
  const add = useMutation(useMemo(() => scopeMutationOptions<FeedbackAddArgs, FeedbackAddAnswer>(ws, "scope.feedback.add"), [ws]));
  const status = useMutation(useMemo(() => scopeMutationOptions<FeedbackStatusArgs, FeedbackStatusAnswer>(ws, "scope.feedback.setStatus"), [ws]));
  const type = target.type as ScopeType;
  const needed = FEEDBACK_RESOLVE_PERMISSION[type];
  return {
    open: true,
    closedReason: null,
    note: target.locked ? scopeChangeRequestNote() : null,
    canComment: isSuperAdmin || permissions.includes("comment"),
    canResolve: isSuperAdmin || (!!needed && permissions.includes(needed)),
    noResolveMessage: type === "screen" ? noResolveScreen() : noResolveScope(),
    setStatus: (threadId, s, decision) => status.mutateAsync({ projectId, threadId, status: s, ...(decision ? { decision } : {}) }),
    openFile: (a) => openAttachment(projectId, a, { call: scopeUrlCall }),
    errorMessage: scopeErrorMessage,
    composer: {
      send: ({ text, draftKey, attachmentIds }) => add.mutateAsync({
        projectId, target: { type, id: target.id }, commentKey: draftKey, text, attachmentIds,
      }),
      upload: ({ draftKey, files, onState }) => uploadScopeFeedbackFiles({ projectId, commentKey: draftKey, files, onState }),
      check: checkScopeFeedbackFile,
      discard: (id) => discardScopeFeedbackFile(projectId, id),
      errorMessage: scopeErrorMessage,
      accept: SCOPE_FEEDBACK_ACCEPT,
    },
  };
}
