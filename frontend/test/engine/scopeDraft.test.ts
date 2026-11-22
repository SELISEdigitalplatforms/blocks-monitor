// scope.draft on the seeded store: a project that reaches Scope & success with requirements but no features gets a
// complete first plan (features, user stories, milestones, success & performance targets) that passes the lock's own
// rules and the schema validations, and a second run never drafts again. Plus the screen names design.generate gives
// a project without features: short names, never sentence fragments.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRowValid } from "../../functions/_lib/testing";
import type { Row } from "../../functions/_lib/gateway";
import { validateMilestonePlan } from "../../src/domain/milestones";
import { parseSuccessTargets, successBlockers } from "../../src/domain/successTargets";
import * as scope from "../../src/blocks/scope/records";
import { lockChecklist } from "../../src/components/scope/blocks/pageState";
import { startsWithVerb } from "../../server/local/engine/kinds/scope/naming";
import { makeWorld, type World } from "./harness";

const FORBIDDEN = /simulat|\bmock|\bdemo\b|\bsample\b|\bexample\b|test data|\bfake\b|prototype|lorem/i;
const s = (v: unknown) => (typeof v === "string" ? v : "");

function done(w: World, id: string): Row {
  const j = w.get("EngineJob", id);
  if (j.Status !== "succeeded") throw new Error(`job ${s(j.Kind)} ${s(j.Status)}: ${s(j.Message)}\n${w.log.join("\n")}`);
  return j;
}

describe("scope.draft", () => {
  let w: World;
  let pid: string;
  beforeAll(async () => {
    w = await makeWorld();
    const p = w.project("Payroll Self-Service");
    pid = s(p.ItemId);
    // the project has just reached Scope & success: requirements, no scope yet
    await w.gw.update("Project", pid, { Stage: "scope" });
    for (const r of w.rows("ScopeVersion", pid)) await w.gw.remove("ScopeVersion", s(r.ItemId));
    for (const schema of ["Feature", "Story", "Milestone"]) for (const r of w.rows(schema, pid)) await w.gw.remove(schema, s(r.ItemId));
  });
  afterAll(() => w?.close());

  it("drafts features, stories, milestones and targets that pass the lock rules", async () => {
    const reqs = w.rows("Requirement", pid).filter((r) => r.Status !== "dropped");
    expect(reqs.length).toBeGreaterThan(2);
    const id = await w.queue({ project: "Payroll Self-Service", kind: "scope.draft", input: { projectId: pid, scopeVersion: 1 }, target: { type: "project", id: pid } });
    await w.settle();
    const j = done(w, id);
    expect(s(j.Message)).toMatch(/^Drafted \d+ features? with \d+ user stor(y|ies) in \d+ milestones?\.$/);

    const versions = w.rows("ScopeVersion", pid);
    expect(versions).toHaveLength(1);
    const v = versions[0]!;
    expect(v).toMatchObject({ Number: 1, Status: "draft" });
    expect(() => assertRowValid("ScopeVersion", v, { read: true })).not.toThrow();
    expect(scope.scopeVersionFromRow(v)).not.toBeNull();
    expect(s(v.RequestKey)).toContain(`l7:${pid}:scopeVersion:1`);

    const features = w.rows("Feature", pid);
    const stories = w.rows("Story", pid);
    const milestones = w.rows("Milestone", pid);
    const included = features.filter((f) => f.Status !== "dropped");
    expect(included.length).toBeGreaterThan(1);
    const reqKeys = new Set(reqs.map((r) => s(r.Key)));
    for (const f of features) {
      expect(() => assertRowValid("Feature", f, { read: true })).not.toThrow();
      expect(scope.featureFromRow(f)).not.toBeNull();
      expect(s(f.Title)).not.toMatch(FORBIDDEN);
      expect(s(f.Title).length).toBeLessThanOrEqual(60);
      expect(s(f.Title)[0]).toMatch(/[A-Z0-9]/);
      for (const ref of f.RequirementRefs as string[]) expect(reqKeys.has(ref.replace(/^requirement:/, ""))).toBe(true);
    }
    for (const st of stories) {
      expect(() => assertRowValid("Story", st, { read: true })).not.toThrow();
      expect(s(st.Text)).toMatch(/^As (a|an|the) [^,]+, I want /);
      expect(s(st.Text)).not.toMatch(/\bI want to have\b|\bhave have\b|\s{2,}/);
    }
    for (const m of milestones) expect(() => assertRowValid("Milestone", m, { read: true })).not.toThrow();

    // the lock's own checks: every included feature has stories and is in exactly one milestone, no milestone empty
    const checklist = lockChecklist(
      features.map((f) => ({ id: s(f.ItemId), ref: `feature:${s(f.Key)}`, priority: f.Status === "dropped" ? "excluded" : s(f.Priority) })),
      stories.map((st) => ({ featureId: s(features.find((f) => `feature:${s(f.Key)}` === st.FeatureRef)?.ItemId), text: s(st.Text) })),
      milestones.map((m) => ({ featureRefs: m.FeatureRefs as string[] })),
    );
    expect(checklist.filter((c) => !c.ok)).toEqual([]);
    const refs = milestones.flatMap((m) => m.FeatureRefs as string[]);
    expect(new Set(refs).size).toBe(refs.length);
    expect(validateMilestonePlan(
      milestones.map((m) => ({ id: s(m.ItemId), name: s(m.Name), goal: s(m.Goal), featureRefs: m.FeatureRefs as string[] })),
      included.map((f) => `feature:${s(f.Key)}`),
      "lock",
    )).toEqual([]);

    // the milestone goals say what people can do, never "can <a feature name>"
    for (const m of milestones) {
      for (const can of s(m.Goal).matchAll(/\bcan (\w+)/g)) expect(startsWithVerb(can[1]!), s(m.Goal)).toBe(true);
      expect(s(m.Name).length).toBeLessThanOrEqual(60);
    }

    // the targets the product manager proposes: nothing left that blocks the lock
    expect(successBlockers(parseSuccessTargets(v.SuccessTargets))).toEqual([]);
  });

  it("never drafts again: a second job changes nothing", async () => {
    const before = w.rows("Feature", pid).length;
    const id = await w.queue({ project: "Payroll Self-Service", kind: "scope.draft", input: { projectId: pid, scopeVersion: 1 }, target: { type: "project", id: pid }, key: "again" });
    await w.settle();
    const j = done(w, id);
    expect(s(j.Message)).toMatch(/already has features; nothing was drafted/);
    expect(w.rows("Feature", pid).length).toBe(before);
  });

  it("design.generate requires a Make request instead of inventing screenshot screens for a project without features", async () => {
    const p = w.project("Client Document Portal");
    const id0 = s(p.ItemId);
    const brief = w.rows("DesignBrief", id0)[0];
    if (!brief) return;
    await w.gw.update("DesignBrief", s(brief.ItemId), { Status: "confirmed", ConfirmedAt: w.now().toISOString(), ConfirmedByUserId: s(p.AssigneeUserId) });
    for (const r of w.rows("Feature", id0)) await w.gw.remove("Feature", s(r.ItemId));
    for (const r of w.rows("DesignScreen", id0)) await w.gw.remove("DesignScreen", s(r.ItemId));
    const id = await w.queue({ project: "Client Document Portal", kind: "design.generate", input: { projectId: id0, designBriefId: s(brief.ItemId) }, target: { type: "design-brief", id: s(brief.ItemId) } });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("failed");
    expect(w.get("EngineJob", id).ErrorCode).toBe("design.figmaRequestRequired");
    const names = w.rows("DesignScreen", id0).filter((x) => x.EngineJobId === id).map((x) => s(x.Name));
    expect(names).toEqual([]);
  });
});
