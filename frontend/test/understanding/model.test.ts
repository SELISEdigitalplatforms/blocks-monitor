// "What to do now" on Understanding your project: the sentence, the checklist and the one primary action follow the
// product manager's work and the person's answers; answering is a conversation (answer, not sure, later).
import { describe, expect, it } from "vitest";
import {
  activeQuestion, asideKindOf, asideReason, asideWords, briefAbout, LATER_REASON, NOT_SURE_REASON, NOT_SURE_REASONS_BEFORE, questionsProgress, understandingNow,
  understoodLines, type UnderstandingInput,
} from "../../src/components/sanitization/understandingModel";

const NONE = { state: "none", progress: 0, message: null } as const;
const DONE = { state: "succeeded", progress: 100, message: "Drafted 4 questions." } as const;
const base: UnderstandingInput = {
  existing: false, completed: false, canEdit: true, notes: 2, files: 1,
  questions: { open: 0, answered: 0, deferred: 0 }, requirements: 0, hasObjective: false,
  questionsJob: NONE, draftJob: NONE,
};
const now = (o: Partial<UnderstandingInput>) => understandingNow({ ...base, ...o });
const chip = (s: ReturnType<typeof now>, key: string) => s.chips.find((c) => c.key === key)!;

describe("understandingNow (step standard: one status, one primary, three chips, the agent line)", () => {
  it("while the product manager reads: busy, shimmer on the agent line, nothing to press yet", () => {
    const s = now({ questionsJob: { state: "active", progress: 34, message: "Found 4 points to clarify." } });
    expect(s).toMatchObject({ tone: "progress", status: "The business analyst is reading your material" });
    expect(s.agent).toEqual({ text: "Reading your material and writing the questions. Found 4 points to clarify.", working: true, progress: 34 });
    expect(chip(s, "read")).toMatchObject({ done: false, busy: true, value: "reading…" });
    expect(s.primary).toMatchObject({ kind: "wait", label: "Answer the questions", disabled: true });
  });

  it("questions arriving while it still reads can be answered at once", () => {
    const s = now({ questionsJob: { state: "active", progress: 60, message: null }, questions: { open: 2, answered: 0, deferred: 0 } });
    expect(s.primary).toEqual({ kind: "answer", label: "Answer the questions" });
  });

  it("no reading yet (handed over before the analysis started by itself): start it", () => {
    expect(now({}).primary).toMatchObject({ kind: "start", label: "Start reading" });
    expect(now({ questionsJob: { state: "failed", progress: 20, message: "Stopped." } }).primary).toMatchObject({ kind: "start", label: "Start the reading again" });
    expect(now({ canEdit: false }).primary.disabled).toBe(true);
  });

  it("open questions: answer them, the chips count", () => {
    const s = now({ questionsJob: DONE, questions: { open: 3, answered: 2, deferred: 1 } });
    expect(s).toMatchObject({ tone: "attention", status: "3 questions for you", primary: { kind: "answer" } });
    expect(chip(s, "read")).toMatchObject({ done: true, value: "2 notes and 1 file read" });
    expect(chip(s, "questions")).toMatchObject({ done: false, value: "2 of 6 answered · 1 set aside" });
    expect(chip(s, "draft")).toMatchObject({ done: false, value: "after your answers" });
  });

  it("all handled: the first requirements are prepared behind the scenes, then Continue", () => {
    const handled = { questionsJob: DONE, questions: { open: 0, answered: 3, deferred: 1 } };
    expect(now(handled).primary).toMatchObject({ kind: "prepare", label: "Continue to Goals & requirements" });
    const drafting = now({ ...handled, draftJob: { state: "active", progress: 40, message: "Writing requirement 3 of 7." } });
    expect(drafting).toMatchObject({ tone: "progress", primary: { kind: "preparing", disabled: true } });
    expect(drafting.agent.working).toBe(true);
    expect(chip(drafting, "draft")).toMatchObject({ busy: true, value: "being prepared" });
    const ready = now({ ...handled, requirements: 7, hasObjective: true, draftJob: DONE });
    expect(ready).toMatchObject({ tone: "done", status: "Ready", primary: { kind: "confirm", label: "Continue to Goals & requirements" } });
    expect(now({ ...handled, requirements: 7, hasObjective: true, existing: true }).primary.label).toBe("Continue to Goals for the change");
  });

  it("a draft that just finished stays ready while its rows are read again (never back to a to-do)", () => {
    const handled = { questionsJob: DONE, questions: { open: 0, answered: 6, deferred: 0 } };
    const justDone = now({ ...handled, requirements: 0, hasObjective: false, draftJob: { state: "succeeded", progress: 100, message: "Drafted 10 requirements and the objective." } });
    expect(chip(justDone, "draft")).toMatchObject({ done: true, value: "ready" });
    expect(justDone.primary).toMatchObject({ kind: "confirm" });
  });

  it("signed off: the link to the next step, every chip ticked", () => {
    const s = now({ completed: true, questionsJob: DONE, questions: { open: 0, answered: 3, deferred: 0 }, requirements: 5, hasObjective: true });
    expect(s.primary).toMatchObject({ kind: "continue", label: "Open Goals & requirements" });
    expect(s.chips.every((c) => c.done)).toBe(true);
  });
});

describe("answering like a conversation", () => {
  it("progress: answered of all, set aside named apart", () => {
    expect(questionsProgress({ open: 2, answered: 3, deferred: 0 })).toEqual({ total: 5, handled: 3, text: "3 of 5 answered" });
    expect(questionsProgress({ open: 1, answered: 3, deferred: 1 }).text).toBe("3 of 5 answered · 1 set aside");
    expect(questionsProgress({ open: 0, answered: 4, deferred: 0 }).text).toBe("All 4 answered");
    expect(questionsProgress({ open: 0, answered: 0, deferred: 0 }).text).toBe("No questions yet");
  });

  it("not sure / later: the reason says which, with the person's own words", () => {
    expect(asideReason("notSure", "")).toBe(NOT_SURE_REASON);
    expect(asideReason("later", "  ")).toBe(LATER_REASON);
    expect(asideReason("notSure", "Ask Beat")).toBe("Not sure yet: Ask Beat");
    expect(asideKindOf(asideReason("notSure", "x"))).toBe("notSure");
    expect(asideKindOf(asideReason("later", "x"))).toBe("later");
    expect(asideKindOf("Waiting for the new accounting software")).toBe("later");
    expect(asideWords(NOT_SURE_REASON)).toBe("");
    expect(asideWords(LATER_REASON)).toBe("");
    expect(asideWords("Answer later: after the call on Friday")).toBe("after the call on Friday");
    expect(asideWords("Waiting for IT")).toBe("Waiting for IT");
  });

  it("the standard \"Not sure\" sentence: new saves name your business analyst; rows saved with the earlier wordings still read as standard", () => {
    expect(NOT_SURE_REASON).toBe("Not sure yet. Your business analyst suggests an answer.");
    expect(asideReason("notSure", "  ")).toBe("Not sure yet. Your business analyst suggests an answer.");
    expect(NOT_SURE_REASONS_BEFORE).toEqual([
      "Not sure yet. The product manager suggests an answer.",
      "Not sure yet. The business analyst suggests an answer.",
    ]);
    for (const saved of [NOT_SURE_REASON, ...NOT_SURE_REASONS_BEFORE]) {
      expect(asideKindOf(saved)).toBe("notSure");
      expect(asideWords(saved)).toBe("");
      expect(asideWords(`  ${saved}  `)).toBe("");
    }
    // the person's own words after the old sentence are not mistaken for it
    expect(asideWords("Not sure yet: The product manager suggests an answer, ask Beat")).toBe("The product manager suggests an answer, ask Beat");
  });

  it("the active question: the one asked for while open, else the first open", () => {
    const rows = [{ ItemId: "a", Status: "answered" }, { ItemId: "b", Status: "open" }, { ItemId: "c", Status: "open" }];
    expect(activeQuestion(rows, null)).toBe("b");
    expect(activeQuestion(rows, "c")).toBe("c");
    expect(activeQuestion(rows, "a")).toBe("b");
    expect(activeQuestion([{ ItemId: "a", Status: "answered" }], null)).toBeNull();
  });

  it("the brief note's about section is the description", () => {
    expect(briefAbout("## About the project\n\n**Café shop**\n\nSell coffee online.\n\n## Goal\n\nMore sales.")).toBe("Sell coffee online.");
    expect(briefAbout("## Goal\n\nMore sales.")).toBe("");
  });

  it("what we understood never says the same thing twice (an objective that only repeats the goal gives way to the brief)", () => {
    const o = {
      existing: false, brief: "A booking app for cooking classes.", goal: "Sell online, fewer mistakes", users: "Customers",
      mustHaves: [{ text: "Pay online", priority: "should" }, { text: "Book a class", priority: "must" }], changes: [],
    };
    expect(understoodLines({ ...o, objective: "Sell online, fewer mistakes." })).toEqual([
      { label: "In short", text: "A booking app for cooking classes." },
      { label: "Goal", text: "Sell online, fewer mistakes" },
      { label: "For", text: "Customers" },
      { label: "It must", text: "Book a class and Pay online" },
    ]);
    const own = understoodLines({ ...o, objective: "Customers book and pay for classes online." });
    expect(own[0]).toEqual({ label: "In short", text: "Customers book and pay for classes online." });
    expect(understoodLines({ ...o, objective: null, brief: "Sell online, fewer mistakes." }).map((l) => l.label)).toEqual(["In short", "For", "It must"]);
  });
});
