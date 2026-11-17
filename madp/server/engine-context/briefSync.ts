// The project brief in the knowledge base on the engine host (<MF_ENGINE_ROOT>/projects/<ws>/<id>/artifacts/brief),
// made from the same Blocks rows every web server builds it from: people's decisions (ProjectAnswer rows, written
// as decisions.json), the project's answers wherever they are recorded and its files (form-answers.json: its fields,
// the Project brief note, the answered brief questions), the drafted objective, and the engine's own readings in sources/
// (written by file.extract on this host). Run before every job (hooks.ts), after each reading (kinds/extract.ts) and in
// the worker's periodic refresh (hooks.ts refreshProjectContext: answers given between jobs), so the engine's context,
// prompts, project-brief tools and the Produced "Project brief" never depend on a folder of a web server.
import type { Row } from "../../functions/_lib/gateway";

export interface BriefSyncInput {
  workspaceId: string;
  projectId: string;
  /** The person the facts are read for (the job's requester). */
  userId: string;
  project: Row;
  rows(schema: string): Row[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Writes decisions.json and brings the brief up to date (brief.json, brief.md, form-answers.json; rebuilt only when an
 *  input changed). True when the brief was rebuilt. Throws on a bad id. */
export async function syncBrief(i: BriefSyncInput): Promise<boolean> {
  const [{ kbKey, factsFromRows }, { ensureBrief }, { writeDecisions, readBrief }, { decisionsFromAnswers, isBriefAnswer }] = await Promise.all([
    import("../api/brief/access.ts"),
    import("../api/brief/builder.ts"),
    import("../api/knowledgeBase.ts"),
    import("../../src/domain/briefDecisions.ts"),
  ]);
  const key = kbKey(i.workspaceId, i.projectId);
  writeDecisions(key, decisionsFromAnswers(i.rows("ProjectAnswer").filter((r) => isBriefAnswer(r.QuestionKey))));
  const files = i.rows("DocFile").filter((f) => ["pending", "ready"].includes(str(f.Status)));
  const notes = i.rows("DocNote").filter((n) => str(n.Title) === "Project brief");
  // the goal and the users where they are recorded since 08.11 (the answers to the business analyst's brief questions)
  // and the drafted objective: once they arrive the inputs change, so the next sync (before a job, or the worker's
  // periodic refresh) rebuilds the brief
  const records = { clarifications: i.rows("Clarification"), objective: i.rows("Objective")[0] ?? null };
  const before = (readBrief(key) as { version?: unknown } | null)?.version;
  return ensureBrief(key, factsFromRows(i.projectId, i.userId, i.project, files, notes, records)).version !== before;
}
