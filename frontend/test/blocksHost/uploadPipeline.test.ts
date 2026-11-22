import { describe, expect, it, vi } from "vitest";
import { uploadDocFile, type UploadDeps } from "../../src/blocks/projects/upload";

const row = {
  ItemId: "gateway-row-1", ProjectId: "project-1", FolderId: "folder-1", Name: "check.txt",
  StoredName: "gateway-row-1.txt", Mime: "text/plain", SizeBytes: 5, Status: "ready", SortOrder: 0,
};

function deps(overrides: Partial<UploadDeps> = {}) {
  const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
  const call = vi.fn(async (op: string, args: Record<string, unknown>) => {
    calls.push({ op, args });
    if (op === "doc.file.presign") return { fileId: "gateway-row-1", uploadUrl: "https://storage.example/put", requiredHeaders: { "x-ms-blob-type": "Blockblob" } };
    if (op === "doc.file.commit") return { file: row };
    return {};
  });
  const result: UploadDeps = {
    call: call as unknown as UploadDeps["call"],
    putBytes: vi.fn(async () => undefined),
    sha256Hex: vi.fn(async () => "a".repeat(64)),
    ...overrides,
  };
  return { deps: result, calls };
}

describe("Project setup file upload pipeline", () => {
  it("persigns, PUTs required headers, then commits the Gateway row ready", async () => {
    const f = deps();
    const phases: string[] = [];
    const file = new File(["hello"], "check.txt", { type: "text/plain" });
    const result = await uploadDocFile({ projectId: "project-1", folderId: "folder-1", file, usedBytes: 0, fileCount: 0 }, {
      onPhase: (phase) => phases.push(phase),
    }, f.deps);

    expect(result).toMatchObject({ ok: true, file: { id: "gateway-row-1", status: "ready" } });
    expect(f.calls.map((c) => c.op)).toEqual(["doc.file.presign", "doc.file.commit"]);
    expect(f.calls[0]?.args).toMatchObject({ projectId: "project-1", folderId: "folder-1", fileName: "check.txt", sizeBytes: 5 });
    expect(f.deps.putBytes).toHaveBeenCalledWith(expect.objectContaining({ url: "https://storage.example/put", headers: { "x-ms-blob-type": "Blockblob" } }));
    expect(phases).toEqual(["checking", "uploading", "verifying", "done"]);
  });

  it("cleans the pending Gateway/Storage record if the byte PUT fails and does not commit", async () => {
    const f = deps({ putBytes: vi.fn(async () => { throw new Error("provider refused upload"); }) });
    const result = await uploadDocFile({
      projectId: "project-1", folderId: "folder-1", file: new File(["hello"], "check.txt", { type: "text/plain" }), usedBytes: 0, fileCount: 0,
    }, {}, f.deps);
    expect(result).toMatchObject({ ok: false, phase: "uploading" });
    expect(f.calls.map((c) => c.op)).toEqual(["doc.file.presign", "doc.file.delete"]);
  });
});
