import { describe, expect, it, vi } from "vitest";
import { createDesignPreviewRoutes } from "../../server/api/designPreview";
import { DESIGN_PREVIEW_CSP } from "../../server/security/designPreview";

describe("private Factory preview route", () => {
  const req = {} as any;
  const response = () => ({ writeHead: vi.fn(), end: vi.fn() }) as any;
  it('uses the same project authorization for the modal screen data', async () => {
    const res = response(); const caller = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await createDesignPreviewRoutes(caller)[1].handler(req, res, { projectId: 'p1', revision: 'a'.repeat(64) });
    expect(res.writeHead.mock.calls[0][0]).toBe(403);
    expect(res.end.mock.calls[0][0]).not.toContain('png');
  });
  it('serves only authorized saved exports as private JSON', async () => {
    const res = response(); const exports = [{ name: 'Orders', nodeId: '1:2', png: 'saved', width: 1440, height: 900 }];
    const caller = vi.fn().mockResolvedValue({ ok: true, data: { screens: exports, revision: 'a'.repeat(64) } });
    await createDesignPreviewRoutes(caller)[1].handler(req, res, { projectId: 'p1', revision: 'a'.repeat(64) });
    expect(caller).toHaveBeenCalledWith(req, res, 'designBrief.preview', { projectId: 'p1', revision: 'a'.repeat(64) });
    expect(res.writeHead.mock.calls[0]).toEqual([200, expect.objectContaining({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })]);
    expect(JSON.parse(res.end.mock.calls[0][0]).screens).toEqual(exports);
  });
  it("fails closed without an authenticated caller adapter", async () => {
    const res = response(); await createDesignPreviewRoutes()[0].handler(req, res, { projectId: "p1", revision: "a".repeat(64) });
    expect(res.writeHead.mock.calls[0][0]).toBe(503);
  });
  it("does not serve prototype source after access is denied", async () => {
    const res = response(); const caller = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await createDesignPreviewRoutes(caller)[0].handler(req, res, { projectId: "p1", revision: "a".repeat(64) });
    expect(res.writeHead.mock.calls[0][0]).toBe(403);
    expect(res.end).not.toHaveBeenCalledWith(expect.stringContaining("<html"));
  });
  it("serves only the authorized revision with opaque-origin and no-network restrictions", async () => {
    const res = response(); const caller = vi.fn().mockResolvedValue({ ok: true, data: { html: "<html>Prototype</html>" } });
    await createDesignPreviewRoutes(caller)[0].handler(req, res, { projectId: "p1", revision: "a".repeat(64) });
    expect(res.writeHead.mock.calls[0]).toEqual([200, expect.objectContaining({ "Content-Security-Policy": DESIGN_PREVIEW_CSP, "Cache-Control": "no-store" })]);
    expect(DESIGN_PREVIEW_CSP).not.toContain("allow-same-origin"); expect(DESIGN_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(caller).toHaveBeenCalledWith(req, res, "designBrief.preview", { projectId: "p1", revision: "a".repeat(64) });
  });
});
