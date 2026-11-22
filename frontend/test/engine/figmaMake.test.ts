// The planner's Figma Make job (design.generate of a Mode "figma" brief), with a stubbed Make runner instead of the
// Claude CLI: the engine refuses to run without the owner-host configuration and consent, keeps the checkpoints
// across a failed attempt (no duplicate remote work), stores the versioned deliverable, and a stale source never
// writes anything. Pure helpers (URLs, the source fingerprint) come first.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/figmaMake.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { designSource, makePreviewUrl, makeProjectUrl, parseMakePrototype } from "../../src/domain/figmaMake";
import { acceptMakeResult, setMakeRunner } from "../../server/local/engine/kinds/scope/figmaMake";
import { makeWorld, type World } from "./harness";
import { projectWorkspace } from "../../server/local/engine/projectFolder";
import type { Row } from "../../functions/_lib/gateway";

const s = (v: unknown) => (typeof v === "string" ? v : "");

describe("the Make deliverable's contract (pure)", () => {
  it("accepts the Make project URL and the published figma.site preview, and nothing else", () => {
    expect(makeProjectUrl("https://www.figma.com/make/fieldflow-demo/")).toContain("figma.com/make/fieldflow-demo");
    expect(makeProjectUrl("https://figma.com/make/fieldflow-demo/overview")).toBeTruthy();
    expect(makeProjectUrl("https://figma.com/make/x?q=invite")).toBeTruthy(); // links can carry a query
    for (const bad of ["http://figma.com/make/x", "https://evil.com/make/x", "https://figma.malicious.com/make/x", "https://figma.com/design/x", "https://user:pw@figma.com/make/x"]) {
      expect(makeProjectUrl(bad)).toBeNull();
    }
    expect(makePreviewUrl("https://ofieldflow-demo.figma.site")).toBeTruthy();
    expect(makePreviewUrl("https://fieldflow-demo.figma.site")).toBeTruthy();
    expect(makePreviewUrl("https://fieldflow-demo.figma.site/")).toBeTruthy();
    for (const bad of ["https://figma.site", "https://fieldflow-demo.evil.site", "https://www.figma.com/make/x", "https://x.figma.site:8443", "ftp://a.figma.site"]) {
      expect(makePreviewUrl(bad)).toBeNull();
    }
  });

  it("parses a stored reference with both URLs optional-safe, and rejects any tampered one", () => {
    const proto = parseMakePrototype({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/fieldflow-demo/", previewUrl: null,
      revision: "rev-7", source: "ux-1-2", jobId: "job-1", artifactFileId: "file-1",
    });
    expect(proto).toMatchObject({ provider: "figma-make", revision: "rev-7", previewUrl: null });
    expect(parseMakePrototype({ ...proto, projectUrl: "https://evil.com/make/x" })).toBeNull();
    expect(parseMakePrototype({ ...proto, previewUrl: "https://evil.site" })).toBeNull();
    expect(parseMakePrototype({ ...proto, provider: "other" })).toBeNull();
    expect(parseMakePrototype({ ...proto, revision: "" })).toBeNull();
    expect(parseMakePrototype("not json")).toBeNull();
  });

  it("the source fingerprint follows the direction and the requirement keys, not their order", () => {
    const reqs = [
      { key: "R1", title: "Assign work", text: "Managers assign technicians.", criteria: ["Assignments persist"] },
      { key: "R2", title: "Urgency", text: "Urgent requests stand out.", criteria: [] },
    ];
    const a = designSource("Calm, premium feel", reqs);
    expect(a).toBe(designSource("Calm, premium feel", [...reqs].reverse()));
    expect(a).not.toBe(designSource("Loud, playful feel", reqs));
    expect(a).not.toBe(designSource("Calm, premium feel", reqs.map((r) => ({ ...r, criteria: ["extra"] }))));
  });

  it("the engine accepts only a provider-true result", () => {
    const good = { projectUrl: "https://www.figma.com/make/fieldflow-demo/", previewUrl: null, revision: "rev-1", summary: "ok" };
    expect(acceptMakeResult(good)).toMatchObject({ revision: "rev-1" });
    expect(acceptMakeResult({ ...good, previewUrl: "https://fieldflow.figma.site" })).toMatchObject({ previewUrl: "https://fieldflow.figma.site/" });
    expect(acceptMakeResult({ ...good, projectUrl: "https://evil.com/make/x" })).toBeNull();
    expect(acceptMakeResult({ ...good, revision: "  " })).toBeNull();
    expect(acceptMakeResult(null)).toBeNull();
  });
});

describe("design.generate of a figma brief on the engine", { timeout: 20000 }, () => {
  let w: World;
  let root: string;
  const result = () => ({
    projectUrl: "https://www.figma.com/make/fieldflow-demo/",
    previewUrl: "https://fieldflow-demo.figma.site",
    revision: "rev-01",
    summary: "Five screens with the flows checked",
  });

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-figma-"));
    fs.writeFileSync(path.join(root, "mcp.json"), '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"}}}');
    w = await makeWorld({ engine: { projectFolder: (ws, pid) => projectWorkspace(root, ws, pid) } });
  }, 20000);
  beforeEach(() => {
    vi.stubEnv("MF_ENGINE_FIGMA_ENABLED", "");
    vi.stubEnv("MF_ENGINE_FIGMA_MCP_CONFIG", "");
    vi.stubEnv("MF_ENGINE_FIGMA_WORKFLOW", "agent");
    vi.stubEnv("MF_ENGINE_FIGMA_CREDITS_APPROVED", "1");
    vi.stubEnv("AI_RUNNER", "codex");
    // No test may launch the developer's authenticated CLI, even if a guard regresses.
    setMakeRunner(async () => { throw new Error("Unexpected provider invocation in a test"); });
    for (const name of ["auth", "state"]) fs.mkdirSync(path.join(root, name), { recursive: true });
    vi.stubEnv("MF_ENGINE_FIGMA_AUTH_DIR", path.join(root, "auth"));
    vi.stubEnv("MF_ENGINE_FIGMA_STATE_DIR", fs.mkdtempSync(path.join(root, "state-")));
  });
  afterAll(() => {
    w?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  afterEach(() => {
    setMakeRunner(null);
    vi.unstubAllEnvs();
  });

  /** The seeded project's brief as a figma one. */
  function makeFigma(project: string) {
    const p = w.project(project);
    const brief = w.rows("DesignBrief", s(p.ItemId))[0]!;
    w.gw.update("DesignBrief", s(brief.ItemId), { Mode: "figma", Status: "draft" });
    const source = designSource(s(brief.Instructions), (w.rows("Requirement", s(p.ItemId)) as Row[]).map((r) => ({
      key: s(r.Key) || s(r.ItemId), title: s(r.Title), text: s(r.Text), criteria: Array.isArray(r.AcceptanceCriteria) ? (r.AcceptanceCriteria as string[]).map(String) : [], status: s(r.Status),
    })));
    return { pid: s(p.ItemId), brief, source };
  }

  const queueFigma = async (pid: string, brief: Row, source: string, o: { credits?: boolean; source?: string } = {}) =>
    w.queue({
      project: "Payroll Self-Service",
      kind: "design.generate",
      input: { projectId: pid, designBriefId: s(brief.ItemId), source: o.source ?? source, feedback: "", ...(o.credits ? { acknowledgeFigmaCredits: true } : {}) },
      target: { type: "design-brief", id: s(brief.ItemId) },
    });

  it("refuses to run without the owner engine's Figma configuration", async () => {
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status).toBe("failed");
    expect(String(j.Message)).toContain("Figma Make is not connected");
    expect(s(w.get("DesignBrief", s(brief.ItemId)).PrototypeJson)).toBe("");
  });

  it("requires operator billing approval even when a client supplies credit consent", async () => {
    const cfg = path.join(root, "mcp.json");
    fs.writeFileSync(cfg, '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"}}}');
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = cfg;
    vi.stubEnv("MF_ENGINE_FIGMA_CREDITS_APPROVED", "");
    setMakeRunner(async (request) => {
      if (request.makeSession?.readOnly) return { status: "ready" };
      throw new Error("Paid generation must not run");
    });
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("failed");
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaBillingNotApproved");
  });

  it("a stale source is refused before any remote work happens", async () => {
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = path.join(root, "mcp.json");
    setMakeRunner(async () => {
      throw new Error("the runner must never be called for a stale source");
    });
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, `${source.slice(0, -1)}0`, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("failed");
    expect(String(w.get("EngineJob", id).Message)).toContain("Requirements or design direction changed");
  });

  it("stores the versioned deliverable of a provider-true run, and never re-runs a checkpointed attempt", async () => {
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = path.join(root, "mcp.json");
    let calls = 0;
    setMakeRunner(async (req) => {
      if (req.makeSession?.readOnly) return { status: "ready" };
      calls++;
      expect(req.makeSession?.directory).toBeTruthy();
      // the skill and the request arrive; the runner writes the handoff documents the way the provider workspace has them
      fs.writeFileSync(path.join(req.makeSession!.directory, "ux-plan.md"), "# UX plan\nJourneys and screens");
      fs.writeFileSync(path.join(req.makeSession!.directory, "design-master.md"), "# Design master\nScreens and tokens");
      fs.writeFileSync(path.join(req.makeSession!.directory, "provider-result.json"), JSON.stringify(result()));
      return result();
    });
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status, w.log.join("\n")).toBe("succeeded");
    expect(calls).toBe(1);
    const briefRow = w.get("DesignBrief", s(brief.ItemId));
    expect(briefRow.Status).toBe("draft");
    const proto = parseMakePrototype(briefRow.PrototypeJson);
    expect(proto).toMatchObject({ provider: "figma-make", revision: "rev-01", artifactFileId: expect.any(String) });
    expect(j.OutputRefs as string[]).toContain(`DesignBrief:${s(brief.ItemId)}`);
    const artifact = w.fileBytes(s(proto!.artifactFileId))?.toString();
    expect(artifact).toContain("Design master");
    expect(artifact).toContain("UX plan");
    // the same attempt run again (the engine restarted mid-run) resumes from the saved provider result without
    // touching Figma again
    w.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    expect(calls).toBe(1);
  });

  it("a started attempt without a saved result is never blindly re-run: it is refused until recovered", async () => {
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = path.join(root, "mcp.json");
    let calls = 0;
    setMakeRunner(async (req) => {
      if (req.makeSession?.readOnly) return { status: "ready" };
      calls++;
      fs.writeFileSync(path.join(req.makeSession!.directory, "ux-plan.md"), "# UX plan\nJourneys");
      fs.writeFileSync(path.join(req.makeSession!.directory, "design-master.md"), "# Design master\nTokens");
      return { ...result(), revision: "" }; // the provider answered without a revision: not a usable answer
    });
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("failed");
    // the retry of this attempt is refused: its started checkpoint stands until the result is recovered or reset
    w.gw.update("EngineJob", id, { Status: "queued", Attempts: 1, Message: "" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("failed");
    expect(String(w.get("EngineJob", id).Message)).toContain("Recover");
    expect(calls).toBe(1);
    const next = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", next).ErrorCode).toBe("design.figmaRecoveryRequired");
    expect(calls).toBe(1);
  });

  it("stops before provider writes when the persistent account needs reconnecting", async () => {
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = path.join(root, "mcp.json");
    let writes = 0;
    setMakeRunner(async (req) => {
      if (req.makeSession?.readOnly) return { status: "reconnect_required" };
      writes++;
      return result();
    });
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaReconnect");
    expect(writes).toBe(0);
    expect(String(w.get("EngineJob", id).Message)).toContain("Reconnect Figma");
  });

  it("fails honestly when the connection exposes no Make prompting capability", async () => {
    process.env.MF_ENGINE_FIGMA_ENABLED = "1";
    process.env.MF_ENGINE_FIGMA_MCP_CONFIG = path.join(root, "mcp.json");
    setMakeRunner(async () => ({ status: "unsupported" }));
    const { pid, brief, source } = makeFigma("Payroll Self-Service");
    const id = await queueFigma(pid, brief, source, { credits: true });
    await w.settle();
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaUnsupported");
  });
});
