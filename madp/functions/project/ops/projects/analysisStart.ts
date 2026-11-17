/**
 * The project analysis starts by itself at the hand-over (business.handOver): the product manager reads the material
 * and writes the questions (sanitization.assist, focus "clarifications"), and reads the code or the technical setting
 * (focus "technical"). Nobody has to ask for it on the next step.
 *
 * Both are sanitization.assist jobs, and an engine job is unique per kind and target while it is active. The questions
 * keep the step's own target (the project as a whole, as "Ask for more questions" does); the technical reading targets
 * the Project record, so the two run side by side. The job input is the record ids the engine reads, as the
 * sanitization ops build it (sanitization/jobs.ts).
 */
import { buildAssistInput, type JobRefs } from "../sanitization/jobs";
import type { OpEnv } from "./op";
import { F, SCHEMA } from "./records";

const MAX_REFS = 1000;

/** The reads of the start (the hand-over's prefetch makes the same calls). */
export function analysisReads(ports: OpEnv["ports"], projectId: string) {
  return Promise.all([
    ports.db.query(SCHEMA.note, { [F.note.projectId]: projectId, [F.note.bodyMd]: { ne: "" } }, { fields: ["ItemId"], limit: MAX_REFS }),
    ports.db.query(SCHEMA.file, { [F.file.projectId]: projectId, [F.file.status]: "ready" }, { fields: ["ItemId"], limit: MAX_REFS }),
  ]);
}

export function analysisRefs(notes: readonly { ItemId?: unknown }[], files: readonly { ItemId?: unknown }[]): JobRefs {
  const ids = (rows: readonly { ItemId?: unknown }[]) => rows.map((r) => String(r.ItemId ?? "")).filter(Boolean).sort();
  return { docNoteIds: ids(notes), docFileIds: ids(files), clarificationIds: [], decisionIds: [], techDecisionIds: [], requirementIds: [] };
}

export interface AnalysisStarted {
  questionsJobId: string;
  technicalJobId: string;
}

/** Queues the two readings; null when this host cannot queue jobs or the queueing failed. The hand-over has happened
 *  by then, so a failure here does not undo it: the step offers "Start reading" for a project without a reading. */
export async function startProjectAnalysis(env: OpEnv, projectId: string): Promise<AnalysisStarted | null> {
  try {
    return await queueReadings(env, projectId);
  } catch {
    return null;
  }
}

async function queueReadings(env: OpEnv, projectId: string): Promise<AnalysisStarted | null> {
  const create = env.ports.jobs.create;
  if (!create) return null;
  const [notes, files] = await analysisReads(env.ports, projectId);
  const refs = analysisRefs(notes, files);
  // The job's RequestKey comes from its event key, which is unique across all projects: this project and this
  // hand-over (its time is the stored HandedOverAt), so a second project's start never answers the first one's jobs.
  const key = `analysis:${projectId}:${env.nowIso}`;
  const [questions, technical] = await Promise.all([
    create({
      kind: "sanitization.assist", projectId, eventKey: `${key}:clarifications`,
      input: buildAssistInput(projectId, "clarifications", undefined, undefined, refs),
    }),
    create({
      kind: "sanitization.assist", projectId, eventKey: `${key}:technical`, targetType: "project", targetId: projectId,
      input: buildAssistInput(projectId, "technical", undefined, undefined, refs),
    }),
  ]);
  await env.audit("analysis.start", SCHEMA.project, projectId, { jobs: [questions.jobId, technical.jobId] });
  return { questionsJobId: questions.jobId, technicalJobId: technical.jobId };
}
