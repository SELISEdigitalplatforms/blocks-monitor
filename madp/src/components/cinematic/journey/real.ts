/** The office's real operations: the same ops the guided start and Project setup use, called from the visit.
 *  - project.create: the name and the idea in the person's own words, the code kept in MADP Factory (as the guided
 *    start's "new product" with its default code home);
 *  - project.setup: who it is for and the goal (the guided start's answers; it rewrites the "Project brief" note);
 *  - doc.note.save: the website, as a "Website" note in the project's material (the ops keep WebsiteUrl for existing
 *    products only, so a new idea's website lives in its material, where the business agent and the analysis read it);
 *  - doc.folder.create + the upload pipeline (check → presign → upload → commit) into "Client documents", exactly as
 *    the Share window of Project setup does it;
 *  - project.setup.agent.wake: the business agent reads what was shared (an EngineJob of kind setup.assist);
 *  - project.update: a new private GitHub repository, only when the person really connected GitHub.
 *  No React here: the visit's store calls these with the workspace the page runs in. */
export { createArgsFor, startAnswersOf, websiteLabel, websiteNoteBody, websiteOf, WEBSITE_NOTE_TITLE, type RealAnswers } from "./realAnswers";
import { toSetupArgs } from "@/domain/guidedStart";
import { createArgsFor, startAnswersOf, websiteNoteBody, WEBSITE_NOTE_TITLE, type RealAnswers } from "./realAnswers";
import { checkProjectName } from "@/domain/projects";
import { NEW_REPO_BRANCH, repoSlug } from "@/domain/projectType";
import { FunctionError } from "@/blocks/fn";
import { callProjectOp, putRows } from "@/blocks/projects/mutations";
import { messageFor } from "@/blocks/projects/messages";
import { SCHEMA, type RawRow } from "@/blocks/projects/records";
import { cacheRow } from "@/blocks/projects/docMutations";
import type { DocRow } from "@/blocks/projects/docReads";
import { uploadDocFile, type UploadPhase } from "@/blocks/projects/upload";
import { CLIENT_DOCS_FOLDER } from "@/components/setup/shareModel";
import { wakeSetupAgent } from "@/components/setup/agent/data";

/** A typed project name, or the reason it can't be one (the server's own check and words). */
export function nameProblem(raw: string): string | null {
  const c = checkProjectName(raw);
  return c.ok ? null : messageFor(new FunctionError("invalid_input", "", "", c.messageKey, c.params));
}

export async function createProject(ws: string, a: RealAnswers, requestId: string): Promise<string> {
  const data = await callProjectOp<{ project: RawRow; scratchNote?: RawRow | null; briefNote?: RawRow | null }>(
    "project.create",
    { ...createArgsFor(a), workspaceId: ws },
    { requestId },
  );
  putRows(ws, SCHEMA.project, [data.project]);
  if (data.scratchNote) putRows(ws, SCHEMA.note, [data.scratchNote]);
  if (data.briefNote) putRows(ws, SCHEMA.note, [data.briefNote]);
  return String(data.project.ItemId);
}

/** Who it is for and the goal, saved as the guided start saves edited answers (the brief note follows). */
export async function saveAnswers(ws: string, projectId: string, a: RealAnswers): Promise<void> {
  const data = await callProjectOp<{ project: RawRow; briefNote?: RawRow }>("project.setup", { ...toSetupArgs(projectId, startAnswersOf(a), a.name.trim()) });
  putRows(ws, SCHEMA.project, [data.project]);
  if (data.briefNote) putRows(ws, SCHEMA.note, [data.briefNote]);
}

/** The website note (doc.note.save, keyed by the attempt's requestId, so a retry never adds a second note). */
export async function saveWebsite(ws: string, projectId: string, url: string, requestId: string): Promise<void> {
  const data = await callProjectOp<{ note: DocRow }>(
    "doc.note.save",
    { projectId, folderId: "", title: WEBSITE_NOTE_TITLE, bodyMd: websiteNoteBody(url) },
    { requestId },
  );
  cacheRow(ws, projectId, SCHEMA.note, data.note);
}

/** The "Client documents" folder the Share window files into (the visit's project is new, so it is created once). */
export async function clientDocsFolder(ws: string, projectId: string, requestId: string): Promise<string> {
  const data = await callProjectOp<{ folder: DocRow }>(
    "doc.folder.create",
    { projectId, parentId: "", name: CLIENT_DOCS_FOLDER, kind: "other" },
    { requestId },
  );
  cacheRow(ws, projectId, SCHEMA.folder, data.folder);
  return String(data.folder.ItemId);
}

/** One file through the Share window's pipeline; answers null when filed, else why not. */
export async function uploadFile(
  ws: string,
  input: { projectId: string; folderId: string; file: File; usedBytes: number; fileCount: number },
  onPhase: (phase: UploadPhase) => void,
): Promise<string | null> {
  const out = await uploadDocFile(input, { onPhase });
  if (out.ok) {
    cacheRow(ws, input.projectId, SCHEMA.file, out.row);
    return null;
  }
  return out.message;
}

/** The business agent reads what nobody has read yet; true when a reading is queued or running. */
export async function wakeAgent(ws: string, projectId: string): Promise<boolean> {
  try {
    await wakeSetupAgent(ws, projectId);
    return true;
  } catch {
    return false;
  }
}

/** A new private repository in the GitHub account the person really connected (created when the build starts). */
export async function connectNewRepo(ws: string, projectId: string, login: string, name: string): Promise<string> {
  const repoName = repoSlug(name);
  const data = await callProjectOp<{ project: RawRow }>("project.update", { projectId, repoOwner: login, repoName, repoVisibility: "private", repoBranch: NEW_REPO_BRANCH });
  if (data?.project) putRows(ws, SCHEMA.project, [data.project]);
  return `${login}/${repoName}`;
}
