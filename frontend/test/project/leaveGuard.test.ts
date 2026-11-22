// Leaving a project from the project switcher: what is unfinished there for the person (leaveGuard.ts), the question's
// store (leaveGuardStore.ts), the unsent-draft registry and the switcher's list.
//   npx vitest run --config test/project/vitest.config.ts
import { afterEach, describe, expect, it } from "vitest";
import {
  JOB_PAUSE_PERMISSION, NO_LEAVE_FACTS, analysisWaiting, canPause, isLeaveWork, leaveTitle, pausable, unfinishedItems, workWhat,
  type LeaveFacts, type LeaveWork,
} from "../../src/components/project/leaveGuard";
import { confirmLeave, settleLeave, useLeaveGuard } from "../../src/components/project/leaveGuardStore";
import { draftsOf } from "../../src/components/project/dirtyDrafts";
import { stepLine, switcherProjects } from "../../src/components/project/ProjectSwitcher";
import type { NextFacts } from "../../src/components/analysis-next/next/nextAction";
import { JOB_KIND_PERMISSION } from "../../functions/project/ops/jobs/permissions";

const facts = (f: Partial<LeaveFacts>): LeaveFacts => ({ ...NO_LEAVE_FACTS, ...f });
const job = (w: Partial<LeaveWork>): LeaveWork => ({
  jobId: "j1", kind: "change.analyse", status: "running", what: "the analysis of CR-007", mine: true, permitted: true, ...w,
});
const texts = (f: Partial<LeaveFacts>) => unfinishedItems(facts(f)).map((i) => i.text);

describe("unfinishedItems", () => {
  it("is empty when nothing is pending: the switch needs no question", () => {
    expect(unfinishedItems(NO_LEAVE_FACTS)).toEqual([]);
    // finished work is not pending either
    expect(unfinishedItems(facts({ work: [job({ status: "succeeded" }), job({ jobId: "j2", status: "cancelled" }), job({ jobId: "j3", status: "failed" })] }))).toEqual([]);
  });

  it("counts the answers the business analyst waits for", () => {
    expect(texts({ answers: 3 })).toEqual(["Your business analyst is waiting for 3 answers"]);
    expect(texts({ answers: 1 })).toEqual(["Your business analyst is waiting for 1 answer"]);
    expect(unfinishedItems(facts({ answers: 2 }))[0]!.kind).toBe("answers");
  });

  it("names the approvals waiting for the person", () => {
    expect(texts({ decisions: ["CR-006"] })).toEqual(["Your business analyst needs your approval on CR-006"]);
    expect(texts({ decisions: ["CR-006", "CR-007"] })).toEqual(["Your business analyst needs your approval on CR-006 and CR-007"]);
    expect(texts({ decisions: ["CR-006", "CR-007", "FX-8"] })).toEqual(["Your business analyst needs your approval on 3 change requests"]);
    expect(texts({ releases: 1 })).toEqual(["Your tech lead needs you to approve a release"]);
    expect(texts({ releases: 2 })).toEqual(["Your tech lead needs you to approve 2 releases"]);
    expect(texts({ analysis: "requirements" })).toEqual(["Your business analyst needs your approval on the requirements"]);
    expect(texts({ analysis: "scope" })).toEqual(["Your business analyst needs you to lock the scope"]);
    expect(unfinishedItems(facts({ decisions: ["CR-006"], releases: 1 })).every((i) => i.kind === "approval")).toBe(true);
  });

  it("says what the team starts when the person gives the go", () => {
    expect(texts({ goAheads: ["the build of CR-005"] })).toEqual(["Your tech lead is waiting for your go on the build of CR-005"]);
    expect(texts({ restarts: [{ who: "analyst", what: "the analysis of CR-004" }] }))
      .toEqual(["Your business analyst can start the analysis of CR-004 again when you say so"]);
  });

  it("keeps the rest of 'waiting for you' in its own words, so the switcher's dot and the list agree", () => {
    const items = unfinishedItems(facts({ waiting: ["Finish your project setup", "Preview ready to try: Checkout"] }));
    expect(items.map((i) => i.text)).toEqual(["Finish your project setup", "Preview ready to try: Checkout"]);
    expect(items.every((i) => i.kind === "waiting" && !i.pause)).toBe(true);
  });

  it("lists running work, with a pause only for work the person started and may start again", () => {
    const withRight = unfinishedItems(facts({ work: [job({})] }));
    expect(withRight).toHaveLength(1);
    expect(withRight[0]!.text).toBe("The analysis of CR-007 is running");
    expect(withRight[0]!.pause).toEqual({ jobId: "j1", text: "The analysis of CR-007 will stop; you can resume it later." });
    expect(pausable(withRight)).toEqual([{ jobId: "j1", text: "The analysis of CR-007 will stop; you can resume it later." }]);

    // started by the person, but no permission to start it again: listed, never paused
    const noRight = unfinishedItems(facts({ work: [job({ permitted: false })] }));
    expect(noRight.map((i) => i.text)).toEqual(["The analysis of CR-007 is running"]);
    expect(pausable(noRight)).toEqual([]);

    // someone else's build: listed, never paused, even with the permission
    const others = unfinishedItems(facts({ work: [job({ kind: "build.run", what: "the build of milestone 2", mine: false })] }));
    expect(others.map((i) => i.text)).toEqual(["The build of milestone 2 is running"]);
    expect(pausable(others)).toEqual([]);

    // queued work waits to start and can be paused as well
    const queued = unfinishedItems(facts({ work: [job({ status: "queued" })] }));
    expect(queued[0]!.text).toBe("The analysis of CR-007 is waiting to start");
    expect(pausable(queued)).toHaveLength(1);
    expect(canPause(job({ status: "succeeded" }))).toBe(false);
  });

  it("puts an unsent draft first: it is the one thing lost on leaving", () => {
    expect(texts({ drafts: [{ id: "d1", label: "message to your tech lead" }] })).toEqual(["You have an unsent message to your tech lead"]);
    expect(texts({ drafts: [{ id: "d1", label: "message to your tech lead" }, { id: "d2", label: "answer for your business analyst" }] }))
      .toEqual(["You have 2 unsent messages"]);
    const all = unfinishedItems(facts({ answers: 2, work: [job({})], drafts: [{ id: "d1", label: "answer for your business analyst" }] }));
    expect(all.map((i) => i.kind)).toEqual(["draft", "answers", "work"]);
  });

  it("titles the question with the project's name", () => {
    expect(leaveTitle("Northwind Portal")).toBe("Leave Northwind Portal for now?");
    expect(leaveTitle("  ")).toBe("Leave this project for now?");
  });
});

describe("Business Analysis' next action as something waiting", () => {
  const base: NextFacts = { step: "requirements", loading: false };
  it("is the step's move when the person may make it", () => {
    expect(analysisWaiting({ ...base, requirements: { drafting: null, count: 4, blockers: [], openItems: 0, canApprove: true } })).toEqual({ answers: 0, wait: "requirements" });
    expect(analysisWaiting({ ...base, requirements: { drafting: null, count: 4, blockers: [], openItems: 0, canApprove: false } })).toEqual({ answers: 0, wait: null });
    // the analyst is still writing: nothing waits for the person
    expect(analysisWaiting({ ...base, requirements: { drafting: "draft", count: 0, blockers: [], openItems: 0, canApprove: true } })).toEqual({ answers: 0, wait: null });
  });
  it("counts the brief's missing answers, and leaves open questions to the 'waiting for you' count", () => {
    expect(analysisWaiting({ step: "understanding", loading: false, brief: { missing: 2, canAnswer: true }, understood: { filesReading: 0, filesFailed: 0, conflicts: 0, confirmed: false, canConfirm: true } }))
      .toEqual({ answers: 2, wait: null });
    expect(analysisWaiting({ step: "sanitization", loading: false, questions: { open: 3, next: "answer", readFailed: false, canEdit: true } })).toEqual({ answers: 0, wait: null });
    expect(analysisWaiting({ step: "sanitization", loading: false, questions: { open: 0, next: "confirm", readFailed: false, canEdit: true } })).toEqual({ answers: 0, wait: "continue" });
  });
  it("is nothing past the analysis or while loading", () => {
    expect(analysisWaiting({ step: "build", loading: false })).toEqual({ answers: 0, wait: null });
    expect(analysisWaiting({ step: "scope", loading: true })).toEqual({ answers: 0, wait: null });
  });
});

describe("the work's names and rights", () => {
  it("names the work in a sentence", () => {
    expect(workWhat("change.analyse", { change: "CR-007" })).toBe("the analysis of CR-007");
    expect(workWhat("change.build", { change: "CR-005" })).toBe("the build of CR-005");
    expect(workWhat("build.run", { milestone: 2 })).toBe("the build of milestone 2");
    expect(workWhat("preview.deploy", { milestone: 1, deployTo: "preview" })).toBe("the preview of milestone 1");
    expect(workWhat("preview.deploy", { deployTo: "stage" })).toBe("the release to staging");
    expect(workWhat("requirements.draft", {})).toBe("the requirements draft");
  });
  it("leaves a reply to a chat question out of the work", () => {
    expect(isLeaveWork("chat.reply")).toBe(false);
    expect(isLeaveWork("build.run")).toBe(true);
  });
  it("uses the server's own rule for who may stop and start work again", () => {
    expect(JOB_PAUSE_PERMISSION).toEqual(JOB_KIND_PERMISSION);
  });
});

describe("the question before leaving", () => {
  afterEach(() => useLeaveGuard.setState({ hosts: 0, warm: 0, request: null }));

  it("goes on at once off a project page (no guard mounted)", async () => {
    await expect(confirmLeave()).resolves.toBe(true);
  });
  it("waits for the person's answer on a project page", async () => {
    useLeaveGuard.setState({ hosts: 1 });
    const stay = confirmLeave();
    expect(useLeaveGuard.getState().request).not.toBeNull();
    settleLeave(false);
    await expect(stay).resolves.toBe(false);
    const go = confirmLeave();
    settleLeave(true);
    await expect(go).resolves.toBe(true);
    expect(useLeaveGuard.getState().request).toBeNull();
  });
  it("a newer switch replaces one still waiting (that one stays)", async () => {
    useLeaveGuard.setState({ hosts: 1 });
    const first = confirmLeave();
    const second = confirmLeave();
    await expect(first).resolves.toBe(false);
    settleLeave(true);
    await expect(second).resolves.toBe(true);
  });
});

describe("unsent drafts", () => {
  it("are kept per project", () => {
    const drafts = { a: { projectId: "p1", label: "message to your tech lead" }, b: { projectId: "p2", label: "answer for your business analyst" } };
    expect(draftsOf(drafts, "p1")).toEqual([{ id: "a", label: "message to your tech lead" }]);
    expect(draftsOf(drafts, "p3")).toEqual([]);
  });
});

describe("the switcher's list", () => {
  const p = (id: string, name: string, extra: Partial<{ clientName: string; status: string }> = {}) =>
    ({ id, name, clientName: "", status: "active", ...extra }) as { id: string; name: string; clientName: string; status: "active" };
  const list = [p("a", "Atlas"), p("b", "Börse Portal", { clientName: "Zürich Bank" }), p("c", "Cargo"), p("d", "Gone", { status: "deleting" })];

  it("pins the open project first and keeps the rest in the list's order, active ones only", () => {
    expect(switcherProjects(list, "c", "").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("finds by name or client, case and accents ignored", () => {
    expect(switcherProjects(list, "c", "borse").map((x) => x.id)).toEqual(["b"]);
    expect(switcherProjects(list, "c", "zurich bank").map((x) => x.id)).toEqual(["b"]);
    expect(switcherProjects(list, "c", "nothing")).toEqual([]);
  });
  it("says the step as one of the four", () => {
    expect(stepLine("requirements")).toBe("Business Analysis · Step 2 of 4");
    expect(stepLine("build")).toBe("Software Engineering · Step 3 of 4");
  });
});
