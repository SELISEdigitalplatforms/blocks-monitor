// A milestone that was built but never came online (its preview failed, or its build came from the Factory's removed
// template builder): build.start queues a new preview, never the old finished build again, and the page says exactly
// what was queued. On the delivery test ports and the pure Build step model.
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { buildStartOp } from "../../functions/delivery/ops/build/buildStart";
import { createFakeWorld, FX, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";
import { buildStartText } from "@/blocks/delivery/actions";
import { buildStep, type StepMilestone } from "@/components/build/buildStep";
import type { EngineJob } from "@/blocks/engine/types";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };

/** Milestone 1 (building, two done tickets) and milestone 2 (planned). */
function world() {
  const w = createFakeWorld();
  const ids = ["building", "planned"].map((Status, i) => String(w.seed("Milestone", {
    ProjectId: FX.project, ScopeVersion: 1, Number: i + 1, Name: `M${i + 1}`, Goal: "", FeatureRefs: [], SortOrder: i + 1, PreviewPoint: "", Status, ...stamps,
  }).ItemId));
  ids.forEach((id, i) => w.seed("Ticket", {
    ProjectId: FX.project, Number: i + 1, PlanRef: `plan:${i + 1}`, Title: `T${i + 1}`, TicketType: "story", FeatureRef: "", MilestoneId: id,
    AgentRole: "shipper", Column: i === 0 ? "done" : "planned", SortOrder: 0, Description: "", IsDone: i === 0, Source: "plan", ...stamps,
  }));
  return { w, m1: ids[0]! };
}

const start = (w: FakeWorld, requestId: string, milestoneId: string) =>
  runOp(w.ports, { op: "build.start", requestId }, buildStartOp, { projectId: FX.project, milestoneId });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Awaited<ReturnType<typeof start>>) => (a.ok ? (a.data as Record<string, any>) : { error: a.error });
const setStatus = (w: FakeWorld, id: string, Status: string) => w.ports.update("EngineJob", id, { Status });
/** A preview job of the milestone as the engine queues it, then ended with `status`. */
async function enginePreview(w: FakeWorld, milestoneId: string, status: string): Promise<string> {
  const { jobId } = await w.ports.createEngineJob({
    workspaceId: FX.ws, projectId: FX.project, kind: "preview.deploy", input: { projectId: FX.project, milestoneId, version: "0.1.0" },
    dedupeKey: `job:preview.deploy:${milestoneId}:0.1.0:${Math.random()}`, createdByUserId: FX.owner, target: { type: "milestone", id: milestoneId },
  });
  await setStatus(w, jobId, status);
  return jobId;
}

describe("build.start for a milestone that is built but not online", () => {
  it("a succeeded build whose preview failed: a new preview is queued (never the old build), and only once", async () => {
    const { w, m1 } = world();
    // the build of 04.11 (the old builder's): key 1, succeeded; its preview failed (three attempts)
    const first = data(await start(w, "r1", m1));
    expect(first).toMatchObject({ existing: false, kind: "build.run" });
    await setStatus(w, first.jobId, "succeeded");
    await enginePreview(w, m1, "failed");

    const again = data(await start(w, "r2", m1));
    expect(again).toMatchObject({ existing: false, kind: "preview.deploy" });
    expect(again.jobId).not.toBe(first.jobId);
    const queued = w.jobs.at(-1)!;
    expect(queued).toMatchObject({ kind: "preview.deploy", input: { projectId: FX.project, milestoneId: m1, version: "0.1.0" }, target: { type: "milestone", id: m1 } });
    expect(w.jobs.filter((j) => j.kind === "build.run")).toHaveLength(1);
    // while it runs, a second start names that preview as already on its way
    expect(data(await start(w, "r3", m1))).toMatchObject({ existing: true, kind: "preview.deploy", jobId: again.jobId });
    // it failed too: a third start queues another preview
    await setStatus(w, again.jobId, "failed");
    const third = data(await start(w, "r4", m1));
    expect(third).toMatchObject({ existing: false, kind: "preview.deploy" });
    expect(third.jobId).not.toBe(again.jobId);
  });

  it("a succeeded build with no preview at all (the removed builder's) gets its preview", async () => {
    const { w, m1 } = world();
    const first = data(await start(w, "r1", m1));
    await setStatus(w, first.jobId, "succeeded");
    expect(data(await start(w, "r2", m1))).toMatchObject({ existing: false, kind: "preview.deploy" });
    expect(w.jobs.at(-1)!.input).toEqual({ projectId: FX.project, milestoneId: m1 });
  });

  it("a failed build starts a new build with a fresh key; a running one is answered as running", async () => {
    const { w, m1 } = world();
    const first = data(await start(w, "r1", m1));
    expect(data(await start(w, "r2", m1))).toMatchObject({ existing: true, kind: "build.run", jobId: first.jobId });
    await setStatus(w, first.jobId, "failed");
    const second = data(await start(w, "r3", m1));
    expect(second).toMatchObject({ existing: false, kind: "build.run" });
    expect(second.jobId).not.toBe(first.jobId);
    expect(new Set(w.jobs.map((j) => j.dedupeKey)).size).toBe(w.jobs.length);
  });

  it("the page says what was queued, never a request it did not make", () => {
    expect(buildStartText({ kind: "build.run", existing: false })).toBe("The build was requested. The development team picks it up in a moment.");
    expect(buildStartText({ kind: "build.run", existing: true })).toBe("The build of this milestone is already running.");
    expect(buildStartText({ kind: "preview.deploy", existing: false })).toBe("The preview was requested. The development team puts it online in a moment.");
    expect(buildStartText({ kind: "preview.deploy", existing: true })).toBe("The preview of this milestone is already going online.");
  });
});

const ms = (statuses: string[]): StepMilestone[] => statuses.map((status, i) => ({ id: `m${i + 1}`, number: i + 1, name: `Milestone ${i + 1}`, sortOrder: i + 1, status }));
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, at: string): EngineJob => ({
  id: `${kind}-${status}-${at}`, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify(input), outputRefs: [],
  progress: 100, message: null, errorCode: null, attempts: 3, claimedBy: null, claimedAt: null, finishedAt: null, createdBy: null, createdAt: at, updatedAt: null,
});
const step = (jobs: EngineJob[]) => buildStep({
  milestones: ms(["building", "planned"]), tickets: [{ milestoneId: "m1", column: "done" }], previewOf: () => null, jobs,
  gate: { milestone: { id: "m1" }, enabled: true, reason: null }, tests: () => null, canAccept: true,
  feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false,
});

describe("the Build step for a milestone that is built but not online", () => {
  it("its preview failed: the step says so and offers the preview again, not a build", () => {
    const s = step([job("build.run", "succeeded", { milestoneId: "m1" }, "2026-11-04T08:00:00.000Z"), job("preview.deploy", "failed", { milestoneId: "m1", version: "0.1.0" }, "2026-11-04T09:00:00.000Z")]);
    expect(s.phase).toBe("stopped");
    expect(s.previewOnly).toBe(true);
    expect(s.status).toBe("The preview of milestone 1 did not go online");
    expect(s.primary).toMatchObject({ kind: "start", label: "Put the preview of milestone 1 online again", disabled: false });
  });

  it("no preview yet after the build: the start puts it online; a failed build still offers the build again", () => {
    const s = step([job("build.run", "succeeded", { milestoneId: "m1" }, "2026-11-04T08:00:00.000Z")]);
    expect(s).toMatchObject({ phase: "ready", previewOnly: true });
    expect(s.primary.label).toBe("Put the preview of milestone 1 online");
    const failed = step([job("build.run", "failed", { milestoneId: "m1" }, "2026-11-04T08:00:00.000Z")]);
    expect(failed).toMatchObject({ phase: "stopped", previewOnly: false });
    expect(failed.primary.label).toBe("Start milestone 1 again");
  });
});
