// project.documentExisting: queues product.document, the engine's documentation of a live product from its own code and
// documents (server/local/engine/kinds/document.ts, src/domain/liveProduct.ts). Only an existing product (RepoMode
// "existing") that is live (a released Release row) can be documented, by a person who may edit the business context.
// Re-runnable to refresh: a repeat while one is queued or running answers that job and writes nothing. The op writes no
// content itself; the engine writes the records (Origin "live-product") and checks on the engine host that the product
// is attached there (factory.json existing: true).
import { DOCUMENT_JOB_KIND, DOCUMENT_OP, documentRefusal } from "../../../../src/domain/liveProduct";
import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row, ScopedGateway } from "../../../_lib";
import { activeKeyOf } from "../../../_lib/jobs";

const PROJECT_FIELDS = ["ItemId", "Status", "RepoMode", "Stage"] as const;
const RELEASE_FIELDS = ["ItemId", "Status"] as const;
const JOB_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId",
  "Progress", "Message", "Attempts", "FinishedAt", "RequestedByUserId",
] as const;

const rowsOf = (res: { items?: unknown } | null | undefined): Row[] => (Array.isArray(res?.items) ? (res!.items as Row[]) : []);

/** The project's latest released Release (one row is enough to know it is live). */
function released(gw: ScopedGateway, projectId: string): Promise<Row[]> {
  return gw
    .find("Release", { where: f.and(f.eq("ProjectId", projectId), f.eq("Status", "released")), fields: RELEASE_FIELDS, page: 1, pageSize: 1 })
    .then(rowsOf);
}

/** The queued or running documentation of the project. */
function activeJob(gw: ScopedGateway, projectId: string): Promise<Row[]> {
  return gw
    .find("EngineJob", { where: f.and(f.eq("ProjectId", projectId), f.eq("ActiveKey", activeKeyOf(DOCUMENT_JOB_KIND))), fields: JOB_FIELDS, page: 1, pageSize: 1 })
    .then(rowsOf);
}

async function projectRow(ctx: OpCtx, deps: OpDeps, projectId: string): Promise<Row> {
  const have = ctx.project !== null && PROJECT_FIELDS.every((k) => k in (ctx.project as Row));
  return have ? (ctx.project as Row) : deps.refs.project(projectId, PROJECT_FIELDS);
}

export const DOCUMENT_EXISTING_OPS = [
  defineOp({
    op: DOCUMENT_OP,
    kind: "command",
    scope: "project",
    permission: "business.edit",
    args: v.object({ projectId: v.id() }),
    prefetch: (p) => (p.gw ? Promise.all([released(p.gw, p.args.projectId), activeJob(p.gw, p.args.projectId)]).then(() => undefined, () => undefined) : undefined),
    async handler(ctx, args, deps) {
      const [project, releases, active] = await Promise.all([projectRow(ctx, deps, args.projectId), released(deps.gw, args.projectId), activeJob(deps.gw, args.projectId)]);
      const refusal = documentRefusal(project, releases);
      if (refusal === "notFound") return deps.fail("not_found");
      if (refusal) return deps.fail("conflict", `liveProduct.${refusal}`);
      if (active[0]) return { jobId: String(active[0].ItemId), existing: true, job: active[0] };
      const made = await deps.jobs.create({ kind: DOCUMENT_JOB_KIND, projectId: args.projectId, input: { projectId: args.projectId } });
      if (!made.existing) deps.audit({ targetType: "engine-job", targetId: String(made.job.ItemId), details: { kind: DOCUMENT_JOB_KIND } });
      return { jobId: String(made.job.ItemId), existing: made.existing, job: made.job };
    },
  }),
];
