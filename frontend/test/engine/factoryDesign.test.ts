import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeWorld, type World } from "./harness";
import { designIntent, factoryDesignSource, parseFactoryPrototype } from "../../src/domain/factoryDesign";
import { setFactoryDesignRunner } from "../../server/local/engine/kinds/scope/factoryDesign";
import { projectWorkspace } from "../../server/local/engine/projectFolder";

let world: World | undefined;
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-design-test-")); });
afterEach(() => { world?.close(); world = undefined; setFactoryDesignRunner(null); fs.rmSync(root, { recursive: true, force: true }); });
async function queue(feedback = "", conflict = false, drift = false, repairReview = false) {
  world = await makeWorld({ engine: { projectFolder: (ws, pid) => projectWorkspace(root, ws, pid) } }); const project = world.project("Payroll Self-Service"), pid = String(project.ItemId);
  const brief = world.rows("DesignBrief", pid)[0];
  world.gw.update("DesignBrief", String(brief.ItemId), { Mode: "figma", Status: "draft" });
  const intent = designIntent(project, world.rows("Objective", pid)[0], world.rows("Requirement", pid), world.rows("RequirementExtra", pid));
  const calls: any[] = [];
  const deliverable = { html: "<!doctype html><html><body><h1>Payroll</h1><button>Review</button></body></html>", uxPlan: "Goal-mapped journeys", designMaster: "Screens and limitations", coverage: intent.requirements.map((r) => ({ key: r.key, screens: ["review"], criteria: r.criteria })) };
  setFactoryDesignRunner(async (req) => {
    calls.push(req);
    if (calls.length === 1) return { status: conflict ? "requirements_change_required" : "aligned", conflicts: conflict ? ["Feedback changes the goal"] : [], rationale: "Checked scope" };
    if (calls.length === 2 || repairReview && calls.length === 4) return deliverable;
    if (repairReview && calls.length === 3) return { status: "changes_required", findings: ["Lock the cart while sending"] };
    if (drift) world!.gw.update("Project", pid, { Goal: "Changed while running" });
    return { status: "aligned", findings: ["Realtime remains a clearly disclosed local simulation."] };
  });
  const id = await world.queue({ project: "Payroll Self-Service", kind: "design.generate", input: {
    projectId: pid, designBriefId: brief.ItemId, source: factoryDesignSource(intent), previousRevision: null, feedback, workflow: "factory", intent,
  }, target: { type: "design-brief", id: String(brief.ItemId) } });
  await world.settle(); return { id, briefId: String(brief.ItemId), calls };
}
describe("headless Factory design writer", () => {
  it("performs one bounded review repair and rechecks it before saving a revision", async () => {
    const { id, calls } = await queue("Improve spacing", false, false, true);
    expect(world!.get("EngineJob", id).Status, world!.log.join("\n")).toBe("succeeded");
    expect(calls).toHaveLength(5); expect(calls[3].prompt).toContain("Lock the cart while sending");
  });
  it("creates an independently reviewed, requirement-mapped draft without Figma or browser sign-in", async () => {
    const { id, briefId, calls } = await queue();
    expect(world!.get("EngineJob", id).Status, world!.log.join("\n")).toBe("succeeded");
    const brief = world!.get("DesignBrief", briefId), prototype = parseFactoryPrototype(brief.PrototypeJson)!;
    expect(brief.Status).toBe("draft"); expect(prototype.provider).toBe("factory");
    expect(prototype.previewUrl).toContain(`/api/design-preview/${prototype.projectId}/`);
    expect(JSON.parse(world!.fileBytes(prototype.artifactFileId)!.toString()).intent).toBeTruthy();
    expect(calls).toHaveLength(3); expect(calls.every((c) => c.makeSession === undefined)).toBe(true);
  });
  it("blocks scope-changing feedback before generating or storing a revision", async () => {
    const { id, calls, briefId } = await queue("Remove an agreed restriction", true);
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.requirementsChangeRequired");
    expect(calls).toHaveLength(1); expect(world!.get("DesignBrief", briefId).PrototypeJson).toBeFalsy();
  });
  it("refuses a revision when the goal changes while it runs", async () => {
    const { id, briefId } = await queue("Improve spacing", false, true);
    expect(world!.get("EngineJob", id).ErrorCode).toBe("design.stale");
    expect(world!.get("DesignBrief", briefId).PrototypeJson).toBeFalsy();
  });
});
