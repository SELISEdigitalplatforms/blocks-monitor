import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({ codex: vi.fn(), claude: vi.fn() }));
vi.mock("../../server/local/engine/ai/claude", async (original) => ({
  ...await original<typeof import("../../server/local/engine/ai/claude")>(), claudeRunner: adapters.claude,
}));
vi.mock("../../server/local/engine/ai/codex", async (original) => ({
  ...await original<typeof import("../../server/local/engine/ai/codex")>(), codexMakeRunner: adapters.codex,
}));
import { makeWorld, type World } from "./harness";
import { projectWorkspace } from "../../server/local/engine/projectFolder";
import { automaticDesignDirection, designSource, parseMakePrototype, rawDesignRequirements } from "../../src/domain/figmaMake";

let root: string;
let world: World | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "figma-planner-flow-"));
  const config = path.join(root, "figma.json");
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }));
  vi.stubEnv("MF_ENGINE_FIGMA_ENABLED", "1");
  vi.stubEnv("MF_ENGINE_FIGMA_RUNNER", "");
  vi.stubEnv("MF_ENGINE_FIGMA_BINARY", "");
  vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "agent");
  vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "");
  vi.stubEnv("MF_ENGINE_FIGMA_CREDITS_APPROVED", "1");
  vi.stubEnv("MF_ENGINE_FIGMA_MCP_CONFIG", config);
  vi.stubEnv("MF_ENGINE_FIGMA_STATE_DIR", path.join(root, "state"));
  vi.stubEnv("MF_ENGINE_FIGMA_AUTH_DIR", "");
  for (const adapter of Object.values(adapters)) {
    adapter.mockReset();
    adapter.mockImplementation(async (request) => {
      if (request.makeSession.readOnly) return { status: "ready" };
      fs.writeFileSync(path.join(request.makeSession.directory, "ux-plan.md"), "# Planner UX plan\nRequirement-mapped journeys");
      fs.writeFileSync(path.join(request.makeSession.directory, "design-master.md"), "# Approved handoff\nScreens, states and tokens");
      return { projectUrl: "https://www.figma.com/make/food-app/", previewUrl: "https://food-app.figma.site/", revision: "provider-revision-1", summary: "Requirement-mapped screens", error: null };
    });
  }
});
afterEach(() => { world?.close(); world = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

async function queueDesign(previousProjectUrl?: string) {
  world = await makeWorld({ engine: { projectFolder: (ws, pid) => projectWorkspace(root, ws, pid) } });
  const project = world.project("Payroll Self-Service");
  const pid = String(project.ItemId);
  const brief = world.rows("DesignBrief", pid)[0];
  const requirements = rawDesignRequirements(world.rows("Requirement", pid));
  const direction = automaticDesignDirection(requirements);
  world.gw.update("DesignBrief", String(brief.ItemId), { Mode: "figma", Instructions: direction, Status: "draft" });
  if (previousProjectUrl) world.gw.update("DesignBrief", String(brief.ItemId), { PrototypeJson: JSON.stringify({
    provider: "figma-make", projectUrl: previousProjectUrl, previewUrl: null, revision: "previous-revision",
    source: "pending:refinement", jobId: "previous-job", artifactFileId: "previous-artifact",
  }) });
  const id = await world.queue({ project: "Payroll Self-Service", kind: "design.generate",
    input: { projectId: pid, designBriefId: brief.ItemId, source: designSource(direction, requirements), feedback: previousProjectUrl ? "Improve the navigation" : "" },
    target: { type: "design-brief", id: String(brief.ItemId) },
  });
  await world.settle();
  return { id, briefId: String(brief.ItemId) };
}

describe("planner → inherited runner → Make → saved review", { timeout: 60000 }, () => {
  it.each(["codex", "claude"] as const)("uses the engine's %s adapter for both preflight and design, without changing runners", async (provider) => {
    const other = provider === "codex" ? "claude" : "codex";
    vi.stubEnv("AI_RUNNER", provider);
    vi.stubEnv("AI_RUNNER_BINARY", `existing-${provider}`);
    vi.stubEnv("MADP_AGENT_MODEL", "engine-model");
    vi.stubEnv("MF_ENGINE_FIGMA_MODEL", "ignored-local-model");
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).Status, world!.log.join("\n")).toBe("succeeded");
    expect(adapters[provider]).toHaveBeenCalledTimes(3);
    expect(adapters[other]).not.toHaveBeenCalled();
    const calls = adapters[provider].mock.calls;
    expect(calls[0][0].makeSession.readOnly).toBe(true);
    for (const [request] of calls) expect(request.makeSession).toMatchObject({ binary: `existing-${provider}`, model: "engine-model" });
    expect(calls[1][0].makeSession.inspectCapabilities).toBe(true);
    expect(calls[2][0].system).toContain("product planner");
    expect(calls[2][0].prompt).toContain("Requirements:");
    const stored = world!.get("DesignBrief", briefId);
    const prototype = parseMakePrototype(stored.PrototypeJson)!;
    expect(stored.Status).toBe("draft"); // Human screen approval is still required.
    expect(prototype).toMatchObject({ provider: "figma-make", revision: "provider-revision-1", jobId: id });
    expect(world!.rows("DesignScreen").filter((screen) => screen.EngineJobId === id)).toEqual([]);
    expect(world!.get("EngineJob", id).OutputRefs).not.toEqual(expect.arrayContaining([expect.stringMatching(/^DesignScreen:/)]));
    expect(world!.fileBytes(prototype.artifactFileId)?.toString()).toContain(`"runner":"${provider}"`);
  });
  it("refuses an unsupported engine runner without falling back or doing paid work", async () => {
    vi.stubEnv("AI_RUNNER", "unsupported-cli");
    const { id } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaUnsupportedRunner");
    expect(adapters.codex).not.toHaveBeenCalled();
    expect(adapters.claude).not.toHaveBeenCalled();
  });
  it("imports a real initial Make deliverable without authorizing paid Make-agent prompts", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    vi.stubEnv("MF_ENGINE_FIGMA_CREDITS_APPROVED", "");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      expect(request.prompt).toContain("Initial private Make import only");
      expect(request.system).toContain('skill name="figma-code-workflows"');
      const dir = request.makeSession.directory;
      fs.writeFileSync(path.join(dir, "ux-plan.md"), "# UX plan");
      fs.writeFileSync(path.join(dir, "design-master.md"), "# Imported interactive prototype; preview not verified");
      // Windows PowerShell's UTF-8 writer can prepend a BOM to provider-created receipts.
      fs.writeFileSync(path.join(dir, "provider-import-receipt.json"), "\uFEFF" + JSON.stringify({ fileKey: "food-app", seedId: "seed-1", status: "imported", previewVerified: false }));
      return { projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null, revision: "seed-1", summary: "Imported", error: null };
    });
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).Status).toBe("succeeded");
    const prototype = parseMakePrototype(world!.get("DesignBrief", briefId).PrototypeJson)!;
    const artifact = JSON.parse(world!.fileBytes(prototype.artifactFileId)!.toString());
    expect(artifact.workflow).toBe("import");
    expect(artifact.importReceipt).toMatchObject({ seedId: "seed-1", previewVerified: false });
    const resultFile = path.join(adapters.codex.mock.calls[2][0].makeSession.directory, "provider-result.json");
    fs.writeFileSync(resultFile, "\uFEFF" + fs.readFileSync(resultFile, "utf8"));
    world!.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "" });
    await world!.settle();
    expect(world!.get("EngineJob", id).Status).toBe("succeeded");
    expect(adapters.codex).toHaveBeenCalledTimes(3); // Recovery reused the import, not another Make destination.
  });
  it("fails a broken provider run diagnostically, without retrying or fabricating", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      throw new Error("Codex Make failed. Its provider output ends with: stream closed | HTTP 401 unauthorized");
    });
    const { id } = await queueDesign();
    expect(world!.get("EngineJob", id).Status).toBe("failed");
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaProviderFailed");
    expect(world!.log.join("\n")).not.toContain("engine.failed");
    expect(adapters.codex).toHaveBeenCalledTimes(3); // The failure is recorded once; nothing is retried automatically.
    const writeDirectory = adapters.codex.mock.calls[2][0].makeSession.directory;
    const recorded = JSON.parse(fs.readFileSync(path.join(writeDirectory, "provider-error.json"), "utf8"));
    expect(recorded).toMatchObject({ runner: "codex", recovered: null });
    expect(recorded.error).toContain("HTTP 401 unauthorized");
    expect(fs.existsSync(path.join(writeDirectory, "provider-started.json"))).toBe(true); // An ambiguous remote state is marked.
  });
  it("recovers the failed attempt on the operator-supplied destination only", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      throw new Error("Codex Make failed. Its provider output ends with: connection reset mid-run");
    });
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaProviderFailed");
    const writeDirectory = adapters.codex.mock.calls[2][0].makeSession.directory;
    fs.writeFileSync(path.join(writeDirectory, "provider-recovery.json"), JSON.stringify({ fileKey: "food-app", decidedAt: new Date().toISOString() }));
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      expect(request.prompt).toContain("APPROVED RECOVERY");
      expect(request.prompt).toContain("https://www.figma.com/make/food-app/");
      expect(request.prompt).not.toContain("Use create_new_file editorType");
      const dir = request.makeSession.directory;
      fs.writeFileSync(path.join(dir, "ux-plan.md"), "# UX plan");
      fs.writeFileSync(path.join(dir, "design-master.md"), "# Recovered interactive import");
      fs.writeFileSync(path.join(dir, "provider-import-receipt.json"), JSON.stringify({ fileKey: "food-app", seedId: "seed-9", status: "imported", previewVerified: false }));
      return { projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null, revision: "seed-9", summary: "Recovered import", error: null };
    });
    world!.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "", ErrorCode: "" });
    await world!.settle();
    expect(world!.get("EngineJob", id).Status).toBe("succeeded");
    const prototype = parseMakePrototype(world!.get("DesignBrief", briefId).PrototypeJson)!;
    const artifact = JSON.parse(world!.fileBytes(prototype.artifactFileId)!.toString());
    expect(artifact.recoveredFileKey).toBe("food-app");
  });
  it("rejects a recovered run that answers with another destination and then accepts the right one", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      throw new Error("Codex Make failed. Its provider output ends with: connection reset mid-run");
    });
    const { id } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaProviderFailed");
    const writeDirectory = adapters.codex.mock.calls[2][0].makeSession.directory;
    fs.writeFileSync(path.join(writeDirectory, "provider-recovery.json"), JSON.stringify({ fileKey: "food-app", decidedAt: new Date().toISOString() }));
    const destinations = ["other-app", "food-app"];
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      const destination = destinations.shift() ?? "food-app";
      const dir = request.makeSession.directory;
      fs.writeFileSync(path.join(dir, "ux-plan.md"), "# UX plan");
      fs.writeFileSync(path.join(dir, "design-master.md"), "# Recovered interactive import");
      fs.writeFileSync(path.join(dir, "provider-import-receipt.json"), JSON.stringify({ fileKey: destination, seedId: "seed-9", status: "imported", previewVerified: false }));
      return { projectUrl: `https://www.figma.com/make/${destination}/`, previewUrl: null, revision: "seed-9", summary: "Recovered import", error: null };
    });
    world!.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "", ErrorCode: "" });
    await world!.settle();
    // The wrong destination is refused and recorded; it is not silently approved.
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaInvalidResult");
    // The operator's explicit recovery archives the stale provider evidence before the next remote-write run.
    fs.renameSync(path.join(writeDirectory, "provider-started.json"), path.join(writeDirectory, "provider-started.abandoned.json"));
    fs.rmSync(path.join(writeDirectory, "provider-result.json"));
    world!.gw.update("EngineJob", id, { Status: "queued", Attempts: 2, Message: "", ErrorCode: "" });
    await world!.settle();
    expect(world!.get("EngineJob", id).Status).toBe("succeeded");
  });
  it.each(["missing", "wrong-file", "wrong-revision", "pending"])("does not approve a Make import with a %s receipt", async (failure) => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) return { status: "import_only" };
      if (request.makeSession.readOnly) return { status: "ready" };
      const dir = request.makeSession.directory;
      fs.writeFileSync(path.join(dir, "ux-plan.md"), "# UX plan");
      fs.writeFileSync(path.join(dir, "design-master.md"), "# Source handoff");
      if (failure !== "missing") fs.writeFileSync(path.join(dir, "provider-import-receipt.json"), JSON.stringify({
        fileKey: failure === "wrong-file" ? "another-app" : "food-app", seedId: failure === "wrong-revision" ? "old-seed" : "seed-1",
        status: failure === "pending" ? "import_pending" : "imported",
      }));
      return { projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null, revision: "seed-1", summary: "Import response", error: null };
    });
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaImportIncomplete");
    expect(world!.get("DesignBrief", briefId).PrototypeJson).toBeFalsy();
  });
  it("will not create a Make import without operator approval", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    adapters.codex.mockImplementation(async (request) => ({ status: request.makeSession.inspectCapabilities ? "import_only" : "ready" }));
    const { id } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaImportNotApproved");
    expect(adapters.codex).toHaveBeenCalledTimes(2);
  });
  it("does not silently create another Make file for import-only refinement", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "import");
    vi.stubEnv("MF_ENGINE_FIGMA_IMPORT_APPROVED", "1");
    const { id } = await queueDesign("https://www.figma.com/make/existing-app/");
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaRefinementUnavailable");
    expect(adapters.codex).not.toHaveBeenCalled();
  });
  it.each(["missing", "empty"])("does not offer a provider result for approval with %s handoff documents", async (contents) => {
    vi.stubEnv("AI_RUNNER", "codex");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.readOnly) return { status: "ready" };
      if (contents === "empty") {
        fs.writeFileSync(path.join(request.makeSession.directory, "ux-plan.md"), " ");
        fs.writeFileSync(path.join(request.makeSession.directory, "design-master.md"), " ");
      }
      return { projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null, revision: "rev-1", summary: "Provider result", error: null };
    });
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaMissingArtifacts");
    expect(world!.get("DesignBrief", briefId).PrototypeJson).toBeFalsy();
    // The observed remote result is retained for same-job recovery, not blindly regenerated.
    const directory = adapters.codex.mock.calls[0][0].makeSession.directory;
    expect(fs.existsSync(path.join(directory, "provider-result.json"))).toBe(true);
  });
  it("refuses to replace the existing Make project during refinement", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    const { id, briefId } = await queueDesign("https://www.figma.com/make/original-app/");
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.figmaInvalidResult");
    expect(parseMakePrototype(world!.get("DesignBrief", briefId).PrototypeJson)?.projectUrl).toContain("/original-app/");
  });
  it("saves a refinement of the same Make file even when its URL gains an overview path", async () => {
    vi.stubEnv("AI_RUNNER", "codex");
    const { id, briefId } = await queueDesign("https://figma.com/make/food-app/overview");
    expect(world!.get("EngineJob", id).Status).toBe("succeeded");
    expect(adapters.codex.mock.calls[2][0].prompt).toContain("Refine this existing Make project:");
    expect(parseMakePrototype(world!.get("DesignBrief", briefId).PrototypeJson)?.revision).toBe("provider-revision-1");
  });
  it.each(["unsupported", "unavailable", "invalid", "throws"])("stops on %s Make capabilities without a write marker or consumed iteration", async (status) => {
    vi.stubEnv("AI_RUNNER", "codex");
    adapters.codex.mockImplementation(async (request) => {
      if (request.makeSession.inspectCapabilities) {
        if (status === "throws") throw new Error("catalog unavailable");
        return { status };
      }
      if (request.makeSession.readOnly) return { status: "ready" };
      throw new Error("Generation must never start");
    });
    const { id, briefId } = await queueDesign();
    expect(world!.get("EngineJob", id).ErrorCode).toBe(status === "unsupported" ? "design.figmaUnsupported" : "design.figmaUnavailable");
    expect(adapters.codex).toHaveBeenCalledTimes(2);
    expect(world!.get("DesignBrief", briefId).PrototypeJson).toBeFalsy();
    const directory = adapters.codex.mock.calls[0][0].makeSession.directory;
    expect(fs.existsSync(path.join(directory, "provider-started.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "state"))).toBe(false);
  });
});
