// The business agent of the Project setup step (setup.assist) on the seeded store: shared files are filed into folders
// by kind, what they say becomes suggestions (must-haves with a priority, workflows, constraints…), nothing is deleted,
// the "Project brief" stays where it is, a second run reads only what is new, and nobody named means the person who
// started the project approves. Also the doorbell (setupWatch.ts) and the readers (read.ts, extract.ts).
//   PRINT=1 npx vitest run --config frontend/test/engine/vitest.config.ts test/engine/setup.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { capKey } from "../../functions/_lib/ids";
import { FILING_FOLDERS, SETUP_AGENT_KIND, filingOf, materialOf, planAgentRun, readSoFar } from "../../src/domain/setupAgent";
import { EMPTY_DETAILS } from "../../src/domain/setupDetails";
import { createFileRecord, writeBytes } from "../../server/local/storage.ts";
import { extractFindings, mustText } from "../../server/local/engine/kinds/setup/extract.ts";
import { pdfText, readDocument, readEmail } from "../../server/local/engine/kinds/setup/read.ts";
import { projectAgentState, startSetupWatch } from "../../server/local/engine/setupWatch.ts";
import { makeWorld, type World } from "./harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = /\b(simulated|simulation|mock|demo|sample|example|test data|fake|prototype|lorem|placeholder|AI)\b/;
const print = (title: string, rows: unknown) => {
  if (process.env.PRINT) console.log(`\n### ${title}\n${JSON.stringify(rows, null, 2)}`);
};

/** Business material the agent reads (fixtures/setup-material.json): minutes (PDF), e-mails (.eml), briefs (.md), call
 *  notes (.txt), data (.csv) and screen sketches (.png, by name only), per project. */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
type Material = { name: string; type: string; bytes?: Uint8Array };
const MATERIAL = JSON.parse(fs.readFileSync(path.join(FIXTURES, "setup-material.json"), "utf8")) as Record<string, { name: string; type: string; base64?: string }[]>;
function material(key: string): Material[] {
  const list = MATERIAL[key];
  if (!list) throw new Error(`no material fixture "${key}"`);
  return list.map((f) => ({ name: f.name, type: f.type, ...(f.base64 ? { bytes: new Uint8Array(Buffer.from(f.base64, "base64")) } : {}) }));
}

/** Shares files with a project the way doc.file.presign + commit leave them (ready, at the top level or in a folder). */
let shared = 0;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function share(w: World, project: Row, attachments: { name: string; type: string; bytes?: Uint8Array }[], folderId = ""): string[] {
  const ids: string[] = [];
  let n = 0;
  for (const a of attachments) {
    const f = { ...a, bytes: a.bytes ?? PNG };
    const rec = createFileRecord(w.db, { directoryId: "", name: f.name, mime: f.type, sizeBytes: f.bytes.length });
    writeBytes(w.db, path.join(w.dir, "files"), rec.fileId, f.bytes);
    n += 1;
    const by = String(project.CreatedByUserId);
    const res = w.store.insert("DocFile", {
      ProjectId: project.ItemId, FolderId: folderId, Name: f.name, StoredName: `${n}.${f.name.split(".").pop()}`, Mime: f.type, SizeBytes: f.bytes.length,
      StorageObjectId: rec.fileId, Status: "ready", SortOrder: 1024 * (100 + n), WorkspaceId: project.WorkspaceId, ReaderIds: project.ReaderIds,
      CreatedByUserId: by, UpdatedByUserId: by, RequestKey: capKey(`test:share:${project.ItemId}:${(shared += 1)}`),
    } as Row);
    ids.push(String(res.ItemId));
  }
  return ids;
}

async function runAgent(w: World, project: Row): Promise<Row> {
  const st = projectAgentState(w.store, String(project.ItemId));
  const plan = planAgentRun(st.material, readSoFar(st.jobs));
  expect(plan).not.toBeNull();
  const id = await w.queue({ project: String(project.Name), kind: SETUP_AGENT_KIND, input: { projectId: project.ItemId, ...plan }, key: `agent:${st.jobs.length}` });
  await w.settle();
  return w.get("EngineJob", id);
}

describe("reading documents", () => {
  it("reads a PDF line by line with headings", () => {
    // fixtures/minutes.pdf: "Workshop with Alpine Fresh, 12 October", a meta line, then "What we heard" and "Decided",
    // each with one bullet
    const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "minutes.pdf")));
    const text = pdfText(bytes);
    print("pdf", text);
    expect(text).toContain("## What we heard");
    expect(text).toMatch(/- Elena wants Supplier Quality Portal to collect the certificates .* chase them by e-mail\./);
    expect(text).toContain("- The first suppliers have to be live before the audit season, by 15 March.");
  });

  it("reads an e-mail's body without the headers, the greeting and the signature", () => {
    const r = readEmail("From: A <a@x.ch>\r\nSubject: Next steps\r\nContent-Type: text/plain\r\n\r\nHello Thea,\r\n\r\nWhat we need: the portal should send the reminders.\r\n\r\nKind regards,\r\nPriya\r\n+41 79 000 00 00\r\n");
    expect(r.subject).toBe("Next steps");
    expect(r.text).toBe("What we need: the portal should send the reminders.");
  });

  it("files documents by kind", () => {
    expect(filingOf("RE Offer Client Document Portal.eml")).toBe("emails");
    expect(filingOf("Minutes Alpine Fresh 12 October.pdf")).toBe("meetings");
    expect(filingOf("Call notes Beat Frei.txt")).toBe("meetings");
    expect(filingOf("Stop flow sketch.png")).toBe("designs");
    expect(filingOf("Order 14 Oct Hotel Seeblick.csv")).toBe("data");
    expect(filingOf("Offer Client Document Portal phase 1.pdf")).toBe("client");
    expect(filingOf("Returns Desk brief.md")).toBe("client");
  });

  it("puts must-haves in plain words", () => {
    expect(mustText("What we need: Returns Desk should record each return once", "Returns Desk")).toBe("Record each return once");
    expect(mustText("Elena wants Supplier Quality Portal to collect the certificates", "Supplier Quality Portal")).toBe("Collect the certificates");
    expect(mustText("**Shelf gap alerts**: flag shelf gaps", "Returns Desk")).toBe("**Shelf gap alerts**: flag shelf gaps");
  });

  it("reads labelled lines: the label gives the priority or the kind, the words after it are the finding", () => {
    const text = [
      "Cooking class booking - notes", "",
      "Must: customers book a class online and pay by card.",
      "Should: reminder e-mail one day before.",
      "Nice to have: a waiting list for full classes.",
      "Won't: gift vouchers in the first version.",
      "Not included: a loyalty programme.",
      "Deadline: before the Christmas season.",
    ].join("\n");
    const docs = [{ ref: "DocFile:n1", name: "notes.txt", read: readDocument("notes.txt", "text/plain", new TextEncoder().encode(text)) }];
    const found = extractFindings(docs, { productName: "Cooking Class Booking", goal: "x", users: "y", details: EMPTY_DETAILS });
    const pick = (kind: string) => found.filter((f) => f.kind === kind).map((f) => [f.text, f.kind === "mustHave" ? f.priority : f.constraintKind]);
    expect(pick("mustHave")).toEqual([
      ["Customers book a class online and pay by card", "must"],
      ["Reminder e-mail one day before", "should"],
      ["A waiting list for full classes", "could"],
    ]);
    expect(found.filter((f) => f.kind === "exclusion").map((f) => f.text)).toEqual(["Gift vouchers in the first version", "A loyalty programme"]);
    expect(pick("constraint")).toEqual([["Before the Christmas season", "deadline"]]);
  });

  it("finds must-haves, constraints and workflows, and leaves out what the project has", () => {
    const files = material("returnsDesk");
    const docs = files.map((f, i) => ({ ref: `DocFile:f${i}`, name: f.name, read: readDocument(f.name, f.type, f.bytes ?? null) }));
    const found = extractFindings(docs, { productName: "Returns Desk", goal: "", users: "", details: EMPTY_DETAILS });
    print("findings", found);
    const kinds = new Set(found.map((f) => f.kind));
    for (const k of ["mustHave", "constraint", "workflow", "goal", "users"]) expect(kinds.has(k as never), k).toBe(true);
    for (const f of found.filter((x) => x.constraintKind === "integrations")) expect(f.text).not.toMatch(/with (The|A|An) /);
    for (const f of found) {
      expect(f.text.length).toBeGreaterThanOrEqual(10);
      expect(f.text).not.toMatch(FORBIDDEN);
      expect(f.text).not.toMatch(/^(today|hello|kind regards)/i);
      expect(docs.some((d) => d.ref === f.sourceRef && d.name === f.sourceName)).toBe(true);
    }
    // nothing twice
    const texts = found.map((f) => `${f.kind}:${f.text.toLowerCase()}`);
    expect(new Set(texts).size).toBe(texts.length);
    // what the project has already is not suggested again
    const musts = found.filter((f) => f.kind === "mustHave");
    const again = extractFindings(docs, { productName: "Returns Desk", goal: "x", users: "y", details: { ...EMPTY_DETAILS, mustHaves: musts.map((m) => ({ text: m.text, priority: m.priority })) } });
    expect(again.filter((f) => f.kind === "mustHave")).toHaveLength(0);
    expect(again.some((f) => f.kind === "goal" || f.kind === "users")).toBe(false);
  });
});

describe("setup.assist", () => {
  let w: World;
  let project: Row;
  let ids: string[];
  let job: Row;
  beforeAll(async () => {
    w = await makeWorld();
    project = w.project("Supplier Quality Portal");
    const files = material("supplierQuality");
    // most at the top level, the brief where the Share window puts it
    const client = w.rows("DocFolder", String(project.ItemId)).find((f) => f.Name === FILING_FOLDERS.client.name);
    ids = [...share(w, project, files.slice(1)), ...share(w, project, files.slice(0, 1), client ? String(client.ItemId) : "")];
    job = await runAgent(w, project);
  });
  afterAll(() => w?.close());

  it("succeeds with the line people read", () => {
    print("job", { message: job.Message, outputs: job.OutputRefs });
    expect(job.Status).toBe("succeeded");
    expect(String(job.Message)).toMatch(/^Filed \d+ documents into \d folders · found .+/);
    expect(String(job.Message)).not.toMatch(FORBIDDEN);
  });

  it("files every new document into the folder of its kind, deleting nothing", () => {
    const pid = String(project.ItemId);
    const folders = w.rows("DocFolder", pid).filter((f) => f.ParentId === "");
    const byId = new Map(folders.map((f) => [String(f.ItemId), String(f.Name)]));
    const placed = ids.map((id) => w.get("DocFile", id)).map((f) => [String(f.Name), byId.get(String(f.FolderId))]);
    print("filed", placed);
    for (const [name, folder] of placed) {
      expect(folder, name).toBe(FILING_FOLDERS[filingOf(String(name))].name);
    }
    for (const id of ids) expect(w.get("DocFile", id).Status).toBe("ready");
    // one folder per name, each placed at the end of the top level
    const names = folders.map((f) => f.Name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of folders) expect(["active"]).toContain(f.Status);
  });

  it("writes suggestions people review, with their source", () => {
    const rows = w.rows("SetupSuggestion", String(project.ItemId));
    print("suggestions", rows.map((r) => [r.Kind, r.Priority, r.ConstraintKind, r.Text, r.SourceName]));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.Status).toBe("open");
      expect(r.EngineJobId).toBe(job.ItemId);
      const sources = [...w.rows("DocFile", String(project.ItemId)).map((f) => `DocFile:${f.ItemId}`), ...w.rows("DocNote", String(project.ItemId)).map((n) => `DocNote:${n.ItemId}`)];
      expect(sources).toContain(r.SourceRef);
      expect(r.ReaderIds).toEqual(project.ReaderIds);
      expect(String(r.Text)).not.toMatch(FORBIDDEN);
    }
    expect(rows.some((r) => r.Kind === "mustHave")).toBe(true);
  });

  it("makes the person who started the project the approver when nobody is named", () => {
    const p = w.get("Project", String(project.ItemId));
    expect(p.ApprovalOwnerUserId).toBe(project.CreatedByUserId);
  });

  it("reads only what is new the next time, and keeps what people decided", async () => {
    const pid = String(project.ItemId);
    const first = w.rows("SetupSuggestion", pid);
    await w.gw.update("SetupSuggestion", String(first[0]!.ItemId), { Status: "ignored" });
    // the same minutes again (a second copy) and one new e-mail
    const again = material("supplierQualityMinutesAgain");
    const mail = material("supplierQualityEmail");
    const added = share(w, project, [...again, ...mail]);
    const st = projectAgentState(w.store, pid);
    const plan = planAgentRun(st.material, readSoFar(st.jobs))!;
    expect(plan.fileIds.sort()).toEqual([...added].sort());
    const next = await runAgent(w, project);
    expect(next.Status).toBe("succeeded");
    expect(w.get("SetupSuggestion", String(first[0]!.ItemId)).Status).toBe("ignored");
    // the second copy found nothing new; no suggestion twice
    const keys = w.rows("SetupSuggestion", pid).map((r) => r.Key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(planAgentRun(projectAgentState(w.store, pid).material, readSoFar(projectAgentState(w.store, pid).jobs))).toBeNull();
  });

  it("is restart safe: a run that starts again ends with the same rows", async () => {
    const pid = String(project.ItemId);
    share(w, project, material("supplierQualityLater"));
    const st = projectAgentState(w.store, pid);
    const plan = planAgentRun(st.material, readSoFar(st.jobs))!;
    const id = await w.queue({ project: "Supplier Quality Portal", kind: SETUP_AGENT_KIND, input: { projectId: pid, ...plan }, key: "restart" });
    // the engine stops half-way (a restart): the job stays running, then a new engine resumes it
    let stops = 0;
    for (let i = 0; i < 400 && stops === 0; i++) {
      w.engine.tick();
      await new Promise((r) => setImmediate(r));
      const j = w.get("EngineJob", id);
      if (j.Status === "running" && Number(j.Progress) >= 60) {
        w.engine.stop();
        stops += 1;
      }
    }
    expect(stops).toBe(1);
    const mid = { folders: w.rows("DocFolder", pid).length, suggestions: w.rows("SetupSuggestion", pid).length };
    const { createEngine } = await import("../../server/local/engine/driver.ts");
    const { writerOf } = await import("../../server/local/engine/kinds/index.ts");
    const engine2 = createEngine({ store: w.store, gateway: w.gw, config: () => w.config, log: () => undefined, writers: writerOf, sleep: async () => undefined, readFile: async () => null, sweepMs: 0 });
    engine2.tick();
    await engine2.idle();
    engine2.stop();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    const names = w.rows("DocFolder", pid).map((f) => f.Name);
    expect(new Set(names).size).toBe(names.length);
    expect(w.rows("DocFolder", pid).length).toBeGreaterThanOrEqual(mid.folders);
    const keys = w.rows("SetupSuggestion", pid).map((r) => r.Key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the doorbell", () => {
  let w: World;
  afterAll(() => w?.close());

  it("queues one run for new material during the setup, none after the hand-over, none for the agent's own moves", async () => {
    w = await makeWorld();
    const project = w.project("Trade Fair Lead App");
    const pid = String(project.ItemId);
    const watch = startSetupWatch({ store: w.store, gateway: w.gw, config: () => w.config, log: () => undefined, debounceMs: 0, sweepAtStart: false });
    share(w, project, material("tradeFair"));
    const jobId = await watch.check(pid);
    expect(jobId).toBeTruthy();
    expect(await watch.check(pid)).toBeNull(); // one active run at a time
    await w.settle();
    expect(w.get("EngineJob", jobId!).Status).toBe("succeeded");
    expect(await watch.check(pid)).toBeNull(); // the agent's own moves are no new material
    // the "Project brief" is the setup's own summary: editing it is no new material
    const brief = w.rows("DocNote", pid).find((n) => n.IsProjectBrief === true);
    if (brief) {
      await w.gw.update("DocNote", String(brief.ItemId), { BodyMd: `${String(brief.BodyMd)}\n\nMore words for the brief.` });
      expect(await watch.check(pid)).toBeNull();
    }
    // after the hand-over the agent leaves the project alone
    await w.gw.update("Project", pid, { BusinessHandedOverAt: "2026-10-25T15:00:00.000Z" });
    share(w, project, material("tradeFairEmail"));
    expect(await watch.check(pid)).toBeNull();
    watch.stop();
  });

  it("reads the note material: a changed note is read again, an empty one never", () => {
    const m = materialOf([{ id: "f1", status: "ready" }, { id: "f2", status: "pending" }], [
      { id: "n1", body: "Store staff log a return with a photo." }, { id: "n2", body: "  " }, { id: "n3", body: "The project's brief.", isBrief: true },
    ]);
    expect(m.files).toEqual(["f1"]);
    expect(m.notes.map((n) => n.id)).toEqual(["n1"]);
    const plan = planAgentRun(m, [])!;
    expect(planAgentRun(m, plan.seen)).toBeNull();
    const changed = materialOf([{ id: "f1", status: "ready" }], [{ id: "n1", body: "Store staff log a return with a photo, in under a minute." }]);
    expect(planAgentRun(changed, plan.seen)).toMatchObject({ fileIds: [], noteIds: ["n1"] });
  });
});
