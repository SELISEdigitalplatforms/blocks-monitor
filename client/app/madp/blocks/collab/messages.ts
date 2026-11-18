// Plain sentences for the collaboration failures. Server free text and invalid_input values are never shown.
import { FunctionError, functionErrorMessage } from "../fn";
import { isEngineNotConfigured } from "../engine/actions";
import { isStorageUnavailable } from "../../domain/uploads";
import { t } from "../../i18n";

export const NOT_CONFIGURED_MESSAGE = "This isn't available yet.";

export const COLLAB_MESSAGES: Record<string, string> = {
  "feedback.closed": "The requirements are confirmed, so this item stays as it is.",
  "feedback.attachmentNotReady": "A file isn't ready yet. Wait until it shows Done, or remove it.",
  "feedback.typeNotAllowed": "This file type isn't accepted. Use one of: {accepted}.",
  "feedback.tooLarge": "This file is larger than 10 MB.",
  "feedback.tooManyFiles": "Attach at most {max} files to one comment.",
  "feedback.tooManyComments": "This thread is full ({max} comments).",
  "feedback.notUploader": "Only the person who uploaded this file can change it.",
  "feedback.attachmentInUse": "This file is already part of a sent comment.",
  "feedback.fileMissing": "The file didn't arrive complete. Try again.",
  "feedback.fileSize": "The file size doesn't match what was sent. Try again.",
  "feedback.fileType": "The file's content doesn't match its type.",
  "wiki.stale": "Someone else changed this page.",
  "wiki.factoryTitle": "Pages MADP wrote keep their title.",
  "wiki.factoryPage": "Pages MADP wrote can't be deleted. Update the wiki with MADP instead.",
  "wiki.tooManyPages": "This wiki already has {max} pages.",
  "wiki.slugTaken": "A page with this title already exists. Choose another title.",
  "chat.tooManyOpen": "MADP is still answering {max} of your questions here. Wait for an answer, then ask again.",
  "chat.taskMismatch": "This change request doesn't match the message.",
  "chat.offerGone": "This was already done or is no longer offered. Ask the agent again.",
  "chat.offerNotYet": "Change requests open after the first release to development.",
  "assistant.empty": "Write a message or attach a file.",
  "assistant.attachmentsTooLarge": "The attached files are too large to keep. Attach fewer or smaller files.",
  "assistant.notBugReport": "This message can't be analysed.",
  "assistant.notAnalysis": "This message has no analysis to act on.",
  "assistant.fixStarted": "This fix has already started.",
  "assistant.fixStarting": "Someone else is starting this fix.",
  "assistant.wrongChange": "This change request doesn't belong to this fix.",
};


/** A param as the sentences show it: a list joined with commas, a number or text as it is, anything else empty. */
function v(x: unknown): string {
  if (Array.isArray(x)) return x.filter((y) => typeof y === "string" || typeof y === "number").join(", ");
  return typeof x === "string" || typeof x === "number" ? String(x) : "";
}

/** COLLAB_MESSAGES in the chosen language (the English above stays the reference). */
const COLLAB_TEXT: Record<string, (p: Record<string, unknown> | undefined) => string> = {
  "feedback.closed": () => t("common.collab.feedback.closed", "The requirements are confirmed, so this item stays as it is."),
  "feedback.attachmentNotReady": () => t("common.collab.feedback.attachmentNotReady", "A file isn't ready yet. Wait until it shows Done, or remove it."),
  "feedback.typeNotAllowed": (p) => t("common.collab.feedback.typeNotAllowed", "This file type isn't accepted. Use one of: {accepted}.", { accepted: v(p?.accepted) }),
  "feedback.tooLarge": () => t("common.collab.feedback.tooLarge", "This file is larger than 10 MB."),
  "feedback.tooManyFiles": (p) => t("common.collab.feedback.tooManyFiles", "Attach at most {max} files to one comment.", { max: v(p?.max) }),
  "feedback.tooManyComments": (p) => t("common.collab.feedback.tooManyComments", "This thread is full ({max} comments).", { max: v(p?.max) }),
  "feedback.notUploader": () => t("common.collab.feedback.notUploader", "Only the person who uploaded this file can change it."),
  "feedback.attachmentInUse": () => t("common.collab.feedback.attachmentInUse", "This file is already part of a sent comment."),
  "feedback.fileMissing": () => t("common.collab.feedback.fileMissing", "The file didn't arrive complete. Try again."),
  "feedback.fileSize": () => t("common.collab.feedback.fileSize", "The file size doesn't match what was sent. Try again."),
  "feedback.fileType": () => t("common.collab.feedback.fileType", "The file's content doesn't match its type."),
  "wiki.stale": () => t("common.collab.wiki.stale", "Someone else changed this page."),
  "wiki.factoryTitle": () => t("common.collab.wiki.factoryTitle", "Pages MADP wrote keep their title."),
  "wiki.factoryPage": () => t("common.collab.wiki.factoryPage", "Pages MADP wrote can't be deleted. Update the wiki with MADP instead."),
  "wiki.tooManyPages": (p) => t("common.collab.wiki.tooManyPages", "This wiki already has {max} pages.", { max: v(p?.max) }),
  "wiki.slugTaken": () => t("common.collab.wiki.slugTaken", "A page with this title already exists. Choose another title."),
  "chat.tooManyOpen": (p) => t("common.collab.chat.tooManyOpen", "MADP is still answering {max} of your questions here. Wait for an answer, then ask again.", { max: v(p?.max) }),
  "chat.taskMismatch": () => t("common.collab.chat.taskMismatch", "This change request doesn't match the message."),
  "chat.offerGone": () => t("common.collab.chat.offerGone", "This was already done or is no longer offered. Ask the agent again."),
  "chat.offerNotYet": () => t("common.collab.chat.offerNotYet", "Change requests open after the first release to development."),
  "assistant.empty": () => t("common.collab.assistant.empty", "Write a message or attach a file."),
  "assistant.attachmentsTooLarge": () => t("common.collab.assistant.attachmentsTooLarge", "The attached files are too large to keep. Attach fewer or smaller files."),
  "assistant.notBugReport": () => t("common.collab.assistant.notBugReport", "This message can't be analysed."),
  "assistant.notAnalysis": () => t("common.collab.assistant.notAnalysis", "This message has no analysis to act on."),
  "assistant.fixStarted": () => t("common.collab.assistant.fixStarted", "This fix has already started."),
  "assistant.fixStarting": () => t("common.collab.assistant.fixStarting", "Someone else is starting this fix."),
  "assistant.wrongChange": () => t("common.collab.assistant.wrongChange", "This change request doesn't belong to this fix."),
};

const CLOSED_TEXT: Record<string, () => string> = {
  requirementsConfirmed: () => t("common.collab.closed.requirementsConfirmed", "The requirements are confirmed, so this item stays as it is."),
  notYet: () => t("common.collab.closed.notYet", "Feedback opens when the project reaches the requirements step."),
};


function fill(template: string, params: Record<string, unknown> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params?.[k];
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string" || typeof x === "number").join(", ");
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  });
}

export function collabErrorMessage(e: unknown): string {
  if (isEngineNotConfigured(e)) return t("common.collab.notConfigured", "This isn't available yet.");
  if (isStorageUnavailable(e)) return t("common.errors.storageUnavailable", "File storage isn't available yet. The platform owner needs to enable it.");
  if (e instanceof FunctionError) {
    const key = e.messageKey;
    if (key && Object.prototype.hasOwnProperty.call(COLLAB_MESSAGES, key)) {
      if (key === "feedback.closed") {
        const reason = e.params?.reason;
        if (typeof reason === "string" && Object.prototype.hasOwnProperty.call(CLOSED_TEXT, reason)) return CLOSED_TEXT[reason]();
      }
      return Object.prototype.hasOwnProperty.call(COLLAB_TEXT, key) ? COLLAB_TEXT[key](e.params) : fill(COLLAB_MESSAGES[key], e.params);
    }
    return functionErrorMessage(e.code);
  }
  return t("common.collab.generic", "Something went wrong. Try again.");
}
