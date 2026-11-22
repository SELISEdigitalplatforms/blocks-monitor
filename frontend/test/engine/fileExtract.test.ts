// file.extract: the MADP engine reads a file people shared — the parser, the AI runner's findings, the knowledge base
// on the engine host, and the reading published to Storage for every web server (the job's OutputRefs point at it).
// A file that cannot be read fails the job with a plain reason and its code; nothing runs on a web server.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/fileExtract.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { createFileRecord, writeBytes } from "../../server/local/storage.ts";
import { parsePublishedReading } from "../../server/api/extraction/process.ts";
import { knowledgeBaseDir } from "../../server/api/knowledgeBase.ts";
import { readingsFromJobs } from "../../server/api/brief/access.ts";
import { makeWorld, type World } from "./harness";

const ai = vi.hoisted(() => ({ callAI: vi.fn() }));
vi.mock("../../server/api/extraction/aiRunner.ts", () => ({ callAI: ai.callAI }));

let n = 0;
function share(w: World, project: Row, name: string, mime: string, bytes: Uint8Array): string {
  const rec = createFileRecord(w.db, { directoryId: "", name, mime, sizeBytes: bytes.length });
  writeBytes(w.db, path.join(w.dir, "files"), rec.fileId, bytes);
  const by = String(project.CreatedByUserId);
  const res = w.store.insert("DocFile", {
    ProjectId: project.ItemId, FolderId: "", Name: name, StoredName: `x${(n += 1)}.${name.split(".").pop()}`, Mime: mime, SizeBytes: bytes.length,
    StorageObjectId: rec.fileId, Status: "ready", SortOrder: 1024 * n, WorkspaceId: project.WorkspaceId, ReaderIds: project.ReaderIds,
    CreatedByUserId: by, UpdatedByUserId: by, RequestKey: capKey(`test:extract:${project.ItemId}:${n}`),
  } as Row);
  return String(res.ItemId);
}

describe("file.extract on the engine", () => {
  let w: World;
  let project: Row;
  let root: string;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-extract-kb-"));
    process.env.MF_ENGINE_ROOT = root;
    w = await makeWorld();
    project = w.project("Supplier Quality Portal");
  });
  afterAll(() => {
    w?.close();
    delete process.env.MF_ENGINE_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads a text file, writes the knowledge base and publishes the reading the job points at", async () => {
    ai.callAI.mockResolvedValue(JSON.stringify({
      summary: "Requirements for the supplier portal",
      observations: [{ id: "OBS-1", text: "Suppliers upload certificates", location: "line 3", kind: "requirement" }],
      candidateRequirements: [{ text: "Suppliers can upload certificates", basis: "explicit", evidenceRefs: ["OBS-1"] }],
      openQuestions: [], warnings: [],
    }));
    const fileId = share(w, project, "needs.md", "text/markdown", new TextEncoder().encode("# Needs\n\nSuppliers upload their certificates.\n"));
    const jobId = await w.queue({ project: String(project.Name), kind: "file.extract", input: { fileId }, target: { type: "doc-file", id: fileId } });
    await w.settle();
    const job = w.get("EngineJob", jobId);
    expect(job.Status).toBe("succeeded");
    expect(String(job.Message)).toBe("needs.md: 1 finding.");
    const refs = job.OutputRefs as string[];
    expect(refs[0]).toBe(`DocFile:${fileId}`);
    const objectId = refs.find((r) => r.startsWith("StorageObject:"))!.slice("StorageObject:".length);
    const published = parsePublishedReading(JSON.parse(String(w.fileBytes(objectId))));
    expect(published).toMatchObject({ sourceId: fileId, status: "ready", fileName: "needs.md" });
    expect(published!.findings.candidateRequirements).toHaveLength(1);
    expect(ai.callAI).toHaveBeenCalledTimes(1);
    // the in-process engine of local mode writes the knowledge base its own brief routes read ("local" workspace)
    const dir = knowledgeBaseDir("local", String(project.ItemId));
    expect(JSON.parse(fs.readFileSync(path.join(dir, "sources", fileId, "meta.json"), "utf8"))).toMatchObject({ status: "ready", observationCount: 1 });
    expect(fs.readFileSync(path.join(dir, "sources", fileId, "full-text.md"), "utf8")).toContain("Suppliers upload their certificates.");
    // what a web server makes of the job row
    expect(readingsFromJobs([job])).toEqual([expect.objectContaining({ fileId, status: "succeeded", objectId })]);
  });

  it("fails the job with the reader's reason and code for a file that cannot be read, without calling the AI runner", async () => {
    ai.callAI.mockClear();
    const fileId = share(w, project, "broken.pdf", "application/pdf", new TextEncoder().encode("not a PDF at all"));
    const jobId = await w.queue({ project: String(project.Name), kind: "file.extract", input: { fileId }, target: { type: "doc-file", id: fileId } });
    await w.settle();
    const job = w.get("EngineJob", jobId);
    expect(job.Status).toBe("failed");
    expect(job.ErrorCode).toBe("pdf_invalid");
    expect(String(job.Message)).toMatch(/PDF/);
    expect(ai.callAI).not.toHaveBeenCalled();
    expect(readingsFromJobs([job])).toEqual([expect.objectContaining({ fileId, status: "failed", errorCode: "pdf_invalid", objectId: "" })]);
  });

  it("fails plainly when the file is gone", async () => {
    const jobId = await w.queue({ project: String(project.Name), kind: "file.extract", input: { fileId: "no-such-file" }, target: { type: "doc-file", id: "no-such-file" } });
    await w.settle();
    expect(w.get("EngineJob", jobId)).toMatchObject({ Status: "failed", ErrorCode: "file.gone" });
  });
});
