// The outputs of a project (engine-context/outputs.ts) count and describe only the features in the locked scope; the
// ones set aside ("Not included", status dropped) are listed apart (live QA 01.11: "9 features" for 5 + 4 set aside).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeProjectOutputs } from "../../server/engine-context/outputs.ts";
import { writeReport, type OnboardingReport } from "../../server/local/engine/official/onboarding.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-outputs-scope-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("What MADP produced: the scope's features", () => {
  it("counts the features in scope and lists the ones not included apart", async () => {
    const project = path.join(dir, "ws-1", "p-1");
    fs.mkdirSync(path.join(project, "artifacts", "brief"), { recursive: true });
    fs.writeFileSync(path.join(project, "project.json"), JSON.stringify({ projectId: "p-1", workspaceId: "ws-1", name: "Café site" }));
    const feature = (key: string, title: string, status: string, priority: string) => ({ ref: `Feature:${key}`, key, title, description: `${title}.`, priority, status, requirementRefs: [], stories: status === "dropped" ? [] : [{ title: `${title} story`, acceptance: ["works"] }] });
    fs.writeFileSync(path.join(project, "artifacts", "brief", "context.json"), JSON.stringify({
      version: 3,
      sections: {
        basics: { name: "Café site", goal: "Serve guests" },
        scope: { locked: 1, versions: [{ number: 1, status: "locked", features: [feature("menu", "Café menu", "planned", "must"), feature("contact", "Contact form", "planned", "must"), feature("shop", "Online shop", "dropped", "later")] }] },
      },
    }));
    const m = await writeProjectOutputs(project);
    expect(m.summary).toMatch(/\b2 features\b/);
    const prd = fs.readFileSync(path.join(project, "artifacts", "requirements", "PRD.md"), "utf8");
    expect(prd).toContain("### Café menu");
    expect(prd).not.toContain("### Online shop");
    expect(prd).toMatch(/## Not included\n\n- \*\*Online shop\*\*/);
    const overview = fs.readFileSync(path.join(project, "artifacts", "docs", "business-overview.md"), "utf8");
    expect(overview).not.toContain("Online shop");
  });

  it("shows the product's onboarding on the MADP engine first, in plain words", async () => {
    const project = path.join(dir, "ws-1", "p-2");
    fs.mkdirSync(path.join(project, "madp"), { recursive: true });
    fs.writeFileSync(path.join(project, "project.json"), JSON.stringify({ projectId: "p-2", workspaceId: "ws-1", name: "Ledger" }));
    const report: OnboardingReport = {
      schema: "madp-onboarding/1", product: "ledger", checkedAt: "2026-11-05T10:00:00.000Z", liveTests: "off",
      repos: [{ key: "web", repo: "example-org/ledger-web", branch: "dev", commit: "abc1234" }],
      checks: [
        { id: "web.verify.build", repo: "web", kind: "verify", name: "build", result: "pass", reason: "", detail: "", seconds: 3, inGate: true, decision: "in the engine's checks: it passes" },
        { id: "web.fast_verify.i18n", repo: "web", kind: "fast_verify", name: "i18n", result: "fail", reason: "the language files do not match (missing, extra or empty keys)", detail: "missing_key x", seconds: 1, inGate: false, decision: "left out of the engine's checks: the language files do not match (missing, extra or empty keys)" },
      ],
      notRunnable: [], languages: null, attention: ["The check \"i18n\" of web fails on its dev branch as it is now."], notes: [], summary: "1 of 2 checks passed on the dev branch as it is; 1 check failed and needs the product's team.",
    };
    writeReport(path.join(project, "madp"), report);
    const m = await writeProjectOutputs(project);
    expect(m.sections[0]).toMatchObject({ id: "engine", title: "On the MADP engine" });
    expect(m.sections[0]!.items[0]).toMatchObject({ path: "engine/ONBOARDING.md", status: "open" });
    const md = fs.readFileSync(path.join(project, "artifacts", "engine", "ONBOARDING.md"), "utf8");
    expect(md).toContain("## Needs your team");
    expect(md).not.toContain("missing_key x");
  });
});
