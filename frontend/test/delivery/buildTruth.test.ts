// The Build page tells the truth about a build that stopped or waits for a person (live E2E report, 08.11.2026):
//  - a failed build shows its job's plain failure line (the Team panel's tech lead line), the milestone reads "Stopped"
//    (not "Being built"), and "The build was requested" goes once its job is on the page;
//  - a build that waits for the Blocks sign-in says "Waiting for you: connect to Blocks", without the working animation.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/buildTruth.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DeliveryMilestone } from "@/blocks/delivery/types";
import type { EngineJob } from "@/blocks/engine/types";
import {
  WAITING_FOR_YOU, buildStep, failureReason, milestoneStopped, milestoneWord, startAnswered, startSnapshot, waitingDetail, waitsForPerson,
  type StepChangeBuild, type StepMilestone,
} from "@/components/build/buildStep";
import { BuildOverview } from "@/components/build/BuildOverview";
import { StudioView } from "@/components/build/StudioView";
import { WaitingForYouLine } from "@/components/build/WaitingForYouLine";
import { buildFocus } from "@/components/build/model";
import { connectLine } from "@/domain/blocksConnect";

const at = (m: number) => new Date(Date.UTC(2026, 10, 8, 9, m)).toISOString();
let n = 0;
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, o: { message?: string | null; created?: number; progress?: number } = {}): EngineJob => ({
  id: `j${++n}`, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify(input), outputRefs: [], progress: o.progress ?? 30,
  message: o.message ?? null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: at(o.created ?? 0), finishedAt: null,
  createdBy: null, createdAt: at(o.created ?? 0), updatedAt: at(o.created ?? 0),
});
const milestone = (i: number, status: DeliveryMilestone["status"]): DeliveryMilestone => ({
  id: `m${i}`, scopeVersion: 1, number: i, name: `Asset list ${i}`, goal: "Buyers see the assets.", featureRefs: [], sortOrder: i, status, acceptedAt: null, acceptedByUserId: null,
});
const step = (o: { milestones: StepMilestone[]; jobs: EngineJob[]; change?: StepChangeBuild | null }) => buildStep({
  milestones: o.milestones, tickets: o.milestones.map((m) => ({ milestoneId: m.id, column: "dev" })), previewOf: () => null, jobs: o.jobs,
  gate: { milestone: { id: "m1" }, enabled: true, reason: null }, tests: () => null, canAccept: true,
  feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false, change: o.change ?? null,
});

const SIGN_IN_FAILED = "The Blocks sign-in for Asset Market could not be started on the engine host. The engine team has the details.";
const NO_ACCESS = "The Blocks account that signed in cannot reach Asset Market's Blocks project. Start it again and sign in with the Blocks account that may deploy this product.";
const CONNECT = connectLine({ product: "Asset Market", url: "https://iam.seliseblocks.com/device", code: "WXYZ-1234" });
const OTHER_JOB = "Waiting for the Blocks sign-in of Asset Market that another job started.";

describe("a build that stopped", () => {
  it("shows its job's plain failure line, the same line the Team panel's tech lead shows", () => {
    const failed = job("build.run", "failed", { milestoneId: "m1" }, { message: SIGN_IN_FAILED });
    const s = step({ milestones: [milestone(1, "building"), milestone(2, "planned")], jobs: [failed] });
    expect(s.phase).toBe("stopped");
    expect(s.status).toBe("The build of milestone 1 stopped");
    expect(s.stopReason).toBe(SIGN_IN_FAILED);
    expect(s.primary).toMatchObject({ kind: "start", label: "Start milestone 1 again" });
    expect(s.agent).toBeNull();
  });

  it("the newest build's line, never an earlier one's; none once a new build runs, none for a cancel or a failure without a line", () => {
    const first = job("build.run", "failed", { milestoneId: "m1" }, { message: SIGN_IN_FAILED, created: 1 });
    const second = job("build.run", "failed", { milestoneId: "m1" }, { message: NO_ACCESS, created: 5 });
    expect(step({ milestones: [milestone(1, "building")], jobs: [first, second] }).stopReason).toBe(NO_ACCESS);
    const again = job("build.run", "running", { milestoneId: "m1" }, { created: 9 });
    expect(step({ milestones: [milestone(1, "building")], jobs: [first, again] }).stopReason).toBeNull();
    expect(step({ milestones: [milestone(1, "building")], jobs: [job("build.run", "cancelled", { milestoneId: "m1" })] }).stopReason).toBeNull();
    expect(step({ milestones: [milestone(1, "building")], jobs: [job("build.run", "failed", { milestoneId: "m1" })] }).stopReason).toBeNull();
    expect(failureReason(job("build.run", "running", { milestoneId: "m1" }, { message: "Building the screens." }))).toBeNull();
  });

  it("a preview that did not go online shows the preview job's line", () => {
    const built = job("build.run", "succeeded", { milestoneId: "m1" }, { created: 1 });
    const preview = job("preview.deploy", "failed", { milestoneId: "m1" }, { message: NO_ACCESS, created: 4 });
    const s = step({ milestones: [milestone(1, "building")], jobs: [built, preview] });
    expect(s.status).toBe("The preview of milestone 1 did not go online");
    expect(s.stopReason).toBe(NO_ACCESS);
  });

  it("a change build that stopped shows its line", () => {
    const failed = job("change.build", "failed", { changeRequestId: "cr-2" }, { message: SIGN_IN_FAILED });
    const change: StepChangeBuild = { job: failed, code: "CR-002", number: 2, title: "Price filter", increment: null, tickets: { total: 2, done: 0 }, tests: null };
    const s = step({ milestones: [{ ...milestone(1, "done"), acceptedAt: at(0) }], jobs: [failed], change });
    expect(s.status).toBe("The build of CR-002 stopped");
    expect(s.stopReason).toBe(SIGN_IN_FAILED);
  });

  it("its milestone reads Stopped, not Being built, until a build runs for it again", () => {
    const failed = job("build.run", "failed", { milestoneId: "m1" }, { message: SIGN_IN_FAILED, created: 1 });
    const m = milestone(1, "building");
    expect(milestoneStopped([failed], "m1")).toBe(true);
    expect(milestoneStopped([failed], "m2")).toBe(false);
    expect(milestoneWord(m, false, milestoneStopped([failed], "m1"))).toBe("Stopped");
    // a cancelled build stopped it too; a running one is the build again
    expect(milestoneStopped([job("build.run", "cancelled", { milestoneId: "m1" })], "m1")).toBe(true);
    const again = job("build.run", "running", { milestoneId: "m1" }, { created: 3 });
    expect(milestoneStopped([failed, again], "m1")).toBe(false);
    expect(milestoneWord(m, true, false)).toBe("Being built");
    // its preview that failed after a good build
    const built = job("build.run", "succeeded", { milestoneId: "m1" }, { created: 4 });
    expect(milestoneStopped([failed, built], "m1")).toBe(false);
    expect(milestoneStopped([failed, built, job("preview.deploy", "failed", { milestoneId: "m1" }, { created: 6 })], "m1")).toBe(true);
    // a release's preview job and a job that only finishes the steps after a deploy are not the milestone's build
    expect(milestoneStopped([built, job("preview.deploy", "failed", { milestoneId: "m1", release: true }, { created: 7 })], "m1")).toBe(false);
    expect(milestoneStopped([built, job("build.run", "failed", { milestoneId: "m1", afterDeploy: true }, { created: 8 })], "m1")).toBe(false);
    // a built or accepted milestone keeps its word
    expect(milestoneWord(milestone(1, "preview-ready"), false, true)).toBe("Ready to try");
    expect(milestoneWord({ ...milestone(1, "done"), acceptedAt: at(0) }, false, true)).toBe("Accepted");
    // without the stopped state the word is as before (the board's lane passes it too: buildAgreement.test.ts)
    expect(milestoneWord(m, false)).toBe("Being built");
  });

  it("the Overview's milestone card and list say Stopped", () => {
    const list = [milestone(1, "building"), milestone(2, "planned")];
    const failed = job("build.run", "failed", { milestoneId: "m1" }, { message: SIGN_IN_FAILED });
    const s = step({ milestones: list, jobs: [failed] });
    const html = renderToStaticMarkup(createElement(BuildOverview, {
      step: s as never, milestones: list, tickets: [], previewOf: () => null, runningId: null,
      stoppedOf: (id: string) => milestoneStopped([failed], id), acceptedText: () => null, onOpenBoard: () => undefined,
    }));
    expect(html).toContain("Stopped");
    expect(html).not.toContain("Being built");
  });
});

describe("the requested line", () => {
  it("shows until the requested job is on the page, then the job speaks for itself", () => {
    const old = job("build.run", "failed", { milestoneId: "m1" }, { created: 1 });
    const other = job("board.plan", "succeeded", { milestoneId: "m1" }, { created: 1 });
    const before = startSnapshot([old, other]);
    expect(startAnswered([old, other], before)).toBe(false);
    // the new build is queued, runs, then fails: it is on the page in every state
    for (const status of ["queued", "running", "failed"] as const) {
      expect(startAnswered([old, other, job("build.run", status, { milestoneId: "m1" }, { created: 2 })], before)).toBe(true);
    }
    // a start that put the preview online answers with a preview job
    expect(startAnswered([old, job("preview.deploy", "queued", { milestoneId: "m1" }, { created: 2 })], before)).toBe(true);
    // other kinds of jobs are no answer; nothing was requested on this page
    expect(startAnswered([old, other, job("board.plan", "running", { milestoneId: "m2" }, { created: 2 })], before)).toBe(false);
    expect(startAnswered([old, job("build.run", "queued", { milestoneId: "m1" })], null)).toBe(false);
  });
});

describe("a build that waits for a person", () => {
  it("the Blocks sign-in line and the sign-in another job started are waits; other lines, finished jobs and empty lines are not", () => {
    expect(waitsForPerson(job("build.run", "running", { milestoneId: "m1" }, { message: CONNECT }))).toBe(true);
    expect(waitsForPerson(job("build.run", "running", { milestoneId: "m1" }, { message: OTHER_JOB }))).toBe(true);
    expect(waitsForPerson(job("build.run", "running", { milestoneId: "m1" }, { message: "Asset Market is signed in to Blocks. Selecting its Blocks project." }))).toBe(false);
    expect(waitsForPerson(job("build.run", "running", { milestoneId: "m1" }))).toBe(false);
    expect(waitsForPerson(job("build.run", "failed", { milestoneId: "m1" }, { message: CONNECT }))).toBe(false);
    expect(waitingDetail(CONNECT)).toBe(CONNECT);
    expect(waitingDetail(OTHER_JOB)).toBe("connect Asset Market to Blocks. The sign-in another job of this product started waits for its approval.");
  });

  it("the status and the team's line say it waits for you, without the working progress", () => {
    const waiting = job("build.run", "running", { milestoneId: "m1" }, { message: CONNECT, progress: 30 });
    const s = step({ milestones: [milestone(1, "building")], jobs: [waiting] });
    expect(s.phase).toBe("building");
    expect(s.status).toBe(WAITING_FOR_YOU);
    expect(s.tone).toBe("attention");
    expect(s.agent).toEqual({ text: WAITING_FOR_YOU, progress: null, waiting: true });
    // once the sign-in is confirmed, the build line comes back
    const going = step({ milestones: [milestone(1, "building")], jobs: [{ ...waiting, message: "Asset Market is signed in to Blocks. Selecting its Blocks project." }] });
    expect(going.status).toBe("Building milestone 1 · 0 of 1 ticket done");
    expect(going.agent).toEqual({ text: "The development team is building milestone 1", progress: 30 });
  });

  it("a preview going online and a change build that wait for the sign-in say so too", () => {
    const built = job("build.run", "succeeded", { milestoneId: "m1" }, { created: 1 });
    const deploy = job("preview.deploy", "running", { milestoneId: "m1" }, { message: OTHER_JOB, created: 2 });
    const d = step({ milestones: [milestone(1, "building")], jobs: [built, deploy] });
    expect(d.phase).toBe("deploying");
    expect(d).toMatchObject({ status: WAITING_FOR_YOU, tone: "attention", agent: { text: WAITING_FOR_YOU, waiting: true } });
    const cb = job("change.build", "running", { changeRequestId: "cr-2" }, { message: CONNECT });
    const change: StepChangeBuild = { job: cb, code: "CR-002", number: 2, title: "Price filter", increment: null, tickets: { total: 2, done: 0 }, tests: null };
    const c = step({ milestones: [{ ...milestone(1, "done"), acceptedAt: at(0) }], jobs: [cb], change });
    expect(c).toMatchObject({ status: WAITING_FOR_YOU, tone: "attention", agent: { text: WAITING_FOR_YOU, waiting: true } });
  });

  it("the Studio says Waiting for you with the sign-in line, not that the agents are working, and nothing pulses", () => {
    const waiting = job("build.run", "running", { milestoneId: "m1" }, { message: CONNECT });
    const focus = buildFocus({ jobs: [waiting], milestones: [milestone(1, "building")], tickets: [], events: [] });
    const html = renderToStaticMarkup(createElement(StudioView, {
      stage: null, focus, window: null, stages: [], gates: [], feed: [], when: () => "",
    }));
    expect(html).toContain("Waiting for you: ");
    expect(html).toContain("confirm code WXYZ-1234");
    expect(html).not.toContain("The MADP agents are working");
    expect(html).not.toContain("animate-pulse");
    // a build at work keeps its live line
    const working = buildFocus({ jobs: [{ ...waiting, message: "Building the screens." }], milestones: [milestone(1, "building")], tickets: [], events: [] });
    const live = renderToStaticMarkup(createElement(StudioView, { stage: null, focus: working, window: null, stages: [], gates: [], feed: [], when: () => "" }));
    expect(live).toContain("Now: ");
    expect(live).toContain("animate-pulse-dot");
  });

  it("the waiting line has no working animation", () => {
    const html = renderToStaticMarkup(createElement(WaitingForYouLine));
    expect(html).toContain(WAITING_FOR_YOU);
    expect(html).not.toMatch(/animate-/);
  });
});
