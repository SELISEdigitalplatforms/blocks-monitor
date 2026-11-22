// The build surfaces agree with each other and with the records (live E2E 08.11.2026, milestone 1's two builds failed,
// nothing built):
//  - the Board's milestone lane says "Stopped", by the same rule as the Build page (buildStep.ts milestoneStopped);
//  - the Timeline's Plan stage is one state: done (Verified, Finished, 100 %, every ticket planned), never "Planned" and
//    "0 %" beside it;
//  - a build's milestone row on the Timeline tab and the Studio show the same, recorded progress.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/buildAgreement.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeliveryMilestone, DeliveryTicket } from "@/blocks/delivery/types";
import type { EngineJob } from "@/blocks/engine/types";
import { MilestoneLane } from "@/components/board/MilestoneLane";
import { MilestoneBuildRow } from "@/components/build/MilestoneBuildRow";
import { StudioView } from "@/components/build/StudioView";
import { TimelineView } from "@/components/build/TimelineView";
import { buildFocus, buildWindow, stageCounts, stagePassed, stageStates, workItems } from "@/components/build/model";
import { recordedProgress } from "@/components/engine/progressEase";

const T0 = Date.UTC(2026, 10, 8, 13, 28);
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
let n = 0;
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, o: { created?: number; progress?: number; message?: string } = {}): EngineJob => ({
  id: `j${++n}`, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify(input), outputRefs: [], progress: o.progress ?? 0,
  message: o.message ?? null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: at(o.created ?? 0),
  finishedAt: status === "failed" || status === "cancelled" || status === "succeeded" ? at((o.created ?? 0) + 2) : null,
  createdBy: null, createdAt: at(o.created ?? 0), updatedAt: at((o.created ?? 0) + 2),
});
const milestone = (i: number, status: DeliveryMilestone["status"]): DeliveryMilestone => ({
  id: `m${i}`, scopeVersion: 1, number: i, name: `Sign in and weekly picks ${i}`, goal: "Everyone signs in.", featureRefs: [], sortOrder: i,
  status, acceptedAt: null, acceptedByUserId: null,
});
const ticket = (i: number, milestoneId: string, column: DeliveryTicket["column"] = "planned"): DeliveryTicket => ({
  id: `t${i}`, number: i, title: `Ticket ${i}`, type: "story", featureRef: "feature:a", agent: "Tech lead", column, isDone: column === "done",
  doneAt: null, milestoneId, sortOrder: i, description: "", acceptance: [], planRef: `plan:${i}`, source: "plan", estimateHours: 6, dependsOn: [],
});
const COLUMN: Record<string, string> = { planned: "Planned", dev: "In development", review: "In review", test: "In test", done: "Done" };
const columnName = (c: string) => COLUMN[c] ?? c;
const text = (html: string) => html.replace(/<!-- -->/g, "");

const NO_ACCESS = "The Blocks account that signed in cannot reach the product's Blocks project. Start it again and sign in with the Blocks account that may deploy this product.";

describe("the Board's milestone lane", () => {
  const lane = (m: DeliveryMilestone, jobs: EngineJob[]) =>
    text(renderToStaticMarkup(createElement(MilestoneLane, { milestone: m, tickets: [ticket(1, m.id)], preview: null, jobs })));

  it("says Stopped when the milestone's newest build failed, as the Build page does", () => {
    const first = job("build.run", "failed", { milestoneId: "m1" }, { created: 0, message: NO_ACCESS });
    const second = job("build.run", "failed", { milestoneId: "m1" }, { created: 10, message: NO_ACCESS });
    const html = lane(milestone(1, "building"), [first, second]);
    expect(html).toContain(">Stopped<");
    expect(html).not.toContain("Being built");
    // a cancelled build stopped it too
    expect(lane(milestone(1, "building"), [job("build.run", "cancelled", { milestoneId: "m1" })])).toContain(">Stopped<");
  });

  it("says Being built again once a build runs for it, and Planned for one that never had a build", () => {
    const failed = job("build.run", "failed", { milestoneId: "m1" }, { created: 0, message: NO_ACCESS });
    const again = job("build.run", "running", { milestoneId: "m1" }, { created: 20 });
    expect(lane(milestone(1, "building"), [failed, again])).toContain(">Being built<");
    expect(lane(milestone(2, "planned"), [failed])).toContain(">Planned<");
  });

  it("a built milestone keeps its word although a later preview did not go online", () => {
    const built = job("build.run", "succeeded", { milestoneId: "m1" }, { created: 0 });
    const preview = job("preview.deploy", "failed", { milestoneId: "m1" }, { created: 5, message: NO_ACCESS });
    expect(lane(milestone(1, "preview-ready"), [built, preview])).toContain(">Ready to try<");
  });
});

describe("the Timeline's Plan stage", () => {
  const m = milestone(1, "building");
  const tickets = [1, 2, 3, 4, 5, 6].map((i) => ticket(i, "m1"));
  const failed = job("build.run", "failed", { milestoneId: "m1" }, { created: 0, message: NO_ACCESS });
  const focus = buildFocus({ jobs: [failed], milestones: [m], tickets, events: [] });
  const stages = stageStates(focus);
  const render = (linkedStage: "01" | "02") => text(renderToStaticMarkup(createElement(TimelineView, {
    focus, window: buildWindow(focus, T0 + 5 * 60_000), stages, ticketCode: (t: DeliveryTicket) => `MF-${t.number}`, columnName, linkedStage,
  })));

  it("is done once the plan's tickets exist, and every number the inspector shows says so", () => {
    expect(stages.find((s) => s.id === "01")).toMatchObject({ status: "done", caption: "6 tickets planned" });
    expect(stagePassed(stageCounts(focus, "01"), "01", "done")).toBe(6);
    const html = render("01");
    expect(html).toContain(">Verified<");
    expect(html).toContain("Finished");
    expect(html).toMatch(/>100<span[^>]*>%</);
    expect(html).not.toMatch(/>0<span[^>]*>%</);
    expect(html).toMatch(/>6<span[^>]*> \/ 6<\/span><\/div><div[^>]*>tickets planned</);
    // the board column its tickets wait in is no state of Plan's own, and its work items are planned, not being worked on
    expect(html).not.toContain("Business analyst · Planned");
    expect(workItems(focus, "01", "done").map((w) => w.state)).toEqual(Array(6).fill("done"));
    expect(html).not.toContain("animate-pulse-dot");
  });

  it("the Build stage still counts the tickets through its column and names it", () => {
    expect(stagePassed(stageCounts(focus, "02"), "02", "blocked")).toBe(0);
    expect(workItems(focus, "02", "blocked").map((w) => w.state)).toEqual(Array(6).fill("planned"));
    const html = render("02");
    expect(html).toContain("Tech lead · In development");
    expect(html).toMatch(/>0<span[^>]*> \/ 6<\/span><\/div><div[^>]*>tickets through</);
  });

  it("while the plan is still being made, Plan has passed none and works on its tickets", () => {
    expect(stagePassed({ total: 3, here: 3, past: 0 }, "01", "active")).toBe(0);
    expect(workItems(focus, "01", "active").map((w) => w.state)).toEqual(Array(6).fill("active"));
  });
});

describe("the build's progress on the Timeline tab and in the Studio", () => {
  it("is the job's recorded progress in both, never an eased number in one of them", () => {
    const running = job("build.run", "running", { milestoneId: "m1" }, { created: 0, progress: 37.6 });
    const m = milestone(1, "building");
    expect(recordedProgress(running)).toBe(37);
    const row = text(renderToStaticMarkup(createElement(MilestoneBuildRow, { milestone: m, tickets: [], jobs: [running], preview: null, previewJob: null })));
    const focus = buildFocus({ jobs: [running], milestones: [m], tickets: [], events: [] });
    const studio = text(renderToStaticMarkup(createElement(StudioView, { stage: null, focus, window: null, stages: [], gates: [], feed: [], when: () => "" })));
    expect(row).toContain(">37%<");
    expect(studio).toMatch(/>37<span[^>]*>%</);
    // the eased bar would round 37.6 up and creep ahead of the record
    expect(row).not.toContain(">38%<");
  });

  it("100 once the build succeeded, 0 without a recorded value", () => {
    expect(recordedProgress({ status: "succeeded", progress: 80 })).toBe(100);
    expect(recordedProgress({ status: "running", progress: Number.NaN })).toBe(0);
    expect(recordedProgress({ status: "failed", progress: 140 })).toBe(100);
    expect(recordedProgress({ status: "running", progress: -3 })).toBe(0);
  });
});
