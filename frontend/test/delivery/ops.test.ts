// milestone.accept and milestone.feedback (the Build step's sign-off and your feedback on a preview), on the delivery
// test ports: the guard, the state rules, idempotency, and what each one queues for the engine.
import { describe, expect, it } from "vitest";
import { runOp } from "../../functions/delivery/ops/common";
import { milestoneAcceptOp, readyPreviewVersion } from "../../functions/delivery/ops/build/milestoneAccept";
import { feedbackTitle, milestoneFeedbackOp } from "../../functions/delivery/ops/build/milestoneFeedback";
import { createFakeWorld, FX, guardCases, type FakeWorld } from "../../functions/delivery/ops/testing/fakePorts";

const stamps = { WorkspaceId: FX.ws, ReaderIds: [FX.owner, FX.member, FX.customWith], CreatedByUserId: FX.owner, UpdatedByUserId: FX.owner };

/** Three milestones: 1 and 2 built with a ready preview, 3 planned (or as given). */
function world(statuses: string[] = ["preview-ready", "preview-ready", "planned"]) {
  const w = createFakeWorld();
  const ids = statuses.map((Status, i) => String(w.seed("Milestone", {
    ProjectId: FX.project, ScopeVersion: 1, Number: i + 1, Name: `M${i + 1}`, Goal: "", FeatureRefs: [], SortOrder: i + 1,
    PreviewPoint: "", Status, ...stamps,
  }).ItemId));
  ids.forEach((id, i) => {
    if (statuses[i] !== "planned") {
      w.seed("Preview", { ProjectId: FX.project, MilestoneId: id, Environment: "dev", Version: `0.${i + 1}.0`, Url: `https://m${i + 1}-app.dev.client.ch`, Status: "ready", ReadyAt: FX.now, ...stamps });
    }
    w.seed("Ticket", {
      ProjectId: FX.project, Number: i + 1, PlanRef: `plan:${i + 1}`, Title: `T${i + 1}`, TicketType: "story", FeatureRef: "", MilestoneId: id,
      AgentRole: "shipper", Column: statuses[i] === "planned" ? "planned" : "done", SortOrder: 0, Description: "", IsDone: statuses[i] !== "planned", Source: "plan", ...stamps,
    });
  });
  return { w, ids };
}

const accept = (w: FakeWorld, requestId: string, milestoneId: string) =>
  runOp(w.ports, { op: "milestone.accept", requestId }, milestoneAcceptOp, { projectId: FX.project, milestoneId });
const feedback = (w: FakeWorld, requestId: string, milestoneId: string, text = "The list should show the delivery window.") =>
  runOp(w.ports, { op: "milestone.feedback", requestId }, milestoneFeedbackOp, { projectId: FX.project, milestoneId, text });
type Ans = Awaited<ReturnType<typeof accept>>;
const err = (a: Ans) => (a.ok ? null : a.error);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (a: Ans) => (a.ok ? (a.data as Record<string, any>) : {});
const row = (w: FakeWorld, schema: "Milestone" | "Ticket" | "EngineJob", id: string) => w.rows(schema).find((r) => r.ItemId === id)!;

describe("milestone.accept", () => {
  for (const c of guardCases("build.run")) {
    it(`guard: ${c.name}`, async () => {
      const { w, ids } = world();
      w.as(c.userId, { superAdmin: c.superAdmin });
      const res = await accept(w, "r1", ids[0]!);
      if (c.code) expect(err(res)?.code).toBe(c.code);
      else expect(res.ok).toBe(true);
    });
  }

  it("signs a ready milestone off: done, with who and when; nothing is released while others are open", async () => {
    const { w, ids } = world();
    const res = await accept(w, "r1", ids[0]!);
    expect(res.ok).toBe(true);
    expect(data(res)).toMatchObject({ milestoneId: ids[0], existing: false, releaseJobId: null });
    expect(row(w, "Milestone", ids[0]!)).toMatchObject({ Status: "done", AcceptedAt: FX.now, AcceptedByUserId: FX.owner });
    expect(w.jobs).toHaveLength(0);
    expect(w.audits.some((a) => a.action === "milestone.accept")).toBe(true);
  });

  it("is idempotent: an accepted milestone answers existing and writes nothing", async () => {
    const { w, ids } = world();
    await accept(w, "r1", ids[0]!);
    const writes = w.writes.length;
    const again = await accept(w, "r2", ids[0]!);
    expect(again.ok).toBe(true);
    expect(data(again)).toMatchObject({ existing: true });
    expect(w.writes.length).toBe(writes);
  });

  it("refuses a milestone that is not built, has no ready preview, is being updated or has open feedback", async () => {
    const { w, ids } = world();
    expect(err(await accept(w, "a", ids[2]!))).toMatchObject({ code: "invalid_input", messageKey: "delivery.milestone.notReady" });

    const noPreview = world(["preview-ready"]);
    for (const p of noPreview.w.rows("Preview")) await noPreview.w.ports.update("Preview", String(p.ItemId), { Status: "failed" });
    expect(err(await accept(noPreview.w, "b", noPreview.ids[0]!))).toMatchObject({ messageKey: "delivery.milestone.noPreview" });

    w.seed("EngineJob", { ProjectId: FX.project, Kind: "build.run", Status: "running", InputJson: JSON.stringify({ projectId: FX.project, milestoneId: ids[0] }), ...stamps } as never);
    expect(err(await accept(w, "c", ids[0]!))).toMatchObject({ code: "conflict", messageKey: "delivery.milestone.building" });

    const fb = world();
    fb.w.seed("Ticket", {
      ProjectId: FX.project, Number: 9, PlanRef: "fb:x", Title: "F", TicketType: "fix", FeatureRef: "", MilestoneId: fb.ids[1], AgentRole: "dev",
      Column: "dev", SortOrder: 1001, Description: "F", IsDone: false, Source: "feedback", ...stamps,
    });
    expect(err(await accept(fb.w, "d", fb.ids[1]!))).toMatchObject({ code: "conflict", messageKey: "delivery.milestone.openFeedback" });
  });

  it("the last milestone accepted queues the release to dev (1.0.0) once; not when dev already has a release", async () => {
    const { w, ids } = world(["done", "preview-ready"]);
    const res = await accept(w, "r1", ids[1]!);
    expect(res.ok).toBe(true);
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ kind: "preview.deploy", input: { projectId: FX.project, milestoneId: ids[1], version: "0.2.0", release: "1.0.0" } });
    expect(data(res).releaseJobId).toBeTruthy();

    const released = world(["done", "preview-ready"]);
    released.w.seed("Release", { ProjectId: FX.project, Environment: "dev", Version: "1.0.0", Url: "", Status: "released", ChangeRequestIds: [], ReleasedAt: FX.now, ReleasedByUserId: FX.owner, ...stamps });
    await accept(released.w, "r1", released.ids[1]!);
    expect(released.w.jobs).toHaveLength(0);
  });

  it("readyPreviewVersion takes the newest ready version", () => {
    expect(readyPreviewVersion([{ Status: "ready", Version: "0.1.0" }, { Status: "ready", Version: "0.1.2" }, { Status: "failed", Version: "0.1.9" }])).toBe("0.1.2");
    expect(readyPreviewVersion([{ Status: "deploying", Version: "0.1.0" }])).toBeNull();
  });
});

describe("milestone.feedback", () => {
  for (const c of guardCases(["comment", "build.run"])) {
    it(`guard: ${c.name}`, async () => {
      const { w, ids } = world();
      w.as(c.userId, { superAdmin: c.superAdmin });
      const res = await feedback(w, "r1", ids[0]!);
      if (c.code) expect(err(res)?.code).toBe(c.code);
      else expect(res.ok).toBe(true);
    });
  }

  it("becomes a fix ticket of the milestone in Planned and the team picks it up at once", async () => {
    const { w, ids } = world();
    const res = await feedback(w, "r1", ids[0]!, "The route list should show the delivery window. Also the stop count.");
    expect(res.ok).toBe(true);
    const t = row(w, "Ticket", data(res).ticketId);
    expect(t).toMatchObject({
      MilestoneId: ids[0], Number: 4, TicketType: "fix", Column: "planned", Source: "feedback", IsDone: false,
      Title: "The route list should show the delivery window", Description: "The route list should show the delivery window. Also the stop count.",
      // a fix of the preview waits for nothing new
      DependsOn: [],
    });
    expect(w.rows("TicketEvent").some((e) => e.TicketId === t.ItemId && e.AuthorUserId === FX.owner && e.IsAuto === false)).toBe(true);
    expect(w.jobs).toHaveLength(1);
    expect(w.jobs[0]).toMatchObject({ kind: "build.run", input: { projectId: FX.project, milestoneId: ids[0], feedback: true } });
  });

  it("while a build runs, only the ticket is written (the engine takes it after that build); a replay writes nothing new", async () => {
    const { w, ids } = world();
    w.seed("EngineJob", { ProjectId: FX.project, Kind: "build.run", Status: "running", InputJson: JSON.stringify({ projectId: FX.project, milestoneId: ids[2] }), ...stamps } as never);
    const res = await feedback(w, "r1", ids[0]!);
    expect(res.ok).toBe(true);
    expect(data(res).jobId).toBeNull();
    expect(w.jobs).toHaveLength(0);
    const tickets = w.rows("Ticket").length;
    await feedback(w, "r1", ids[0]!);
    expect(w.rows("Ticket").length).toBe(tickets);
  });

  it("only while the preview waits: not on an accepted or unbuilt milestone, never empty", async () => {
    const { w, ids } = world(["done", "preview-ready", "planned"]);
    expect(err(await feedback(w, "a", ids[0]!))).toMatchObject({ messageKey: "delivery.milestone.accepted" });
    expect(err(await feedback(w, "b", ids[2]!))).toMatchObject({ messageKey: "delivery.milestone.notReady" });
    expect(err(await feedback(w, "c", ids[1]!, "   "))?.code).toBe("invalid_input");
  });

  it("feedbackTitle: the first sentence, at most 100 characters", () => {
    expect(feedbackTitle("The button is hidden. Please move it.")).toBe("The button is hidden");
    expect(feedbackTitle("x".repeat(150))).toHaveLength(98);
  });
});
