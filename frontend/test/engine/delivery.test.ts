// Delivery on the seeded store: the running Driver App build finishes, its preview goes live, the remaining milestones
// build and each preview waits for the client; feedback on a preview is built and the preview refreshed (also feedback
// given while another build ran); only accepting the last milestone releases 1.0.0 to dev and moves the project on to
// Release; the running change build on the Service portal and a new one from a draft request release to dev; a build
// interrupted half-way resumes without repeating a move.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import * as delivery from "../../src/blocks/delivery/types";
import { nextMilestoneToBuild } from "../../src/domain/delivery";
import { createEngine } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { makeWorld, type World } from "./harness";

const FLOW = ["planned", "dev", "review", "test", "security", "docs", "gate", "done"];
const FORBIDDEN = /\b(simulat\w*|mock\w*|demo|sample|example|test data|fake|prototype)\b/i;

function parsedAll(w: World, projectId: string): void {
  const check = (schema: string, parse: (r: unknown) => { ok: boolean; error?: string }) => {
    for (const r of w.rows(schema, projectId)) {
      const p = parse(r);
      expect(p.ok, `${schema} ${String(r.ItemId)}: ${p.error}`).toBe(true);
    }
  };
  check("Ticket", delivery.parseTicket);
  check("TicketEvent", delivery.parseTicketEvent);
  check("Milestone", delivery.parseMilestone);
  check("Preview", delivery.parsePreview);
  check("ChangeRequest", delivery.parseChangeRequest);
  check("Release", delivery.parseRelease);
}

function nextMilestone(w: World, projectId: string): Row | null {
  const ms = w.rows("Milestone", projectId);
  const counts: Record<string, number> = {};
  for (const t of w.rows("Ticket", projectId)) if (t.MilestoneId) counts[String(t.MilestoneId)] = (counts[String(t.MilestoneId)] ?? 0) + 1;
  const next = nextMilestoneToBuild(
    ms.map((m) => ({ id: String(m.ItemId), number: Number(m.Number), name: String(m.Name), sortOrder: Number(m.SortOrder), status: String(m.Status) })),
    counts,
  );
  return next.milestone ? ms.find((m) => m.ItemId === next.milestone!.id) ?? null : null;
}

function milestonesOf(w: World, projectId: string): Row[] {
  const p = w.get("Project", projectId);
  return w.rows("Milestone", projectId).filter((m) => Number(m.ScopeVersion) === Number(p.CurrentScopeVersion))
    .sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder) || Number(a.Number) - Number(b.Number));
}

/** A feedback ticket as milestone.feedback writes it (Planned, Source "feedback"). */
async function feedback(w: World, p: Row, m: Row, text: string): Promise<string> {
  const pid = String(p.ItemId);
  const number = Math.max(0, ...w.rows("Ticket", pid).map((t) => Number(t.Number))) + 1;
  const by = String(p.AssigneeUserId || p.CreatedByUserId);
  const res = await w.gw.insert("Ticket", {
    ProjectId: pid, MilestoneId: m.ItemId, Number: number, PlanRef: `fb:${String(m.ItemId)}:${number}`, Title: text.replace(/\.$/, ""),
    TicketType: "fix", FeatureRef: "", StoryRef: "", AgentRole: "planner", Column: "planned", EstimateHours: 2,
    Acceptance: [`The preview does what this feedback asks: ${text}`], SortOrder: 1000 + number, Description: text, IsDone: false, Source: "feedback",
    WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: `test:fb:${number}`,
  });
  return String(res.itemId);
}

function engineTexts(w: World, jobIds: Set<string>): string[] {
  return [
    ...w.rows("TicketEvent").filter((e) => jobIds.has(String(e.EngineJobId))).map((e) => String(e.Text)),
    ...w.rows("EngineJob").filter((j) => jobIds.has(String(j.ItemId))).map((j) => String(j.Message)),
  ];
}

describe("delivery writers", () => {
  let w: World;
  let seededChange = "";
  beforeAll(async () => {
    w = await makeWorld();
    seededChange = String(w.rows("EngineJob").find((j) => j.Kind === "change.build" && j.Status === "running")?.ItemId ?? "");
  });
  afterAll(() => w?.close());

  it("finishes the seeded running build and puts its preview live", async () => {
    const p = w.project("Driver Delivery App");
    const build = w.rows("EngineJob", String(p.ItemId)).find((j) => j.Kind === "build.run" && j.Status === "running")!;
    expect(build).toBeTruthy();
    const milestoneId = JSON.parse(String(build.InputJson)).milestoneId as string;
    const before = w.rows("TicketEvent").length;
    await w.settle();

    const job = w.get("EngineJob", String(build.ItemId));
    expect(job.Status).toBe("succeeded");
    expect(job.ActiveKey).toBe(build.ItemId);
    expect(job.Attempts).toBe(1);
    expect(String(job.Message)).toMatch(/built: (\d+) of \1 tickets done\.$/);
    const tickets = w.rows("Ticket", String(p.ItemId)).filter((t) => t.MilestoneId === milestoneId);
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.Column).toBe("done");
      expect(t.IsDone).toBe(true);
      expect(t.AgentRole).toBe("shipper");
      expect(typeof t.DoneAt).toBe("string");
    }
    expect((job.OutputRefs as string[]).sort()).toEqual(tickets.map((t) => `Ticket:${String(t.ItemId)}`).sort());
    const moves = w.rows("TicketEvent").filter((e) => e.EngineJobId === build.ItemId && e.Kind === "move");
    expect(moves.length).toBeGreaterThan(0);
    expect(w.rows("TicketEvent").length).toBeGreaterThan(before);
    for (const m of moves) {
      expect(m.IsAuto).toBe(true);
      expect(Date.parse(String(m.At))).toBeGreaterThan(Date.parse(String(job.ClaimedAt)));
    }

    const preview = w.rows("EngineJob", String(p.ItemId)).find((j) => j.Kind === "preview.deploy" && JSON.parse(String(j.InputJson)).milestoneId === milestoneId && j.Status === "succeeded" && j.CreatedDate! > build.CreatedDate!);
    expect(preview, "preview.deploy queued by the build").toBeTruthy();
    expect(preview!.TargetType).toBe("milestone");
    expect(preview!.ActiveKey).toBe(preview!.ItemId);
    const m = w.get("Milestone", milestoneId);
    expect(m.Status).toBe("preview-ready");
    const pr = w.rows("Preview", String(p.ItemId)).find((x) => x.MilestoneId === milestoneId)!;
    expect(pr.Status).toBe("ready");
    expect(String(pr.Url)).toMatch(/^https:\/\/m\d+-/);
    expect(pr.Version).toBe(`0.${Number(m.Number)}.0`);
    expect(w.rows("Notification", String(p.ItemId)).some((n) => n.Kind === "preview.ready" && String(n.EventKey).includes(milestoneId) && n.IsRead === false)).toBe(true);
    parsedAll(w, String(p.ItemId));
  });

  it("builds the remaining milestones; every preview waits for the client and nothing is released yet", async () => {
    const p = w.project("Driver Delivery App");
    const pid = String(p.ItemId);
    const jobIds = new Set<string>();
    for (let guard = 0; guard < 6; guard++) {
      const m = nextMilestone(w, pid);
      if (!m) break;
      const id = await w.queue({ project: "Driver Delivery App", kind: "build.run", input: { projectId: pid, milestoneId: m.ItemId }, key: `build-${String(m.ItemId)}` });
      jobIds.add(id);
      await w.settle();
      expect(w.get("EngineJob", id).Status).toBe("succeeded");
    }
    expect(nextMilestone(w, pid)).toBeNull();
    for (const m of milestonesOf(w, pid)) expect(m.Status).toBe("preview-ready");
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev")).toBe(false);
    expect(w.get("Project", pid).Stage).toBe("build");
    for (const t of engineTexts(w, jobIds)) expect(t).not.toMatch(FORBIDDEN);
    parsedAll(w, pid);
  });

  it("feedback on a ready preview is built and the preview refreshed; feedback given during another build follows it", async () => {
    const p = w.project("Driver Delivery App");
    const pid = String(p.ItemId);
    const [m1, m2] = milestonesOf(w, pid);
    const fb1 = await feedback(w, p, m1!, "The route list should show the delivery window next to each stop.");
    const id = await w.queue({ project: "Driver Delivery App", kind: "build.run", input: { projectId: pid, milestoneId: m1!.ItemId, feedback: true }, key: "fb-1" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
    expect(String(w.get("EngineJob", id).Message)).toMatch(/built: (\d+) of \1 tickets done\.$/);
    expect(w.get("Ticket", fb1).Column).toBe("done");
    expect(w.get("Milestone", String(m1!.ItemId)).Status).toBe("preview-ready");
    const v1 = w.rows("Preview", pid).filter((x) => x.MilestoneId === m1!.ItemId).map((x) => x.Version);
    expect(v1).toEqual(expect.arrayContaining([`0.${Number(m1!.Number)}.0`, `0.${Number(m1!.Number)}.1`]));

    // feedback on milestone 2 while milestone 1's preview deploys again: picked up once that job is done
    const fb2 = await feedback(w, p, m2!, "Allow a photo of the signed delivery note.");
    const redeploy = await w.queue({ project: "Driver Delivery App", kind: "preview.deploy", input: { projectId: pid, milestoneId: m1!.ItemId, version: `0.${Number(m1!.Number)}.1` }, target: { type: "milestone", id: String(m1!.ItemId) }, key: "redeploy-1" });
    await w.settle();
    expect(w.get("EngineJob", redeploy).Status).toBe("succeeded");
    expect(w.get("Ticket", fb2).Column).toBe("done");
    expect(w.rows("Preview", pid).some((x) => x.MilestoneId === m2!.ItemId && x.Version === `0.${Number(m2!.Number)}.1` && x.Status === "ready")).toBe(true);
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev")).toBe(false);
    parsedAll(w, pid);
  });

  it("accepting the last milestone releases 1.0.0 to dev and moves the project on to Release", async () => {
    const p = w.project("Driver Delivery App");
    const pid = String(p.ItemId);
    const ms = milestonesOf(w, pid);
    const by = String(p.AssigneeUserId || p.CreatedByUserId);
    // milestone.accept: done with who and when; the last one queues the release (preview.deploy { release })
    for (const m of ms) await w.gw.update("Milestone", String(m.ItemId), { Status: "done", AcceptedAt: w.now().toISOString(), AcceptedByUserId: by });
    const last = ms[ms.length - 1]!;
    const id = await w.queue({ project: "Driver Delivery App", kind: "preview.deploy", input: { projectId: pid, milestoneId: last.ItemId, version: `0.${Number(last.Number)}.0`, release: "1.0.0" }, key: "release-1.0.0" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    expect(job.Message).toBe("Release 1.0.0 is on dev.");
    const release = w.rows("Release", pid).find((r) => r.Environment === "dev" && r.Version === "1.0.0")!;
    expect(release).toBeTruthy();
    expect(release.Status).toBe("released");
    expect(String(release.Url)).toMatch(/^https:\/\//);
    expect(w.get("Project", pid).Stage).toBe("release");
    for (const m of milestonesOf(w, pid)) {
      expect(m.Status).toBe("done");
      expect(m.AcceptedByUserId).toBe(by);
    }
    expect(w.rows("Notification", pid).some((n) => n.Kind === "release.created")).toBe(true);
    for (const t of engineTexts(w, new Set([id]))) expect(t).not.toMatch(FORBIDDEN);
    parsedAll(w, pid);
  });

  it("finishes the seeded running change build and releases it to dev", async () => {
    const p = w.project("Service Technician Portal");
    const pid = String(p.ItemId);
    // The first settle above ran it already (every active job of the store is worked on).
    expect(seededChange).not.toBe("");
    const job = w.get("EngineJob", seededChange);
    expect(job.ProjectId).toBe(pid);
    expect(job.Status).toBe("succeeded");
    const crId = JSON.parse(String(job!.InputJson)).changeRequestId as string;
    const cr = w.get("ChangeRequest", crId);
    expect(cr.Status).toBe("released-dev");
    const rel = w.rows("Release", pid).find((r) => r.Environment === "dev" && r.Version === cr.Version)!;
    expect(rel).toBeTruthy();
    expect(rel.ChangeRequestIds).toContain(crId);
    for (const t of w.rows("Ticket", pid).filter((x) => x.ChangeRequestId === crId)) expect(t.Column).toBe("done");
    expect(String(job!.Message)).toBe(`CR-${String(cr.Number).padStart(3, "0")} released to dev as ${String(cr.Version)}.`);
    expect(w.rows("Notification", pid).some((n) => n.Kind === "change.released" && String(n.EventKey).includes(crId))).toBe(true);
  });

  it("a release promoted to staging or production goes live: the deploy gives its Release row the address", async () => {
    const p = w.project("Service Technician Portal");
    const pid = String(p.ItemId);
    const by = String(p.AssigneeUserId || p.CreatedByUserId);
    const stageUrl = String(w.rows("Release", pid).find((r) => r.Environment === "stage" && String(r.Url).startsWith("https://"))!.Url);
    const prod = w.rows("Release", pid).find((r) => r.Environment === "production" && String(r.Url).startsWith("https://"))!;
    for (const [env, version] of [["stage", "9.9.0"], ["production", "9.9.0"]] as const) {
      // as release.promote writes it: released, no address yet
      const ins = await w.gw.insert("Release", {
        ProjectId: pid, Environment: env, Version: version, Url: "", Status: "released", ChangeRequestIds: [], ReleasedAt: w.now().toISOString(), ReleasedByUserId: by,
        WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: by, UpdatedByUserId: by, RequestKey: `test:release:${env}:${version}`,
      });
      const releaseId = String(ins.itemId);
      const id = await w.queue({ project: "Service Technician Portal", kind: "preview.deploy", input: { projectId: pid, environment: env, version, releaseId }, key: `deploy-${env}-${version}` });
      await w.settle();
      const job = w.get("EngineJob", id);
      expect(job.Status).toBe("succeeded");
      expect(job.Message).toBe(`${version} is live on ${env === "stage" ? "staging" : "production"}.`);
      expect(w.get("Release", releaseId).Url).toBe(env === "stage" ? stageUrl : String(prod.Url));
      for (const t of engineTexts(w, new Set([id]))) expect(t).not.toMatch(FORBIDDEN);
    }
    // no milestone, preview or dev release is touched by a stage or production deploy
    expect(w.rows("Release", pid).filter((r) => r.Version === "9.9.0").map((r) => r.Environment).sort()).toEqual(["production", "stage"]);
  });

  it("plans and builds a new change request from its text", async () => {
    const p = w.project("Service Technician Portal");
    const pid = String(p.ItemId);
    const draft = w.rows("ChangeRequest", pid).find((c) => c.Status === "draft")!;
    expect(draft).toBeTruthy();
    // cr.startBuild: the version after the highest dev release, the request building, the job queued.
    const versions = w.rows("Release", pid).filter((r) => r.Environment === "dev").map((r) => String(r.Version).split(".").map(Number));
    const [maj, min] = versions.sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!)[0]!;
    const version = draft.Lane === "fix" ? undefined : `${maj}.${min! + 1}.0`;
    await w.gw.update("ChangeRequest", String(draft.ItemId), { Status: "building", Version: version ?? "1.2.1" });
    const id = await w.queue({ project: "Service Technician Portal", kind: "change.build", input: { projectId: pid, changeRequestId: draft.ItemId }, key: "cr-new" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("succeeded");
    const tickets = w.rows("Ticket", pid).filter((t) => t.ChangeRequestId === draft.ItemId);
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    const numbers = w.rows("Ticket", pid).map((t) => Number(t.Number));
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const t of tickets) {
      expect(t.Column).toBe("done");
      expect(t.MilestoneId).toBe("");
      expect(["change-request", "fix"]).toContain(t.Source);
      expect((t.Acceptance as string[]).length).toBeGreaterThan(0);
    }
    expect(w.get("ChangeRequest", String(draft.ItemId)).Status).toBe("released-dev");
    expect(w.rows("Release", pid).some((r) => r.Environment === "dev" && r.Version === (version ?? "1.2.1"))).toBe(true);
    for (const t of engineTexts(w, new Set([id]))) expect(t).not.toMatch(FORBIDDEN);
    parsedAll(w, pid);
  });

  it("a build interrupted half-way (a restart) resumes from where the tickets stand, without repeating a move", async () => {
    const p = w.project("Spare Parts Webshop");
    const pid = String(p.ItemId);
    const m = nextMilestone(w, pid);
    expect(m, "Spare Parts Webshop has a milestone to build").toBeTruthy();
    const id = await w.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: pid, milestoneId: m!.ItemId }, key: "restart" });
    // First engine: stops after a number of sleeps (the server going down mid-build).
    let sleeps = 0;
    const first = createEngine({
      store: w.store,
      gateway: w.gw,
      config: () => w.config,
      log: () => undefined,
      writers: writerOf,
      now: () => w.now(),
      sleep: (_ms, signal) =>
        new Promise((resolve, reject) => {
          sleeps += 1;
          if (signal.aborted) return reject(new Error("aborted"));
          setImmediate(resolve);
        }),
      sweepMs: 0,
    });
    first.tick();
    while (sleeps < 14) await new Promise((r) => setImmediate(r));
    first.stop();
    await first.idle();
    const mid = w.get("EngineJob", id);
    expect(mid.Status).toBe("running");
    const half = w.rows("Ticket", pid).filter((t) => t.MilestoneId === m!.ItemId);
    expect(half.some((t) => t.Column !== "planned")).toBe(true);
    expect(half.some((t) => t.Column !== "done")).toBe(true);

    await w.settle();
    const done = w.get("EngineJob", id);
    expect(done.Status).toBe("succeeded");
    expect(done.Attempts).toBe(1);
    expect(done.ClaimedAt).toBe(mid.ClaimedAt);
    for (const t of w.rows("Ticket", pid).filter((x) => x.MilestoneId === m!.ItemId)) {
      expect(t.Column).toBe("done");
      const moves = w.rows("TicketEvent").filter((e) => e.TicketId === t.ItemId && e.Kind === "move" && e.EngineJobId === id);
      // planned -> done is 7 moves, 10 with a send-back; never a move twice from the same place to the same place in a row.
      expect([7, 10]).toContain(moves.length);
      const path = moves.sort((a, b) => String(a.At).localeCompare(String(b.At))).map((e) => `${String(e.FromColumn)}>${String(e.ToColumn)}`);
      for (let i = 1; i < path.length; i++) expect(path[i]!.split(">")[0]).toBe(path[i - 1]!.split(">")[1]);
      expect(path[0]!.startsWith("planned>")).toBe(true);
      expect(path[path.length - 1]!.endsWith(">done")).toBe(true);
    }
    parsedAll(w, pid);
  });

  it("sends a ticket back now and then, and never when send-backs are off", async () => {
    const backs = w.rows("TicketEvent").filter((e) => e.Kind === "move" && FLOW.indexOf(String(e.ToColumn)) < FLOW.indexOf(String(e.FromColumn)) && e.ToColumn !== "planned" && String(e.EngineJobId).length > 0);
    // Not guaranteed per build, but across every build of this store some ticket was sent back.
    expect(backs.length).toBeGreaterThan(0);
    expect(backs.every((e) => String(e.Text).startsWith("Sent back:"))).toBe(true);

    const quiet = await makeWorld({ config: { sendBacks: false } });
    try {
      const p = quiet.project("Spare Parts Webshop");
      const m = nextMilestone(quiet, String(p.ItemId))!;
      const id = await quiet.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: p.ItemId, milestoneId: m.ItemId }, key: "quiet" });
      await quiet.settle();
      expect(quiet.get("EngineJob", id).Status).toBe("succeeded");
      const own = quiet.rows("TicketEvent").filter((e) => e.EngineJobId === id && e.Kind === "move");
      expect(own.some((e) => FLOW.indexOf(String(e.ToColumn)) < FLOW.indexOf(String(e.FromColumn)))).toBe(false);
    } finally {
      quiet.close();
    }
  });

  it("is deterministic: the same store and job give the same texts", async () => {
    const run = async () => {
      const x = await makeWorld();
      try {
        const p = x.project("Spare Parts Webshop");
        const m = nextMilestone(x, String(p.ItemId))!;
        const id = await x.queue({ project: "Spare Parts Webshop", kind: "build.run", input: { projectId: p.ItemId, milestoneId: m.ItemId }, key: "det" });
        await x.settle();
        return x.rows("TicketEvent").filter((e) => e.EngineJobId === id).map((e) => `${String(e.Kind)}|${String(e.FromColumn)}>${String(e.ToColumn)}|${String(e.Text)}`).sort();
      } finally {
        x.close();
      }
    };
    expect(await run()).toEqual(await run());
  });
});
