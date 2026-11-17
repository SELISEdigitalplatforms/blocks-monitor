// change.analyse: the analysis of a submitted change request (engine-host/CHANGE-PROCESS-31.10.md). cr.submit queues it
// with { projectId, changeRequestId } (the request "analysing"); cr.answer queues it again with { refine: true } once
// every question is answered (the request stays "questions"). Claude reads the project's material and context digest,
// its facts, the locked scope (features, stories, milestones), the screens and the request, and answers the Analysis
// JSON (kinds/changes/ai.ts, src/domain/changeAnalysis.ts). The writer stores Analysis and AnalysedAt and moves the
// request to "questions" (a question is open) or "review" (waiting for approval).
//
// There is no built-in analysis: an answer that is missing or unusable after one retry sets the request "failed" and
// fails the job with a plain message; cr.submit may try again.
//
// A product on the official MADP engine whose registry and repositories are on this host (<project folder>/madp, see
// official/app.ts) is analysed against its code as well: the ask carries its repositories, the owner's standing rules
// and a FILE MAP (official/fileMap.ts), and the analysis names the files and folders it expects to touch (codeAreas).
// Reading the code is read-only (git ls-files and line counts); a product without it is analysed exactly as before.
//
// A product without a Factory scope (an existing product attached as it is live) is analysed against what it does today,
// and a new feature on it is planned as a feature delivery (route "feature": tickets in increments, the parts it changes,
// its code areas and risks) that builds on approval, increment by increment (kinds/delivery.ts change.build).
import path from "node:path";
import { parseChangeAnalysis, serializeChangeAnalysis, statusAfterAnalysis, type ChangeAnalysis } from "../../../../src/domain/changeAnalysis";
import { changeCode } from "../../../../src/domain/delivery";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { num, str } from "../context.ts";
import { JobFailure, JobGone, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { aiEnabled, aiJson } from "../ai/index.ts";
import { projectMaterial } from "../ai/material.ts";
import { contextOf } from "../../../engine-context/hooks.ts";
import { acceptAnalysis, analysisPrompt, analysisSchema, changeNames, hasFactoryScope, questionSlots } from "./changes/ai.ts";
import { ATTACHMENT_OWNERS, attachmentRows, attachmentsOf, type AttachedFile } from "../ai/attachments.ts";
import { groupedFiles, oneLine, questionIdOf, type FileGroup } from "../ai/attachedGroups.ts";
import { appDir, appName } from "../official/app.ts";
import { refreshStreamsAdvice } from "../official/streamsAdvice.ts";
import { productCode, type ProductCode } from "../official/fileMap.ts";

/** The product's code on this host (its official-engine registry and the repositories it names), or null when the
 *  product has none here. Never fails the analysis. */
export async function codeOfProduct(run: JobRun): Promise<ProductCode | null> {
  try {
    return await productCode(appDir(run), { name: appName(run.p.name, run.projectId) });
  } catch {
    return null;
  }
}

/** Statuses an analysis may be written in; any other (approved, rejected, building, released) was decided already. */
const OPEN = new Set(["draft", "analysing", "questions", "review", "failed"]);

/** The files of a change request by what they belong to: the request itself, or the answer to one of the analysis's
 *  questions (Attachment.Meta {"questionId"}; an id the analysis does not have counts as the request) (pure). */
export function changeFileGroups(files: readonly AttachedFile[], questionOf: ReadonlyMap<string, string>, analysis: ChangeAnalysis | null): FileGroup[] {
  const questions = analysis?.questions ?? [];
  const known = new Set(questions.map((q) => q.id));
  const qid = (f: AttachedFile) => {
    const id = questionOf.get(f.id) ?? "";
    return known.has(id) ? id : "";
  };
  return [
    { where: "With the change request itself", files: files.filter((f) => !qid(f)) },
    ...questions.map((q) => ({
      where: `With the answer to the question "${oneLine(q.text, 160)}"${q.answer ? ` (they answered "${oneLine(q.answer, 120)}")` : ""}`,
      files: files.filter((f) => qid(f) === q.id),
    })),
  ];
}

export const ANALYSIS_FAILED = "The change analysis could not be finished. Try again in a moment.";

async function changeAnalyse(run: JobRun): Promise<KindResult> {
  const crId = str(run.input.changeRequestId);
  const cr = run.p.row("ChangeRequest", crId);
  if (!cr) throw new JobFailure("This change request no longer exists.", "change.missing");
  const code = changeCode({ lane: str(cr.Lane), number: num(cr.Number, 1) || 1 });
  const status = str(cr.Status);
  if (!OPEN.has(status)) return { outputs: [`ChangeRequest:${crId}`], message: `${code} was already decided; its analysis stays as it was.` };
  const refine = run.input.refine === true;
  const prior = parseChangeAnalysis(cr.Analysis);

  const fail = async (message: string, why: string): Promise<never> => {
    run.log(`change.analyse ${code}: failed (${why})`);
    try {
      await run.update("ChangeRequest", crId, { Status: "failed" });
    } catch (e) {
      if (e instanceof JobGone) throw e;
    }
    throw new JobFailure(message, "change.analysis");
  };

  try {
    await run.step(5, refine ? `Updating the analysis of ${code} with the answers.` : `Analysing ${code}: ${str(cr.Title) || "the change"}.`);
    if (!aiEnabled()) return await fail("The change analysis needs Claude, which is switched off on this engine.", "AI off");
    const ctx = await contextOf(run);
    const material = await projectMaterial(run, { budget: 5000, contextBudget: 3000 });
    await run.step(20, `Reading the scope, screens and earlier decisions for ${code}.`);
    const names = changeNames(run.p);
    // no locked scope (an existing product attached as it is live): a new feature is built on the product as it is
    const existing = !hasFactoryScope(run.p);
    const slots = questionSlots(refine ? prior : null);
    const priorForAsk = refine ? prior : null;
    // the files attached to the request (pictures are shown to Claude, documents quoted)
    const files = await attachmentsOf(run, ATTACHMENT_OWNERS.changeRequest, [crId]);
    const metaQuestion = new Map(attachmentRows(run, ATTACHMENT_OWNERS.changeRequest, [crId]).map((a) => [str(a.ItemId), questionIdOf(a.Meta)] as const));
    const attached = groupedFiles(changeFileGroups(files, metaQuestion, prior), "Files the person attached to the change request (part of what they asked, read them closely)");
    const filesText = attached.block;
    // the product's code, when its repositories are on this host (read-only)
    const source = await codeOfProduct(run);
    if (source) {
      await run.step(30, `Analysing ${code} against the product's code (${source.repos.length === 1 ? "1 repository" : `${source.repos.length} repositories`}).`);
      run.log(`change.analyse ${code}: the product's code: ${source.repos.map((r) => `${r.key} ${r.entries ? `${r.entries.length} files` : "not listed"}`).join(", ")}; file map ${source.map.length} characters`);
    }
    const analysis = await aiJson<ChangeAnalysis>(run, {
      task: refine ? "change analysis (answers)" : "change analysis",
      role: existing
        ? `You are the product manager of ${run.p.name}, an existing product that is live: you analyse every change request before the team builds it, against what the product does today${source ? " (its code)" : ""} and what the client told us, and you plan a new feature as increments built on the existing product.`
        : `You are the product manager of ${run.p.name}: you analyse every change request before the team builds it, against the locked scope${source ? ", the product's code" : ""} and what the client told us.`,
      prompt: `${analysisPrompt({ p: run.p, cr, material: material.text, prior: priorForAsk, refine, code: source, existing })}${filesText ? `\n\n${filesText}` : ""}`,
      ...(attached.images.length ? { images: attached.images } : {}),
      schema: analysisSchema(names, slots, source, existing),
      accept: (raw) => acceptAnalysis(raw, { names, prior: priorForAsk, contextVersion: ctx.version, code: source, existing }),
      timeoutMs: source ? (existing ? 240_000 : 180_000) : 120_000,
      // its own failure path (below) puts the change request back and says so; nothing built in is written
      orNull: true,
    });
    if (!analysis) return await fail(ANALYSIS_FAILED, "no usable answer after one retry");
    const next = statusAfterAnalysis(analysis);
    await run.step(90, `${code}: analysis ready.`);
    await run.update("ChangeRequest", crId, { Analysis: serializeChangeAnalysis(analysis), AnalysedAt: run.iso(), Status: next });
    run.writeJobFile("analysis.json", analysis);
    // the tech lead's advice for parallel streams from the product's set-up on this host (Project.StreamsAdvice)
    if (source) await refreshStreamsAdvice(run, path.join(appDir(run), `${source.name}.yml`));
    const asks = analysis.questions.filter((q) => q.answer === null).length;
    const message =
      next === "questions"
        ? `${code} analysed: ${asks === 1 ? "1 question" : `${asks} questions`} to answer.`
        : analysis.route === "scope"
          ? `${code} analysed: a new feature, to add through Scope & success.`
          : analysis.route === "feature" && analysis.feature
          ? `${code} analysed: a new feature on the existing product, ${analysis.tickets.length === 1 ? "1 ticket" : `${analysis.tickets.length} tickets`} in ${analysis.feature.increments.length === 1 ? "1 build" : `${analysis.feature.increments.length} builds`}, waiting for approval.`
          : `${code} analysed: ${analysis.tickets.length === 1 ? "1 ticket" : `${analysis.tickets.length} tickets`} planned, waiting for approval.`;
    return { outputs: [`ChangeRequest:${crId}`], message };
  } catch (e) {
    if (e instanceof JobGone || e instanceof JobFailure) throw e;
    return await fail(ANALYSIS_FAILED, (e as Error).message || "error");
  }
}

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "change.analyse": changeAnalyse,
};
