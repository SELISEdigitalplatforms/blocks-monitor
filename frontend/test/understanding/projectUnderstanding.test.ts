// "Project understanding" (the review after Project setup): the brief is built from the project's real answers (never
// its id), only really open questions are listed, decisions stick, every brief route needs the signed-in person's
// access, the knowledge base lives in the project's engine folder, and the page speaks plain words.
//   npx vitest run --config test/understanding/vitest.config.ts test/understanding/projectUnderstanding.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { factsFromRows, kbKey, projectReads, type CallerOp, type CallerReads } from "../../server/api/brief/access";
import { loadS1Catalog, validateDataRequest } from "../../server/fnHost/dataRead";
import { mergeToBrief, type BriefInputs } from "../../server/api/brief/builder";
import { createBriefRoutes } from "../../server/api/brief/routes";
import { knowledgeBaseDir } from "../../server/api/knowledgeBase";
import { fileWords, openQuestions, setupFindings, understandingNow, understoodLines, type NowInput } from "../../src/components/understanding/model";
import { FilesCard } from "../../src/components/understanding/FilesCard";

const WS = "383b791a-eccf-49e8-a68b-9204da76f798";
const PID = "e34a92e7-2204-4729-8774-716321bb4f74";

const inputs = (o: Partial<BriefInputs> = {}): BriefInputs => ({
  source: "blocks", answers: {}, sources: [], decisions: { requirements: {}, conflicts: {} }, fingerprint: "f", ...o,
});

describe("the project's facts, read as the signed-in person", () => {
  it("takes the name, answers, brief note and files from the Blocks rows", () => {
    const f = factsFromRows(PID.toUpperCase(), "u1",
      { WorkspaceId: WS, Name: "Brightledger", Goal: "Close the books in a day", TargetUsers: "Swiss SME owners", RepoMode: "new",
        SetupMustHaves: JSON.stringify([{ text: "Import bank statements", priority: "must" }]) },
      [{ ItemId: "f1", Name: "Spec.pdf", Mime: "application/pdf", Status: "ready" }, { ItemId: "f2", Name: "draft.docx", Status: "pending" }],
      [{ Title: "Project brief", IsProjectBrief: true, BodyMd: "## About the project\nBookkeeping for small firms.\n## Goal\nx" }]);
    expect(f).toMatchObject({ id: PID, workspaceId: WS, name: "Brightledger", goal: "Close the books in a day", targetUsers: "Swiss SME owners", about: "Bookkeeping for small firms." });
    expect(f.mustHaves).toEqual([{ text: "Import bank statements", priority: "must" }]);
    expect(f.files.map((x) => [x.id, x.ready])).toEqual([["f1", true], ["f2", false]]);
  });

  it("reads the goal and the users where they are recorded since 08.11 (the shared readers), never the analyst's draft as an answer", () => {
    const project = { WorkspaceId: WS, Name: "Lunch orders", Goal: "", TargetUsers: "", RepoMode: "new" };
    const note = [{ ItemId: "n1", Title: "Project brief", IsProjectBrief: true, BodyMd: "## About the project\n\n**Lunch orders**\n\nTeam members pick lunch.\n\n## Approval\n\nThe owner approves." }];
    const asked = [
      { ItemId: "c1", Number: 1, Question: "Who pays for the lunches?", Answer: "The company", Status: "answered" },
      { ItemId: "c2", Number: 2, Question: "Who will use it day to day?", Answer: "About 25 team members and the office manager", Status: "answered" },
    ];
    const f = factsFromRows(PID, "u1", project, [], note, { clarifications: asked, objective: { Statement: "Let the team order lunch in one place." } });
    expect(f).toMatchObject({ about: "Team members pick lunch.", goal: "", targetUsers: "About 25 team members and the office manager", objective: "Let the team order lunch in one place." });
    // the project's own fields stay first; another question's answer is never the users
    const own = factsFromRows(PID, "u1", { ...project, Goal: "Close the books in a day", TargetUsers: "Swiss SME owners" }, [], note, { clarifications: asked });
    expect(own).toMatchObject({ goal: "Close the books in a day", targetUsers: "Swiss SME owners", objective: "" });
    expect(factsFromRows(PID, "u1", project, [], note, { clarifications: asked.slice(0, 1) }).targetUsers).toBe("");
  });
});

describe("the caller's reads", () => {
  it("are reads the data route accepts (catalogue fields, at most 100 rows each)", () => {
    const root = join(import.meta.dirname, "..", "..");
    expect(validateDataRequest({ reads: projectReads(PID) }, loadS1Catalog(root))).toMatchObject({ ok: true });
  });
});

describe("the brief", () => {
  it("never shows the project id as its name, and asks the start questions only when they are unanswered", () => {
    const empty = mergeToBrief(PID, 1, inputs());
    expect(empty.project.name).toBe("");
    expect(empty.openQuestions.map((q) => q.key)).toEqual(["basics:goal", "basics:users"]);
    const answered = mergeToBrief(PID, 1, inputs({ answers: { name: "Brightledger", goal: "Close the books in a day", targetUsers: "SME owners" } }));
    expect(answered.project.name).toBe("Brightledger");
    expect(answered.openQuestions).toEqual([]);
  });

  it("reads the drafted objective as the objective only while no goal is recorded, as Business Analysis shows it", () => {
    const drafted = mergeToBrief(PID, 1, inputs({ answers: { name: "Lunch orders", goal: "", targetUsers: "" }, objective: "Let the team order lunch in one place." }));
    expect(drafted.project.problem).toBe("Let the team order lunch in one place.");
    // only the users are still open, and Project setup is no longer named as the place to answer them
    expect(drafted.openQuestions.map((q) => [q.key, q.question, q.context])).toEqual([["basics:users", "Who will use it?", "Not answered yet"]]);
    const own = mergeToBrief(PID, 1, inputs({ answers: { goal: "Close the books in a day", targetUsers: "SME owners" }, objective: "Something else" }));
    expect(own.project.problem).toBe("Close the books in a day");
  });

  it("lists every file (also unread ones), drops file questions the answers already settle, and applies decisions", () => {
    const findings = {
      sourceId: "f1", sourceType: "pdf", fileName: "Spec.pdf", summary: "The spec", observations: [],
      candidateRequirements: [
        { text: "Export VAT reports", basis: "inferred" as const, evidenceRefs: ["OBS-1"] },
        { text: "Import bank statements", basis: "explicit" as const, evidenceRefs: ["OBS-2"] },
      ],
      openQuestions: ["Who are the target users?", "Which banks must be supported?", "Which banks must be supported?"], warnings: [],
    };
    const base = inputs({
      answers: { name: "Brightledger", goal: "Close the books", targetUsers: "SME owners", mustHaves: [{ text: "Import bank statements", priority: "must" }] },
      sources: [
        { fileId: "f1", name: "Spec.pdf", status: "ready", hash: "h", at: "", findings },
        { fileId: "f2", name: "Old.docx", status: "not_read", hash: "", at: "" },
      ],
    });
    const b = mergeToBrief(PID, 1, base);
    expect(b.attachmentStatus.map((a) => [a.name, a.status])).toEqual([["Spec.pdf", "ready"], ["Old.docx", "not_read"]]);
    expect(b.openQuestions.map((q) => q.question)).toEqual(["Which banks must be supported?"]);
    const all = b.features.flatMap((f) => [...f.confirmedRequirements, ...f.proposedRequirements]);
    const bank = all.find((r) => r.description === "Import bank statements")!;
    expect(bank.sources.sort()).toEqual(["Spec.pdf", "Your project setup"]);
    const vat = b.features.flatMap((f) => f.proposedRequirements).find((r) => r.description === "Export VAT reports")!;
    expect(vat.sources).toEqual(["Spec.pdf"]);
    // the same text keeps its key, so a decision sticks across rebuilds
    const confirmed = mergeToBrief(PID, 2, { ...base, decisions: { requirements: { [vat.id]: "confirmed" }, conflicts: {} } });
    expect(confirmed.features.flatMap((f) => f.confirmedRequirements).some((r) => r.id === vat.id && r.basis === "confirmed")).toBe(true);
    const rejected = mergeToBrief(PID, 3, { ...base, decisions: { requirements: { [vat.id]: "rejected" }, conflicts: {} } });
    expect(rejected.rejectedRequirements.map((r) => r.id)).toEqual([vat.id]);
    expect(JSON.stringify(rejected.features)).not.toContain("Export VAT reports");
  });
});

describe("the brief routes and the knowledge-base folder", () => {
  let root: string;
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), "mf-kb-")); process.env.MF_ENGINE_ROOT = root; });
  afterAll(() => { delete process.env.MF_ENGINE_ROOT; rmSync(root, { recursive: true, force: true }); });

  it("puts the knowledge base in the project's own engine folder and checks both ids", () => {
    expect(knowledgeBaseDir(WS, PID.toUpperCase())).toBe(join(root, "projects", WS, PID, "artifacts", "brief"));
    expect(() => knowledgeBaseDir("../etc", PID)).toThrow();
    expect(() => kbKey(WS, "a/b")).toThrow();
  });

  const project = { ItemId: PID, WorkspaceId: WS, Name: "Brightledger", Goal: "Close the books", TargetUsers: "SME owners" };
  // the caller's reads: project, files, brief note, the engine's file.extract jobs, the brief's ProjectAnswer rows, the
  // answered questions, the objective
  const reads = (state: "ok" | "anon" | "none"): CallerReads => async () => state === "anon" ? { ok: false, status: 401 }
    : { ok: true, userId: "u1", results: [{ ok: true, items: state === "ok" ? [project] : [] }, { ok: true, items: [] }, { ok: true, items: [] }, { ok: true, items: [] }, { ok: true, items: [] }, { ok: true, items: [] }, { ok: true, items: [] }] };
  const ops: { op: string; args: Record<string, unknown> }[] = [];
  const callOp: CallerOp = async (_req, _res, op, args) => { ops.push({ op, args }); return { ok: true, data: {} }; };
  async function call(state: "ok" | "anon" | "none", method: string, url: string, body?: unknown) {
    const route = createBriefRoutes({ reads: reads(state), callOp }).find((r) => r.method === method && r.pattern.test(url))!;
    const params = url.match(route.pattern)!.groups ?? {};
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage;
    req.headers = { "content-type": "application/json" };
    let status = 0;
    let data: any;
    const res = { writableEnded: false, writeHead: (code: number) => { status = code; }, end: (s: string) => { data = JSON.parse(s); } } as unknown as ServerResponse;
    await route.handler(req, res, params);
    return { status, data };
  }

  it("refuses without a session (401) and for a project the person cannot read (404)", async () => {
    expect((await call("anon", "GET", `/api/brief/${PID}`)).status).toBe(401);
    expect((await call("none", "GET", `/api/brief/${PID}`)).status).toBe(404);
    expect((await call("anon", "GET", `/api/extraction/${PID}/status`)).status).toBe(401);
    expect((await call("anon", "POST", `/api/brief/${PID}/confirm`)).status).toBe(401);
  });

  it("answers with the real project, writes nothing on the web server, and records decisions through the project op", async () => {
    const got = await call("ok", "GET", `/api/brief/${PID}`);
    expect(got.status).toBe(200);
    expect(got.data.brief.project).toMatchObject({ name: "Brightledger", problem: "Close the books" });
    expect(got.data.brief.openQuestions).toEqual([]);
    // Blocks mode: the brief comes from Blocks alone; this server's folder stays untouched
    expect(existsSync(knowledgeBaseDir(WS, PID))).toBe(false);
    const bad = await call("ok", "POST", `/api/brief/${PID}/decision`, { kind: "requirement", key: "../x", value: "confirmed" });
    expect(bad.status).toBe(400);
    expect(ops).toEqual([]);
    const set = await call("ok", "POST", `/api/brief/${PID}/decision`, { kind: "requirement", key: "R-0123456789", value: "rejected" });
    expect(set.status).toBe(200);
    expect(ops.at(-1)).toEqual({ op: "project.brief.decide", args: { projectId: PID, kind: "requirement", key: "R-0123456789", value: "rejected" } });
    const done = await call("ok", "POST", `/api/brief/${PID}/confirm`);
    expect(done.status).toBe(200);
    expect(ops.at(-1)).toEqual({ op: "project.brief.decide", args: { projectId: PID, kind: "confirm", value: "confirmed" } });
    expect(done.data.brief).toMatchObject({ confirmedByUserId: "u1" });
    expect(typeof done.data.brief.confirmedAt).toBe("string");
    expect(existsSync(knowledgeBaseDir(WS, PID))).toBe(false);
  });

  it("refuses a decision the project op refuses (no access), and saves nothing", async () => {
    const refusing: CallerOp = async () => ({ ok: false, status: 403, code: "forbidden" });
    const route = createBriefRoutes({ reads: reads("ok"), callOp: refusing }).find((r) => r.method === "POST" && r.pattern.test(`/api/brief/${PID}/confirm`))!;
    let status = 0;
    await route.handler(Readable.from([]) as IncomingMessage, { writableEnded: false, writeHead: (c: number) => { status = c; }, end: () => {} } as unknown as ServerResponse, { projectId: PID });
    expect(status).toBe(403);
  });

  it("lists a project file never read, shows the engine's reading states, and loads only readings the caller's jobs point at", async () => {
    const files = [
      { ItemId: "f9", Name: "Brief.pdf", Status: "ready" }, { ItemId: "f1", Name: "Spec.pdf", Status: "ready" },
      { ItemId: "f2", Name: "Plan.docx", Status: "ready" }, { ItemId: "f3", Name: "Scan.pdf", Status: "ready" },
    ];
    const jobs = [
      { ItemId: "j1", TargetType: "doc-file", TargetId: "f1", Status: "succeeded", OutputRefs: ["DocFile:f1", "StorageObject:obj1"], CreatedDate: "2026-10-31T10:00:00Z" },
      { ItemId: "j2", TargetType: "doc-file", TargetId: "f2", Status: "running", OutputRefs: [], CreatedDate: "2026-10-31T10:01:00Z" },
      { ItemId: "j3a", TargetType: "doc-file", TargetId: "f3", Status: "succeeded", OutputRefs: ["StorageObject:old"], CreatedDate: "2026-10-31T09:00:00Z" },
      { ItemId: "j3", TargetType: "doc-file", TargetId: "f3", Status: "failed", Message: "Some pages are scanned.", ErrorCode: "pdf_ocr_required", CreatedDate: "2026-10-31T10:02:00Z" },
    ];
    const withFiles: CallerReads = async () => ({ ok: true, userId: "u1", results: [{ ok: true, items: [project] }, { ok: true, items: files }, { ok: true, items: [] }, { ok: true, items: jobs }, { ok: true, items: [] }, { ok: true, items: [] }, { ok: true, items: [] }] });
    const asked: string[] = [];
    const readings = async (id: string) => {
      asked.push(id);
      return { schema: 1 as const, sourceId: "f1", sourceType: "pdf", fileName: "Spec.pdf", mimeType: "application/pdf", status: "ready" as const, summary: "The spec",
        contentHash: "h", pages: 2, extractedAt: "2026-10-31T10:00:30Z",
        findings: { sourceId: "f1", sourceType: "pdf", fileName: "Spec.pdf", summary: "The spec", observations: [{ id: "OBS-1", text: "Bank import", location: "p1", kind: "fact" }], candidateRequirements: [], openQuestions: [], warnings: [] } } as never;
    };
    const route = createBriefRoutes({ reads: withFiles, readings }).find((r) => r.method === "GET" && r.pattern.test(`/api/brief/${PID}`))!;
    let data: any;
    await route.handler(Readable.from([]) as IncomingMessage, { writableEnded: false, writeHead: () => {}, end: (s: string) => { data = JSON.parse(s); } } as unknown as ServerResponse, { projectId: PID });
    const byId = Object.fromEntries(data.brief.attachmentStatus.map((a: { fileId: string; status: string }) => [a.fileId, a]));
    expect(byId.f9).toMatchObject({ name: "Brief.pdf", status: "not_read" });
    expect(byId.f1).toMatchObject({ status: "ready", observationCount: 1 });
    expect(byId.f2).toMatchObject({ status: "processing" });
    // a failed re-read of an unchanged file keeps its earlier successful reading (the file's content is the same)
    expect(byId.f3).toMatchObject({ status: "ready" });
    // only succeeded readings are loaded: f1's and the earlier one of f3
    expect([...asked].sort()).toEqual(["obj1", "old"]);
    expect(existsSync(knowledgeBaseDir(WS, PID))).toBe(false);
  });

  it("builds the brief from the goal and the users where they are recorded, and never from a partial answer", async () => {
    const PID2 = "bc59c5f8-0b69-49ed-a0fc-5b5096a443b1";
    const bare = { ItemId: PID2, WorkspaceId: WS, Name: "Lunch orders", Goal: "", TargetUsers: "", RepoMode: "new" };
    const note = { ItemId: "n1", Title: "Project brief", IsProjectBrief: true, BodyMd: "## About the project\n\n**Lunch orders**\n\nTeam members pick lunch." };
    const askedRows = [{ ItemId: "c2", Number: 2, Question: "Who will use it day to day?", Answer: "About 25 team members and the office manager", Status: "answered" }];
    const objectiveRows = [{ ItemId: "o1", Statement: "Let the team order lunch in one place." }];
    const seen: string[][] = [];
    const answered = (asked: { ok: boolean; items?: unknown[] }): CallerReads => async (_req, _res, list) => {
      seen.push(list.map((r) => r.schema));
      return { ok: true, userId: "u1", results: [{ ok: true, items: [bare] }, { ok: true, items: [] }, { ok: true, items: [note] }, { ok: true, items: [] }, { ok: true, items: [] }, asked as never, { ok: true, items: objectiveRows }] };
    };
    const get = async (r: CallerReads) => {
      const route = createBriefRoutes({ reads: r }).find((x) => x.method === "GET" && x.pattern.test(`/api/brief/${PID2}`))!;
      let status = 0;
      let data: any;
      await route.handler(Readable.from([]) as IncomingMessage, { writableEnded: false, writeHead: (c: number) => { status = c; }, end: (t: string) => { data = JSON.parse(t); } } as unknown as ServerResponse, { projectId: PID2 });
      return { status, data };
    };
    const got = await get(answered({ ok: true, items: askedRows }));
    expect(seen[0]!.slice(-2)).toEqual(["Clarification", "Objective"]);
    expect(got.status).toBe(200);
    expect(got.data.brief.project).toMatchObject({ desiredOutcome: "Team members pick lunch.", problem: "Let the team order lunch in one place." });
    expect(got.data.brief.targetUsers).toEqual([{ persona: "Primary users", description: "About 25 team members and the office manager", source: "guided:targetUsers" }]);
    expect(got.data.brief.openQuestions).toEqual([]);
    // the answered questions could not be read: no brief that would list answered questions as open
    expect((await get(answered({ ok: false }))).status).toBe(503);
  });
});

describe("the page in plain words", () => {
  const base: NowInput = {
    canEdit: true, confirmed: false, goal: true, users: true, files: { total: 2, read: 2, reading: 0, notRead: 0, failed: 0, unsupported: 0 },
    retrying: false, proposed: 0, confirmedRequirements: 3, conflictsOpen: 0, conflicts: 0, questions: 1,
  };
  it("is ready to confirm when everything is read and checked", () => {
    const n = understandingNow(base);
    expect(n.status).toBe("Ready to confirm");
    expect(n.primary).toMatchObject({ label: "Confirm understanding", disabled: false });
    expect(n.chips.length).toBeLessThanOrEqual(6);
  });
  it("waits while files are read and blocks on open disagreements", () => {
    expect(understandingNow({ ...base, files: { ...base.files, read: 1, reading: 1 } })).toMatchObject({ status: "Reading your files…", primary: { disabled: true } });
    expect(understandingNow({ ...base, conflicts: 1, conflictsOpen: 1 }).primary).toMatchObject({ disabled: true, reason: "Settle 1 disagreement first." });
  });
  it("shows a missing start answer as missing, not as a generic question", () => {
    const lines = understoodLines({ existing: false, about: "", goal: "", users: "SME owners", outOfScope: [] });
    expect(lines.find((l) => l.key === "goal")).toMatchObject({ missing: true, text: "Not answered yet" });
    expect(openQuestions([{ key: "basics:goal", question: "What problem should this project solve?", context: "", kind: "basics" }])).toEqual([]);
  });
  it("names every file state in plain words, with retry only where it helps", () => {
    const f = (status: string, extra = {}) => fileWords({ fileId: "a", name: "a.pdf", status, observationCount: 0, ...extra }, false);
    expect(f("ready", { requirementCount: 2 })).toMatchObject({ label: "Read", detail: "2 requirements found", action: null });
    expect(f("not_read")).toMatchObject({ label: "Not read yet", action: "read" });
    expect(f("failed", { errorCode: "pdf_password_required" })).toMatchObject({ label: "Couldn't read it", action: "retry", detail: expect.stringContaining("password") });
    expect(f("failed", { errorCode: "pdf_parser_unavailable" }).detail).not.toMatch(/install|dependency|server/i);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FilesCard, {
      files: [{ fileId: "a", name: "Spec.pdf", status: "ready", observationCount: 3 }, { fileId: "b", name: "Old.docx", status: "not_read", observationCount: 0 }],
      busyIds: new Set<string>(), canEdit: true, readOnly: false, setupHref: "/p/x/business", onRead: () => {}, onReadAll: () => {},
    })));
    expect(html).toContain("What we read from your files");
    expect(html).toContain("Not read yet");
    expect(html).toContain("Read it");
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("what the project setup found (QA 31.10 U2)", () => {
  it("lists the setup's must-haves and the business agent's findings, without ignored ones, repeats or what the brief lists", () => {
    const out = setupFindings({
      mustHaves: [{ text: "Buyers pay once" }],
      found: [
        { id: "a", text: "Buyers can browse assets by category", status: "open", sourceName: "Scratch pad" },
        { id: "b", text: "buyers pay once.", status: "added", sourceName: "Scratch pad" },
        { id: "c", text: "Creators see their sales", status: "ignored", sourceName: "Scratch pad" },
        { id: "d", text: "Creators upload assets", status: "open", sourceName: "" },
      ],
      inBrief: ["Creators upload assets"],
    });
    expect(out.map((f) => f.text)).toEqual(["Buyers pay once", "Buyers can browse assets by category"]);
    expect(out.map((f) => f.source)).toEqual(["From your project setup", "Found in Scratch pad by your business analyst"]);
  });
  it("says nothing new is waiting to be checked when only the setup found something", () => {
    const base: NowInput = {
      canEdit: true, confirmed: false, goal: true, users: true, files: { total: 0, read: 0, reading: 0, notRead: 0, failed: 0, unsupported: 0 },
      retrying: false, proposed: 0, confirmedRequirements: 0, conflictsOpen: 0, conflicts: 0, questions: 0,
    };
    expect(understandingNow({ ...base, fromSetup: 7 }).chips.find((c) => c.key === "review")?.value).toBe("nothing new");
    expect(understandingNow(base).chips.find((c) => c.key === "review")?.value).toBe("nothing yet");
  });
});
