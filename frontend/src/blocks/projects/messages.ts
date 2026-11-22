// Plain sentences for function failures: server free text is never shown.
import { FunctionError, functionErrorMessage } from "../fn";
import {
  FUNCTION_HOST, FUNCTION_IDS, FunctionNotConfiguredError, resolveFunction,
  type FunctionHost, type FunctionName,
} from "../functions";
import { BlocksDataError } from "../data/errors";
import { STORAGE_UNAVAILABLE_MESSAGE, isStorageUnavailable } from "../../domain/uploads";

export const NOT_CONFIGURED_MESSAGE = "This step isn't available yet.";

const MESSAGES: Record<string, string> = {
  "business.empty": "Write something in the Scratch pad or a note, or upload a file, first.",
  "business.alreadyHandedOver": "The project analysis has already started.",
  "business.repoMissing": "Add the GitHub repository and branch first: MADP analyses the existing product from it.",
  "project.typeDisabled": "Greyfield projects can't be started yet.",
  "project.repoInvalid": "Enter the GitHub repository as owner/name or its github.com address.",
  "project.branchInvalid": "Enter a valid branch name, for example main.",
  "project.notBrownfield": "Only an existing product has a repository to connect.",
  "project.repoLocked": "The repository can't change once the project analysis has started: MADP works from this one.",
  "project.notGreenfield": "Only a new product gets a new repository from MADP.",
  "project.newRepoLocked": "The new repository can't change once the build has started: MADP has created it.",
  "project.repoOwnerInvalid": "Connect GitHub to choose the account the repository is created in.",
  "project.repoNameInvalid": "Use 1 to 100 letters, digits, dots, hyphens or underscores, for example customer-portal.",
  "project.repoVisibilityInvalid": "Choose private or internal.",
  "project.repoMixed": "Send either the existing repository or the new one, not both.",
  "project.repoRequired": "Connect GitHub and choose an existing repository or create a new one before creating the project.",
  "project.repoNameTaken": "A repository with this name already exists. Select it as an existing repository, or change your project name.",
  "project.websiteUrlInvalid": "Enter a web address, like www.example.com.",
  "project.websiteUrlTooLong": "Use at most 500 characters.",
  "project.landingChoiceInvalid": "Choose whether you want a landing page.",
  "project.landingAnswerInvalid": "Some answers about the landing page are missing or too long.",
  "project.landingChanged": "The landing page answers changed meanwhile. Review the new section, then confirm it.",
  "project.landingClosed": "The landing page can't be changed while the project is paused or closed.",
  "project.landingNeedsChange": "The requirements are approved, so this change needs a change request. The development team can make it.",
  "project.appUrlInvalid": "Enter the app's address as a web link, for example https://app.example.com.",
  "project.testEnvInvalid": "Say whether a test environment is available: yes, no or not sure.",
  "project.testEnvUrlInvalid": "Enter the test environment's address as a web link, for example https://test.example.com.",
  "project.setupAnswersInvalid": "The setup answers couldn't be read. Try again.",
  "project.textTooLong": "This field can be at most {max} characters.",
  "project.setupLocked": "The project analysis has started, so its setup answers are fixed now.",
  "note.stale": "Someone else changed this note.",
  "note.tooLong": "Notes can be at most 100 000 characters.",
  "doc.cycle": "A folder can't move into itself or one of its subfolders.",
  "doc.tooDeep": "Folders can be nested at most 6 levels deep.",
  "doc.scratchFixed": "The scratch pad stays at the top and can't be moved or deleted.",
  "doc.typeNotAllowed": "This file type isn't accepted. Accepted: {accepted}.",
  "doc.fileTooLarge": "Files can be at most 10 MB.",
  "doc.projectFull": "This project's files can take at most 50 MB in total.",
  "doc.tooManyFolders": "A project can have at most {max} folders.",
  "doc.tooManyNotes": "A project can have at most {max} notes.",
  "doc.tooManyFiles": "A project can have at most {max} files.",
  "doc.emptyFile": "This file is empty.",
  "doc.uploadIncomplete": "The file didn't arrive complete. Try again.",
  "doc.uploadRejected": "This file was rejected. Check its type and size, then try again.",
  "doc.notReady": "This file isn't ready yet.",
  "doc.notFound": "This item no longer exists.",
  "doc.readingUnavailable": "This file can't be read right now. Try again in a moment.",
  "share.itemNotFound": "This item no longer exists.",
  "doc.nameRequired": "Enter a name.",
  "doc.nameTooLong": "Names can be at most {max} characters.",
  "doc.badPosition": "That position isn't available any more. Try again.",
  "share.self": "You can't share with yourself.",
  "share.notMember": "Everyone you share with must be an active member of this workspace.",
  "share.tooMany": "You can share with at most 50 people at once.",
  "share.notSharer": "Only the person who shared this, or a member manager, can remove it.",
  "assign.notMember": "Only active members of this workspace can be assigned.",
  "project.nameRequired": "Enter a project name.",
  "project.nameTooLong": "Project names can be at most 80 characters.",
  "project.nameInvalid": "Project names can't contain control characters.",
  "project.fieldTooLong": "This field can be at most 120 characters.",
  // project.documentExisting refusals (src/domain/liveProduct.ts DOCUMENT_REFUSAL_TEXT, the same words)
  "liveProduct.notExisting": "Only an existing product attached to the Factory can be documented from its code.",
  "liveProduct.notLive": "The product is documented once it is live: no release is recorded yet.",
  "liveProduct.paused": "Resume the project before it is documented.",
  "job.alreadyActive": "This job is already running.",
  "job.notRetryable": "This job can't be retried.",
  "permission.missing": "You don't have permission for this.",
  "auth.required": "Your session ended. Please sign in again.",
};

export function isNotConfigured(e: unknown): boolean {
  return e instanceof FunctionNotConfiguredError;
}

/** True when the mf-project function resolves on the configured host (the local function host needs no Blocks id). */
export function isProjectFunctionConfigured(
  ids: Readonly<Record<FunctionName, string | null>> = FUNCTION_IDS,
  host: FunctionHost = FUNCTION_HOST,
): boolean {
  try {
    resolveFunction("project", ids, host);
    return true;
  } catch {
    return false;
  }
}

export function messageKeyOf(e: unknown): string | null {
  return e instanceof FunctionError && e.messageKey ? e.messageKey : null;
}

function fill(template: string, params: Record<string, unknown> | undefined): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params?.[k];
    if (Array.isArray(v)) return v.map(String).join(", ");
    return v === undefined || v === null ? "" : String(v);
  });
}

export function messageFor(e: unknown): string {
  if (isNotConfigured(e)) return NOT_CONFIGURED_MESSAGE;
  if (isStorageUnavailable(e)) return STORAGE_UNAVAILABLE_MESSAGE;
  if (e instanceof FunctionError) {
    const key = e.messageKey;
    if (key && Object.prototype.hasOwnProperty.call(MESSAGES, key)) return fill(MESSAGES[key], e.params);
    return functionErrorMessage(e.code);
  }
  if (e instanceof BlocksDataError) return e.message;
  return functionErrorMessage("unknown");
}
