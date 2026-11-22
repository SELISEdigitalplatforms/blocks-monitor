import { describe, expect, it, vi } from "vitest";
import { prepareMakePreview, verifyMakePreview } from "../../server/blocks/engineWorker/makePreview";

const prototype = { provider: "figma-make", projectUrl: "https://www.figma.com/make/file1/", previewUrl: null,
  revision: "seed-1", source: "ux-1", jobId: "job1", artifactFileId: "artifact1", extra: "keep" };
const brief = { ItemId: "brief1", Mode: "figma", Status: "confirmed", PrototypeJson: JSON.stringify(prototype) };
describe("operator preview registration", () => {
  it("targets the exact Make file, preserves the source revision and metadata, and requires renewed review", () => {
    const result = prepareMakePreview([brief], "file1", "https://product.figma.site");
    expect(result.briefId).toBe("brief1");
    expect(result.patch.Status).toBe("draft");
    expect(JSON.parse(result.patch.PrototypeJson)).toEqual({ ...prototype, previewUrl: "https://product.figma.site/" });
    expect(brief.Status).toBe("confirmed");
  });
  it("rejects invalid URLs, wrong files, duplicate associations and pending revisions", () => {
    expect(() => prepareMakePreview([brief], "file1", "https://evil.example")).toThrow(/invalid_make_preview_url/);
    expect(() => prepareMakePreview([brief], "file2", "https://product.figma.site")).toThrow(/no_imported_design/);
    expect(() => prepareMakePreview([brief, brief], "file1", "https://product.figma.site")).toThrow(/multiple_briefs/);
    expect(() => prepareMakePreview([{ ...brief, PrototypeJson: JSON.stringify({ ...prototype, source: "pending:job2" }) }], "file1", "https://product.figma.site")).toThrow(/pending/);
  });
  it("recognizes the already recorded URL without replacing an approved revision", () => {
    expect(prepareMakePreview([{ ...brief, PrototypeJson: JSON.stringify({ ...prototype, previewUrl: "https://product.figma.site/" }) }], "file1", "https://product.figma.site").unchanged).toBe(true);
  });
  it("checks HTML availability without following redirects or sending credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Design</html>", { headers: { "content-type": "text/html" } }));
    await verifyMakePreview("https://product.figma.site/", request);
    expect(request).toHaveBeenCalledWith("https://product.figma.site/", expect.objectContaining({ redirect: "manual", credentials: "omit", method: "GET" }));
  });
  it.each([
    [302, { location: "https://evil.example" }, "preview_http_302"],
    [404, {}, "preview_http_404"],
    [200, { "content-type": "application/json" }, "preview_is_not_html"],
    [200, { "content-type": "text/html", "x-frame-options": "SAMEORIGIN" }, "preview_blocks_framing"],
    [200, { "content-type": "text/html", "content-security-policy": "frame-ancestors 'none'" }, "preview_requires_frame_ancestors_review"],
  ] as const)("refuses an unusable response (%s)", async (status, headers, code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("page", { status, headers }));
    await expect(verifyMakePreview("https://product.figma.site/", request)).rejects.toThrow(code);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("never requests a host outside the preview allowlist", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(verifyMakePreview("https://localhost/", request)).rejects.toThrow(/invalid_make_preview/);
    expect(request).not.toHaveBeenCalled();
  });
});
