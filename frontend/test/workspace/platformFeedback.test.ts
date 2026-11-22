// feedback.platform.presign / feedback.platform.submit through the real router: any signed-in person, outside any
// project; the attachment pipeline's file rules; ONE EngineJob "platform.feedback" row (ProjectId/WorkspaceId "system").
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedRow } from "../../functions/_lib/testing";
import type { FilesService } from "../../functions/_lib/storage";
import { PLATFORM_FEEDBACK_OPS } from "../../functions/workspace/ops/feedback/platform";
import { opKind } from "../../src/blocks/fnKinds";
import { MAX_ATTACHMENT_BYTES } from "../../src/domain/feedback";

const ME = { userId: "tester-1", email: "tester@example.org", displayName: "Beta Tester" };
const OTHER = { userId: "tester-2", email: "other@example.org", displayName: "Other Tester" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const REQ = "5f0c6a52-1d2e-4c1b-9a51-2b7e3f9d0a11";

function memoryFiles() {
  const files = new Map<string, { name: string; folder: readonly string[] | undefined; mime: string; bytes: Uint8Array | null }>();
  let n = 0;
  const service: FilesService = {
    projectDirectory: async () => "dir",
    async presignUpload(i) {
      const fileId = `file-${++n}`;
      const storedName = i.fileName.replace(/\.[^.]*$/, "") + ".png";
      files.set(fileId, { name: storedName, folder: i.folder, mime: i.mime, bytes: null });
      return { fileId, uploadUrl: `https://storage.test/${fileId}`, storedName, displayName: i.fileName, directoryId: "dir", requiredHeaders: {} };
    },
    async info(fileId) {
      const f = files.get(fileId);
      if (!f?.bytes) throw Object.assign(new Error("not_found"), { code: "not_found" });
      return { fileId, name: f.name, mime: f.mime, sizeBytes: f.bytes.length, directoryId: "dir", createdAt: "" };
    },
    downloadUrl: async (fileId) => ({ url: `https://storage.test/${fileId}?read`, expiresAt: null }),
    async remove(fileId) { files.delete(fileId); },
    async head(fileId, bytes) { return (files.get(fileId)?.bytes ?? new Uint8Array()).slice(0, bytes); },
  };
  return { service, files, put: (fileId: string, bytes: Uint8Array) => { files.get(fileId)!.bytes = bytes; } };
}

function setup() {
  const gateway = memoryGateway();
  for (const p of [ME, OTHER]) seedRow(gateway, "Account", { UserId: p.userId, Email: p.email, DisplayName: p.displayName, Status: "active" });
  const storage = memoryFiles();
  let n = 0;
  const call = (op: string, args: Record<string, unknown>, who = ME) =>
    runOp("workspace", PLATFORM_FEEDBACK_OPS, { ctx: fakeCtx(who), gateway, files: () => storage.service, request: { op, args, requestId: `req-pf-${++n}-abcdefghijklmnop` } });
  const presign = async (who = ME, o: { fileName?: string; mime?: string; sizeBytes?: number } = {}) => {
    const r = await call("feedback.platform.presign", { fileName: o.fileName ?? "Screen shot.png", mime: o.mime ?? "image/png", sizeBytes: o.sizeBytes ?? PNG.length }, who);
    expect(r.status).toBe(200);
    return r.body.data as { fileId: string; upload: { uploadUrl: string; storedName: string } };
  };
  const submitArgs = (files: unknown[] = [], requestId = REQ) => ({
    requestId,
    title: "  The save button does nothing  ",
    description: "I clicked Save on the goals page.\nNothing happened.",
    page: { path: "/projects/p1/goals", title: "Goals" },
    client: { userAgent: "Mozilla/5.0", viewport: "1440x900", language: "en" },
    files,
  });
  const jobs = () => gateway.rows("EngineJob");
  return { gateway, storage, call, presign, submitArgs, jobs };
}

const fileArg = (fileId: string, o: Record<string, unknown> = {}) => ({ fileId, fileName: "Screen shot.png", mime: "image/png", sizeBytes: PNG.length, ...o });

describe("platform feedback ops", () => {
  it("are registered in mf-workspace as writes", async () => {
    const ops = await listRegisteredOps("workspace");
    expect(ops).toContain("feedback.platform.presign");
    expect(ops).toContain("feedback.platform.submit");
    expect(opKind("workspace", "feedback.platform.presign")).toBe("write");
    expect(opKind("workspace", "feedback.platform.submit")).toBe("write");
  });

  it("presigns into the caller's platform-feedback folder and submits one system EngineJob", async () => {
    const t = setup();
    const p = await t.presign();
    expect(p.upload.uploadUrl).toBe(`https://storage.test/${p.fileId}`);
    expect(t.storage.files.get(p.fileId)!.folder).toEqual(["platform-feedback", ME.userId]);
    t.storage.put(p.fileId, PNG);
    const r = await t.call("feedback.platform.submit", t.submitArgs([fileArg(p.fileId)]));
    expect(r.status).toBe(200);
    const rows = t.jobs();
    expect(rows).toHaveLength(1);
    const job = rows[0]!;
    expect(r.body.data).toEqual({ jobId: job.ItemId });
    expect(job).toMatchObject({
      ProjectId: "system", WorkspaceId: "system", Kind: "platform.feedback", Status: "queued",
      ActiveKey: `platform.feedback:${REQ}`, RequestKey: `platform.feedback:${REQ}`, Attempts: 0, Progress: 0,
      Message: "Feedback received.", CreatedByUserId: ME.userId, RequestedByUserId: ME.userId,
    });
    const input = JSON.parse(String(job.InputJson));
    expect(input).toMatchObject({
      title: "The save button does nothing",
      description: "I clicked Save on the goals page.\nNothing happened.",
      page: { path: "/projects/p1/goals", title: "Goals" },
      client: { userAgent: "Mozilla/5.0", viewport: "1440x900", language: "en" },
      files: [{ fileId: p.fileId, fileName: "Screen shot.png", mime: "image/png", sizeBytes: PNG.length }],
      reporter: { userId: ME.userId, email: ME.email },
    });
    expect(typeof input.submittedAt).toBe("string");
  });

  it("refuses an oversize or a wrong-type file at presign", async () => {
    const t = setup();
    const big = await t.call("feedback.platform.presign", { fileName: "huge.png", mime: "image/png", sizeBytes: MAX_ATTACHMENT_BYTES + 1 });
    expect(big.status).not.toBe(200);
    expect(big.body.error).toMatchObject({ code: "too_large", messageKey: "feedback.tooLarge" });
    const exe = await t.call("feedback.platform.presign", { fileName: "tool.exe", mime: "application/octet-stream", sizeBytes: 10 });
    expect(exe.body.error).toMatchObject({ code: "invalid_input", messageKey: "feedback.typeNotAllowed" });
    expect(t.storage.files.size).toBe(0);
  });

  it("refuses at submit a file whose bytes are not its type, a size that differs, and a wrong type", async () => {
    const t = setup();
    const p = await t.presign();
    t.storage.put(p.fileId, new TextEncoder().encode("not a png at all"));
    const wrongBytes = await t.call("feedback.platform.submit", t.submitArgs([fileArg(p.fileId, { sizeBytes: 16 })]));
    expect(wrongBytes.body.error).toMatchObject({ code: "invalid_input", messageKey: "feedback.fileType", params: { index: 0, rule: "type" } });
    const wrongSize = await t.call("feedback.platform.submit", t.submitArgs([fileArg(p.fileId, { sizeBytes: 99 })]));
    expect(wrongSize.body.error).toMatchObject({ code: "invalid_input", messageKey: "feedback.fileSize" });
    const exe = await t.call("feedback.platform.submit", t.submitArgs([fileArg(p.fileId, { fileName: "x.exe", mime: "application/x-msdownload" })]));
    expect(exe.body.error).toMatchObject({ code: "invalid_input", messageKey: "feedback.typeNotAllowed" });
    expect(t.jobs()).toHaveLength(0);
  });

  it("refuses a file missing in Storage, never uploaded, and another person's file", async () => {
    const t = setup();
    const missing = await t.call("feedback.platform.submit", t.submitArgs([fileArg("file-404")]));
    expect(missing.body.error).toMatchObject({ code: "invalid_input", messageKey: "feedback.fileMissing", params: { rule: "missing" } });
    const notUploaded = await t.presign();
    const r = await t.call("feedback.platform.submit", t.submitArgs([fileArg(notUploaded.fileId)]));
    expect(r.body.error).toMatchObject({ messageKey: "feedback.fileMissing" });
    const theirs = await t.presign(OTHER);
    t.storage.put(theirs.fileId, PNG);
    const stolen = await t.call("feedback.platform.submit", t.submitArgs([fileArg(theirs.fileId)]));
    expect(stolen.body.error).toMatchObject({ messageKey: "feedback.fileMissing" });
    expect(t.jobs()).toHaveLength(0);
  });

  it("answers the same job to a retry with the same requestId, and refuses another person's requestId", async () => {
    const t = setup();
    const first = await t.call("feedback.platform.submit", t.submitArgs());
    const again = await t.call("feedback.platform.submit", t.submitArgs());
    expect(first.status).toBe(200);
    expect(again.body.data).toEqual(first.body.data);
    expect(t.jobs()).toHaveLength(1);
    const other = await t.call("feedback.platform.submit", t.submitArgs(), OTHER);
    expect(other.body.error).toMatchObject({ code: "conflict" });
    expect(t.jobs()).toHaveLength(1);
  });

  it("allows 20 submissions per person per hour", async () => {
    const t = setup();
    const recent = new Date(Date.now() - 10 * 60_000).toISOString();
    for (let i = 0; i < 20; i++) {
      const key = `platform.feedback:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      seedRow(t.gateway, "EngineJob", {
        ProjectId: "system", WorkspaceId: "system", Kind: "platform.feedback", Status: "succeeded", ActiveKey: key,
        RequestKey: key, CreatedByUserId: ME.userId, CreatedDate: recent, Attempts: 1, Progress: 100,
      });
    }
    const no = await t.call("feedback.platform.submit", t.submitArgs());
    expect(no.body.error).toMatchObject({ code: "limit_reached", messageKey: "fn.quota", params: { op: "feedback.platform.submit", max: 20 } });
    const someoneElse = await t.call("feedback.platform.submit", t.submitArgs([], "6a1d2c3b-0000-4000-8000-000000000001"), OTHER);
    expect(someoneElse.status).toBe(200);
  });

  it("validates the text fields before any I/O", async () => {
    const t = setup();
    const blank = await t.call("feedback.platform.submit", { ...t.submitArgs(), title: "   " });
    expect(blank.body.error).toMatchObject({ code: "invalid_input", params: { field: "title", rule: "min" } });
    const long = await t.call("feedback.platform.submit", { ...t.submitArgs(), description: "x".repeat(5001) });
    expect(long.body.error).toMatchObject({ code: "invalid_input", params: { field: "description", rule: "max" } });
    const badId = await t.call("feedback.platform.submit", { ...t.submitArgs(), requestId: "nope" });
    expect(badId.body.error).toMatchObject({ code: "invalid_input", params: { field: "requestId" } });
    expect(t.jobs()).toHaveLength(0);
  });
});
