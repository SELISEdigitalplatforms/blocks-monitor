import { describe, expect, it, vi } from "vitest";
import { createFiles, type FetchImpl } from "../../functions/_lib/storage";

const projectId = "project-1";
const workspaceId = "workspace-1";
const directoryId = "directory-project";

function fixture(overrides: Record<string, unknown> = {}, missingModuleDirectory = false) {
  const presignedUploadUrl = vi.fn(async () => ({ fileId: "storage-file-1", uploadUrl: "https://storage.example/upload", requiredHeaders: { "x-ms-blob-type": "Blockblob", "x-checksum": "digest" } }));
  const get = vi.fn(async () => ({ fileId: "storage-file-1", name: "spec.txt", downloadUrl: "https://storage.example/download" }));
  const info = vi.fn<() => Promise<unknown>>(async () => ({ items: [] }));
  const createdDirectories: Array<{ itemId: string; name: string; parentDirectoryId?: string }> = [];
  const dataClient = {
    data: {
      objects: { list: vi.fn(async (request: { parentDirectoryId?: string; moduleName?: number }) => ({ items:
        request.parentDirectoryId === undefined
          ? missingModuleDirectory
            ? createdDirectories.filter((d) => d.parentDirectoryId === "module:8").map((d) => ({ ...d, type: "directory" }))
            : [{ itemId: "root-mf", name: "mf", type: "directory" }]
          : request.parentDirectoryId === "root-mf" || request.parentDirectoryId === "created-mf"
            ? [{ itemId: "directory-workspace", name: workspaceId, type: "directory" }]
            : [{ itemId: directoryId, name: projectId, type: "directory" }],
        hasMore: false })) },
      directories: { get: vi.fn(async () => ({ inheritsParentAccess: false, permissions: { canDownload: true, canEdit: true } })), create: vi.fn(async (request: { name: string; parentDirectoryId?: string; moduleName?: number }) => {
        const itemId = `created-${request.name}`;
        createdDirectories.push({ itemId, name: request.name, parentDirectoryId: request.parentDirectoryId ?? `module:${request.moduleName}` });
        return { itemId };
      }) },
      files: { presignedUploadUrl, get, info, delete: vi.fn() },
    },
    http: { request: vi.fn() },
  };
  const fetchImpl = vi.fn<FetchImpl>(async () => ({ ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === "content-length" ? "101" : "text/plain" } }));
  const files = createFiles({
    client: async () => dataClient as never,
    workspaceIdOf: async () => workspaceId,
    fetchImpl,
    timeoutMs: () => 50,
    ...overrides,
  });
  return { files, dataClient, presignedUploadUrl, get, info, fetchImpl };
}

describe("Blocks Storage adapter used by Project setup", () => {
  it("does not treat a denied private-file read as invalid uploaded bytes or use its upload URL", async () => {
    const f = fixture();
    f.get.mockResolvedValueOnce({ errors: { access: "forbidden" }, isSuccess: false } as never);
    await expect(f.files.info("storage-file-1")).rejects.toMatchObject({ code: "not_configured", messageKey: "storage.forbidden" });
    expect(f.info).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("preserves retryability when the metadata size measurement fails", async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(f.files.info("storage-file-1")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("presigns in the project's directory and preserves private access, size/type, checksum and required headers", async () => {
    const f = fixture();
    const result = await f.files.presignUpload({
      projectId, fileName: "Spec.txt", mime: "text/plain", sizeBytes: 101, maxBytes: 10_000,
      allowedMimes: ["text/plain"], sha256: "a".repeat(64),
    });

    expect(result).toMatchObject({ fileId: "storage-file-1", directoryId, requiredHeaders: { "x-checksum": "digest" } });
    expect(f.presignedUploadUrl).toHaveBeenCalledWith(expect.objectContaining({
      name: "Spec.txt", contentType: "text/plain", parentDirectoryId: directoryId,
      ContentType: "text/plain", SizeInBytes: 101, ObjectAccessLevel: "Creator", InheritsParentAccess: true, accessModifier: "Private",
      Checksum: "a".repeat(64), ChecksumAlgorithm: "SHA256",
      configurationName: "Default",
    }));
    expect(f.dataClient.data.objects.list).toHaveBeenCalledWith(expect.objectContaining({ moduleName: 8, type: "directory" }));
    expect(f.dataClient.http.request).not.toHaveBeenCalled();
  });

  it("refuses uploads when the isolated app root has not been provisioned", async () => {
    const f = fixture({}, true);
    await expect(f.files.projectDirectory(projectId)).rejects.toMatchObject({ code: "not_configured" });
    expect(f.dataClient.data.directories.create).not.toHaveBeenCalled();
    expect(f.dataClient.http.request).not.toHaveBeenCalled();
  });

  it("refuses a root that still inherits module-wide access", async () => {
    const f = fixture();
    f.dataClient.data.directories.get.mockResolvedValueOnce({ inheritsParentAccess: true, permissions: { canDownload: true, canEdit: true } });
    await expect(f.files.presignUpload({ projectId, fileName: "spec.txt", mime: "text/plain", sizeBytes: 101, maxBytes: 10_000, allowedMimes: ["text/plain"] })).rejects.toMatchObject({ code: "not_configured" });
    expect(f.presignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses an app root the service cannot download from", async () => {
    const f = fixture();
    f.dataClient.data.directories.get.mockResolvedValueOnce({ inheritsParentAccess: false, permissions: { canDownload: false, canEdit: true } });
    await expect(f.files.projectDirectory(projectId)).rejects.toMatchObject({ code: "not_configured" });
    expect(f.presignedUploadUrl).not.toHaveBeenCalled();
  });

  it("uses injected, bounded HEAD metadata lookup when file metadata omits size", async () => {
    const f = fixture();
    const result = await f.files.info("storage-file-1");
    expect(result).toMatchObject({ sizeBytes: 101, mime: "text/plain" });
    expect(f.fetchImpl).toHaveBeenCalledWith("https://storage.example/download", expect.objectContaining({ method: "HEAD", signal: expect.any(AbortSignal) }));
  });

  it("does not disguise a file-get server outage as a missing file", async () => {
    const f = fixture();
    f.get.mockRejectedValueOnce(Object.assign(new Error("gateway down"), { status: 503 }));
    await expect(f.files.info("storage-file-1")).rejects.toMatchObject({ code: "unavailable" });
    expect(f.info).not.toHaveBeenCalled();
  });

  it("falls back to file info after a not-found file get", async () => {
    const f = fixture();
    f.get.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    f.info.mockResolvedValueOnce({ items: [{ itemId: "storage-file-1", name: "spec.txt", sizeInBytes: 101, contentType: "text/plain", parentDirectoryId: directoryId }] });
    await expect(f.files.info("storage-file-1")).resolves.toMatchObject({ sizeBytes: 101, mime: "text/plain", directoryId });
  });
});
