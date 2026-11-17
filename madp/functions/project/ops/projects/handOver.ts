import { canHandOver } from "../../../../src/domain/projects";
import { journeyStep } from "../../../../src/domain/journey";
import { factoryNote } from "../../../../src/domain/factoryNotes";
import { fail, ok, strictArgs, type OpDef } from "./op";
import type { GatewayPort } from "./ports";
import { F, SCHEMA } from "./records";
import { analysisReads, startProjectAnalysis } from "./analysisStart";

/** The two reads of the gate; the prefetch and the run build them the same way, so the run's reads hit the memo. */
function gateReads(ports: { db: Pick<GatewayPort, "query"> }, projectId: string) {
  return Promise.all([
    ports.db.query(SCHEMA.note, { [F.note.projectId]: projectId, [F.note.bodyMd]: { ne: "" } }, { fields: ["ItemId"], limit: 1 }),
    ports.db.query(SCHEMA.file, { [F.file.projectId]: projectId, [F.file.status]: "ready" }, { fields: ["ItemId"], limit: 1 }),
  ]);
}

export const businessHandOver: OpDef<{ projectId: string }, any> = {
  op: "business.handOver",
  permission: "business.edit",
  scope: "project",
  parse(args) {
    const a = strictArgs(args, { projectId: { type: "string" } });
    if (!a.ok) return a;
    return { ok: true, value: { projectId: a.value.projectId as string } };
  },
  prefetch: (env, { projectId }) => Promise.all([gateReads(env.ports, projectId), analysisReads(env.ports as never, projectId)]),
  async run(env, { projectId }) {
    if (env.project!.step !== "business") return fail("conflict", "business.alreadyHandedOver");
    const j = journeyStep({ step: "business", scopeLocked: false }, "business.handOver", {
      kind: "user",
      permissions: env.permissions,
    });
    if (!j.ok) return fail("forbidden", "business.notAllowed");
    const [notes, files] = await gateReads(env.ports, projectId);
    if (!canHandOver({ notesWithText: notes.length, readyFiles: files.length })) return fail("invalid_input", "business.empty");
    // An existing product's repository is optional: without one, the analysis reads the shared material (and the website).
    const project = await env.ports.db.update(
      SCHEMA.project,
      projectId,
      env.stampUpdate({
        [F.project.stage]: "sanitization",
        [F.project.handedOverAt]: env.nowIso,
        [F.project.handedOverByUserId]: env.userId,
      }),
    );
    await env.audit("business.handOver", SCHEMA.project, projectId, { stage: "sanitization" });
    await env.ports.notify.send({
      workspaceId: env.workspaceId,
      ...factoryNote("business.handed-over", { projectId, discriminator: "v1", withActor: true, params: { projectName: env.project?.name ?? "" } }),
    });
    // The analysis starts by itself: the product manager's reading and questions, and the technical reading.
    const analysis = await startProjectAnalysis(env, projectId);
    return ok({ project, ...(analysis ? { analysis } : {}) });
  },
};
