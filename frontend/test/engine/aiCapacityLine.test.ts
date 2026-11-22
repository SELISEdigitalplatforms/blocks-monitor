// A job that stopped because the engine's capacity is used up (ai.capacity, server/api/extraction/claudeCapacity.ts)
// shows the app's own line, in the chosen language, with the reset only when the engine named a real one; the
// analysis says it instead of "Something interrupted my reading", and a first-requirements draft that stopped is said
// to have stopped (with its reason) instead of "I'm writing the requirements" or nothing.
import { afterEach, describe, expect, it } from "vitest";
import { CAPACITY_CODE, capacityMessage } from "../../server/api/extraction/claudeCapacity.ts";
import { AI_CAPACITY_CODE, capacityResetOf, failedJobText, toEngineJob } from "../../src/blocks/engine/types";
import { jobView } from "../../src/components/sanitization/SanitizationStep";
import { understandingNow, type UnderstandingInput } from "../../src/components/sanitization/understandingModel";
import { NEXT_TEXT, nextActionFrom } from "../../src/components/analysis-next/next/nextAction";
import { resetI18nForTests, setCulture } from "../../src/i18n";

const row = (o: Record<string, unknown> = {}) => ({
  ItemId: "j1", ProjectId: "p1", Kind: "sanitization.assist", Status: "failed", ErrorCode: CAPACITY_CODE,
  Message: capacityMessage({ resetsAt: null, resetsText: "2am (Europe/Stockholm)" }), CreatedDate: "2026-11-15T08:13:00Z", ...o,
});
const FOR_NOW = "The engine's capacity is used up for now, so the work stopped. Nothing was lost; start it again once it is back.";
const UNTIL_2AM = "The engine's capacity is used up until 2am (Europe/Stockholm), so the work stopped. Nothing was lost; start it again then.";

const base: UnderstandingInput = {
  existing: false, completed: false, canEdit: true, notes: 1, files: 0,
  questions: { open: 0, answered: 0, deferred: 0 }, requirements: 0, hasObjective: false,
  questionsJob: { state: "none", progress: 0, message: null }, draftJob: { state: "none", progress: 0, message: null },
};

afterEach(() => resetI18nForTests());

describe("the ai.capacity line", () => {
  it("is the same code on both sides", () => {
    expect(AI_CAPACITY_CODE).toBe(CAPACITY_CODE);
  });

  it("carries over only the reset the engine named, in English and in German", () => {
    expect(capacityResetOf(capacityMessage({ resetsAt: null, resetsText: "2am (Europe/Stockholm)" }))).toBe("2am (Europe/Stockholm)");
    expect(capacityResetOf(capacityMessage({ resetsAt: Date.UTC(2033, 4, 18, 3, 33), resetsText: null }, { now: 0, timeZone: "UTC" }))).toBe("Wed 18 May, 03:33 UTC");
    expect(capacityResetOf(capacityMessage(null))).toBeNull();
    expect(toEngineJob(row())?.message).toBe(UNTIL_2AM);
    expect(toEngineJob(row({ Message: capacityMessage(null) }))?.message).toBe(FOR_NOW);
    expect(failedJobText(AI_CAPACITY_CODE)).toBe(FOR_NOW);
    setCulture("de-CH");
    expect(toEngineJob(row())?.message).toBe("Die Kapazität der Engine ist bis 2am (Europe/Stockholm) aufgebraucht, deshalb wurde die Arbeit angehalten. Nichts ging verloren; starten Sie sie dann erneut.");
    expect(failedJobText(AI_CAPACITY_CODE)).toBe("Die Kapazität der Engine ist im Moment aufgebraucht, deshalb wurde die Arbeit angehalten. Nichts ging verloren; starten Sie sie erneut, sobald die Kapazität wieder da ist.");
  });

  it("is said on the step and on the analyst's card when it stopped the reading", () => {
    const questionsJob = jobView(toEngineJob(row()));
    expect(questionsJob).toMatchObject({ state: "failed", errorCode: AI_CAPACITY_CODE, message: UNTIL_2AM });
    const now = understandingNow({ ...base, questionsJob });
    expect(now.primary.kind).toBe("start");
    expect(now.agent.text).toBe(UNTIL_2AM);
    expect(now.stopped).toEqual({ text: UNTIL_2AM, capacity: true });
    const card = nextActionFrom({ step: "sanitization", loading: false, questions: { open: 0, next: "start", readFailed: true, stopped: now.stopped, canEdit: true } });
    expect(card).toMatchObject({ title: NEXT_TEXT.readAgain.title, detail: UNTIL_2AM, button: "Start" });
    expect(card.detail).not.toMatch(/\bAI\b/);
  });

  it("keeps the general words for a reading that stopped for another reason", () => {
    const questionsJob = jobView(toEngineJob(row({ ErrorCode: "engine.failed", Message: "The clarifying questions stopped." })));
    const now = understandingNow({ ...base, questionsJob });
    expect(now.agent.text).toBe("Something interrupted the reading. Nothing you added is lost.");
    expect(now.stopped).toBeUndefined();
    const card = nextActionFrom({ step: "sanitization", loading: false, questions: { open: 0, next: "start", readFailed: true, stopped: now.stopped, canEdit: true } });
    expect(card.detail).toBe(NEXT_TEXT.readAgain.detail);
  });
});

describe("the first requirements stopped (requirements.draft failed)", () => {
  const handled = { questions: { open: 0, answered: 2, deferred: 0 }, questionsJob: { state: "succeeded" as const, progress: 100, message: null } };
  const draft = (o: Record<string, unknown>) => jobView(toEngineJob(row({ Kind: "requirements.draft", ...o })));
  const card = (stopped: ReturnType<typeof understandingNow>["stopped"]) =>
    nextActionFrom({ step: "sanitization", loading: false, questions: { open: 0, next: "prepare", readFailed: false, stopped, canEdit: true } });

  it("out of capacity: the step and the card say it stopped and why, and Continue prepares it again", () => {
    const now = understandingNow({ ...base, ...handled, draftJob: draft({ Message: capacityMessage(null) }) });
    expect(now).toMatchObject({ tone: "attention", status: "The first requirements stopped before they were ready", primary: { kind: "prepare", disabled: false } });
    expect(now.agent).toEqual({ text: FOR_NOW, working: false, progress: null });
    expect(now.stopped).toEqual({ text: FOR_NOW, capacity: true });
    expect(card(now.stopped)).toEqual({ title: "Continue to the requirements", detail: FOR_NOW, item: "questions", button: "Continue" });
  });

  it("another failure: the step says the job's own line, the card says it stopped in the analyst's words", () => {
    const now = understandingNow({ ...base, ...handled, draftJob: draft({ ErrorCode: "engine.failed", Message: "The requirements draft stopped." }) });
    expect(now.agent.text).toBe("The requirements draft stopped.");
    expect(now.stopped).toEqual({ text: "The requirements draft stopped.", capacity: false });
    expect(card(now.stopped).detail).toBe(NEXT_TEXT.toRequirements.stopped);
    const silent = understandingNow({ ...base, ...handled, draftJob: { state: "failed", progress: 0, message: null } });
    expect(silent.stopped?.text).toBe("Something interrupted the first requirements. Your answers are not lost.");
  });

  it("never claims it is writing them while the newest draft has failed, and a draft not started yet is no stop", () => {
    const failed = understandingNow({ ...base, ...handled, draftJob: draft({}) });
    expect(failed.primary.kind).toBe("prepare");
    expect(card(failed.stopped).working).toBeUndefined();
    const none = understandingNow({ ...base, ...handled });
    expect(none.stopped).toBeUndefined();
    expect(card(none.stopped).detail).toBe(NEXT_TEXT.toRequirements.prepare);
    // a draft that failed once but whose requirements are in is ready, not stopped
    const ready = understandingNow({ ...base, ...handled, requirements: 3, hasObjective: true, draftJob: draft({}) });
    expect(ready.primary.kind).toBe("confirm");
    expect(ready.stopped).toBeUndefined();
  });

  it("says it in German too", () => {
    setCulture("de-CH");
    const now = understandingNow({ ...base, ...handled, draftJob: draft({ ErrorCode: "engine.failed", Message: null }) });
    expect(now.status).toBe("Die ersten Anforderungen wurden angehalten, bevor sie bereit waren");
    expect(card(now.stopped).detail).toBe("Ich musste anhalten, bevor die ersten Anforderungen bereit waren. Ihre Antworten gehen nicht verloren; fahren Sie fort, um neu zu starten.");
  });
});
