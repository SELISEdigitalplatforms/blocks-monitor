// One operator-approved live Make import and its operator-directed recovery, using the existing engine driver and
// writer on this host. No general queue consumer and no second worker: the design.generate writer stays the only path.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { serviceClient, serviceTokens } from "../../../functions/_lib/serviceToken";
import { createRawGateway, type RawGateway, type Row } from "../../../functions/_lib/gateway";
import { defaultSdk } from "../../../functions/_lib/sdk";
import { createFiles } from "../../../functions/_lib/storage";
import { createGatewayStore, loadCatalog } from "./store.ts";
import { workerHostId } from "./worker.ts";
import { archiveMakeAttempt, makeRecoveryClaim, recordMakeRecovery } from "./makeRecovery";
import { createEngine } from "../../local/engine/driver.ts";
import { writerOf } from "../../local/engine/kinds/index.ts";
import { ProjectView } from "../../local/engine/context.ts";
import { projectWorkspace } from "../../local/engine/projectFolder.ts";
import { automaticDesignDirection, designSource, parseMakePrototype, rawDesignRequirements } from "../../../src/domain/figmaMake";
import { parseProductPrototype } from "../../../src/domain/factoryDesign";

type Service = { raw: RawGateway; client: ReturnType<typeof serviceClient>; store: ReturnType<typeof createGatewayStore> };

export async function bootstrapService(o: { root: string; env: Record<string, string | undefined>; projectId: string }): Promise<Service> {
  const env = { apiUrl: o.env.VITE_BLOCKS_API_URL!, tenant: o.env.MF_BLOCKS_TENANT!, clientId: o.env.MF_SVC_CLIENT_ID!, clientSecret: o.env.MF_SVC_CLIENT_SECRET! };
  if (!env.apiUrl || !env.tenant || !env.clientId || !env.clientSecret) throw new Error("Server service identity is not configured.");
  const tokens = serviceTokens(env, defaultSdk);
  const client = serviceClient(env, defaultSdk, tokens);
  const raw = createRawGateway({ env, sdk: defaultSdk, tokens, batch: false });
  const catalog = await loadCatalog(o.root, client);
  const store = createGatewayStore({ root: o.root, raw, client, invalidateToken: () => tokens.invalidate(), catalog });
  await store.loadProject(o.projectId);
  return { raw, client, store };
}

/** Runs one known design.generate job to completion on this host, then answers its outcome and records the checkpoint. */
export async function runImportJob(o: { service: Service; projectId: string; jobId: string; workspaceId: string; summary: Record<string, unknown>; checkpoint: string; claim: string }) {
  const { store, client } = o.service;
  await store.loadProject(o.projectId);
  const p = new ProjectView(store, o.projectId);
  const gateway = store.mirrored();
  const files = createFiles({ client, workspaceIdOf: async () => p.workspaceId });
  const engine = createEngine({ store, gateway, config: () => ({ enabled: true, pace: 1, sendBacks: false }),
    writers: writerOf, workerId: o.claim, sweepMs: 0, pickupDelay: false, backgroundProgress: true, waitScale: () => 0,
    acceptsJob: (j) => j.ItemId === o.jobId, canResume: (j) => j.ItemId === o.jobId && j.ClaimedBy === o.claim,
    log: (line) => console.log(`[${o.summary.workflow === "factory" ? "factory-design" : "private-make"}] ${line}`),
    projectFolder: (ws, pid) => projectWorkspace(process.env.MF_ENGINE_ROOT!, ws, pid),
    async putFile(f) {
      const pre = await files.presignUpload({ projectId: f.projectId, fileName: f.name, mime: f.mime, sizeBytes: f.bytes.length, maxBytes: 50 * 1024 * 1024, allowedMimes: [f.mime] });
      await (await client()).data.files.uploadToUrl({ url: pre.uploadUrl, body: new Blob([new Uint8Array(f.bytes)], { type: f.mime }), contentType: f.mime, headers: pre.requiredHeaders });
      return pre.fileId;
    },
    async readFile(id) {
      const { url } = await files.downloadUrl(id);
      if (!url.startsWith("https://")) return null;
      const r = await fetch(url);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    },
  });
  let reading = false;
  const refresh = setInterval(() => {
    if (reading) return;
    reading = true;
    void store.refreshRow("EngineJob", o.jobId).catch(() => undefined).finally(() => { reading = false; engine.tick(); });
  }, 5000);
  try {
    engine.tick();
    await engine.idle();
    const job = store.get("EngineJob", o.jobId);
    fs.writeFileSync(o.checkpoint, JSON.stringify({ ...o.summary, jobId: o.jobId, state: job?.Status ?? "unknown", errorCode: job?.ErrorCode ?? null }, null, 2));
    if (job?.Status !== "succeeded") {
      if (o.summary.workflow === 'screens') throw new Error(`Figma screen generation did not complete (${String(job?.ErrorCode ?? 'engine_unavailable')}); recover job ${o.jobId} and its figma-screens artifacts before retrying.`);
      if (o.summary.workflow === "factory") throw new Error(`Factory revision did not complete (${String(job?.ErrorCode ?? "engine_unavailable")}). The earlier preview was retained; inspect the job's feedback-assessment.json and alignment-review.json before retrying.`);
      const providerError = path.join(projectWorkspace(process.env.MF_ENGINE_ROOT!, o.workspaceId, o.projectId).artifacts, "design-ref", o.jobId, "provider-error.json");
      throw new Error(`Private Make import did not complete (${String(job?.ErrorCode ?? "engine_unavailable")}); recover job ${o.jobId} before retrying. ${fs.existsSync(providerError) ? `Its sanitized provider output is recorded at ${providerError}.` : "The failure left no provider error record."}`);
    }
    const prototype = parseProductPrototype(p.designBrief()?.PrototypeJson);
    if (!prototype) throw new Error("The completed job did not save a usable design reference.");
    return { ...o.summary, jobId: o.jobId, state: "succeeded", errorCode: null, status: o.summary.workflow === "factory" || o.summary.workflow === 'screens' ? "ready" : "imported", projectUrl: prototype.projectUrl, previewUrl: prototype.previewUrl, revision: prototype.revision, designApproved: false };
  } finally { clearInterval(refresh); engine.stop(); }
}

function privateImportCheckpoints(root: string): { checkpoint: string } {
  const checkpoint = path.join(root, "data", "local-planner", "private-import.json");
  fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
  return { checkpoint };
}

export async function privateMakeImport(o: { root: string; env: Record<string, string | undefined>; projectId: string; approved: boolean }) {
  const service = await bootstrapService(o);
  const p = new ProjectView(service.store, o.projectId);
  if (!p.project.ItemId || p.project.IsDeleted === true) throw new Error("Project not found.");
  const brief = p.designBrief();
  if (!brief || p.project.Stage !== "requirements") throw new Error("An existing design brief at the requirements step is required.");
  const requirements = rawDesignRequirements(p.requirements());
  if (!requirements.length) throw new Error("Requirements are not ready.");
  if (parseMakePrototype(brief.PrototypeJson)) throw new Error("This project already has a Make reference; initial import cannot replace it.");
  const active = p.rows("EngineJob").some((j) => j.Kind === "design.generate" && ["queued", "claimed", "running"].includes(String(j.Status)));
  if (active) throw new Error("An existing design job is active. It was not cancelled or replaced.");
  const instructions = automaticDesignDirection(requirements);
  const source = designSource(instructions, requirements);
  const summary = { projectId: o.projectId, requirementCount: requirements.length, source, workflow: "import", destination: "one private standalone Make file", publicPublishing: false, paidMakePrompts: false };
  if (!o.approved) return { dryRun: true, ...summary };

  const { checkpoint } = privateImportCheckpoints(o.root);
  if (fs.existsSync(checkpoint)) throw new Error("An approved import attempt is already recorded. Recover that job instead of creating another private Make file.");
  const requestKey = `private-make-import:${randomUUID()}`;
  fs.writeFileSync(checkpoint, JSON.stringify({ ...summary, requestKey, state: "creating-job" }, null, 2), { flag: "wx", mode: 0o600 });
  const actor = String(p.project.CreatedByUserId || "");
  if (!actor) throw new Error("The project has no creating actor; no cloud job was created.");
  const claim = workerHostId();
  // Create already claimed, never queued: the screenshot-era worker must not win an initial queue race.
  // The normal engine driver heartbeats the job while the Make request is running.
  const row: Row = { ProjectId: o.projectId, WorkspaceId: p.workspaceId, ReaderIds: p.project.ReaderIds ?? [],
    Kind: "design.generate", Status: "claimed", Attempts: 1, Progress: 0, Message: "Preparing the approved private Make import.",
    ActiveKey: `design.generate:${String(brief.ItemId)}`, TargetType: "design-brief", TargetId: brief.ItemId,
    InputJson: JSON.stringify({ projectId: o.projectId, designBriefId: brief.ItemId, source, feedback: "", requestType: "initial-design", requirementKeys: requirements.map(r => r.key) }),
    ClaimedBy: claim, ClaimedAt: new Date().toISOString(), RequestedByUserId: actor, CreatedByUserId: actor, UpdatedByUserId: actor, RequestKey: requestKey };
  const inserted = await service.raw.insert("EngineJob", row);
  if (!inserted.created || !inserted.itemId) throw new Error("The private import job could not be uniquely created. Check its request key before retrying.");
  const jobId = inserted.itemId;
  fs.writeFileSync(checkpoint, JSON.stringify({ ...summary, requestKey, jobId, state: "claimed" }, null, 2));
  await service.raw.update("DesignBrief", String(brief.ItemId), { Mode: "figma", Instructions: instructions, Status: "draft", UpdatedByUserId: actor });
  return await runImportJob({ service, projectId: o.projectId, jobId, workspaceId: p.workspaceId, summary, checkpoint, claim });
}

/** Operator-directed recovery of the recorded import attempt: same job, same project, no new Make destination. */
export async function recoverMakeImport(o: { root: string; env: Record<string, string | undefined>; projectId: string; mode: "new" | "destination"; fileKey?: string }) {
  const { checkpoint } = privateImportCheckpoints(o.root);
  if (!fs.existsSync(checkpoint)) throw new Error("No approved import attempt is recorded for this host. Nothing to recover.");
  const recorded = JSON.parse(fs.readFileSync(checkpoint, "utf8")) as { projectId?: unknown; jobId?: unknown };
  if (recorded.projectId !== o.projectId || typeof recorded.jobId !== "string" || !recorded.jobId) throw new Error("The recorded import attempt belongs to another project.");
  const service = await bootstrapService(o);
  const p = new ProjectView(service.store, o.projectId);
  if (!p.project.ItemId || p.project.IsDeleted === true) throw new Error("Project not found.");
  const brief = p.designBrief();
  if (parseMakePrototype(brief?.PrototypeJson)) throw new Error("The design already has a Make reference; recovery cannot create or replace it.");
  const job = service.store.get("EngineJob", recorded.jobId);
  if (!job) throw new Error("The recorded job is not among this project's jobs. Refresh the store view once and try again.");
  if (String(job.Kind) !== "design.generate") throw new Error("The recorded job is not a Make design job; this recovery only handles design.generate.");
  if (["queued", "running"].includes(String(job.Status))) throw new Error("The recorded job is still active; do not recover it while it runs.");
  if (!["claimed", "failed"].includes(String(job.Status))) throw new Error(`The recorded job is ${String(job.Status)}; recovery resumes a failed or paused attempt only.`);
  const claim = workerHostId();
  if (String(job.ClaimedBy ?? "") !== claim) throw new Error("The recorded job was claimed by another worker host; only the host that claimed it can recover it here.");
  const dir = path.join(projectWorkspace(process.env.MF_ENGINE_ROOT!, p.workspaceId, o.projectId).artifacts, "design-ref", recorded.jobId);
  if (o.mode === "new") {
    archiveMakeAttempt(dir, new Date());
  } else {
    if (!o.fileKey || !/^[A-Za-z0-9_-]{1,128}$/.test(o.fileKey)) throw new Error("Provide the failed import's file key: the segment of its Make file URL path after figma.com/make/.");
    recordMakeRecovery(dir, o.fileKey, new Date());
  }
  const actor = String(p.project.CreatedByUserId || "");
  const patch: Row = { ...makeRecoveryClaim(String(brief!.ItemId), new Date()), ...(actor ? { UpdatedByUserId: actor } : {}) };
  await service.raw.update("EngineJob", recorded.jobId, patch);
  const summary = { ...recorded, recovery: o.mode === "new" ? "confirmed-no-provider-file" : `continue-destination:${o.fileKey}` };
  fs.writeFileSync(checkpoint, JSON.stringify({ ...summary, state: "recovering" }, null, 2));
  return await runImportJob({ service, projectId: o.projectId, jobId: recorded.jobId, workspaceId: p.workspaceId, summary, checkpoint, claim });
}
