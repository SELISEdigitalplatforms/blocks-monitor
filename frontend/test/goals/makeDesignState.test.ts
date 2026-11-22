import { describe, expect, it } from "vitest";
import { designJobFailureMessage, designJobInput, designRequestSending, makeDesignState, startsFirstDesign } from "../../src/components/design/makeDesignState";
import type { EngineJob } from "../../src/blocks/engine/types";

const job = (status: EngineJob["status"], input: object, id = "j1") => ({ id, status, inputJson: JSON.stringify(input) }) as EngineJob;
describe("Make design reconciliation", () => {
  it('uses the newest attempt even when storage returns older jobs first', () => {
    const old = { ...job('succeeded', { designBriefId: 'b1', source: 'ux-1' }, 'old'), createdAt: '2026-11-01T10:00:00Z', outputRefs: [{ schema: 'DesignScreen', id: 'old-screen' }] };
    const latest = { ...job('failed', { designBriefId: 'b1', source: 'ux-1', workflow: 'screens' }, 'latest'), createdAt: '2026-11-02T10:00:00Z' };
    const state = makeDesignState([old, latest], 'b1', 'ux-1');
    expect(state.attempt?.id).toBe('latest');
    expect(state.screenshotResult).toBe(false);
  });
  it("detects a stale worker that accepted a Make request but returned screenshot outputs", () => {
    const attempt = { ...job("succeeded", { designBriefId: "b1", source: "ux-1" }), outputRefs: [{ schema: "DesignScreen", id: "screen-1" }] };
    expect(makeDesignState([attempt], "b1", "ux-1").screenshotResult).toBe(true);
    expect(makeDesignState([{ ...attempt, outputRefs: [{ schema: "DesignBrief", id: "b1" }] }], "b1", "ux-1").screenshotResult).toBe(false);
  });
  it("ignores finished legacy screenshots when deciding whether Make has been attempted", () => {
    expect(makeDesignState([job("succeeded", { designBriefId: "b1" })], "b1", "ux-1").attempt).toBeUndefined();
  });
  it("waits for an active legacy writer rather than switching its mode mid-job", () => {
    const legacy = job("running", { designBriefId: "b1" });
    expect(makeDesignState([legacy], "b1", "ux-1")).toMatchObject({ active: legacy, attempt: undefined });
  });
  it.each(["queued", "running", "failed", "cancelled", "succeeded"] as const)("remembers a %s attempt to prevent automatic re-submission", (status) => {
    const attempt = job(status, { designBriefId: "b1", source: "ux-1" });
    expect(makeDesignState([attempt], "b1", "ux-1").attempt).toBe(attempt);
  });
  it("does not reuse a job for another brief or older requirements", () => {
    const jobs = [job("failed", { designBriefId: "b2", source: "ux-1" }), job("failed", { designBriefId: "b1", source: "ux-old" })];
    expect(makeDesignState(jobs, "b1", "ux-1").attempt).toBeUndefined();
  });
  it("orders recorded failures newest first, with the empty code mapped honestly", () => {
    const old = { ...job("failed", { designBriefId: "b1", source: "ux-1" }, "old"), errorCode: null, createdAt: "2026-11-01T10:00:00.000Z" };
    const newer = { ...job("failed", { designBriefId: "b1", source: "ux-1" }, "new"), errorCode: "design.figmaProviderFailed", createdAt: "2026-11-01T11:00:00.000Z" };
    const state = makeDesignState([old, newer], "b1", "ux-1");
    expect(state.failures.map((f) => f.id)).toEqual(["new", "old"]);
    expect(designJobFailureMessage(newer)).toContain("check whether Figma saved any work");
    expect(designJobFailureMessage({ errorCode: "design.figmaProviderFailed", message: "The engine's design runner stopped at its own usage limit before contacting Figma; nothing was created." })).toContain("Nothing was created");
    expect(designJobFailureMessage(old)).not.toMatch(/usage|runner|engine's design connection/i);
  });
  it("says what failed and the step this person has, without claiming designs that do not exist", () => {
    const invalid = { errorCode: "design.figmaInvalidResult", message: "Figma did not return a complete screen design and requirements mapping." };
    const first = designJobFailureMessage(invalid, { hasDesign: false, canRetry: true });
    expect(first).toContain("nothing new was saved");
    expect(first).toContain("Select Retry design to try again.");
    expect(first).not.toMatch(/retained|unchanged|engine owner|recover/i);
    expect(designJobFailureMessage(invalid, { hasDesign: true, canRetry: true })).toContain("Your current design is unchanged. Select Generate fresh design to try again.");
    expect(designJobFailureMessage(invalid, { hasDesign: false, canRetry: false })).toContain("Someone who can edit this project can try again.");
    // Without context it never claims an existing design.
    expect(designJobFailureMessage(invalid)).not.toMatch(/retained|unchanged/i);
  });
  it("explains an incomplete requirement map with its detail and the next step", () => {
    const message = designJobFailureMessage({ errorCode: "design.coverageIncomplete",
      message: 'Screens were made, but the requirement map is incomplete: "Import staff" has no screen and no reason why none is needed.' }, { hasDesign: false, canRetry: true });
    expect(message).toBe('The screens were made, but they could not be matched to every requirement, so this attempt was not saved. Details: "Import staff" has no screen and no reason why none is needed. Select Retry design to try again. If it fails the same way again, check that requirement\'s wording in Goals & requirements.');
    const bare = designJobFailureMessage({ errorCode: "design.coverageIncomplete", message: "something else" }, { hasDesign: true, canRetry: true });
    expect(bare).not.toContain("Details:");
    expect(bare).toContain("Your current design is unchanged.");
  });
  it("tolerates invalid inputs without crashing the design page", () => {
    expect(designJobInput({ inputJson: "not json" })).toEqual({});
    expect(designJobInput({ inputJson: "null" })).toEqual({});
    expect(designJobInput({ inputJson: "[]" })).toEqual({});
  });
});

// 09.11.2026: right after the first design job finished, the page showed the finished screens and "Your business analyst
// is making a new design · Sending your request…", with Change design and Generate fresh design off. Nobody had asked
// for anything; the only design job had succeeded. The design is saved a moment before its job's row turns succeeded.
describe("the job that made the design on screen", () => {
  const made = { ...job("running", { designBriefId: "b1", source: "ux-1", requestType: "initial-design" }, "e3f1300a"), createdAt: "2026-11-09T05:16:48Z" };
  it("is never a new design while it is still marked running: nothing is active and nothing waits on it", () => {
    const state = makeDesignState([made], "b1", "ux-1", { jobId: "e3f1300a", complete: true });
    expect(state.active).toBeUndefined();
    expect(state.finishing).toBe(false);
    // it is still this source's attempt, so nothing starts a design on its own
    expect(state.attempt?.id).toBe("e3f1300a");
    // and the job list is due a read, so the stale "running" clears at once
    expect(state.makerUnread).toBe(true);
  });
  it("is finishing that same design while screens are still missing, never a new one", () => {
    const state = makeDesignState([made], "b1", "ux-1", { jobId: "e3f1300a", complete: false });
    expect(state.active?.id).toBe("e3f1300a");
    expect(state.finishing).toBe(true);
  });
  it("is read as finished once its row says so; a design whose job is not in the list asks for a read", () => {
    expect(makeDesignState([{ ...made, status: "succeeded" }], "b1", "ux-1", { jobId: "e3f1300a", complete: true }).makerUnread).toBe(false);
    expect(makeDesignState([], "b1", "ux-1", { jobId: "e3f1300a", complete: true }).makerUnread).toBe(true);
    expect(makeDesignState([made], "b1", "ux-1").makerUnread).toBe(false);
  });
  it("leaves a real revision alone: another job running over the saved design is a new design", () => {
    const done = { ...made, status: "succeeded" as const };
    const revision = { ...job("running", { designBriefId: "b1", source: "ux-1", requestType: "design-change", feedback: "Bigger buttons" }, "rev-2"), createdAt: "2026-11-09T06:00:00Z" };
    const state = makeDesignState([done, revision], "b1", "ux-1", { jobId: "e3f1300a", complete: true });
    expect(state.active?.id).toBe("rev-2");
    expect(state.finishing).toBe(false);
  });
});

describe("this page's design request", () => {
  const known = [{ id: "old-1" }];
  it("counts as sending only until it is answered or its job shows up", () => {
    expect(designRequestSending(null, known, false)).toBe(false);
    expect(designRequestSending({ automatic: false, knownJobIds: ["old-1"] }, known, true)).toBe(true);
    expect(designRequestSending({ automatic: true, knownJobIds: ["old-1"] }, known, false)).toBe(true);
    // a job that was not there when it was sent: the request was taken, even if its own answer is lost or late
    expect(designRequestSending({ automatic: false, knownJobIds: ["old-1"] }, [...known, { id: "new-1" }], true)).toBe(false);
    expect(designRequestSending({ automatic: true, knownJobIds: [] }, [{ id: "e3f1300a" }], true)).toBe(false);
  });
  it("never shows the page's own first-design request as a new design once a design is saved", () => {
    expect(designRequestSending({ automatic: true, knownJobIds: ["old-1"] }, known, true)).toBe(false);
  });
});

describe("starting the first design on its own", () => {
  const clear = { editable: true, canGenerate: true, hasDesign: false, hasAttempt: false, rereading: false, startedBefore: false };
  it("starts only with no design, no job for the current requirements and nothing being read again", () => {
    expect(startsFirstDesign(clear)).toBe(true);
  });
  it.each([
    ["a design is saved", { hasDesign: true }],
    ["a job for the current requirements exists", { hasAttempt: true }],
    ["the design or the job list is being read again", { rereading: true }],
    ["it was started before for this source", { startedBefore: true }],
    ["this person cannot edit", { editable: false }],
    ["a design cannot be started now", { canGenerate: false }],
  ])("never starts when %s", (_why, over) => {
    expect(startsFirstDesign({ ...clear, ...over })).toBe(false);
  });
});
