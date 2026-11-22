// The change request's light SDLC on the engine side (engine-host/CHANGE-PROCESS-31.10.md) with a stub runner instead
// of the Claude CLI: change.analyse writes the Analysis (review, or questions and a refine with the answers), fails
// honestly when the answer is unusable, routes a new feature through scope; change.build plans and builds from the
// analysis and its prompt carries the acceptance criteria; the change requests' ledger events.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/changeAnalyse.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { applyChangeAnswers, parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { ProjectView } from "../../server/local/engine/context.ts";
import { ANALYSIS_FAILED } from "../../server/local/engine/kinds/changes.ts";
import { changeNames } from "../../server/local/engine/kinds/changes/ai.ts";
import { changeBriefOf } from "../../server/local/engine/kinds/delivery.ts";
import { buildPrompt, buildTicketOf } from "../../server/local/engine/build/prompt.ts";
import { changeActionsOf } from "../../server/engine-context/changeEvents.ts";
import { recordUserActions } from "../../server/engine-context/userEvents.ts";
import { readLedger } from "../../server/engine-context/store.ts";
import { makeWorld, type World } from "./harness";

const PROJECT = "Service Technician Portal";
const s = (v: unknown) => (typeof v === "string" ? v : "");

let w: World;
let pid = "";
let calls: AiRequest[] = [];
const install = (fn: (r: AiRequest, n: number) => unknown) => setAiRunner(async (r) => { calls.push(r); return fn(r, calls.length); });

beforeAll(async () => {
  w = await makeWorld();
  pid = s(w.project(PROJECT).ItemId);
});
afterAll(() => w?.close());
afterEach(() => {
  setAiRunner(null);
  calls = [];
});

let crNumber = 50;
/** A new change request, as cr.submit leaves it (analysing). */
async function newRequest(o: { title: string; lane: string; description: string }): Promise<string> {
  const p = w.project(PROJECT);
  const draft = w.rows("ChangeRequest", pid)[0]!;
  crNumber += 1;
  const res = await w.gw.insert("ChangeRequest", {
    WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
    ProjectId: pid, Number: crNumber, Lane: o.lane, FeatureRef: s(draft.FeatureRef), Title: o.title, Description: o.description,
    Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: `t:cr:${crNumber}`,
  });
  return res.itemId!;
}

const analyse = async (crId: string, refine = false): Promise<Row> => {
  const id = await w.queue({ project: PROJECT, kind: "change.analyse", input: { projectId: pid, changeRequestId: crId, ...(refine ? { refine: true } : {}) }, target: { type: "ChangeRequest", id: crId }, key: `an-${crId}-${refine}` });
  await w.settle();
  return w.get("EngineJob", id);
};

function answerOf(names: ReturnType<typeof changeNames>, over: Record<string, unknown> = {}) {
  return {
    kind: "change",
    scopeChange: false,
    summary: "Technicians can attach a second photo to a finished job, so the office sees the result before and after.",
    impact: { features: [names.features[0], "A feature nobody has"], stories: [], screens: names.screens.slice(0, 1), milestones: [] },
    conflicts: [],
    risks: ["Phones with little storage left may fail the upload; the job must still close."],
    acceptanceCriteria: ["A finished job accepts a second photo.", "Both photos show on the job page in the office."],
    tickets: [
      { title: "Second photo on the job report", description: "Add a second photo slot to the finished-job form and store it with the job." },
      { title: "Show both photos in the office", description: "Show the before and after photos side by side on the job page." },
    ],
    questions: [],
    ...over,
  };
}

describe("change.analyse", () => {
  let crId = "";

  it("writes a valid analysis and moves the request to review", async () => {
    crId = await newRequest({ title: "Second photo on finished jobs", lane: "enhance", description: "Technicians want to add a photo after the repair, next to the one before it." });
    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names));
    const job = await analyse(crId);
    expect(job.Status, `${s(job.Message)}\n${w.log.join("\n")}`).toBe("succeeded");
    expect(calls).toHaveLength(1);
    const prompt = calls[0]!.prompt;
    expect(prompt).toContain("Second photo on finished jobs");
    expect(prompt).toContain("Lane the person picked: Enhance feature");
    expect(prompt).toMatch(/Project context v\d+/);
    if (names.features[0]) expect(prompt).toContain(`Feature "${names.features[0]}"`);
    const cr = w.get("ChangeRequest", crId);
    expect(cr.Status).toBe("review");
    expect(s(cr.AnalysedAt)).toMatch(/^\d{4}-/);
    const a = parseChangeAnalysis(cr.Analysis)!;
    expect(a).toMatchObject({ v: 1, kind: "change", route: "fast", scopeChange: false, estimate: { tickets: 2 }, questions: [] });
    expect(a.impact.features).toEqual(names.features[0] ? [names.features[0]] : []); // unknown names left out
    expect(a.acceptanceCriteria).toHaveLength(2);
    expect(typeof a.contextVersion).toBe("number");
    expect(s(job.Message)).toContain("2 tickets planned");
  });

  it("asks questions, then refines with the answers", async () => {
    const q = await newRequest({ title: "Customer signature on the job", lane: "change", description: "The customer should sign when the job is done." });
    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names, { questions: [
      { text: "Who signs when the customer is not there?", options: ["The technician notes who received it", "Nobody: the job stays open"] },
      { text: "Should the signature go on the PDF report?", options: ["Yes", "No", "Only for warranty jobs"] },
    ] }));
    expect((await analyse(q)).Status).toBe("succeeded");
    let cr = w.get("ChangeRequest", q);
    expect(cr.Status).toBe("questions");
    const first = parseChangeAnalysis(cr.Analysis)!;
    expect(first.questions.map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(first.questions[1]!.options).toHaveLength(3);

    // cr.answer: the answers saved, refine queued
    const answered = applyChangeAnswers(first, [{ id: "q1", answer: "The technician notes who received it" }, { id: "q2", answer: "Yes" }], "u-1", "2026-10-31T10:00:00.000Z");
    expect(answered.ok).toBe(true);
    await w.gw.update("ChangeRequest", q, { Analysis: serializeChangeAnalysis((answered as { value: typeof first }).value) });
    calls = [];
    install(() => answerOf(names, { summary: "The customer signs on the phone when the job is done; without them the technician notes who received it.", questions: [] }));
    expect((await analyse(q, true)).Status).toBe("succeeded");
    expect(calls[0]!.prompt).toContain("A: The technician notes who received it");
    expect((calls[0]!.schema as { properties: { questions: { maxItems: number } } }).properties.questions.maxItems).toBe(1);
    cr = w.get("ChangeRequest", q);
    expect(cr.Status).toBe("review");
    const refined = parseChangeAnalysis(cr.Analysis)!;
    expect(refined.summary).toContain("notes who received it");
    expect(refined.questions.map((x) => [x.id, x.answer, x.answeredBy])).toEqual([["q1", "The technician notes who received it", "u-1"], ["q2", "Yes", "u-1"]]);
  });

  it("fails honestly after one retry when the answer is unusable", async () => {
    const f = await newRequest({ title: "Faster job list", lane: "change", description: "The job list should load faster." });
    install(() => ({ kind: "something", summary: "", tickets: [], acceptanceCriteria: [], questions: [] }));
    const job = await analyse(f);
    expect(job.Status).toBe("failed");
    expect(job.Message).toBe(ANALYSIS_FAILED);
    expect(job.ErrorCode).toBe("change.analysis");
    expect(calls).toHaveLength(2); // one retry, no built-in analysis
    expect(w.get("ChangeRequest", f).Status).toBe("failed");
    expect(w.get("ChangeRequest", f).Analysis ?? "").toBe("");
  });

  it("refuses too many questions or a question with one option, then takes the retry", async () => {
    const r = await newRequest({ title: "Job notes in bold", lane: "change", description: "Office notes on a job should stand out." });
    const names = changeNames(new ProjectView(w.store, pid));
    install((_r, n) => (n === 1 ? answerOf(names, { questions: [{ text: "Which colour?", options: ["Red"] }] }) : answerOf(names)));
    expect((await analyse(r)).Status).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(w.get("ChangeRequest", r).Status).toBe("review");
  });

  it("routes a new feature through scope, and change.build refuses it", async () => {
    const f = await newRequest({ title: "Customer self-service booking", lane: "add", description: "Customers book their own repair slot online." });
    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names, { kind: "feature", scopeChange: false, summary: "Customers book a repair slot themselves on a new booking page." }));
    expect((await analyse(f)).Status).toBe("succeeded");
    const cr = w.get("ChangeRequest", f);
    const a = parseChangeAnalysis(cr.Analysis)!;
    expect(a).toMatchObject({ kind: "feature", route: "scope", scopeChange: true });
    expect(cr.Status).toBe("review");
    await w.gw.update("ChangeRequest", f, { Status: "approved" });
    const id = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: f }, key: "scope-build" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("failed");
    expect(job.Message).toBe("This is a new feature: add it through Scope & success.");
    expect(w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === f)).toHaveLength(0);
  });

  it("change.build plans the analysis's tickets with its criteria and its prompt carries them", async () => {
    const cr = w.get("ChangeRequest", crId);
    const a = parseChangeAnalysis(cr.Analysis)!;
    await w.gw.update("ChangeRequest", crId, { Status: "approved", DecidedAt: "2026-10-31T11:00:00.000Z", DecidedByUserId: s(cr.RequestedByUserId), SelfApproved: true, Version: "1.9.0" });
    const id = await w.queue({ project: PROJECT, kind: "change.build", input: { projectId: pid, changeRequestId: crId }, key: "analysed-build" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-20).join("\n")}`).toBe("succeeded");
    const tickets = w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === crId).sort((x, y) => Number(x.SortOrder) - Number(y.SortOrder));
    expect(tickets.map((t) => t.Title)).toEqual(a.tickets.map((t) => t.title));
    expect(tickets[0]!.Description).toBe(a.tickets[0]!.description);
    for (const t of tickets) {
      expect(t.Acceptance).toEqual(a.acceptanceCriteria);
      expect(t.Column).toBe("done");
    }
    expect(w.get("ChangeRequest", crId).Status).toBe("released-dev");

    // the code writer's ask: the change block with summary, criteria and the answers
    const p = new ProjectView(w.store, pid);
    const withAnswers = { ...a, questions: [{ id: "q1", text: "Keep the old photo?", options: ["Yes", "No"], answer: "Yes", answeredBy: "u", answeredAt: "2026-10-31T10:00:00.000Z" }] };
    const prompt = buildPrompt(p, { label: "CR-051: Second photo", goal: "", tickets: tickets.map((t) => buildTicketOf(t, p)), built: [], later: [], existing: true, change: changeBriefOf(withAnswers) });
    expect(prompt).toContain("## The change (analysed and approved)");
    expect(prompt).toContain(a.summary);
    for (const c of a.acceptanceCriteria) expect(prompt).toContain(`- ${c}`);
    expect(prompt).toContain("- Keep the old photo? → Yes");
    expect(prompt).toContain(`### Ticket #${Number(tickets[0]!.Number)}: ${a.tickets[0]!.title}`);
    // a request without an analysis gets no change block
    expect(buildPrompt(p, { label: "CR-001", goal: "", tickets: [], built: [], later: [], existing: true })).not.toContain("## The change");
  });

  it("records the change requests' ledger events once, linked to the request, its tickets and its build", async () => {
    const p = new ProjectView(w.store, pid);
    const build = w.rows("EngineJob", pid).find((j) => j.Kind === "change.build" && j.Status === "succeeded" && s(j.InputJson).includes(crId))!;
    const events = changeActionsOf(p, { build: { jobId: s(build.ItemId), commit: "abc1234", branch: `change/${crId}`, buildId: "cr51-1-9-0", version: "1.9.0" } });
    const mine = events.filter((e) => e.ref === `ChangeRequest:${crId}`);
    // (the test world mixes its virtual clock with the store's own CreatedDate, so the order is not asserted here)
    expect(mine.map((e) => e.action).sort()).toEqual(["change.analysed", "change.approved", "change.built", "change.released", "change.requested"]);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort());
    const built = mine.find((e) => e.action === "change.built")!;
    expect(built).toMatchObject({ type: "change", detail: { commit: "abc1234", branch: `change/${crId}` } });
    expect((built.detail!.tickets as string[]).length).toBe(2);
    expect(mine.find((e) => e.action === "change.approved")!.detail).toMatchObject({ selfApproved: true });
    expect(mine.find((e) => e.action === "change.requested")!.type).toBe("user");
    // the refined request: its answers
    expect(events.filter((e) => e.action === "change.answered").map((e) => e.detail!.answer)).toEqual(["The technician notes who received it", "Yes"]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-ledger-"));
    try {
      expect(recordUserActions(dir, events, { contextVersion: 7 })).toBe(events.length);
      expect(recordUserActions(dir, changeActionsOf(p), { contextVersion: 8 })).toBe(0); // recorded once, by key
      const ledger = readLedger(dir);
      expect(ledger.filter((e) => e.type === "change").map((e) => e.action)).toContain("change.released");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("asks one question when a change clashes with a detail of the locked scope, and keeps it a change once it is settled", async () => {
    const q = await newRequest({ title: "Full-width hero with parallax", lane: "change", description: "Make the hero full width with a parallax effect, without the two buttons." });
    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names, { scopeChange: true, conflicts: ["The locked scope's hero shows two buttons."] }));
    expect((await analyse(q)).Status).toBe("succeeded");
    let cr = w.get("ChangeRequest", q);
    expect(cr.Status).toBe("questions");
    const first = parseChangeAnalysis(cr.Analysis)!;
    const ask = first.questions.find((x) => x.id === "scope")!;
    expect(ask.text).toBe("This change differs from the locked scope: the locked scope's hero shows two buttons. How should we go on?");
    expect(ask.options).toEqual(["Build it as a change that replaces that part", "Keep that part and fit the change around it"]);
    // the prompt now tells look-and-layout changes from scope changes
    expect(calls[0]!.prompt).toContain("A new look, layout, size, colour, picture, motion or wording of an existing screen or section is always a \"change\"");

    const answered = applyChangeAnswers(first, [{ id: "scope", answer: "Build it as a change that replaces that part" }], "u-1", "2026-10-31T10:00:00.000Z");
    await w.gw.update("ChangeRequest", q, { Analysis: serializeChangeAnalysis((answered as { value: typeof first }).value) });
    calls = [];
    // even when the model still calls it a scope change, the person's answer keeps it in the fast lane
    install(() => answerOf(names, { scopeChange: true, conflicts: ["The locked scope's hero shows two buttons."] }));
    expect((await analyse(q, true)).Status).toBe("succeeded");
    cr = w.get("ChangeRequest", q);
    expect(cr.Status).toBe("review");
    expect(parseChangeAnalysis(cr.Analysis)).toMatchObject({ kind: "change", route: "fast", scopeChange: false });
  });

});
