import { afterEach, describe, expect, it, vi } from "vitest";
import { retryAttachmentExtraction } from "../../src/components/understanding/retryExtraction";

afterEach(() => vi.clearAllMocks());

// "Read again" only asks the MADP engine to read the committed file (doc.file.extract queues a file.extract job): the
// browser never downloads, uploads or reads the file itself, and nothing is sent to a web-server extraction route.
describe("read again: the MADP engine reads the committed file", () => {
  it("queues the engine's reading through the project op, with the project and file only", async () => {
    const callOp = vi.fn().mockResolvedValue({ jobId: "job-1", queued: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await retryAttachmentExtraction("project-1", { fileId: "file-1", name: "spec.pdf" }, { callOp });
    expect(callOp).toHaveBeenCalledTimes(1);
    expect(callOp).toHaveBeenCalledWith("doc.file.extract", { projectId: "project-1", fileId: "file-1" });
    expect(r).toEqual({ jobId: "job-1", queued: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("answers a reading already under way as such (not a failure)", async () => {
    const callOp = vi.fn().mockResolvedValue({ jobId: "job-0", queued: false });
    await expect(retryAttachmentExtraction("p", { fileId: "f", name: "x.png" }, { callOp })).resolves.toEqual({ jobId: "job-0", queued: false });
  });
  it("passes a refusal of the op on (no access, file gone)", async () => {
    const callOp = vi.fn().mockRejectedValue(new Error("not_found"));
    await expect(retryAttachmentExtraction("foreign-project", { fileId: "f", name: "x.png" }, { callOp })).rejects.toThrow("not_found");
  });
  it("does nothing once cancelled", async () => {
    const callOp = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(retryAttachmentExtraction("p", { fileId: "f", name: "x.png" }, { callOp }, controller.signal)).rejects.toThrow();
    expect(callOp).not.toHaveBeenCalled();
  });
});
