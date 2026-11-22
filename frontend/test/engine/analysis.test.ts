// The analysis writers on the seeded store: sanitization questions and technical proposals (also for an existing
// product), the first requirements draft with the objective, and the review for suggestions. Rows must have the
// shapes the app reads and the ops accept, be deterministic, and read like an analyst's work.
//   PRINT=1 npx vitest run --config frontend/test/engine/vitest.config.ts test/engine/analysis.test.ts   (prints the texts)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { completionBlockers } from "../../src/domain/sanitization";
import { parseOutputRef } from "../../src/domain/engineJob";
import { toSuggestionRecord } from "../../src/blocks/requirements/records";
import { makeWorld, type World } from "./harness";

const FORBIDDEN = /\b(simulated|simulation|mock|demo|sample|example|test data|fake|prototype|lorem|placeholder)\b/i;
const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
const print = (title: string, rows: unknown) => {
  if (process.env.PRINT) console.log(`\n### ${title}\n${JSON.stringify(rows, null, 2)}`);
};

function outputs(w: World, jobId: string, schema: string): Row[] {
  const job = w.get("EngineJob", jobId);
  return ((job.OutputRefs as string[]) ?? [])
    .map(parseOutputRef)
    .filter((r): r is { schema: string; id: string } => r !== null && r.schema === schema)
    .map((r) => w.get(schema, r.id));
}

/** Words of the project's own notes may be quoted; only the engine's own wording is checked. */
function ownWords(w: World, projectId: string, text: string): string {
  const notes = w.rows("DocNote", projectId).map((n) => String(n.BodyMd ?? "")).join(" ").toLowerCase();
  return text
    .split(/\s+/)
    .filter((word) => !notes.includes(word.toLowerCase().replace(/[^a-z]/g, "")) || word.length < 4)
    .join(" ");
}

function refsOf(w: World, projectId: string) {
  const ids = (s: string, f: (r: Row) => boolean = () => true) => w.rows(s, projectId).filter(f).map((r) => String(r.ItemId)).sort();
  return {
    docNoteIds: ids("DocNote"),
    docFileIds: ids("DocFile", (r) => r.Status === "ready"),
    clarificationIds: ids("Clarification", (r) => r.Status === "answered" || r.Status === "deferred"),
    decisionIds: ids("Decision", (r) => r.Status === "accepted"),
    techDecisionIds: ids("TechDecision", (r) => r.Status !== "rejected"),
    requirementIds: ids("Requirement"),
  };
}

describe("analysis writers", () => {
  let w: World;
  let sqp: Row;
  beforeAll(async () => {
    w = await makeWorld();
    sqp = w.project("Supplier Quality Portal");
  });
  afterAll(() => w?.close());

  it("sanitization.assist (clarifications) asks new open questions from the notes", async () => {
    const pid = String(sqp.ItemId);
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications", refs: refsOf(w, pid) } });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    const qs = outputs(w, id, "Clarification");
    print("clarifications", qs.map((q) => [q.Number, q.Question, q.SourceType]));
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs.length).toBeLessThanOrEqual(6);
    expect(String(job.Message)).toMatch(new RegExp(`^Drafted ${qs.length} questions`));
    const numbers = w.rows("Clarification", pid).map((c) => c.Number);
    expect(new Set(numbers).size).toBe(numbers.length);
    const noteIds = new Set(w.rows("DocNote", pid).map((n) => n.ItemId));
    const fileIds = new Set(w.rows("DocFile", pid).map((n) => n.ItemId));
    for (const q of qs) {
      expect(q.Status).toBe("open");
      expect(q.Answer).toBe("");
      expect(String(q.Question)).toMatch(/\?$/);
      expect(String(q.Question).length).toBeLessThanOrEqual(2000);
      expect(q.SortOrder).toBe(q.Number);
      expect(["doc-note", "doc-file", "engine"]).toContain(q.SourceType);
      if (q.SourceType === "doc-note") expect(noteIds.has(q.SourceRef)).toBe(true);
      if (q.SourceType === "doc-file") expect(fileIds.has(q.SourceRef)).toBe(true);
      expect(String(q.OwnerUserId)).not.toBe("");
      expect(ownWords(w, pid, String(q.Question))).not.toMatch(FORBIDDEN);
    }
    // The note's own open point is asked as it was written.
    expect(qs.some((q) => /own login, or a link per upload\?$/.test(String(q.Question)))).toBe(true);
  });

  it("a second run asks nothing already asked", async () => {
    const pid = String(sqp.ItemId);
    const before = w.rows("Clarification", pid).map((c) => String(c.Question));
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications", refs: refsOf(w, pid) }, key: "again" });
    await w.settle();
    const qs = outputs(w, id, "Clarification");
    print("second run", { message: w.get("EngineJob", id).Message, qs: qs.map((q) => q.Question) });
    for (const q of qs) expect(before).not.toContain(q.Question);
  });

  it("sanitization.assist (technical) proposes decisions for open areas", async () => {
    const pid = String(sqp.ItemId);
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "technical", refs: refsOf(w, pid) } });
    await w.settle();
    const tds = outputs(w, id, "TechDecision");
    print("tech (new product)", tds.map((t) => ({ Area: t.Area, Title: t.Title, Choice: t.Choice, Rationale: t.Rationale, NfrTarget: t.NfrTarget, IntegrationSystem: t.IntegrationSystem })));
    expect(tds.length).toBeGreaterThanOrEqual(2);
    expect(tds.length).toBeLessThanOrEqual(4);
    for (const t of tds) {
      expect(t.Status).toBe("proposed");
      expect(["stack", "architecture", "integration", "nfr", "security", "data", "hosting", "other"]).toContain(t.Area);
      expect(String(t.Title).length).toBeLessThanOrEqual(200);
      expect(String(t.Choice).length).toBeLessThanOrEqual(500);
      expect(Array.isArray(t.Alternatives)).toBe(true);
      expect(t.ExpertUserIds).toEqual([]);
      if (t.Area === "nfr") expect(String(t.NfrTarget)).not.toBe("");
      expect(ownWords(w, pid, `${t.Title} ${t.Choice} ${t.Rationale}`)).not.toMatch(FORBIDDEN);
    }
    expect(new Set(tds.map((t) => t.Area)).size).toBe(tds.length);
  });

  it("existing product: the technical proposals are findings from its repository", async () => {
    const cdp = w.project("Client Document Portal");
    const pid = String(cdp.ItemId);
    const decided = new Set(w.rows("TechDecision", pid).filter((t) => t.Status !== "rejected").map((t) => t.Area));
    const id = await w.queue({ project: "Client Document Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "technical", refs: refsOf(w, pid) } });
    await w.settle();
    const job = w.get("EngineJob", id);
    const tds = outputs(w, id, "TechDecision");
    print("tech (existing product)", { message: job.Message, tds: tds.map((t) => ({ Area: t.Area, Title: t.Title, Choice: t.Choice, Rationale: t.Rationale })) });
    expect(job.Status).toBe("succeeded");
    expect(String(job.Message)).toMatch(/^Read lindenhof-treuhand\/klientenportal and proposed \d technical decisions?\.$/);
    expect(tds.length).toBeGreaterThanOrEqual(2);
    const systems = w.rows("TechDecision", pid).filter((t) => !String(t.RequestKey).startsWith(`engine:${id}:`)).map((t) => String(t.IntegrationSystem).toLowerCase());
    for (const t of tds) {
      // A decided area gets no second proposal, except an integration with another system.
      if (t.Area === "integration") expect(systems).not.toContain(String(t.IntegrationSystem).toLowerCase());
      else expect(decided.has(t.Area)).toBe(false);
    }
  });

  it("requirements.draft writes requirements, the objective, and sanitization can then complete", async () => {
    const pid = String(sqp.ItemId);
    // A person answers the questions first (the draft uses the answers as acceptance criteria).
    const answer = (q: string): string =>
      /login/i.test(q) ? "Each supplier gets an own login; a link per upload is too easy to forward."
      : /expired/i.test(q) ? "An expired certificate blocks new deliveries of the supplier until a valid one is uploaded."
      : /temperature/i.test(q) ? "Chilled goods 2 to 7 °C, frozen goods -18 °C or colder; outside these limits the delivery counts as failed."
      : /12 Nov/i.test(q) ? "A first version to show at the supplier day; real use starts in January."
      : /shared folder/i.test(q) ? "Only the certificates valid today; older ones stay in the archive."
      : /budget/i.test(q) ? "CHF 80'000 for the first phase; Jonas decides."
      : "As written in the kick-off notes.";
    for (const c of w.rows("Clarification", pid)) {
      await w.gw.update("Clarification", String(c.ItemId), { Status: "answered", Answer: answer(String(c.Question)), AnsweredByUserId: String(c.OwnerUserId), AnsweredAt: w.now().toISOString() });
    }
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, refs: refsOf(w, pid) } });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    const reqs = outputs(w, id, "Requirement");
    const [obj] = outputs(w, id, "Objective");
    print("requirements", reqs.map((r) => ({ n: r.Number, key: r.Key, title: r.Title, text: r.Text, cat: r.Category, prio: r.Priority, ac: r.AcceptanceCriteria, src: (r.SourceRefs as string[]).length })));
    print("objective", obj);
    expect(reqs.length).toBeGreaterThanOrEqual(5);
    expect(reqs.length).toBeLessThanOrEqual(10);
    expect(String(job.Message)).toBe(`Drafted ${reqs.length} requirements and the objective.`);
    const keys = w.rows("Requirement", pid).map((r) => r.Key);
    expect(new Set(keys).size).toBe(keys.length);
    const ids = new Set([...w.rows("DocNote", pid), ...w.rows("DocFile", pid), ...w.rows("Clarification", pid), ...w.rows("Decision", pid), ...w.rows("TechDecision", pid)].map((r) => r.ItemId));
    for (const r of reqs) {
      expect(String(r.Key)).toMatch(KEY);
      expect(r.Status).toBe("draft");
      expect(["must", "nice", "later"]).toContain(r.Priority);
      expect(["functional", "integration", "nfr", "security", "data", "ux", "other"]).toContain(r.Category);
      expect((r.AcceptanceCriteria as string[]).length).toBeGreaterThanOrEqual(2);
      expect(r.SpecVersion).toBe(1);
      expect(Number(r.SortOrder) % 1000).toBe(0);
      expect(r.CreatedByUserId).toBe(r.UpdatedByUserId);
      for (const s of r.SourceRefs as string[]) expect(ids.has(s)).toBe(true);
      expect(ownWords(w, pid, `${r.Title} ${r.Text} ${(r.AcceptanceCriteria as string[]).join(" ")}`)).not.toMatch(FORBIDDEN);
    }
    expect(reqs.some((r) => (r.AcceptanceCriteria as string[]).some((c) => /own login/i.test(c)))).toBe(true);
    expect(obj).toBeTruthy();
    expect(obj!.Status).toBe("draft");
    expect(String(obj!.Statement).length).toBeGreaterThan(30);
    expect(String(obj!.HighLevelMd)).toMatch(/^## Users/m);
    expect(String(obj!.ArchitectureMd)).toMatch(/^## Components/m);
    expect((obj!.AcceptanceCriteria as string[]).length).toBeGreaterThanOrEqual(2);
    // the look & feel is prepared too (a complete draft, approved with the requirements), when nobody described it:
    // the engine drafts a Figma Make brief by default, the planner designs the product in Make on the owner engine
    const [look] = w.rows("DesignBrief", pid);
    expect(look).toMatchObject({ Mode: "figma", Status: "draft" });
    expect(String(look!.Instructions).trim().length).toBeGreaterThanOrEqual(20);
    expect(String(look!.Instructions)).not.toMatch(FORBIDDEN);
    // the setup's goal is the objective, never a requirement of its own
    const goal = String(sqp.Goal ?? "").trim();
    if (goal) for (const r of reqs) expect(String(r.Title).toLowerCase()).not.toBe(goal.replace(/[.;]+$/, "").toLowerCase());
    // sanitization.complete's checks pass once the questions are answered.
    const blockers = completionBlockers({
      clarifications: w.rows("Clarification", pid).map((c) => ({ status: String(c.Status) })),
      requirements: w.rows("Requirement", pid).map((r) => ({ number: Number(r.Number), title: String(r.Title), acceptanceCriteria: r.AcceptanceCriteria as string[] })),
      objective: { statement: String(obj!.Statement) },
      activeDraftJob: null,
    });
    expect(blockers).toEqual([]);
  });

  it("is deterministic: the same project and input give the same texts", async () => {
    const a = await makeWorld();
    const b = await makeWorld();
    try {
      const texts: string[][] = [];
      for (const x of [a, b]) {
        const p = x.project("Supplier Onboarding Portal");
        const pid = String(p.ItemId);
        const id1 = await x.queue({ project: "Supplier Onboarding Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications", refs: refsOf(x, pid) }, key: "det" });
        await x.settle();
        const id2 = await x.queue({ project: "Supplier Onboarding Portal", kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, refs: refsOf(x, pid) }, key: "det2" });
        await x.settle();
        texts.push([...outputs(x, id1, "Clarification").map((q) => String(q.Question)), ...outputs(x, id2, "Requirement").map((r) => `${r.Key}|${r.Title}|${r.Text}`)]);
        print("onboarding (existing product)", texts[texts.length - 1]);
      }
      expect(texts[0]!.length).toBeGreaterThan(4);
      expect(texts[0]).toEqual(texts[1]);
    } finally {
      a.close();
      b.close();
    }
  });

  it("requirements review writes open suggestions the Suggestions tab reads", async () => {
    const pay = w.project("Payroll Self-Service");
    const pid = String(pay.ItemId);
    const reqIds = w.rows("Requirement", pid).map((r) => String(r.ItemId)).sort();
    const id = await w.queue({
      project: "Payroll Self-Service",
      kind: "requirements.draft",
      input: { projectId: pid, requirementIds: reqIds, objectiveId: null, purpose: "suggestions" },
      target: { type: "project", id: `${pid}:suggestions` },
    });
    await w.settle();
    const job = w.get("EngineJob", id);
    const sug = outputs(w, id, "Suggestion");
    print("suggestions", sug.map((s) => [s.Key, s.Title, s.Text]));
    expect(job.Status).toBe("succeeded");
    expect(sug.length).toBeGreaterThanOrEqual(2);
    expect(sug.length).toBeLessThanOrEqual(4);
    const keys = w.rows("Suggestion", pid).map((s) => s.Key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of sug) {
      expect(s.Source).toBe("engine");
      expect(s.Status).toBe("open");
      expect(s.EngineJobId).toBe(id);
      expect(String(s.Key)).toMatch(KEY);
      const rec = toSuggestionRecord(s as never);
      expect(rec.title).toBe(s.Title);
      expect(rec.status).toBe("open");
      expect(ownWords(w, pid, `${s.Title} ${s.Text}`)).not.toMatch(FORBIDDEN);
    }
    // No requirement or suggestion of the project is touched.
    expect(w.rows("Requirement", pid).map((r) => String(r.ItemId)).sort()).toEqual(reqIds);
  });

  it("a question about one record gets one follow-up; focus requirements proposes a few drafts", async () => {
    const p = w.project("Client Document Portal");
    const pid = String(p.ItemId);
    const clar = w.rows("Clarification", pid).find((c) => c.Status === "open")!;
    const id = await w.queue({ project: "Client Document Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "clarifications", refId: clar.ItemId, refs: refsOf(w, pid) }, key: "follow" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const qs = outputs(w, id, "Clarification");
    expect(qs).toHaveLength(1);
    expect(String(qs[0]!.Question)).toMatch(/\?$/);
    const id2 = await w.queue({ project: "Client Document Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "requirements", refs: refsOf(w, pid) }, key: "reqs" });
    await w.settle();
    const job = w.get("EngineJob", id2);
    expect(job.Status).toBe("succeeded");
    const reqs = outputs(w, id2, "Requirement");
    print("assist requirements (existing product)", reqs.map((r) => [r.Key, r.Title]));
    expect(reqs.length).toBeLessThanOrEqual(3);
    for (const r of reqs) expect((r.AcceptanceCriteria as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it("a resumed run writes nothing twice", async () => {
    const p = w.project("Supplier Onboarding Portal");
    const pid = String(p.ItemId);
    const id = await w.queue({ project: "Supplier Onboarding Portal", kind: "sanitization.assist", input: { projectId: pid, focus: "technical", refs: refsOf(w, pid) }, key: "resume" });
    // Run until the first proposal is written, then stop the engine (a restart) and let a new one resume.
    w.engine.tick();
    for (let i = 0; i < 400 && !w.rows("TechDecision", pid).some((t) => String(t.RequestKey).startsWith(`engine:${id}:`)); i++) await new Promise((r) => setImmediate(r));
    w.engine.stop();
    const { createEngine } = await import("../../server/local/engine/driver.ts");
    const { writerOf } = await import("../../server/local/engine/kinds/index.ts");
    const again = createEngine({ store: w.store, gateway: w.gw, config: () => w.config, log: () => undefined, writers: writerOf, sleep: async () => undefined, sweepMs: 0, now: () => w.now() });
    again.tick();
    await again.idle();
    again.stop();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    const mine = w.rows("TechDecision", pid).filter((t) => String(t.RequestKey).startsWith(`engine:${id}:`));
    expect(mine.length).toBe((job.OutputRefs as string[]).length);
    expect(new Set(mine.map((t) => t.Area)).size).toBe(mine.length);
  });
});
