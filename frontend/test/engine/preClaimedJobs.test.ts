// Jobs the Factory claims for an engine before it runs them (functions/_lib/jobs.ts: design, extraction and build jobs
// are inserted "claimed" for their worker) and jobs whose work ended without the row getting the outcome:
//   - a pre-claimed job's first start is a pick-up like a claim: claimed -> running at once, "picked up" in the log,
//     progress and the outcome on the row;
//   - a true resume (running, or claimed with this attempt's job.json on the host) is unchanged;
//   - an attempt whose result.json is on the host gets that outcome written, and its work never runs again, also after
//     a code reload (a new engine on the same store).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capKey } from "../../functions/_lib/ids";
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import type { EngineJobKind } from "../../src/domain/engineJob";
import { createEngine, recordedOutcome } from "../../server/local/engine/driver.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import type { KindWriter } from "../../server/local/engine/run.ts";
import { makeWorld, type World } from "./harness";

const HOST = "madp-engine-main";
const calls: string[] = [];
const WRITER: KindWriter = async (run) => {
  calls.push(`${run.id}:${run.attempt}:${run.resumeFrom}`);
  await run.step(20, "Reading the records.");
  await run.wait(5);
  await run.step(80, "Writing.");
  return { outputs: [`DesignBrief:${run.id.slice(0, 8)}`], message: "Screen designs are ready." };
};
const writers = async (_k: EngineJobKind) => WRITER;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-preclaimed-"));
const projectFolder = (ws: string, p: string, o?: { name?: string }) => projectWorkspace(root, ws, p, o);
const s = (v: unknown) => (typeof v === "string" ? v : "");

describe("jobs claimed for the engine before they run", () => {
  let w: World;
  let n = 0;
  beforeAll(async () => {
    w = await makeWorld({ writers, engine: { projectFolder, pickupDelay: false } });
    await w.settle(); // the seeded running jobs end first
  });
  afterAll(() => {
    w?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A job row as jobs.create writes a pre-claimed one. */
  async function preClaimed(extra: Row = {}): Promise<string> {
    n += 1;
    const p = w.project("Supplier Quality Portal");
    const by = s(p.CreatedByUserId);
    const res = await w.gw.insert("EngineJob", {
      ProjectId: p.ItemId, Kind: "design.generate", Status: "claimed", Progress: 0, Attempts: 1, ClaimedBy: HOST,
      ClaimedAt: w.now().toISOString(), Message: "Waiting for the design worker.", ActiveKey: `design.generate:brief-${n}`,
      TargetType: "design-brief", TargetId: `brief-${n}`, InputJson: "{}", RequestedByUserId: by, WorkspaceId: p.WorkspaceId,
      ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: capKey(`test:preclaimed:${n}`), ...extra,
    });
    if (!res.itemId) throw new Error("not inserted");
    return res.itemId;
  }
  const jobDir = (id: string, attempt = 1) => {
    const j = w.get("EngineJob", id);
    return projectFolder(s(j.WorkspaceId), s(j.ProjectId)).job(id, attempt);
  };
  /** An engine on the same store, only for this job (a worker of its own, like the next code generation). */
  function engineFor(id: string, gateway: RawGateway = w.gw, log: string[] = w.log) {
    return createEngine({
      store: w.store, gateway, config: () => w.config, log: (l) => log.push(l), writers, now: () => w.now(),
      sleep: async () => undefined, sweepMs: 0, pickupDelay: false, projectFolder, workerId: HOST, acceptsJob: (j) => j.ItemId === id,
    });
  }
  async function run(id: string, gateway?: RawGateway, log?: string[]): Promise<void> {
    const e = engineFor(id, gateway, log);
    try {
      for (let i = 0; i < 5 && ["claimed", "running"].includes(s(w.get("EngineJob", id).Status)); i++) {
        e.tick();
        await e.idle();
      }
    } finally {
      e.stop();
    }
  }
  function watch(id: string): Row[] {
    const seen: Row[] = [];
    w.store.onChange(`watch-${id}`, (c) => {
      if (c.schema === "EngineJob" && c.row.ItemId === id) seen.push({ ...c.row });
    });
    return seen;
  }

  it("starts a pre-claimed job like a claim: running at once, picked up, progress and the outcome on the row", async () => {
    const id = await preClaimed();
    const seen = watch(id);
    const log: string[] = [];
    calls.length = 0;
    await run(id, w.gw, log);
    w.store.onChange(`watch-${id}`, null);
    // the first write moves it from "claimed · Waiting for the design worker." to running, before the writer's steps
    expect(seen[0]).toMatchObject({ Status: "running", Message: "Started.", Attempts: 1, ClaimedBy: HOST });
    expect(seen.some((r) => r.Status === "running" && r.Progress === 20 && r.Message === "Reading the records.")).toBe(true);
    expect(log.some((l) => l.includes(`design.generate ${id.slice(0, 8)} picked up`))).toBe(true);
    const job = w.get("EngineJob", id);
    expect(job).toMatchObject({ Status: "succeeded", Progress: 100, Attempts: 1, ActiveKey: id, Message: "Screen designs are ready." });
    expect(job.OutputRefs).toEqual([`DesignBrief:${id.slice(0, 8)}`]);
    expect(calls).toEqual([`${id}:1:0`]);
    const recorded = JSON.parse(fs.readFileSync(path.join(jobDir(id), "job.json"), "utf8"));
    expect(recorded.mode).toBe("start");
  });

  it("resumes a running job as before: no pick-up, no new start line, the writer catches up", async () => {
    const id = await preClaimed({ Status: "running", Progress: 40, Message: "Writing." });
    const claimedAt = w.get("EngineJob", id).ClaimedAt;
    const seen = watch(id);
    const log: string[] = [];
    calls.length = 0;
    await run(id, w.gw, log);
    w.store.onChange(`watch-${id}`, null);
    expect(calls).toEqual([`${id}:1:40`]);
    expect(seen.some((r) => r.Message === "Started.")).toBe(false);
    expect(log.some((l) => l.includes("picked up"))).toBe(false);
    expect(w.get("EngineJob", id)).toMatchObject({ Status: "succeeded", Attempts: 1, ClaimedAt: claimedAt });
  });

  it("resumes a claimed job this host already started (its job.json is there) as before", async () => {
    const id = await preClaimed();
    fs.writeFileSync(path.join(jobDir(id), "job.json"), JSON.stringify({ jobId: id, attempt: 1, mode: "resume" }));
    const seen = watch(id);
    const log: string[] = [];
    calls.length = 0;
    await run(id, w.gw, log);
    w.store.onChange(`watch-${id}`, null);
    expect(calls).toEqual([`${id}:1:0`]);
    expect(seen[0]).toMatchObject({ Status: "running", Progress: 20, Message: "Reading the records." });
    expect(log.some((l) => l.includes("picked up"))).toBe(false);
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
  });

  it("writes a recorded success to a job that never got it, without running the work again (also after a reload)", async () => {
    const id = await preClaimed();
    // the engine finishes the work, but every write of the final state is lost (the 08.11.2026 design job)
    const lossy: RawGateway = {
      ...w.gw,
      update: async (schema, itemId, patch) => {
        if (schema === "EngineJob" && itemId === id && patch.Status === "succeeded") return;
        return w.gw.update(schema, itemId, patch);
      },
    };
    calls.length = 0;
    const first = engineFor(id, lossy);
    first.tick();
    await first.idle();
    first.tick(); // the same generation never resumes a job it ended
    await first.idle();
    first.stop();
    expect(calls).toHaveLength(1);
    expect(w.get("EngineJob", id).Status).toBe("running");
    const result = JSON.parse(fs.readFileSync(path.join(jobDir(id), "result.json"), "utf8"));
    expect(result.status).toBe("succeeded");
    // the next code generation (a new engine on the same store) applies the recorded outcome
    const log: string[] = [];
    await run(id, w.gw, log);
    expect(calls).toHaveLength(1);
    expect(w.get("EngineJob", id)).toMatchObject({
      Status: "succeeded", Progress: 100, Message: "Screen designs are ready.", OutputRefs: [`DesignBrief:${id.slice(0, 8)}`],
      FinishedAt: result.finishedAt, ActiveKey: id,
    });
    expect(log.some((l) => l.includes("never got the outcome"))).toBe(true);
  });

  it("writes a recorded success to a job still claimed (its final write missed), never running the writer", async () => {
    const id = await preClaimed();
    const finishedAt = new Date(w.now().getTime() + 415_000).toISOString();
    fs.writeFileSync(path.join(jobDir(id), "job.json"), JSON.stringify({ jobId: id, attempt: 1, mode: "resume" }));
    fs.writeFileSync(path.join(jobDir(id), "result.json"), JSON.stringify({ status: "succeeded", message: "Screen designs are ready in Look & feel.", outputs: ["DesignBrief:b1", "StorageObject:s1"], finishedAt }));
    calls.length = 0;
    await run(id);
    expect(calls).toHaveLength(0);
    expect(w.get("EngineJob", id)).toMatchObject({
      Status: "succeeded", Progress: 100, Message: "Screen designs are ready in Look & feel.", OutputRefs: ["DesignBrief:b1", "StorageObject:s1"], FinishedAt: finishedAt, ActiveKey: id,
    });
  });

  it("writes a recorded failure with its code, never running the writer", async () => {
    const id = await preClaimed();
    const finishedAt = new Date(w.now().getTime() + 60_000).toISOString();
    fs.writeFileSync(path.join(jobDir(id), "result.json"), JSON.stringify({ status: "failed", message: "Figma did not return a complete screen design.", code: "design.figmaInvalidResult", error: "raw", finishedAt }));
    calls.length = 0;
    await run(id);
    expect(calls).toHaveLength(0);
    expect(w.get("EngineJob", id)).toMatchObject({ Status: "failed", Message: "Figma did not return a complete screen design.", ErrorCode: "design.figmaInvalidResult", FinishedAt: finishedAt, ActiveKey: id });
  });

  it("ignores an outcome older than the job's claim (a retry claimed for the same host reuses the attempt number)", async () => {
    const id = await preClaimed();
    fs.writeFileSync(path.join(jobDir(id), "result.json"), JSON.stringify({ status: "failed", message: "Out of capacity.", code: "engine.capacity", finishedAt: new Date(w.now().getTime() - 60_000).toISOString() }));
    calls.length = 0;
    await run(id);
    expect(calls).toEqual([`${id}:1:0`]);
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
  });
});

describe("recordedOutcome (also keeps the worker's time limit off a job whose work ended on the host)", () => {
  const job = { ClaimedAt: "2026-11-08T20:32:01.785Z" };
  it("answers an outcome of the current claim", () => {
    expect(recordedOutcome({ status: "succeeded", finishedAt: "2026-11-08T20:39:00.643Z" }, job)).toMatchObject({ status: "succeeded" });
    expect(recordedOutcome({ status: "failed", code: "design.stale", finishedAt: "2026-11-08T20:40:00.000Z" }, job)).toMatchObject({ code: "design.stale" });
  });
  it("ignores an older outcome, a run that stopped, and anything unreadable", () => {
    expect(recordedOutcome({ status: "failed", finishedAt: "2026-11-08T20:00:00.000Z" }, job)).toBeNull();
    expect(recordedOutcome({ status: "stopped", finishedAt: "2026-11-08T20:39:00.643Z" }, job)).toBeNull();
    expect(recordedOutcome({ status: "succeeded" }, job)).toBeNull();
    expect(recordedOutcome({ status: "succeeded", finishedAt: "2026-11-08T20:39:00.643Z" }, {})).toBeNull();
    expect(recordedOutcome(null, job)).toBeNull();
    expect(recordedOutcome([], job)).toBeNull();
  });
});
