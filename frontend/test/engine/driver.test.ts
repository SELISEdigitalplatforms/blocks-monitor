// The engine's job lifecycle on the seeded store: claim, progress, success with outputs, ActiveKey hand-back, cancel,
// failure and retry, restart safety (a running job is resumed in place) and the paused switch.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EngineJobKind } from "../../src/domain/engineJob";
import type { Row } from "../../functions/_lib/gateway";
import type { KindWriter } from "../../server/local/engine/run.ts";
import { createEngine, retryCanFix, UNFIXABLE_LOOKS } from "../../server/local/engine/driver.ts";
import { OpError } from "../../functions/_lib/errors";
import { makeWorld, type World } from "./harness";
import { acceptsWorkerJob } from "../../server/blocks/engineWorker/jobScope";

let failNext = false;
const calls: string[] = [];
const WRITER: KindWriter = async (run) => {
  calls.push(`${run.kind}:${run.attempt}:${run.resumeFrom}`);
  await run.step(20, "Reading the records.");
  await run.wait(5);
  if (failNext) {
    failNext = false;
    throw new Error("boom");
  }
  const id = await run.insert("WikiPage", { Slug: `t-${run.id.slice(0, 6)}`, PageGroup: "overview", Title: "T", BodyMd: "x", SourcesJson: "{}", UpdatedWithVersion: "", Origin: "factory", EngineJobId: run.id }, "page");
  await run.step(80, "Writing.");
  await run.wait(5);
  return { outputs: [`WikiPage:${id}`], message: "Wrote 1 page." };
};
const writers = async (_k: EngineJobKind) => WRITER;

describe("engine driver", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld({ writers });
  });
  afterAll(() => w?.close());

  it("resumes a running job after a restart without claiming it again", async () => {
    // The two seeded builds are running; with this test writer they finish in place, attempt 1, no new claim.
    const running = w.rows("EngineJob").filter((j) => j.Status === "running");
    expect(running.length).toBeGreaterThanOrEqual(2);
    const before = new Map(running.map((j) => [String(j.ItemId), { claimedAt: j.ClaimedAt, by: j.ClaimedBy }]));
    calls.length = 0;
    await w.settle();
    for (const [id, b] of before) {
      const j = w.get("EngineJob", id);
      expect(j.Status).toBe("succeeded");
      expect(j.Attempts).toBe(1);
      expect(j.ClaimedAt).toBe(b.claimedAt);
      expect(j.ClaimedBy).toBe(b.by);
    }
    // The resumed writers knew where the job stood.
    expect(calls.some((c) => /:1:(4\d|40)$/.test(c))).toBe(true);
  });

  it("claims a queued job, reports progress and finishes it with its outputs", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {} });
    const seen: string[] = [];
    w.store.onChange("test", (c) => {
      if (c.schema === "EngineJob" && c.row.ItemId === id) seen.push(String(c.row.Status));
    });
    await w.settle();
    w.store.onChange("test", null);
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    expect(job.Progress).toBe(100);
    expect(job.Attempts).toBe(1);
    expect(job.ActiveKey).toBe(id);
    expect(String(job.ClaimedBy)).toMatch(/^madp-engine-/);
    expect(Date.parse(String(job.FinishedAt))).toBeGreaterThan(Date.parse(String(job.ClaimedAt)));
    expect(job.Message).toBe("Wrote 1 page.");
    expect(job.OutputRefs).toHaveLength(1);
    expect(seen[0]).toBe("claimed");
    expect(seen).toContain("running");
    const [schema, pageId] = String((job.OutputRefs as string[])[0]).split(":");
    const page = w.get(schema!, pageId!);
    expect(page.WorkspaceId).toBe(job.WorkspaceId);
    expect(page.ReaderIds).toEqual(job.ReaderIds);
    expect(page.CreatedByUserId).toBe(job.RequestedByUserId);
  });

  it("a second job of the same kind is new (the finished one gave its ActiveKey back)", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "second" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
  });

  it("fails a job whose writer throws, and runs it again after a retry", async () => {
    failNext = true;
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "fails" });
    await w.settle();
    const failed = w.get("EngineJob", id);
    expect(failed.Status).toBe("failed");
    expect(failed.ErrorCode).toBe("engine.failed");
    expect(failed.Message).toBe("The wiki stopped while writing the wiki pages. Start it again; if it stops the same way again, ask the engine team to look into it.");
    // job.retry: failed -> queued with the active key back
    await w.gw.update("EngineJob", id, { Status: "queued", Progress: 0, Message: "", ActiveKey: "wiki.generate:project" });
    await w.settle();
    const again = w.get("EngineJob", id);
    expect(again.Status).toBe("succeeded");
    expect(again.Attempts).toBe(2);
  });

  it("acknowledges a design stop only after the writer exits and releases its reservation", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "design.generate", input: {}, key: "design-stop" });
    w.engine.tick();
    for (let i = 0; i < 20 && w.get("EngineJob", id).Status !== "running"; i++) await new Promise((r) => setImmediate(r));
    const key = w.get("EngineJob", id).ActiveKey;
    await w.gw.update("EngineJob", id, { ErrorCode: "design.stopRequested" });
    expect(w.get("EngineJob", id).ActiveKey).toBe(key);
    w.engine.tick();
    await w.engine.idle();
    expect(w.get("EngineJob", id).Status).toBe("cancelled");
    expect(w.get("EngineJob", id).ActiveKey).toBe(id);
    expect(w.get("EngineJob", id).ErrorCode).toBe("");
    expect(w.rows("WikiPage").some((p) => p.EngineJobId === id)).toBe(false);
  });

  it("acknowledges a pending design stop after restarting without invoking the writer", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "design.generate", input: {}, key: "design-restart" });
    w.engine.tick();
    for (let i = 0; i < 20 && w.get("EngineJob", id).Status !== "running"; i++) await new Promise((r) => setImmediate(r));
    w.engine.stop();
    await w.gw.update("EngineJob", id, { ErrorCode: "design.stopRequested" });
    const callsBefore = calls.length;
    const restarted = createEngine({ store: w.store, gateway: w.gw, config: () => w.config, log: () => undefined, writers, sleep: async () => undefined, sweepMs: 0, pickupDelay: false, now: () => w.now() });
    try {
      restarted.tick();
      await restarted.idle();
      expect(w.get("EngineJob", id).Status).toBe("cancelled");
      expect(w.get("EngineJob", id).ActiveKey).toBe(id);
      expect(w.get("EngineJob", id).ErrorCode).toBe("");
      expect(calls.length).toBe(callsBefore);
    } finally {
      restarted.stop();
    }
  });

  it("stops working on a cancelled job and never writes after the cancel", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "cancel" });
    w.engine.tick();
    // Let it get going, then cancel the way job.cancel does.
    for (let i = 0; i < 20 && w.get("EngineJob", id).Status !== "running"; i++) await new Promise((r) => setImmediate(r));
    await w.gw.update("EngineJob", id, { Status: "cancelled", FinishedAt: w.now().toISOString(), ActiveKey: id });
    w.engine.tick();
    await w.engine.idle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("cancelled");
    expect(w.rows("WikiPage").some((p) => p.EngineJobId === id)).toBe(false);
  });

  it("does not claim or resume jobs outside the operator's project/kind scope", async () => {
    w.engine.stop();
    const project = w.project("Supplier Quality Portal");
    const scope = { projectIds: [String(project.ItemId)], kinds: ["wiki.generate" as const] };
    const selected = createEngine({ store: w.store, gateway: w.gw, config: () => w.config, log: () => undefined,
      writers, sleep: async () => undefined, sweepMs: 0, pickupDelay: false, acceptsJob: (j) => acceptsWorkerJob(scope, j) });
    try {
      const allowed = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "scope-allowed" });
      const otherKind = await w.queue({ project: "Supplier Quality Portal", kind: "chat.reply", input: {}, key: "scope-other-kind" });
      const otherProject = await w.queue({ project: "Payroll Self-Service", kind: "wiki.generate", input: {}, key: "scope-other-project" });
      await w.gw.update("EngineJob", otherProject, { Status: "running", Attempts: 1 });
      selected.tick();
      await selected.idle();
      expect(w.get("EngineJob", allowed).Status).toBe("succeeded");
      expect(w.get("EngineJob", otherKind).Status).toBe("queued");
      expect(w.get("EngineJob", otherProject).Status).toBe("running");
      expect(w.rows("WikiPage").some((p) => p.EngineJobId === otherProject)).toBe(false);
    } finally { selected.stop(); }
  });

  it("leaves jobs queued while paused", async () => {
    const paused = createEngine({
      store: w.store,
      gateway: w.gw,
      config: () => ({ enabled: false, pace: 1, sendBacks: true }),
      log: () => undefined,
      writers,
      sleep: async () => undefined,
      sweepMs: 0,
    });
    w.engine.stop();
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "paused" });
    paused.tick();
    await paused.idle();
    expect(w.get("EngineJob", id).Status).toBe("queued");
    paused.stop();
  });
});

// A job that cannot start is looked at again every 20 s. Before, every error left it there for ever (a writer module that
// did not load after an install: "design.generate ... waits: Requiring @playwright/test second time", every 20 s); now
// an error a new look cannot fix fails the job plainly on its third look, and a service that did not answer still waits.
describe("a job that cannot start", () => {
  let w: World;
  let writerError: unknown = null;
  let prepareError: unknown = null;
  const loader = async (k: EngineJobKind) => {
    if (k === "docs.generate" && writerError) throw writerError;
    return WRITER;
  };
  beforeAll(async () => {
    w = await makeWorld({ writers: loader });
    w.engine.stop();
  });
  afterAll(() => w?.close());
  afterEach(() => {
    vi.useRealTimers();
    writerError = null;
    prepareError = null;
  });

  function lookingEngine(lines: string[]) {
    const engine = createEngine({
      store: w.store, gateway: w.gw, config: () => w.config, log: (l) => lines.push(l), writers: loader,
      sleep: async () => undefined, sweepMs: 0, pickupDelay: false, now: () => w.now(),
      prepare: async () => { if (prepareError) throw prepareError; },
    });
    /** One look at the store, then the 20 s until the next one may start a parked job. */
    const look = async () => {
      engine.tick();
      await engine.idle();
      vi.setSystemTime(Date.now() + 21_000);
    };
    return { engine, look };
  }

  it("tells the errors a new look may get past from those it cannot fix", () => {
    expect(retryCanFix(new OpError("unavailable"))).toBe(true);
    expect(retryCanFix(new OpError("internal"))).toBe(true);
    expect(retryCanFix(new TypeError("fetch failed"))).toBe(true);
    expect(retryCanFix(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(retryCanFix(new Error("request failed", { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }))).toBe(true);
    expect(retryCanFix(new Error("Requiring @playwright/test second time, \nFirst:\nError"))).toBe(false);
    expect(retryCanFix(new SyntaxError("Unexpected token '}'"))).toBe(false);
    expect(retryCanFix(new OpError("forbidden"))).toBe(false);
  });

  it("fails plainly on its third look when its writer cannot be loaded, and runs again after a retry", async () => {
    writerError = new Error("Requiring @playwright/test second time, \nFirst:\nError\n    at Object.<anonymous> (/srv/madp-factory/bridge/releases/d8f8f8c1/selise-madp/frontend/node_modules/playwright/lib/index.js:67:33)");
    const lines: string[] = [];
    const { engine, look } = lookingEngine(lines);
    try {
      const id = await w.queue({ project: "Supplier Quality Portal", kind: "docs.generate", input: {}, key: "unloadable" });
      for (let i = 1; i < UNFIXABLE_LOOKS; i++) {
        await look();
        expect(w.get("EngineJob", id).Status).toBe("queued");
      }
      await look();
      const job = w.get("EngineJob", id);
      expect(job.Status).toBe("failed");
      expect(job.ErrorCode).toBe("engine.failed");
      expect(job.ActiveKey).toBe(id);
      expect(job.Message).toBe("The project documentation stopped while writing the documents. Start it again; if it stops the same way again, ask the engine team to look into it.");
      expect(lines.filter((l) => l.includes(`${id.slice(0, 8)} waits: Requiring @playwright/test second time`))).toHaveLength(UNFIXABLE_LOOKS - 1);
      expect(lines.some((l) => l.startsWith(`[engine] job ${id.slice(0, 8)} failed: it could not start on 3 looks in a row`) && l.includes("second time"))).toBe(true);
      // nothing more happens to it
      await look();
      expect(w.get("EngineJob", id).Status).toBe("failed");
      // once the code loads (a restart, a new release), a retry runs it
      writerError = null;
      await w.gw.update("EngineJob", id, { Status: "queued", Progress: 0, Message: "", ErrorCode: "", ActiveKey: "docs.generate:project" });
      await look();
      expect(w.get("EngineJob", id).Status).toBe("succeeded");
    } finally {
      engine.stop();
    }
  });

  it("keeps waiting while a service it needs does not answer", async () => {
    writerError = new OpError("unavailable");
    const lines: string[] = [];
    const { engine, look } = lookingEngine(lines);
    try {
      const id = await w.queue({ project: "Supplier Quality Portal", kind: "docs.generate", input: {}, key: "service-down" });
      for (let i = 0; i < UNFIXABLE_LOOKS + 2; i++) await look();
      expect(w.get("EngineJob", id).Status).toBe("queued");
      expect(lines.filter((l) => l.includes(`${id.slice(0, 8)} waits:`))).toHaveLength(UNFIXABLE_LOOKS + 2);
      expect(lines.some((l) => l.includes("a new look cannot fix"))).toBe(false);
      writerError = null;
      await look();
      expect(w.get("EngineJob", id).Status).toBe("succeeded");
    } finally {
      engine.stop();
    }
  });

  it("fails a claimed job whose records cannot be read, on the attempt it had", async () => {
    prepareError = new TypeError("Cannot read properties of undefined (reading 'ItemId')");
    const lines: string[] = [];
    const { engine, look } = lookingEngine(lines);
    try {
      const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "unreadable" });
      await w.gw.update("EngineJob", id, { Status: "running", Attempts: 1, ClaimedBy: "madp-engine-zrh-01", ClaimedAt: w.now().toISOString() });
      for (let i = 0; i < UNFIXABLE_LOOKS; i++) await look();
      const job: Row = w.get("EngineJob", id);
      expect(job.Status).toBe("failed");
      expect(job.Attempts).toBe(1);
      expect(job.ErrorCode).toBe("engine.failed");
      expect(job.Message).toBe("The wiki stopped while writing the wiki pages. Start it again; if it stops the same way again, ask the engine team to look into it.");
    } finally {
      engine.stop();
    }
  });
});
