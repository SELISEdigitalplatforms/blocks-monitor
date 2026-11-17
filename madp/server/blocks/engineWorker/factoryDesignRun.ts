import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { bootstrapService, runImportJob } from "./privateMakeImport";
import { ProjectView } from "../../local/engine/context";
import { workerHostId } from "./worker";
import { designIntentOf, factoryDesignSource, parseProductPrototype } from "../../../src/domain/factoryDesign";
import { makeRecoveryClaim } from "./makeRecovery";

/** Operator smoke run uses the same driver/writer, already claimed to avoid the outdated worker's queue race. */
export async function runFactoryRevision(o: { root: string; env: Record<string, string | undefined>; projectId: string; approved: boolean; feedback: string; workflow?: 'screens' | 'factory' }) {
  const service = await bootstrapService(o), p = new ProjectView(service.store, o.projectId), brief = p.designBrief();
  if (!brief || p.project.Stage !== "requirements") throw new Error("An open requirements step and design brief are required.");
  const previous = parseProductPrototype(brief.PrototypeJson);
  const intent = designIntentOf(p), source = factoryDesignSource(intent);
  const workflow = o.workflow ?? 'factory';
  const summary = { projectId: o.projectId, workflow, source, previousRevision: previous?.revision ?? null, publicPublishing: false, figmaWrites: workflow === 'screens' };
  if (!o.approved) return { dryRun: true, ...summary };
  if (p.rows("EngineJob").some((j) => j.Kind === "design.generate" && ["queued", "claimed", "running"].includes(String(j.Status)))) throw new Error("A design job is already active.");
  const checkpoint = path.join(o.root, "data", "local-planner", workflow === 'screens' ? 'figma-screens.json' : "factory-design.json");
  const claim = workerHostId(), actor = String(p.project.CreatedByUserId ?? "");
  let jobId: string;
  if (fs.existsSync(checkpoint)) {
    const recorded = JSON.parse(fs.readFileSync(checkpoint, "utf8"));
    const job = service.store.get("EngineJob", recorded.jobId);
    if (recorded.projectId !== o.projectId || !job || job.Status !== "failed" || job.ClaimedBy !== claim) throw new Error("This operator run is already recorded; use the design UI for a new revision.");
    jobId = recorded.jobId;
    await service.raw.update("EngineJob", jobId, makeRecoveryClaim(String(brief.ItemId), new Date()));
  } else {
    const row = await service.raw.insert("EngineJob", { ProjectId: o.projectId, WorkspaceId: p.workspaceId, ReaderIds: p.project.ReaderIds ?? [],
      Kind: "design.generate", Status: "claimed", Attempts: 1, Progress: 0, ClaimedBy: claim, ClaimedAt: new Date().toISOString(),
      ActiveKey: `design.generate:${String(brief.ItemId)}`, TargetType: "design-brief", TargetId: brief.ItemId, RequestedByUserId: actor, CreatedByUserId: actor, UpdatedByUserId: actor,
      RequestKey: `factory-design:${randomUUID()}`, InputJson: JSON.stringify({ ...summary, designBriefId: brief.ItemId, intent, feedback: o.feedback,
        requirementKeys: intent.requirements.map((r) => r.key), requestType: previous ? "design-change" : "initial-design" }) });
    if (!row.created || !row.itemId) throw new Error("Factory design job was not uniquely created.");
    jobId = row.itemId; fs.writeFileSync(checkpoint, JSON.stringify({ ...summary, jobId, state: "claimed" }, null, 2));
    await service.raw.update("DesignBrief", String(brief.ItemId), { Mode: "figma", Status: "draft" });
  }
  return runImportJob({ service, projectId: o.projectId, jobId, workspaceId: p.workspaceId, checkpoint, claim, summary });
}
