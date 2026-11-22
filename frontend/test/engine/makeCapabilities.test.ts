import { describe, expect, it, vi } from "vitest";
import { checkHeadlessMakeCapabilities, supportsHeadlessMake, supportsMakeWorkflow } from "../../server/local/engine/ai/makeCapabilities";

describe("explicit Make workflows", () => {
  it("requires schema evidence for updates, revisions and publishing independently", () => {
    const ready = { updateExistingMake: true, retrieveRevision: true, publishSite: true,
      updateTools: ["update"], revisionTools: ["revision"], publishTools: ["publish"] };
    expect(supportsHeadlessMake(ready)).toBe(true);
    expect(supportsHeadlessMake({ ...ready, publishSite: false })).toBe(false);
    expect(supportsHeadlessMake({ ...ready, updateTools: [] })).toBe(false);
    expect(supportsHeadlessMake({ ...ready, publishTools: [""] })).toBe(false);
    expect(supportsHeadlessMake({ status: "import_only" })).toBe(false);
    expect(supportsHeadlessMake(null)).toBe(false);
  });
  it("checks headless schemas without authorizing shell or remote tool calls", async () => {
    const runner = vi.fn().mockResolvedValue({ publishSite: false });
    await checkHeadlessMakeCapabilities(runner, { directory: "/job", mcpConfig: "/config" });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      makeSession: expect.objectContaining({ readOnly: true, inspectCapabilities: true }),
    }));
    expect(runner.mock.calls[0][0].prompt).toContain("without a browser session");
  });
  it("does not mistake import capability for Make-agent generation", () => {
    expect(supportsMakeWorkflow({ status: "import_only" }, "agent")).toBe(false);
    expect(supportsMakeWorkflow({ status: "import_only" }, "import")).toBe(true);
    expect(supportsMakeWorkflow({ status: "ready" }, "agent")).toBe(true);
    expect(supportsMakeWorkflow({ status: "ready" }, "import")).toBe(true);
  });
  it.each([null, {}, { status: "unsupported" }, { status: "unavailable" }, { status: "invalid" }])("fails closed for %j", (result) => {
    expect(supportsMakeWorkflow(result, "import")).toBe(false);
    expect(supportsMakeWorkflow(result, "agent")).toBe(false);
  });
});
