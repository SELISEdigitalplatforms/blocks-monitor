// The Build and Release steps on the shared step frame: the status line, the one primary action, the chips and the
// agent line follow the records (milestones, tickets, previews, jobs, releases, approvals).
import { describe, expect, it } from "vitest";
import type { EngineJob } from "@/blocks/engine/types";
import { buildStep, isAccepted, milestoneWord, workWords, type StepChangeBuild, type StepMilestone, type StepPreview } from "@/components/build/buildStep";
import { releaseNotes, releaseStep, type StepChange, type StepPolicy, type StepRelease, type StepRequest } from "@/components/delivery/releaseStep";
import { environmentStates } from "@/domain/delivery";
import { resolveStepTab } from "@/components/build/buildTabs";

const FORBIDDEN = /\b(simulat\w*|mock\w*|demo|sample|example|test data|fake|prototype)\b/i;

const ms = (statuses: string[], accepted: number[] = []): StepMilestone[] =>
  statuses.map((status, i) => ({ id: `m${i + 1}`, number: i + 1, name: `Milestone ${i + 1}`, sortOrder: i + 1, status, acceptedAt: accepted.includes(i + 1) ? "2026-10-20T10:00:00.000Z" : null }));
const tk = (m: string, cols: string[]) => cols.map((column) => ({ milestoneId: m, column }));
const job = (kind: EngineJob["kind"], status: EngineJob["status"], input: Record<string, unknown>, progress = 40): EngineJob => ({
  id: `${kind}-${status}-${JSON.stringify(input)}`, workspaceId: "w", projectId: "p", kind, status, inputJson: JSON.stringify(input), outputRefs: [],
  progress, message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: null, finishedAt: null, createdBy: null, createdAt: "2026-10-26T08:00:00.000Z", updatedAt: null,
});
const preview = (v: string): StepPreview => ({ url: `https://m1-app.dev.client.ch`, version: v, status: "ready", createdAt: "2026-10-26T08:00:00.000Z" });

function step(o: Partial<Parameters<typeof buildStep>[0]> & { milestones: StepMilestone[] }) {
  return buildStep({
    tickets: [], previewOf: () => null, jobs: [], gate: { milestone: null, enabled: false, reason: null }, tests: () => null,
    canAccept: true, feedback: () => ({ open: 0, total: 0 }), previewOpened: () => false, ...o,
  });
}

describe("Build step", () => {
  it("ready to build: Start the build of the next milestone, nothing running", () => {
    const s = step({ milestones: ms(["planned", "planned"]), tickets: tk("m1", ["planned", "planned"]), gate: { milestone: { id: "m1" }, enabled: true, reason: null } });
    expect(s.phase).toBe("ready");
    expect(s.primary).toMatchObject({ kind: "start", label: "Start the build of milestone 1", disabled: false });
    expect(s.agent).toBeNull();
    expect(s.chips.map((c) => c.id)).toEqual(["milestone", "tickets", "preview", "accepted"]);
    expect(s.chips.find((c) => c.id === "tickets")!.value).toBe("0 of 2 done");
  });

  it("no tickets planned yet: the start waits, with the reason", () => {
    const s = step({ milestones: ms(["planned"]), gate: { milestone: { id: "m1" }, enabled: false, reason: "The board for milestone 1 isn't planned yet." } });
    expect(s.phase).toBe("planning");
    expect(s.primary).toMatchObject({ kind: "start", disabled: true, reason: "The board for milestone 1 isn't planned yet." });
  });

  it("building: Watch the build, the development team's line with the job's progress", () => {
    const s = step({
      milestones: ms(["building", "planned"]), tickets: tk("m1", ["done", "dev", "test"]),
      jobs: [job("build.run", "running", { milestoneId: "m1" }, 55)], tests: () => ({ state: "running", detail: "1 checking now" }),
    });
    expect(s.phase).toBe("building");
    expect(s.status).toBe("Building milestone 1 · 1 of 3 tickets done");
    expect(s.primary.kind).toBe("watch");
    expect(s.agent).toEqual({ text: "The development team is building milestone 1", progress: 55 });
    expect(s.chips.find((c) => c.id === "tests")).toMatchObject({ value: "running", state: "info" });
  });

  it("a ready preview: Review and accept is the one action (the preview link next to it); feedback and the Accepted chip invite you", () => {
    const base = { milestones: ms(["preview-ready", "planned"]), tickets: tk("m1", ["done"]), previewOf: (id: string) => (id === "m1" ? preview("0.1.0") : null) };
    const first = step(base);
    expect(first.phase).toBe("review");
    expect(first.status).toBe("Milestone 1 is ready to try");
    expect(first.primary).toMatchObject({ kind: "accept", label: "Review and accept milestone 1", disabled: false, reason: "Try the preview first: its link is next to this button." });
    expect(first.chips.find((c) => c.id === "feedback")).toMatchObject({ state: "todo", value: "none" });
    expect(first.chips.find((c) => c.id === "accepted")).toMatchObject({ state: "todo", value: "0 of 2" });
    const opened = step({ ...base, previewOpened: () => true });
    expect(opened.primary).toMatchObject({ kind: "accept", label: "Review and accept milestone 1", disabled: false, reason: null });
    // someone without build rights keeps the preview as the primary
    expect(step({ ...base, previewOpened: () => true, canAccept: false }).primary.kind).toBe("preview");
    // open feedback blocks the acceptance
    const fb = step({ ...base, previewOpened: () => true, feedback: () => ({ open: 1, total: 1 }) });
    expect(fb.primary).toMatchObject({ kind: "wait", disabled: true });
    expect(fb.chips.find((c) => c.id === "feedback")).toMatchObject({ value: "1 open" });
  });

  it("feedback being built: the team works on your feedback; the milestone reads as being updated", () => {
    const s = step({
      milestones: ms(["preview-ready", "planned"]), tickets: [...tk("m1", ["done", "dev"])], previewOf: () => preview("0.1.0"),
      jobs: [job("build.run", "running", { milestoneId: "m1", feedback: true })], feedback: () => ({ open: 1, total: 1 }),
    });
    expect(s.phase).toBe("building");
    expect(s.updating).toBe(true);
    expect(s.status).toBe("Working on your feedback for milestone 1");
    expect(s.agent?.text).toBe("The development team is working on your feedback for milestone 1");
    expect(milestoneWord(ms(["preview-ready"])[0]!, true)).toBe("Being updated");
  });

  it("a built milestone waiting for you stays the focus while the team builds the next one", () => {
    const s = step({
      milestones: ms(["preview-ready", "building"]), tickets: [...tk("m1", ["done"]), ...tk("m2", ["dev"])],
      previewOf: (id: string) => (id === "m1" ? preview("0.1.0") : null), previewOpened: () => true,
      jobs: [job("build.run", "running", { milestoneId: "m2" }, 30)],
    });
    expect(s.phase).toBe("review");
    expect(s.current?.id).toBe("m1");
    expect(s.primary).toMatchObject({ kind: "accept", label: "Review and accept milestone 1" });
    expect(s.updating).toBe(false);
    expect(s.agent).toEqual({ text: "The development team is building milestone 2", progress: 30 });
  });

  it("a milestone accepted while the next waits: the next one is the step's focus", () => {
    const s = step({ milestones: ms(["done", "planned"], [1]), tickets: tk("m2", ["planned"]), gate: { milestone: { id: "m2" }, enabled: true, reason: null } });
    expect(s.phase).toBe("ready");
    expect(s.current?.id).toBe("m2");
    expect(s.accepted).toBe(1);
  });

  it("every milestone accepted: complete; the release job shows on the agent line", () => {
    const s = step({ milestones: ms(["done", "done"], [1, 2]), jobs: [job("preview.deploy", "running", { milestoneId: "m2", release: "1.0.0" })] });
    expect(s.phase).toBe("complete");
    expect(s.status).toBe("All 2 milestones accepted");
    expect(s.primary.kind).toBe("release");
    expect(s.agent?.text).toBe("The development team is releasing the app to the development environment");
    expect(s.chips.find((c) => c.id === "accepted")).toMatchObject({ state: "done", value: "2 of 2" });
  });

  it("a stopped build offers the start again", () => {
    const failed = job("build.run", "failed", { milestoneId: "m1" });
    const s = step({ milestones: ms(["building"]), tickets: tk("m1", ["dev"]), jobs: [failed], gate: { milestone: { id: "m1" }, enabled: true, reason: null } });
    expect(s.phase).toBe("stopped");
    expect(s.primary).toMatchObject({ kind: "start", label: "Start milestone 1 again" });
  });

  it("plain words, at most six chips, the words never sound made up", () => {
    const s = step({ milestones: ms(["preview-ready", "planned"]), previewOf: () => preview("0.1.0"), tests: () => ({ state: "passed", detail: "3 of 3 tickets passed" }), feedback: () => ({ open: 0, total: 2 }) });
    expect(s.chips.length).toBeLessThanOrEqual(6);
    for (const t of [s.status, s.primary.label, ...s.chips.flatMap((c) => [c.label, c.value, c.title])]) expect(t).not.toMatch(FORBIDDEN);
    expect(workWords(tk("m1", ["planned", "dev", "review", "test", "done"]), "m1")).toBe("1 being built · 2 being checked · 1 waiting · 1 done");
    expect(isAccepted({ status: "done", acceptedAt: null })).toBe(true);
  });

  it("the main area opens on Overview; the old board link and a ticket link still open the Board", () => {
    expect(resolveStepTab({ tab: null, ticket: null })).toBe("overview");
    expect(resolveStepTab({ tab: "board", ticket: null })).toBe("board");
    expect(resolveStepTab({ tab: null, ticket: "t1" })).toBe("board");
    expect(resolveStepTab({ tab: "nope", ticket: null })).toBe("overview");
  });
});

describe("Build step: a change request's build", () => {
  const change = (status: EngineJob["status"], o: Partial<StepChangeBuild> = {}): StepChangeBuild => ({
    job: job("change.build", status, { changeRequestId: "c1" }, 35), code: "CR-002", number: 2, title: "Payment reminders",
    increment: { n: 1, of: 4, title: "Find overdue invoices" }, tickets: { total: 3, done: 1 }, tests: { state: "running", detail: "1 checking now" }, ...o,
  });

  it("while it runs on a product without milestones: the status line, Watch, the chips and the agent line are about the change", () => {
    const ch = change("running");
    const s = step({ milestones: [], jobs: [ch.job], change: ch });
    expect(s.status).toBe("Building CR-002 increment 1 of 4 · 1 of 3 tickets done");
    expect(s.tone).toBe("progress");
    expect(s.primary).toMatchObject({ kind: "watch", label: "Watch the build" });
    expect(s.agent).toEqual({ text: "The development team is building CR-002 increment 1 of 4", progress: 35 });
    expect(s.chips.map((c) => [c.id, c.value])).toEqual([["change", "CR-002"], ["increment", "1 of 4"], ["tickets", "1 of 3 done"], ["tests", "running"]]);
    expect(s.chips.find((c) => c.id === "increment")?.title).toBe("Increment 1 of 4: Find overdue invoices");
    expect(s.change).toMatchObject({ code: "CR-002", live: true });
    for (const t of [s.status, s.primary.label, ...s.chips.flatMap((c) => [c.label, c.value, c.title])]) expect(t).not.toMatch(FORBIDDEN);
  });

  it("queued: next in line; a change in one build (no increments) is named by its code alone", () => {
    const ch = change("queued", { increment: null, tickets: { total: 2, done: 0 } });
    const s = step({ milestones: ms(["done"], [1]), jobs: [ch.job], change: ch });
    expect(s.status).toBe("CR-002 is next in line for the development team");
    expect(s.tone).toBe("waiting");
    expect(s.agent).toEqual({ text: "The development team is picking up CR-002", progress: null });
    expect(s.chips.map((c) => c.id)).toEqual(["change", "tickets", "tests"]);
  });

  it("a built milestone waiting for you keeps the step; the agent line names the change being built", () => {
    const ch = change("running");
    const s = step({ milestones: ms(["preview-ready", "planned"]), tickets: tk("m1", ["done"]), previewOf: (id: string) => (id === "m1" ? preview("0.1.0") : null), jobs: [ch.job], change: ch });
    expect(s.phase).toBe("review");
    expect(s.primary.kind).toBe("accept");
    expect(s.change).toBeNull();
    expect(s.agent?.text).toBe("The development team is building CR-002 increment 1 of 4");
  });

  it("finished, more increments to come: on development, the primary opens the change request for the next increment", () => {
    const ch = change("succeeded", { tickets: { total: 3, done: 3 }, tests: { state: "passed", detail: "3 of 3 tickets passed" } });
    const s = step({ milestones: [], jobs: [ch.job], change: ch });
    expect(s.status).toBe("CR-002 increment 1 of 4 is on development");
    expect(s.tone).toBe("attention");
    expect(s.primary).toMatchObject({ kind: "change", label: "Open CR-002", disabled: false });
    expect(s.agent).toBeNull();
    expect(s.change).toMatchObject({ live: false });
    expect(s.chips.find((c) => c.id === "tickets")).toMatchObject({ value: "3 of 3 done", state: "done" });
  });

  it("finished with its last increment: on development, on to Release; a stopped build opens the change request again", () => {
    const last = change("succeeded", { increment: { n: 4, of: 4, title: "History" }, tickets: { total: 2, done: 2 } });
    const done = step({ milestones: [], jobs: [last.job], change: last });
    expect(done.status).toBe("CR-002 increment 4 of 4 is on development");
    expect(done.tone).toBe("done");
    expect(done.primary.kind).toBe("release");
    const failed = change("failed");
    const stopped = step({ milestones: [], jobs: [failed.job], change: failed });
    expect(stopped.status).toBe("The build of CR-002 increment 1 of 4 stopped");
    expect(stopped.primary).toMatchObject({ kind: "change", label: "Open CR-002" });
  });

  it("milestones are unchanged: nothing ever ran, a milestone left to build, or a newer milestone build keeps the milestone step", () => {
    expect(step({ milestones: [] })).toMatchObject({ phase: "complete", status: "Nothing to build", change: null });
    const finished = change("succeeded");
    const ready = step({ milestones: ms(["done", "planned"], [1]), tickets: tk("m2", ["planned"]), gate: { milestone: { id: "m2" }, enabled: true, reason: null }, jobs: [finished.job], change: finished });
    expect(ready).toMatchObject({ phase: "ready", status: "Ready to build milestone 2", change: null });
    const newer = { ...job("build.run", "succeeded", { milestoneId: "m1" }), createdAt: "2026-10-27T08:00:00.000Z" };
    const s = step({ milestones: ms(["done"], [1]), jobs: [finished.job, newer], change: finished });
    expect(s).toMatchObject({ phase: "complete", status: "The milestone is accepted", change: null });
  });
});

/* ── Release ──────────────────────────────────────────────────────────────── */

const rel = (environment: string, version: string, extra: Partial<StepRelease> = {}): StepRelease => ({
  id: `${environment}-${version}`, environment, version, releasedAt: "2026-10-20T10:00:00.000Z", url: `https://${environment}.app.ch`, releasedByUserId: "u-jan", changeRequestIds: [], ...extra,
});
// production also needs its QA step (release.promote's policyGaps): a policy without one is not complete
const policy = (environment: "stage" | "production"): StepPolicy => ({
  id: `pol-${environment}`, environment,
  policy: { environment, steps: [
    { type: "architect", required: true, approverUserIds: ["u-stefan"] }, { type: "security", required: true, approverUserIds: ["u-florian"] },
    ...(environment === "production" ? [{ type: "qa", required: true, approverUserIds: ["u-jan"] }] : []),
  ] },
} as never);
const request = (environment: "stage" | "production", version: string, decisions: ("pending" | "approved")[], status: StepRequest["status"] = "pending"): StepRequest => ({
  id: `req-${environment}-${version}`, environment, version, status, attempt: 1, stepRequired: decisions.map(() => true),
  request: {
    environment, version, status,
    steps: decisions.map((decision, i) => ({ type: i === 0 ? "architect" : i === 1 ? "security" : "qa", approverUserIds: [i === 0 ? "u-stefan" : i === 1 ? "u-florian" : "u-jan"], decision, decidedBy: null, decidedAt: null, comment: null })),
  },
});
const NAMES: Record<string, string> = { "u-stefan": "Stefan Brandt", "u-florian": "Florian Weber", "u-jan": "Jan Kowalski" };

function release(o: { releases: StepRelease[]; requests?: StepRequest[]; policies?: StepPolicy[]; changes?: StepChange[]; userId?: string; can?: Partial<{ approve: boolean; promote: boolean; request: boolean }> }) {
  return releaseStep({
    states: environmentStates(o.releases), requests: o.requests ?? [], policies: o.policies ?? [policy("stage"), policy("production")],
    changes: o.changes ?? [], userId: o.userId ?? "u-katrin", can: { approve: true, promote: true, request: true, ...o.can }, nameOf: (id) => NAMES[id] ?? id,
  });
}

describe("Release step", () => {
  it("nothing on development yet: waiting for the build", () => {
    const s = release({ releases: [] });
    expect(s.phase).toBe("notReleased");
    expect(s.primary).toMatchObject({ kind: "build", label: "Go to Software Engineering" });
  });

  it("a newer version on development: send it for approval to staging", () => {
    const s = release({ releases: [rel("dev", "1.0.0")] });
    expect(s.phase).toBe("request");
    expect(s.target).toBe("stage");
    expect(s.primary).toMatchObject({ kind: "request", label: "Send v1.0.0 to Staging for approval" });
    expect(s.chips.map((c) => [c.id, c.value])).toEqual([["dev", "v1.0.0"], ["stage", "not yet"], ["production", "not yet"], ["changes", "none open"], ["approvals", "set up"]]);
  });

  it("you are an approver of the open request: Approve vX for Staging comes first", () => {
    const s = release({ releases: [rel("dev", "1.1.0"), rel("stage", "1.0.0"), rel("production", "1.0.0")], requests: [request("stage", "1.1.0", ["approved", "pending"])], userId: "u-florian" });
    expect(s.phase).toBe("approve");
    expect(s.myStep).toBe(1);
    expect(s.primary.label).toBe("Approve v1.1.0 for Staging");
    expect(s.chips.find((c) => c.id === "approvals")).toMatchObject({ value: "yours", state: "attention" });
  });

  it("someone else's approval is open: waiting, naming who", () => {
    const s = release({ releases: [rel("dev", "1.1.0"), rel("stage", "1.1.0"), rel("production", "1.0.0")], requests: [request("production", "1.1.0", ["approved", "pending"])] });
    expect(s.phase).toBe("waiting");
    expect(s.waitingFor).toEqual(["Security (Florian Weber)"]);
    expect(s.primary).toMatchObject({ kind: "wait", disabled: true, reason: "Waiting for Security (Florian Weber)." });
  });

  it("every required approval in: Release vX to Production", () => {
    const s = release({ releases: [rel("dev", "1.1.0"), rel("stage", "1.1.0"), rel("production", "1.0.0")], requests: [request("production", "1.1.0", ["approved", "approved", "approved"], "approved")] });
    expect(s.phase).toBe("promote");
    expect(s.primary.label).toBe("Release v1.1.0 to Production");
  });

  it("an approver asked for changes: the step says who and what, and offers a change request", () => {
    const base = request("production", "1.1.0", ["approved", "approved"], "rejected");
    const steps = base.request.steps.map((st, i) => (i === 1 ? { ...st, decision: "rejected" as const, decidedBy: "u-florian", comment: "Photos are lost offline." } : st));
    const rejected: StepRequest = { ...base, request: { ...base.request, steps } };
    const s = release({ releases: [rel("dev", "1.1.0"), rel("stage", "1.1.0"), rel("production", "1.0.0")], requests: [rejected] });
    expect(s.phase).toBe("changes");
    expect(s.status).toBe("Florian Weber asked for changes to v1.1.0 before Production");
    expect(s.primary).toMatchObject({ kind: "change", label: "Request a change", disabled: false });
    expect(s.changes).toEqual({ by: "Florian Weber", comment: "Photos are lost offline." });
    expect(s.plans.production).toMatchObject({ phase: "changes", changes: { by: "Florian Weber" } });
    // once a newer version is on development, sending it on comes first; production keeps the changes asked for
    const next = release({ releases: [rel("dev", "1.2.0"), rel("stage", "1.1.0"), rel("production", "1.0.0")], requests: [rejected] });
    expect(next.phase).toBe("request");
    expect(next.primary.label).toBe("Send v1.2.0 to Staging for approval");
    expect(next.plans.production).toMatchObject({ phase: "changes", version: "1.1.0" });
  });

  it("no approval policy yet: set up the approvals", () => {
    const s = release({ releases: [rel("dev", "1.0.0")], policies: [] });
    expect(s.phase).toBe("setup");
    expect(s.primary.kind).toBe("setup");
    expect(s.chips.find((c) => c.id === "approvals")).toMatchObject({ state: "todo", value: "not set up" });
  });

  it("the Approvals chip follows the saved policies, as on the Scope step", () => {
    // nothing released yet and nothing saved: not set up (Scope says the same)
    const none = release({ releases: [], policies: [] });
    expect(none.chips.find((c) => c.id === "approvals")).toMatchObject({ state: "todo", value: "not set up", title: "Who approves staging and production is not set up yet" });
    // staging saved, production not: still not set up, even with nothing new to release
    const half = release({ releases: [rel("dev", "1.0.0"), rel("stage", "1.0.0"), rel("production", "1.0.0")], policies: [policy("stage")] });
    expect(half.chips.find((c) => c.id === "approvals")).toMatchObject({ state: "todo", value: "not set up", title: "Production approvals are not set up yet" });
    // both saved and nothing waiting: set up
    expect(release({ releases: [] }).chips.find((c) => c.id === "approvals")).toMatchObject({ state: "done", value: "set up" });
    // while the policies are read: neither
    const reading = releaseStep({
      states: environmentStates([]), requests: [], policies: [], policiesLoading: true, changes: [], userId: "u-katrin",
      can: { approve: true, promote: true, request: true }, nameOf: (id) => id,
    });
    expect(reading.chips.find((c) => c.id === "approvals")).toMatchObject({ state: "info", value: "…" });
  });

  it("production runs the newest version: live, Request a change", () => {
    const s = release({ releases: [rel("dev", "1.1.0"), rel("stage", "1.1.0"), rel("production", "1.1.0")] });
    expect(s.phase).toBe("live");
    expect(s.live?.version).toBe("1.1.0");
    expect(s.primary.kind).toBe("change");
    expect(s.chips.slice(0, 3).every((c) => c.state === "done")).toBe(true);
  });

  it("release notes: each version's changes in plain words; the first release lists the milestones", () => {
    const changes: StepChange[] = [
      { id: "c1", number: 1, lane: "add", title: "Offline reporting", status: "released-dev", version: "1.1.0" },
      { id: "c2", number: 2, lane: "fix", title: "Wrong technician on shared visits", status: "promoted-stage", version: "1.0.1" },
    ];
    const notes = releaseNotes({
      devHistory: environmentStates([rel("dev", "1.0.0"), rel("dev", "1.0.1", { changeRequestIds: ["c2"] }), rel("dev", "1.1.0", { changeRequestIds: ["c1"] })]).dev.history,
      changes, milestones: [{ number: 2, name: "Report on site" }, { number: 1, name: "Visits on the phone" }], after: null, upTo: null, code: (c) => `CR-${c.number}`,
    });
    expect(notes.map((n) => n.version)).toEqual(["1.1.0", "1.0.1", "1.0.0"]);
    expect(notes[0]!.items).toEqual([{ word: "New", text: "Offline reporting", code: "CR-1" }]);
    expect(notes[1]!.items[0]!.word).toBe("Fixed");
    expect(notes[2]).toMatchObject({ first: true, items: [{ word: "Milestone 1", text: "Visits on the phone", code: null }, { word: "Milestone 2", text: "Report on site", code: null }] });
  });
});
