// A build is done only when everything after its deploy finished (official/afterDeploy.ts, src/domain/afterDeploy.ts):
// the data tables and the texts are each retried once when that can help; what is still open then is the job's
// attention, written as its ErrorCode on a job that still succeeds (its code is live). The driver writes it, a later
// clean build closes it, and a job of the build's kind with { afterDeploy: true } runs only those steps again.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/afterDeployOutcome.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AFTER_DEPLOY_LINE, EXPOSED_LINE, afterDeployCode, afterDeployIssues, afterDeployRetryInput, attentionOf, deliveryTargetOf, isAfterDeployRetry,
  jobAttention, newestDelivered, openAttention,
} from "../../src/domain/afterDeploy";
import type { EngineJobKind } from "../../src/domain/engineJob";
import { dataIssues, runAfterDeploy, textsIssues } from "../../server/local/engine/official/afterDeploy.ts";
import { EXPOSED_LINE as DATA_EXPOSED_LINE, FAILED_LINE, REFUSED_LINE, type DataOutcome } from "../../server/local/engine/official/dataTables.ts";
import { SYNCED_LINE, failedLine, problemsLine, portalLine, type TextsOutcome } from "../../server/local/engine/official/uilm.ts";
import type { KindWriter } from "../../server/local/engine/run.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { makeWorld, type World } from "./harness";

const data = (o: Partial<DataOutcome> = {}): DataOutcome => ({ status: "none", line: "", repos: [], tables: 0, fields: 0, ...o });
const texts = (o: Partial<TextsOutcome> = {}): TextsOutcome => ({ status: "none", modules: [], line: "", ...o });
const DATA_UPDATED = data({ status: "updated", line: "Data tables updated on Blocks (1 new, 0 changed fields added).", repos: ["api"], tables: 1 });
const DATA_FAILED = data({ status: "failed", line: FAILED_LINE, repos: ["api"] });
const DATA_EXPOSED = data({ status: "exposed", line: EXPOSED_LINE, repos: ["api"], exposed: ["Leave"], openTables: ["Leave"] });
const DATA_REFUSED = data({ status: "refused", line: REFUSED_LINE, repos: ["api"] });
const TEXTS_SYNCED = texts({ status: "synced", modules: ["sales"], line: SYNCED_LINE });
const TEXTS_FAILED = texts({ status: "failed", modules: ["sales"], line: failedLine(["sales"]) });
const TEXTS_PROBLEMS = texts({ status: "failed", modules: ["sales"], line: problemsLine(["sales"], 1), problems: ["sales.de-CH placeholder: differs"] });
const TEXTS_PORTAL = texts({ status: "portal-edits", modules: ["sales"], line: portalLine(["sales"]) });

/** The steps with scripted outcomes, one per run; records the runs, the log and the notes. */
function steps(d: DataOutcome[], t: TextsOutcome[]) {
  const runs = { data: 0, texts: 0 };
  const log: string[] = [];
  const notes: Array<{ key: string; status: string }> = [];
  return {
    runs, log, notes,
    s: {
      data: async () => d[Math.min(runs.data++, d.length - 1)]!,
      texts: async () => t[Math.min(runs.texts++, t.length - 1)]!,
      log: (l: string) => void log.push(l),
      note: async (x: { status: string }, key: "data" | "texts") => void notes.push({ key, status: x.status }),
    },
  };
}

describe("the job's attention (pure)", () => {
  it("is written as one ErrorCode, most urgent first, and read back; any other code is no attention", () => {
    expect(afterDeployCode(["texts-held", "data-exposed", "texts-held"])).toBe("after-deploy:data-exposed,texts-held");
    expect(afterDeployCode([])).toBe("");
    expect(afterDeployIssues("after-deploy:texts-failed,data-failed,bogus")).toEqual(["data-failed", "texts-failed"]);
    for (const other of ["", "engine.failed", "change.scope", null, undefined, 3]) expect(afterDeployIssues(other)).toEqual([]);
  });

  it("a new table that may be open comes first, in the data tables' own words; texts are mentioned when data is open too", () => {
    expect(DATA_EXPOSED_LINE).toBe(EXPOSED_LINE);
    const a = attentionOf(["texts-failed", "data-exposed"])!;
    expect(a).toMatchObject({ top: "data-exposed", security: true, retry: true });
    expect(a.line).toBe(`${EXPOSED_LINE} The new texts are not synced yet either.`);
    expect(attentionOf(["data-failed"])!.line).toBe(AFTER_DEPLOY_LINE["data-failed"]);
    expect(AFTER_DEPLOY_LINE["data-failed"]).toMatch(/new screens may not save until/);
    expect(AFTER_DEPLOY_LINE["texts-failed"]).toMatch(/old words until/);
    expect(attentionOf([])).toBeNull();
  });

  it("can be finished by running the steps again only when that can help", () => {
    expect(attentionOf(["data-refused"])!.retry).toBe(false);
    expect(attentionOf(["texts-held"])!.retry).toBe(false);
    expect(attentionOf(["data-refused", "texts-failed"])!.retry).toBe(true);
  });

  it("belongs to succeeded builds and change builds only", () => {
    const code = "after-deploy:data-failed";
    expect(jobAttention({ kind: "change.build", status: "succeeded", errorCode: code })?.top).toBe("data-failed");
    expect(jobAttention({ kind: "build.run", status: "succeeded", errorCode: code })?.top).toBe("data-failed");
    expect(jobAttention({ kind: "build.run", status: "failed", errorCode: code })).toBeNull();
    expect(jobAttention({ kind: "preview.deploy", status: "succeeded", errorCode: code })).toBeNull();
    expect(jobAttention({ kind: "build.run", status: "succeeded", errorCode: "engine.failed" })).toBeNull();
  });

  it("stays open until a later delivered build finished that area, whatever it was for", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 10, m)).toISOString();
    const cr7 = { id: "j7", kind: "change.build", status: "succeeded", errorCode: "after-deploy:data-failed,texts-failed", finishedAt: at(1) };
    expect(openAttention(cr7, cr7)?.issues).toEqual(["data-failed", "texts-failed"]);
    expect(openAttention(cr7, null)?.top).toBe("data-failed");
    // a later build (another change) left only the texts open: the data of CR-7 is on Blocks now
    const cr8 = { id: "j8", kind: "change.build", status: "succeeded", errorCode: "after-deploy:texts-failed", finishedAt: at(5) };
    expect(openAttention(cr7, cr8)?.issues).toEqual(["texts-failed"]);
    // a later clean build closes it
    const clean = { id: "j9", kind: "build.run", status: "succeeded", errorCode: "", finishedAt: at(9) };
    expect(openAttention(cr7, clean)).toBeNull();
    // a later build that has its own data issue keeps the data area open in that build's words
    const exposed = { ...cr8, errorCode: "after-deploy:data-exposed" };
    expect(openAttention(cr7, exposed)?.issues).toEqual(["data-exposed"]);
    // the newest delivered build is the one that finished last; failed or running ones never count
    expect(newestDelivered([cr7, { ...cr8, status: "failed", finishedAt: at(20) }, clean, cr8])?.id).toBe("j9");
    expect(newestDelivered([cr7, clean], (j) => j.kind === "change.build")?.id).toBe("j7");
  });

  it("names the target of a build and the input of the job that finishes its steps", () => {
    const j = { id: "j1", kind: "change.build", inputJson: JSON.stringify({ projectId: "p", changeRequestId: "cr-1" }) };
    expect(deliveryTargetOf(j)).toBe("cr-1");
    expect(deliveryTargetOf({ kind: "build.run", inputJson: JSON.stringify({ milestoneId: "m-1" }) })).toBe("m-1");
    expect(deliveryTargetOf({ kind: "build.run", inputJson: "not json" })).toBe("");
    const input = afterDeployRetryInput(j, "p");
    expect(input).toEqual({ projectId: "p", changeRequestId: "cr-1", afterDeploy: true, afterJobId: "j1" });
    expect(isAfterDeployRetry({ inputJson: JSON.stringify(input) })).toBe(true);
    expect(isAfterDeployRetry({ inputJson: j.inputJson })).toBe(false);
  });
});

describe("the steps after a deploy", () => {
  it("everything finished: no attention, each step noted once", async () => {
    const x = steps([DATA_UPDATED], [TEXTS_SYNCED]);
    const r = await runAfterDeploy(x.s);
    expect(r.issues).toEqual([]);
    expect(x.runs).toEqual({ data: 1, texts: 1 });
    expect(x.notes).toEqual([{ key: "data", status: "updated" }, { key: "texts", status: "synced" }]);
  });

  it("data tables that failed are tried once more; when that works the build is finished", async () => {
    const x = steps([DATA_FAILED, DATA_UPDATED], [TEXTS_SYNCED]);
    const r = await runAfterDeploy(x.s);
    expect(x.runs.data).toBe(2);
    expect(r.tables.status).toBe("updated");
    expect(r.issues).toEqual([]);
    // the tickets get the final outcome only
    expect(x.notes).toEqual([{ key: "data", status: "updated" }, { key: "texts", status: "synced" }]);
    expect(x.log.join("\n")).toContain("trying once more");
  });

  it("data tables that fail twice leave the build not finished", async () => {
    const x = steps([DATA_FAILED, DATA_FAILED], [TEXTS_SYNCED]);
    const r = await runAfterDeploy(x.s);
    expect(x.runs.data).toBe(2);
    expect(r.issues).toEqual(["data-failed"]);
  });

  it("the security path (a table that may be open) already retried inside the data step: no third run, top priority", async () => {
    const x = steps([DATA_EXPOSED], [TEXTS_FAILED, TEXTS_FAILED]);
    const r = await runAfterDeploy(x.s);
    expect(x.runs).toEqual({ data: 1, texts: 2 });
    expect(r.issues).toEqual(["data-exposed", "texts-failed"]);
    expect(afterDeployCode(r.issues)).toBe("after-deploy:data-exposed,texts-failed");
  });

  it("a refusal and held-back texts wait for a person: not run again, still not finished", async () => {
    for (const held of [TEXTS_PROBLEMS, TEXTS_PORTAL]) {
      const x = steps([DATA_REFUSED], [held]);
      const r = await runAfterDeploy(x.s);
      expect(x.runs).toEqual({ data: 1, texts: 1 });
      expect(r.issues).toEqual(["data-refused", "texts-held"]);
      expect(attentionOf(r.issues)!.retry).toBe(false);
    }
  });

  it("texts that failed for another reason are synced once more", async () => {
    const x = steps([data()], [TEXTS_FAILED, TEXTS_SYNCED]);
    const r = await runAfterDeploy(x.s);
    expect(x.runs.texts).toBe(2);
    expect(r.issues).toEqual([]);
  });

  it("what an earlier build left open counts too: a table still listed as open, a refusal still waiting", () => {
    expect(dataIssues(data({ openTables: ["Leave"] }))).toEqual(["data-exposed"]);
    expect(dataIssues(data({ waiting: ["api"] }))).toEqual(["data-refused"]);
    expect(dataIssues(data({ status: "failed", line: FAILED_LINE, waiting: ["api"] }))).toEqual(["data-failed", "data-refused"]);
    expect(dataIssues(DATA_UPDATED)).toEqual([]);
    expect(textsIssues(texts())).toEqual([]);
    expect(textsIssues(TEXTS_PROBLEMS)).toEqual(["texts-held"]);
  });
});

describe("the driver writes the attention on a job that still succeeds", () => {
  let w: World;
  let attention: KindResult["attention"] = undefined;
  let failNext = false;
  type KindResult = Awaited<ReturnType<KindWriter>>;
  const WRITER: KindWriter = async (run) => {
    await run.step(50, "Building.");
    if (failNext) {
      failNext = false;
      throw new Error("boom");
    }
    return { outputs: [], message: "CR-007 released to dev as 0.3.0.", ...(attention ? { attention } : {}) };
  };
  beforeAll(async () => {
    w = await makeWorld({ writers: async (_k: EngineJobKind) => WRITER });
    await w.settle();
  });
  afterAll(() => w?.close());

  it("succeeded, with the after-deploy code; a clean finish writes none", async () => {
    attention = ["texts-failed", "data-exposed"];
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: {}, key: "attention-1" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job).toMatchObject({ Status: "succeeded", Progress: 100, ErrorCode: "after-deploy:data-exposed,texts-failed", Message: "CR-007 released to dev as 0.3.0." });
    expect(jobAttention({ kind: String(job.Kind), status: String(job.Status), errorCode: String(job.ErrorCode) })?.security).toBe(true);
    expect(w.log.join("\n")).toContain("not finished after the deploy (data-exposed, texts-failed)");

    attention = undefined;
    const clean = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: {}, key: "attention-2" });
    await w.settle();
    expect(w.get("EngineJob", clean).Status).toBe("succeeded");
    expect(w.get("EngineJob", clean).ErrorCode ?? "").toBe("");
  });

  it("a job retried after a failure and then finished clean keeps no failure code", async () => {
    attention = undefined;
    failNext = true;
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: {}, key: "attention-3" });
    await w.settle();
    expect(w.get("EngineJob", id)).toMatchObject({ Status: "failed", ErrorCode: "engine.failed" });
    await w.gw.update("EngineJob", id, { Status: "queued", Progress: 0, Message: "", ActiveKey: "change.build:project" });
    await w.settle();
    expect(w.get("EngineJob", id)).toMatchObject({ Status: "succeeded", ErrorCode: "" });
  });
});

describe("a job that only finishes the steps after the deploy", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld({ writers: writerOf });
    await w.settle();
  });
  afterAll(() => w?.close());

  it("changes no status and moves no ticket (board-only mode has no steps after the deploy)", async () => {
    const p = w.project("Service Technician Portal");
    const pid = String(p.ItemId);
    const cr = w.rows("ChangeRequest", pid).find((c) => c.Status === "released-dev")!;
    expect(cr).toBeTruthy();
    const crId = String(cr.ItemId);
    const tickets = () => w.rows("Ticket", pid).map((t) => `${String(t.ItemId)}:${String(t.Column)}`).sort();
    const before = { tickets: tickets(), releases: w.rows("Release", pid).length };
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: { projectId: pid, changeRequestId: crId, afterDeploy: true, afterJobId: "earlier" }, key: "finish-1" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    expect(String(job.Message)).toMatch(/^Nothing was left to finish after the deploy of CR-\d{3}\.$/);
    expect(job.ErrorCode ?? "").toBe("");
    expect(w.get("ChangeRequest", crId).Status).toBe("released-dev");
    expect(tickets()).toEqual(before.tickets);
    expect(w.rows("Release", pid).length).toBe(before.releases);
  });
});
