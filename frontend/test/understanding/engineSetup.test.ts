// The local engine reads the project's setup answers: the product manager's questions ask what the setup leaves open
// (above all the success and performance targets), a note that repeats the setup is read once, and the draft takes the
// must-haves' priorities, leaves the exclusions out and writes the goal, workflows, constraints and approver into the
// objective. Pure parts first, then one project of the seeded store.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { parseOutputRef } from "../../src/domain/engineJob";
import { isNotSure, setupGaps, setupLines, type SetupAnswers } from "../../server/local/engine/kinds/analysis/setup";
import { asideReason, LATER_REASON, NOT_SURE_REASON, NOT_SURE_REASONS_BEFORE } from "../../src/components/sanitization/understandingModel";
import { makeWorld, type World } from "../engine/harness";

const FORBIDDEN = /\b(simulated|simulation|mock|demo|sample|example|test data|fake|prototype|lorem|placeholder)\b/i;

const EMPTY: SetupAnswers = {
  goal: "", targetUsers: "", appUrl: "", testEnv: null, runInstructions: "", mustHaves: [], workflows: [], exclusions: [], constraints: [],
  intendedChanges: "", changeTags: [], approvalOwnerUserId: "", approvalOwnerName: "",
};
const CTX = { productNoun: "portal", client: "Alpine Fresh AG", existing: false, all: "", actor: { name: "users" }, todayMeasure: null, wishes: 0 };

describe("setup gaps (pure)", () => {
  it("an empty setup asks for the goal, the users and the targets, in that order", () => {
    const ids = setupGaps(EMPTY, CTX).map((g) => g.id);
    expect(ids.slice(0, 5)).toEqual(["goal", "users", "success", "users-at-once", "speed"]);
    for (const g of setupGaps(EMPTY, CTX)) {
      expect(g.question).toMatch(/\?$/);
      expect(g.question).not.toMatch(FORBIDDEN);
    }
  });

  it("what the material already says is not asked again", () => {
    const all = "about 850 clients, 40 at the same time in february. the list opens within 2 seconds. success: 50% less time chasing documents. 2000 receipts per year";
    const ids = setupGaps({ ...EMPTY, goal: "Less chasing", targetUsers: "Clients" }, { ...CTX, all, actor: { name: "clients", count: 850 }, wishes: 3 }).map((g) => g.id);
    expect(ids).toEqual([]);
  });

  it("users counted in the material are named in the question, with the peak", () => {
    const q = setupGaps(EMPTY, { ...CTX, all: "peak: february to april (tax returns)", actor: { name: "clients", count: 850 }, wishes: 2 }).find((g) => g.id === "users-at-once")!;
    expect(q.question).toMatch(/^About 850 clients are mentioned\. How many of them use it at the same time at the busiest moment \(peak: february to april/);
  });

  it("existing product: what should change, a test version and how it is started", () => {
    const ids = setupGaps({ ...EMPTY, testEnv: { available: "no" } }, { ...CTX, existing: true, wishes: 2, actor: { name: "clients", count: 9 } }).map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(["changes", "test-version", "run"]));
    const slow = setupGaps(EMPTY, { ...CTX, existing: true, all: "the portal is slow" }).find((g) => g.id === "speed")!;
    expect(slow.question).toMatch(/described as slow today/);
  });

  it("a constraint picked without words is asked about", () => {
    const gaps = setupGaps({ ...EMPTY, constraints: [{ kind: "deadline", text: "" }, { kind: "budget", text: "CHF 80 000" }] }, CTX);
    expect(gaps.some((g) => g.id === "constraint-deadline")).toBe(true);
    expect(gaps.some((g) => g.id === "constraint-budget")).toBe(false);
  });

  it("lines: must-haves keep their priority, exclusions are kept apart, constraints read as requirements", () => {
    const lines = setupLines({
      ...EMPTY, goal: "Suppliers upload certificates themselves.", mustHaves: [{ text: "Upload certificates", priority: "must" }, { text: "Expiry reminders", priority: "could" }],
      exclusions: ["Online payments"], constraints: [{ kind: "languages", text: "German and French" }, { kind: "deadline", text: "1 March" }],
    });
    expect(lines.find((l) => l.text === "Upload certificates")).toMatchObject({ kind: "wish", priority: "must" });
    expect(lines.find((l) => l.text === "Expiry reminders")).toMatchObject({ priority: "later" });
    expect(lines.find((l) => l.text === "Online payments")).toMatchObject({ kind: "excluded" });
    expect(lines.find((l) => l.heading === "Constraints" && l.kind === "constraint")?.text).toBe("Must be available in German and French");
    expect(lines.find((l) => l.text.startsWith("Deadline"))).toMatchObject({ kind: "fact" });
  });

  it("\"Not sure\": the engine reads the step's standard sentence, new and earlier wordings alike, and the person's own words", () => {
    for (const saved of [NOT_SURE_REASON, ...NOT_SURE_REASONS_BEFORE, asideReason("notSure", "ask Beat")]) expect(isNotSure(saved)).toBe(true);
    expect(isNotSure(LATER_REASON)).toBe(false);
    expect(isNotSure(asideReason("later", "after Friday"))).toBe(false);
  });
});

describe("the engine on a project with setup answers", () => {
  let w: World;
  let pid: string;
  let approver: string;
  const outputs = (jobId: string, schema: string): Row[] =>
    (((w.get("EngineJob", jobId).OutputRefs as string[]) ?? []).map(parseOutputRef).filter((r) => r?.schema === schema) as { id: string }[]).map((r) => w.get(schema, r.id));

  beforeAll(async () => {
    w = await makeWorld();
    const p = w.project("Supplier Quality Portal");
    pid = String(p.ItemId);
    approver = String(w.rows("Membership").find((m) => m.WorkspaceId === p.WorkspaceId && m.Status === "active" && m.UserId !== p.AssigneeUserId)?.UserId);
    await w.gw.update("Project", pid, {
      Goal: "Quality assurance sees expiring certificates and failed deliveries at a glance instead of searching shared folders.",
      TargetUsers: "Quality assurance staff and about 140 suppliers",
      SetupMustHaves: JSON.stringify([{ text: "Suppliers upload certificates with an expiry date", priority: "must" }, { text: "A dashboard of failed deliveries per supplier", priority: "should" }]),
      SetupWorkflows: JSON.stringify(["A supplier uploads a new certificate and QA confirms it"]),
      SetupExclusions: JSON.stringify(["Online payments to suppliers"]),
      SetupConstraints: JSON.stringify([{ kind: "languages", text: "German and French" }]),
      ApprovalOwnerUserId: approver,
    });
  });
  afterAll(() => w?.close());

  it("the questions ask the targets the setup leaves open, the targets to the approver", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications" }, key: "setup-q" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    expect(String(job.Message)).toMatch(/from the project setup, the notes and files\.$/);
    const qs = outputs(id, "Clarification");
    const texts = qs.map((q) => String(q.Question));
    expect(texts.some((t) => /worked a few months after it goes live/.test(t))).toBe(true);
    expect(texts.some((t) => /at the same time at the busiest moment/.test(t))).toBe(true);
    // the goal and users are given: not asked
    expect(texts.some((t) => /^What should the new portal achieve/.test(t))).toBe(false);
    for (const q of qs) if (/worked a few months|busiest moment|How fast/.test(String(q.Question))) expect(q.OwnerUserId).toBe(approver);
    for (const t of texts) expect(t).not.toMatch(FORBIDDEN);
  });

  it("the draft follows the setup: priorities, no exclusions, the objective names goal, workflows, constraints and approver", async () => {
    // "Not sure" on the targets (the product manager suggests the usual answer), "Later" on the rest
    for (const c of w.rows("Clarification", pid).filter((c) => c.Status === "open")) {
      const unsure = /busiest moment|How fast/.test(String(c.Question));
      await w.gw.update("Clarification", String(c.ItemId), { Status: "deferred", DeferReason: unsure ? "Not sure yet. The product manager suggests an answer." : "Answer later." });
    }
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1 }, key: "setup-d" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const reqs = outputs(id, "Requirement");
    if (process.env.PRINT) console.log(reqs.map((r) => [r.Priority, r.Title, r.Text]));
    const byTitle = (re: RegExp) => reqs.find((r) => re.test(`${r.Title} ${r.Text}`));
    expect(byTitle(/upload certificates/i)?.Priority).toBe("must");
    // the client's "should" wins over the twin from the notes
    expect(byTitle(/failed deliveries are visible per supplier|dashboard of failed deliveries/i)?.Priority).toBe("nice");
    expect(reqs.some((r) => /online payments/i.test(`${r.Title} ${r.Text}`))).toBe(false);
    const obj = w.rows("Objective", pid)[0]!;
    expect(String(obj.Statement)).toMatch(/expiring certificates and failed deliveries at a glance/i);
    const md = String(obj.HighLevelMd);
    expect(md).toMatch(/## Goal\n/);
    expect(md).toMatch(/## Key workflows\n- A supplier uploads a new certificate and QA confirms it/);
    expect(md).toMatch(/## Not included\n- Online payments to suppliers/);
    expect(md).toMatch(/## Constraints\n- Languages: German and French/);
    expect(md).toMatch(/## Approval\n.+ approves the result\./);
    expect(md).toMatch(/## Suggested where you weren't sure\n- .*busiest moment.* Suggested: Plan for about one in ten users/);
    expect(md).toMatch(/Suggested: The most used screens open within 2 seconds/);
  });
});
