// The pages never show a build as done while its steps after the deploy are open (src/domain/afterDeploy.ts), and never
// show a change as being built when nothing runs: the Build step, a change request's stage and lifecycle, the Studio's
// line, and the job that only finishes those steps (it is no build: no "building", no "stopped").
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/afterDeployPage.test.ts
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import { buildStep, type StepChangeBuild, type StepMilestone } from "@/components/build/buildStep";
import { openAfterDeploy } from "@/components/build/afterDeployUi";
import { bannerFor, buildChip, buildFocus } from "@/components/build/model";
import { changeStage, lifecycleSteps } from "@/components/changes/changeFlow";
import { parseChangeAnalysis } from "@/domain/changeAnalysis";
import { EXPOSED_LINE, attentionOf } from "@/domain/afterDeploy";

const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 9, m)).toISOString();
let n = 0;
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, o: { code?: string; finished?: number; created?: number } = {}): EngineJob => ({
  id: `j${++n}`, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify(input), outputRefs: [], progress: status === "succeeded" ? 100 : 40,
  message: null, errorCode: o.code ?? null, attempts: 1, claimedBy: null, claimedAt: null, finishedAt: o.finished === undefined ? null : at(o.finished),
  createdBy: null, createdAt: at(o.created ?? o.finished ?? 0), updatedAt: null,
});
const ms = (statuses: string[]): StepMilestone[] => statuses.map((status, i) => ({ id: `m${i + 1}`, number: i + 1, name: `Milestone ${i + 1}`, sortOrder: i + 1, status }));
const step = (o: { milestones: StepMilestone[]; jobs: EngineJob[]; change?: StepChangeBuild | null; preview?: boolean; next?: string }) => buildStep({
  milestones: o.milestones, tickets: o.milestones.map((m) => ({ milestoneId: m.id, column: m.status === "planned" ? "planned" : "done" })),
  previewOf: (id) => (o.preview === false ? null : { url: `https://${id}-app.dev.client.ch`, version: "0.1.0", status: "ready", createdAt: at(0) }),
  jobs: o.jobs, gate: o.next ? { milestone: { id: o.next }, enabled: true, reason: null } : { milestone: null, enabled: false, reason: null }, tests: () => null, canAccept: true,
  feedback: () => ({ open: 0, total: 0 }), previewOpened: () => true, change: o.change ?? null,
  unfinished: (id) => openAfterDeploy(o.jobs, { kind: "build.run", id })?.attention ?? null,
});

describe("what is still open after a deploy, for a page", () => {
  it("the newest delivered build of the milestone or change request, until a later build of the project finished it", () => {
    const first = job("change.build", "succeeded", { changeRequestId: "cr-7" }, { code: "after-deploy:data-failed", finished: 1 });
    const open = openAfterDeploy([first], { kind: "change.build", id: "cr-7" });
    expect(open).toMatchObject({ job: { id: first.id }, finishing: false, attention: { top: "data-failed", retry: true } });
    expect(openAfterDeploy([first], { kind: "change.build", id: "cr-8" })).toBeNull();
    // a retry that stopped leaves it open (the newest SUCCEEDED build counts); one that runs says so
    const stopped = job("change.build", "failed", { changeRequestId: "cr-7", afterDeploy: true, afterJobId: first.id }, { finished: 3 });
    expect(openAfterDeploy([first, stopped], { kind: "change.build", id: "cr-7" })?.attention.top).toBe("data-failed");
    const running = job("change.build", "running", { changeRequestId: "cr-7", afterDeploy: true, afterJobId: first.id }, { created: 4 });
    expect(openAfterDeploy([first, running], { kind: "change.build", id: "cr-7" })?.finishing).toBe(true);
    // a later clean build of a milestone ran the same steps for everything still open: closed
    const later = job("build.run", "succeeded", { milestoneId: "m2" }, { code: "", finished: 6 });
    expect(openAfterDeploy([first, later], { kind: "change.build", id: "cr-7" })).toBeNull();
  });
});

describe("the Build step", () => {
  it("a change on development whose steps after the deploy are open: not done, in plain words", () => {
    const j = job("change.build", "succeeded", { changeRequestId: "cr-7" }, { code: "after-deploy:texts-failed", finished: 2 });
    const change: StepChangeBuild = {
      job: j, code: "CR-007", number: 7, title: "Delivery window", increment: null, tickets: { total: 2, done: 2 }, tests: null,
      unfinished: openAfterDeploy([j], { kind: "change.build", id: "cr-7" })?.attention ?? null,
    };
    const s = step({ milestones: ms(["done"]), jobs: [j], change });
    expect(s.status).toBe("CR-007 is on development, but not finished");
    expect(s.tone).toBe("attention");
    expect(s.chips.find((c) => c.id === "change")?.state).toBe("info");
    const done = step({ milestones: ms(["done"]), jobs: [j], change: { ...change, unfinished: null } });
    expect(done).toMatchObject({ status: "CR-007 is on development", tone: "done" });
  });

  it("a milestone ready to try whose new data table may be open says that first", () => {
    const j = job("build.run", "succeeded", { milestoneId: "m1" }, { code: "after-deploy:data-exposed,texts-failed", finished: 2 });
    const s = step({ milestones: ms(["preview-ready", "planned"]), jobs: [j] });
    expect(s.phase).toBe("review");
    expect(s.status).toBe("Milestone 1 is ready to try, but a new data table may be open");
    const all = step({ milestones: ms(["done"]), jobs: [j] });
    expect(all).toMatchObject({ phase: "complete", status: "The milestone is accepted, but a new data table may be open", tone: "attention" });
  });

  it("a job that only finishes the steps after the deploy is no build: never building, never a stopped build", () => {
    const built = job("build.run", "succeeded", { milestoneId: "m1" }, { code: "after-deploy:data-failed", finished: 1 });
    const finishing = job("build.run", "running", { milestoneId: "m1", afterDeploy: true, afterJobId: built.id }, { created: 3 });
    const s = step({ milestones: ms(["preview-ready", "planned"]), jobs: [built, finishing] });
    expect(s.phase).toBe("review");
    expect(s.agent?.text).toBe("The development team is finishing the steps after the deploy");
    const failed = { ...finishing, status: "failed" as const, finishedAt: at(4) };
    // built, its preview not online, and the finishing job stopped: the start is still the preview, not a new build
    const after = step({ milestones: ms(["building"]), jobs: [built, failed], preview: false, next: "m1" });
    expect(after.phase).not.toBe("stopped");
    expect(after.previewOnly).toBe(true);
    expect(after.primary.label).toBe("Put the preview of milestone 1 online");
  });
});

describe("a change request's page", () => {
  const fast = parseChangeAnalysis({ v: 1, kind: "change", route: "fast", summary: "s", tickets: [{ title: "t" }], questions: [] })!;
  const feature = parseChangeAnalysis({
    v: 1, kind: "feature", questions: [], tickets: [{ title: "a", increment: 1 }, { title: "b", increment: 2 }],
    feature: { basis: "existing-product", parts: { api: true, web: true, data: false }, increments: [{ title: "One", goal: "" }, { title: "Two", goal: "" }] },
  })!;
  const decided = { decidedAt: at(0) };

  it("is never 'being built' when its newest build has ended: the next increment, or the build again", () => {
    expect(changeStage("building", feature, decided, { status: "running" })).toBe("building");
    expect(changeStage("building", feature, decided, { status: "queued" })).toBe("building");
    expect(changeStage("building", feature, decided, { status: "succeeded" })).toBe("approved");
    expect(changeStage("building", fast, decided, { status: "succeeded" })).toBe("buildFailed");
    expect(changeStage("building", fast, decided, { status: "failed" })).toBe("buildFailed");
    expect(changeStage("building", fast, decided, null)).toBe("building");
  });

  it("released with its steps after the deploy open: the environment it is on is not done yet", () => {
    const steps = lifecycleSteps("released-dev", "released", fast, at(0), true);
    expect(steps.find((x) => x.id === "dev")).toMatchObject({ state: "now", title: "Development: live, but the steps after the deploy are not finished" });
    expect(steps.find((x) => x.id === "build")?.state).toBe("done");
    expect(lifecycleSteps("released-dev", "released", fast, at(0)).find((x) => x.id === "dev")?.state).toBe("done");
  });
});

describe("the Studio's line", () => {
  it("a build that is live but not finished is never the success line", () => {
    const j = job("build.run", "succeeded", { milestoneId: "m1" }, { code: "after-deploy:data-exposed", finished: 2 });
    const focus = (jobs: EngineJob[]) => buildFocus({ jobs, milestones: [{ id: "m1", number: 1, name: "M1" }] as never, tickets: [], events: [] });
    const f = focus([j]);
    expect(f.afterDeploy?.top).toBe("data-exposed");
    expect(buildChip(f)).toMatchObject({ tone: "danger", label: "Built, not finished" });
    const b = bannerFor(f, null, null, () => "T", (c: string) => c);
    expect(b.tone).toBe("danger");
    expect(b.text).toBe(attentionOf(["data-exposed"])!.line);
    expect(b.text).toBe(EXPOSED_LINE);
    // the steps finished by a job that only ran them again: the focus stays on the build, now done
    const finished = job("build.run", "succeeded", { milestoneId: "m1", afterDeploy: true, afterJobId: j.id }, { code: "", finished: 5 });
    const after = focus([j, finished]);
    expect(after.job?.id).toBe(j.id);
    expect(after.afterDeploy).toBeNull();
    expect(buildChip(after)).toMatchObject({ tone: "success", label: "Milestone 1 built" });
  });
});
