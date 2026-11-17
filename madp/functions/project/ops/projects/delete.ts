import { PROJECT_CASCADE, PROJECT_FILE_FIELDS } from "../../../../src/domain/projects";
import { runCascade, type CascadeStep } from "./cascade";
import { ok, strictArgs, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

const BUDGET_MS = 20_000;
const CONCURRENCY = 5;

const cascadeSteps = (projectId: string): CascadeStep[] =>
  PROJECT_CASCADE.filter((s) => s !== SCHEMA.project).map((schema) => ({
    schema,
    filter: { ProjectId: projectId },
    fileFields: PROJECT_FILE_FIELDS[schema],
  }));

export const projectDelete: OpDef<{ projectId: string }, any> = {
  op: "project.delete",
  permission: "project.delete",
  scope: "project",
  allowDeleting: true,
  // Resumable and idempotent (a repeat finds fewer rows): the router has no Operation record left to write after the last round.
  record: () => false,
  parse(args) {
    const a = strictArgs(args, { projectId: { type: "string" } });
    if (!a.ok) return a;
    return { ok: true, value: { projectId: a.value.projectId as string } };
  },
  async run(env, { projectId }) {
    const { ports } = env;
    // Bound to the router: ONE write. The Project goes to 'deleting' (every other op answers not_found, every list drops
    // it) and the durable background purge (_lib/purge.ts, woken by bind.ts; its worker runs on every host) runs the
    // cascade: jobs, Storage objects, child rows (PROJECT_PURGE_SCHEMAS, notifications included), audit, and the Project
    // row last. A repeat on a 'deleting' project writes nothing.
    // `done: true` means nothing more for the caller to do (old callers that loop until done still work).
    if (ports.oneRoundPerCall) {
      if (env.project?.status !== "deleting") {
        await ports.db.update(SCHEMA.project, projectId, env.stampUpdate({ [F.project.status]: "deleting" }));
      }
      return ok({ done: true, remaining: 0, deleted: {}, queued: true });
    }
    // Status first, so every other op answers not_found from now on.
    if (env.project?.status !== "deleting") {
      await ports.db.update(SCHEMA.project, projectId, env.stampUpdate({ [F.project.status]: "deleting" }));
    }
    // The engine must write nothing into a project being deleted.
    await ports.jobs.cancelActive(projectId, "system");
    const res = await runCascade(ports, cascadeSteps(projectId), { budgetMs: BUDGET_MS, concurrency: CONCURRENCY });
    if (!res.done) return ok({ done: false, remaining: res.remaining, deleted: res.deleted });
    await ports.files.removeProjectDirectory(env.workspaceId, projectId);
    await ports.db.remove(SCHEMA.project, projectId);
    await env.audit("project.delete", SCHEMA.project, projectId, { deleted: res.deleted });
    return ok({ done: true, remaining: 0, deleted: res.deleted });
  },
};
