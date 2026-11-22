import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

const mocks = vi.hoisted(() => ({ callAI: vi.fn(), write: vi.fn(), update: vi.fn(), start: vi.fn() }));
vi.mock("../../server/api/extraction/aiRunner.ts", () => ({ callAI: mocks.callAI }));
vi.mock("../../server/api/knowledgeBase.ts", () => ({ writeSourceExtraction: mocks.write, updateManifest: mocks.update, startSourceExtraction: mocks.start }));
import { briefRoutes } from "../../server/api/brief/routes.ts";
import { textPdf } from "./pdfFixture";

afterEach(() => vi.clearAllMocks());

async function processImage(fileName = "screen.png", mimeType = "image/png", input?: Buffer) {
  const form = new FormData();
  form.set("projectId", "test-project");
  form.set("fileId", "test-file");
  form.set("fileName", fileName);
  form.set("mimeType", mimeType);
  const bytes = input ? new Uint8Array(input) : new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  form.set("file", new Blob([bytes], { type: mimeType }), fileName);
  const request = new Request("http://test", { method: "POST", body: form });
  const req = Readable.from([Buffer.from(await request.arrayBuffer())]) as IncomingMessage;
  req.headers = { "content-type": request.headers.get("content-type")! };
  let status = 0, data: any;
  const res = { writeHead: (code: number) => { status = code; }, end: (body: string) => { data = JSON.parse(body); } } as unknown as ServerResponse;
  const route = briefRoutes.find(r => r.pattern.test("/api/extraction/test-file/process") && r.method === "POST")!;
  await route.handler(req, res, { fileId: "test-file" });
  return { status, data, bytes };
}

describe("image extraction HTTP route", () => {
  it("normalizes real per-page PDF text, passes its page count, and does not misread document prose as an OCR error", async () => {
    mocks.callAI.mockResolvedValue(JSON.stringify({ summary: "PDF process guide", observations: [], candidateRequirements: [], openQuestions: [], warnings: [] }));
    const result = await processImage("guide.pdf", "application/pdf", textPdf(["A scanned upload requires OCR, but this is readable PDF text.", "The system must support release approval."]));
    expect(result.status).toBe(200);
    expect(mocks.callAI.mock.calls[0][0]).toContain("Pages: 2");
    expect(mocks.callAI.mock.calls[0][0]).toContain("## Page 2");
    expect(mocks.write).toHaveBeenCalledWith({ workspaceId: "local", projectId: "test-project" }, expect.objectContaining({ status: "ready", pages: 2 }));
  });
  it("preserves specific PDF errors in HTTP and saved metadata without calling a runner", async () => {
    const result = await processImage("invalid.pdf", "application/pdf", Buffer.from("not a PDF"));
    expect(result.status).toBe(422);
    expect(result.data.errorCode).toBe("pdf_invalid");
    expect(mocks.callAI).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith({ workspaceId: "local", projectId: "test-project" }, expect.objectContaining({ status: "failed", errorCode: "pdf_invalid", errorMessage: expect.stringContaining("valid PDF") }));
  });
  it("marks the attempt processing before model completion and rejects overlapping attempts", async () => {
    let release!: (value: string) => void;
    let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    mocks.callAI.mockImplementation(() => { started(); return new Promise<string>(resolve => { release = resolve; }); });
    const first = processImage();
    await began;
    expect(mocks.start).toHaveBeenCalledWith({ workspaceId: "local", projectId: "test-project" }, expect.objectContaining({ sourceId: "test-file" }));
    expect(mocks.write).not.toHaveBeenCalled();
    const duplicate = await processImage();
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.status).toBe("processing");
    expect(mocks.callAI).toHaveBeenCalledTimes(1);
    release(JSON.stringify({ summary: "No findings", observations: [], candidateRequirements: [], openQuestions: [], warnings: [] }));
    expect((await first).data).toMatchObject({ status: "ready", observations: 0 });
  });
  it("sends actual image bytes to the runner and persists cited content", async () => {
    mocks.callAI.mockResolvedValue(JSON.stringify({ summary: "A checkout screen", observations: [{ id: "OBS-001", kind: "ui_element", text: "Apply code button", location: "image:bottom" }], candidateRequirements: [{ text: "Apply discount codes", basis: "inferred", evidenceRefs: ["OBS-001"] }], openQuestions: [], warnings: [] }));
    const result = await processImage();
    expect(result.status).toBe(200);
    expect(result.data.extracted).toBe(true);
    expect(mocks.callAI.mock.calls[0][1].image.buffer).toEqual(Buffer.from(result.bytes));
    expect(mocks.write).toHaveBeenCalledWith({ workspaceId: "local", projectId: "test-project" }, expect.objectContaining({ status: "ready", extractedText: expect.stringContaining("Apply code button") }));
  });

  it("returns failure status instead of reporting an analyzed file", async () => {
    mocks.callAI.mockRejectedValue(new Error("Codex extraction failed."));
    const result = await processImage();
    expect(result.status).toBe(422);
    expect(result.data.extracted).toBe(false);
    expect(result.data.status).toBe("failed");
    expect(mocks.write).toHaveBeenCalledWith({ workspaceId: "local", projectId: "test-project" }, expect.objectContaining({ status: "failed" }));
  });
});
