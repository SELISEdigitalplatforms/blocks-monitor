/**
 * The business agent of the Project setup step (src/domain/setupAgent.ts):
 *
 *  project.setup.agent.wake       asks the agent to read what nobody has read yet (the Project setup page sends it when
 *                                 it opens; new material queues the agent by itself as well). Queues one setup.assist
 *                                 job, or answers the active / latest one. Only while the project is being set up.
 *  project.setup.suggestion.decide marks what the agent found as added (after project.setup.save took it), ignored, or
 *                                 open again. The setup details themselves are only ever saved by project.setup.save.
 */
import {
  SETUP_AGENT_KIND, SETUP_SUGGESTION_SCHEMA, inSetup, isSuggestionStatus, materialOf, planAgentRun, readSoFar, shortHash, type SuggestionStatus,
} from "../../../../src/domain/setupAgent";
import { fail, ok, strictArgs, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

const MAX_ROWS = 1000;
const ACTIVE = new Set(["queued", "claimed", "running"]);
const SUGGESTION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Text", "Priority", "ConstraintKind", "SourceName", "SourceRef", "Status", "EngineJobId", "SortOrder",
  "DecidedByUserId", "DecidedAt", "CreatedDate", "LastUpdatedDate",
];
const JOB_FIELDS = ["ItemId", "Kind", "Status", "InputJson", "Progress", "Message", "OutputRefs", "CreatedDate", "FinishedAt"];

export const projectSetupAgentWake: OpDef<{ projectId: string }, any> = {
  op: "project.setup.agent.wake",
  permission: "business.edit",
  scope: "project",
  parse: (args) => strictArgs(args, { projectId: { type: "string", max: 128 } }) as never,
  async run(env) {
    const projectId = env.project!.id;
    if (!inSetup(env.projectRow ?? {})) return ok({ jobId: null, queued: false });
    const [files, notes, jobs] = await Promise.all([
      env.ports.db.query(SCHEMA.file, { [F.file.projectId]: projectId }, { fields: ["ItemId", F.file.status], limit: MAX_ROWS }),
      env.ports.db.query(SCHEMA.note, { [F.note.projectId]: projectId }, { fields: ["ItemId", F.note.title, F.note.bodyMd, F.note.isProjectBrief], limit: MAX_ROWS }),
      env.ports.db.query("EngineJob", { ProjectId: projectId, Kind: SETUP_AGENT_KIND }, { fields: JOB_FIELDS, limit: 200 }),
    ]);
    const active = jobs.find((j) => ACTIVE.has(String(j.Status)));
    if (active) return ok({ jobId: active.ItemId, queued: false });
    const material = materialOf(
      files.map((f) => ({ id: String(f.ItemId), status: String(f[F.file.status] ?? "") })),
      notes.map((n) => ({ id: String(n.ItemId), body: String(n[F.note.bodyMd] ?? ""), title: String(n[F.note.title] ?? ""), isBrief: n[F.note.isProjectBrief] === true })),
    );
    const plan = planAgentRun(material, readSoFar(jobs));
    if (!plan || !env.ports.jobs.create) return ok({ jobId: null, queued: false });
    // a reading that failed or was stopped does not count as read: waking the agent again ("Try again", the page
    // opening) queues a new one. The key names the misses so far, else it would answer the finished job again.
    const misses = jobs.filter((j) => j.Status === "failed" || j.Status === "cancelled").length;
    const job = await env.ports.jobs.create({
      kind: SETUP_AGENT_KIND,
      projectId,
      eventKey: `setup-agent:${shortHash(plan.seen.join(","))}${misses ? `:r${misses}` : ""}`,
      input: { projectId, ...plan },
    });
    return ok({ jobId: job.jobId, queued: !job.existing });
  },
};

export interface DecideArgs {
  projectId: string;
  suggestionIds: string[];
  decision: SuggestionStatus;
}

export const projectSetupSuggestionDecide: OpDef<DecideArgs, any> = {
  op: "project.setup.suggestion.decide",
  permission: "business.edit",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, {
      projectId: { type: "string", max: 128 },
      suggestionIds: { type: "string[]", maxItems: 100, max: 128 },
      decision: { type: "string", max: 20 },
    });
    if (!a.ok) return a as never;
    const v = a.value as Record<string, unknown>;
    if (!isSuggestionStatus(v.decision)) return { ok: false, messageKey: "input.wrongType", params: { key: "decision" } };
    const ids = [...new Set(v.suggestionIds as string[])].filter(Boolean);
    if (ids.length === 0) return { ok: false, messageKey: "input.wrongType", params: { key: "suggestionIds" } };
    return { ok: true, value: { projectId: v.projectId as string, suggestionIds: ids, decision: v.decision } };
  },
  async run(env, args) {
    const projectId = env.project!.id;
    const rows = await env.ports.db.query(SETUP_SUGGESTION_SCHEMA, { ItemId: { in: args.suggestionIds } }, { fields: SUGGESTION_FIELDS, limit: args.suggestionIds.length });
    const mine = rows.filter((r) => r.ProjectId === projectId && r.WorkspaceId === env.workspaceId);
    if (mine.length !== args.suggestionIds.length) return fail("not_found", "setup.suggestionNotFound");
    const changed = await Promise.all(mine.map(async (r) => {
      if (r.Status === args.decision) return r;
      const patch = { Status: args.decision, DecidedByUserId: env.userId, DecidedAt: env.nowIso };
      return { ...r, ...(await env.ports.db.update(SETUP_SUGGESTION_SCHEMA, r.ItemId, env.stampUpdate(patch))) };
    }));
    await env.audit("project.setup.suggestion.decide", SETUP_SUGGESTION_SCHEMA, mine[0]!.ItemId, { decision: args.decision, count: mine.length });
    return ok({ suggestions: changed });
  },
};
