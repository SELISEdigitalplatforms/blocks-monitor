// The business agent of the Project setup step (setup.assist): reads the files and notes people just shared, files the
// documents into folders by kind (setup/file.ts), writes down what it found as suggestions people review
// (SetupSuggestion rows, setup/extract.ts) and, when nobody is named yet, makes the person who started the project the
// one who approves the result. Queued by setupWatch.ts (and project.setup.agent.wake) when material changes.
//
// Restart safe: a run that starts again repeats its steps; folders are found by name, moves are plain updates and a
// suggestion's RequestKey is the project's own (the same finding is one row, whatever run or copy of a document found it).
import { capKey } from "../../../../functions/_lib/ids";
import type { Row } from "../../../../functions/_lib/gateway";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { NOTE_BODY_MAX } from "../../../../src/domain/docs";
import { briefFactsOf } from "../../../../src/domain/projectBrief";
import {
  BRIEF_NOTE_TITLE, SETUP_FIELD, approvalOwnerFromRow, briefSectionBodies, detailsFromRow, refreshBriefSections,
} from "../../../../src/domain/setupDetails";
import { SETUP_SUGGESTION_SCHEMA, doneLine, suggestionKey, workingLine } from "../../../../src/domain/setupAgent";
import type { JobRun, KindResult, KindWriter } from "../run.ts";
import { str, strs, type ProjectView } from "../context.ts";
import { extractFindings, type ExtractContext, type SourceDoc } from "./setup/extract.ts";
import { fileDocuments, fileKindOf, planFiling } from "./setup/file.ts";
import { readDocument } from "./setup/read.ts";
import { early } from "../ai/index.ts";
import { aiFindings } from "./setup/ai.ts";

const progressOf = (i: number, n: number, from: number, to: number): number => from + Math.round(((to - from) * i) / Math.max(1, n));

/** The person who approves the result when nobody is named: the person who started the project, else who asked. */
async function defaultApprover(run: JobRun): Promise<string | null> {
  const p = run.p.project;
  if (approvalOwnerFromRow(p)) return null;
  const members = run.p.members();
  const who = members.find((m) => m.userId === str(p.CreatedByUserId)) ?? members.find((m) => m.userId === run.requester);
  if (!who) return null;
  await run.update("Project", run.projectId, { [SETUP_FIELD.approvalOwnerUserId]: who.userId, UpdatedByUserId: run.requester });
  const brief = run.p.rows("DocNote").find((n) => n.IsProjectBrief === true) ?? run.p.rows("DocNote").find((n) => str(n.Title) === BRIEF_NOTE_TITLE && n.IsScratchPad !== true);
  if (brief) {
    const before = str(brief.BodyMd);
    const after = refreshBriefSections(before, briefSectionBodies({}, { name: who.name || run.p.personName(who.userId) }));
    if (after !== before && after.length <= NOTE_BODY_MAX) await run.update("DocNote", str(brief.ItemId), { BodyMd: after, UpdatedByUserId: run.requester });
  }
  return who.userId;
}

/** What the project already says, which the findings leave out: the goal and the users wherever they are recorded (the
 *  project's own fields, else the business analyst's answers; briefFactsOf) and the setup windows. */
export function findingsContextOf(p: ProjectView): ExtractContext {
  const about = briefFactsOf(p);
  return { productName: p.name, goal: about.goal, users: about.targetUsers, details: detailsFromRow(p.project) };
}

export const setupAssist: KindWriter = async (run: JobRun): Promise<KindResult> => {
  const files = strs(run.input.fileIds).map((id) => run.p.row("DocFile", id)).filter((f): f is Row => Boolean(f) && f!.Status === "ready" && f!.IsDeleted !== true);
  const notes = strs(run.input.noteIds).map((id) => run.p.row("DocNote", id)).filter((n): n is Row => Boolean(n) && n!.IsDeleted !== true);
  const total = files.length + notes.length;
  await run.step(3, workingLine(files.length, notes.length));
  await run.wait(1.4);

  // 1. reading, one document after the other
  const docs: SourceDoc[] = [];
  const texts = new Map<string, string>();
  for (const [i, f] of files.entries()) {
    const name = str(f.Name);
    await run.step(progressOf(i, total, 6, 54), `Reading ${name}…`);
    const bytes = await run.readFile(str(f.StorageObjectId));
    const read = readDocument(name, str(f.Mime), bytes);
    texts.set(str(f.ItemId), read.text);
    docs.push({ ref: `DocFile:${str(f.ItemId)}`, name, read });
    await run.wait(read.type === "none" ? 0.7 : 1.1 + Math.min(1.6, read.text.length / 4000));
  }
  for (const [i, n] of notes.entries()) {
    const name = str(n.Title) || "a note";
    await run.step(progressOf(files.length + i, total, 6, 54), `Reading ${name}…`);
    docs.push({ ref: `DocNote:${str(n.ItemId)}`, name, read: { type: "markdown", text: str(n.BodyMd) } });
    await run.wait(1 + Math.min(1.4, str(n.BodyMd).length / 4000));
  }

  // what it found: the built-in reading, and Claude's (started now, read after the filing)
  const ctx = findingsContextOf(run.p);
  const builtIn = extractFindings(docs, ctx);
  const fromAi = early(aiFindings(run, docs, ctx, builtIn.length));

  // 2. filing
  await run.step(56, files.length ? "Sorting the documents into folders…" : "Comparing with your project setup…");
  const plan = planFiling(files, run.p.rows("DocFolder"), (f) => fileKindOf(f, texts.get(str(f.ItemId)) ?? ""));
  const filing = await fileDocuments(run, plan, (i, n) => run.step(progressOf(i, n, 58, 74), "Sorting the documents into folders…"));

  // 3. what it found, as suggestions people review
  await run.step(76, "Writing down what it found…");
  const findings = (await fromAi) ?? builtIn;
  await run.wait(1.2);
  const outputs = [...filing.outputs];
  const existing = run.p.rows(SETUP_SUGGESTION_SCHEMA);
  let order = existing.reduce((m, r) => Math.max(m, typeof r.SortOrder === "number" ? r.SortOrder : 0), 0);
  const fresh: { kind: string; sourceName: string }[] = [];
  for (const [i, f] of findings.entries()) {
    const key = suggestionKey(f.kind, f.text);
    const before = existing.find((r) => r.Key === key);
    if (before) continue; // found before: it keeps what a person decided
    order += 1;
    const id = await run.insert(SETUP_SUGGESTION_SCHEMA, {
      Kind: f.kind,
      Text: f.text,
      Priority: f.priority,
      ConstraintKind: f.constraintKind,
      SourceName: f.sourceName,
      SourceRef: f.sourceRef,
      Status: "open",
      EngineJobId: run.id,
      Key: key,
      SortOrder: order,
    }, `suggestion:${i}`, { requestKey: capKey(`setup-suggestion:${run.projectId}:${key}`) });
    outputs.push(`${SETUP_SUGGESTION_SCHEMA}:${id}`);
    fresh.push({ kind: f.kind, sourceName: f.sourceName });
    await run.step(progressOf(i + 1, findings.length, 78, 94));
    await run.wait(0.35);
  }

  // 4. who approves the result, when nobody is named yet
  const approver = await defaultApprover(run);
  if (approver) outputs.push(`Project:${run.projectId}`);

  await run.step(97, "Done reading.");
  const open = run.p.rows(SETUP_SUGGESTION_SCHEMA).filter((r) => r.Status === "open").map((r) => ({ kind: str(r.Kind) as never, sourceName: str(r.SourceName) }));
  return { outputs, message: doneLine({ filed: filing.filed, folders: filing.folders }, open.length ? open : fresh as never) };
};

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "setup.assist": setupAssist,
};
