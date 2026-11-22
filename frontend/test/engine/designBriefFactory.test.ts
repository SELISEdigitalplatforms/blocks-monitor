// The interactive (non-Figma) design path works from the same design brief and style direction as the Figma screens:
// the business analyst's brief is saved with the job's files, the designer's prompt carries the house principles, the
// chosen direction and the brief, the revision records its style, and the hashed intent stays as queued.
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeWorld, type World } from "./harness";
import { designIntent, factoryDesignSource, parseFactoryPrototype } from "../../src/domain/factoryDesign";
import { setFactoryDesignRunner } from "../../server/local/engine/kinds/scope/factoryDesign";
import { setDesignSkillDir } from "../../server/local/engine/kinds/scope/designKit";
import { FALLBACK_REASON } from "../../server/local/engine/kinds/scope/designerBrief";
import { projectWorkspace } from "../../server/local/engine/projectFolder";
import { PRINCIPLES_MARKER, writeSkillTree } from "./designSkillFixture";

let world: World | undefined;
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "factory-brief-test-")); setDesignSkillDir(writeSkillTree(path.join(root, "kit"))); });
afterEach(() => { world?.close(); world = undefined; setFactoryDesignRunner(null); setDesignSkillDir(null); fs.rmSync(root, { recursive: true, force: true }); });

const find = (dir: string, name: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? find(path.join(dir, e.name), name) : e.name === name ? [path.join(dir, e.name)] : []);

it("designs the interactive revision from the brief and the chosen style direction, without changing the intent", async () => {
  world = await makeWorld({ engine: { projectFolder: (ws, pid) => projectWorkspace(path.join(root, "projects"), ws, pid) } });
  const project = world.project("Payroll Self-Service"), pid = String(project.ItemId);
  const brief = world.rows("DesignBrief", pid)[0];
  world.gw.update("DesignBrief", String(brief.ItemId), { Mode: "figma", Status: "draft" });
  const intent = designIntent(project, world.rows("Objective", pid)[0], world.rows("Requirement", pid), world.rows("RequirementExtra", pid));
  const source = factoryDesignSource(intent);
  const calls: any[] = [];
  setFactoryDesignRunner(async (req) => {
    calls.push(req);
    if (calls.length === 1) return { status: "aligned", conflicts: [], rationale: "Checked scope" };
    if (calls.length === 2) return { html: "<!doctype html><html><body><h1>Payroll</h1></body></html>", uxPlan: "Journeys", designMaster: "Screens", coverage: intent.requirements.map((r) => ({ key: r.key, screens: ["review"], criteria: r.criteria })) };
    return { status: "aligned", findings: [] };
  });
  const id = await world.queue({ project: "Payroll Self-Service", kind: "design.generate", input: {
    projectId: pid, designBriefId: brief.ItemId, source, previousRevision: null, feedback: "", workflow: "factory", intent,
  }, target: { type: "design-brief", id: String(brief.ItemId) } });
  await world.settle();
  expect(world.get("EngineJob", id).Status, world.log.join("\n")).toBe("succeeded");

  const system = calls[1].system as string;
  expect(system).toContain(PRINCIPLES_MARKER);
  expect(system).toContain("STYLE MARKER quiet-ledger");
  expect(system).toContain("RECIPE MARKER app-shell");
  expect(system).toContain(`# Design brief: ${String(project.Name)}`);
  expect(system).toContain("You are the product UX designer. Follow the chosen style direction and the house principles above");
  expect(system).not.toContain("SKILL BODY MARKER");
  // the engine asks no one in unit tests: the default direction, the closest general fit
  const prototype = parseFactoryPrototype(world.get("DesignBrief", String(brief.ItemId)).PrototypeJson)!;
  expect((prototype as unknown as { style: unknown }).style).toEqual({ styleId: "quiet-ledger", styleName: "Quiet Ledger", reason: FALLBACK_REASON });
  expect(prototype.source).toBe(source);
  const briefs = find(path.join(root, "projects"), "design-brief.md");
  expect(briefs).toHaveLength(1);
  expect(briefs[0]).toContain(path.join("design-ref", id));
  expect(fs.readFileSync(briefs[0], "utf8")).toContain("## Style direction: Quiet Ledger");
  expect(JSON.parse(calls[1].prompt.split("\n\nPrevious editable source")[0]).intent).toEqual(intent);
});
