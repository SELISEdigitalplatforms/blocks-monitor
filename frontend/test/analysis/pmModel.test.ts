import { describe, expect, it } from "vitest";
import { JOURNEY_STEPS } from "../../src/domain/journey";
import {
  analystChecklistStates, briefAnswers, briefQuestions, checklistStates, currentItem, isThin, livePastAnalysis, questionCounter, readLine,
  type LiveFacts,
} from "../../src/components/analysis/pm/pmModel";

const NOTHING: LiveFacts = { understoodConfirmed: false, filesRead: 0, questionsHandled: 0, requirementsApproved: false, scopeLocked: false };

describe("product manager panel model", () => {
  it("treats empty or one-or-two-word answers as too thin", () => {
    expect(isThin("")).toBe(true);
    expect(isThin("  CRM  ")).toBe(true);
    expect(isThin("sales team")).toBe(true);
    expect(isThin("Let customers book repairs online")).toBe(false);
  });

  it("asks with the project's name", () => {
    expect(briefQuestions("Acme Repairs").goal).toBe("What is the main objective of Acme Repairs?");
    expect(briefQuestions("  ").goal).toBe("What is the main objective of this project?");
  });

  it("takes the project's fields first, else the answer to its own question", () => {
    const q = briefQuestions("Acme");
    const asked = [
      { Question: q.goal, Answer: "Let customers book repairs online", Status: "answered" },
      { Question: q.users, Answer: "", Status: "open" },
    ];
    const a = briefAnswers({ name: "Acme", goal: "", users: "Service desk staff and customers", asked });
    expect(a.goal).toBe("Let customers book repairs online");
    expect(a.users).toBe("Service desk staff and customers");
    expect(a.missing).toEqual([]);
    expect(briefAnswers({ name: "Acme", goal: "CRM", users: "", asked: [] }).missing).toEqual(["goal", "users"]);
  });

  it("marks the checklist from the stored step and the brief", () => {
    const atStart = checklistStates("understanding", false);
    expect(atStart.brief).toBe("now");
    expect(atStart.understood).toBe("later");
    expect(currentItem(atStart)).toBe("brief");
    const ready = checklistStates("understanding", true);
    expect(ready.brief).toBe("done");
    expect(ready.understood).toBe("now");
    expect(currentItem(ready)).toBe("understood");
    const asking = checklistStates("sanitization", false);
    expect(asking).toMatchObject({ brief: "done", understood: "done", questions: "now", requirements: "later", scope: "later" });
    expect(currentItem(checklistStates("board", true))).toBe("scope");
    expect(currentItem(checklistStates(null, false))).toBe("brief");
  });

  it("says what it read and where the questions stand", () => {
    expect(readLine(0)).toBe("I read your project setup.");
    expect(readLine(1)).toBe("I read your project setup and one file.");
    expect(readLine(3)).toBe("I read your project setup and 3 files.");
    expect(questionCounter(2, 7)).toBe("Question 3 of 7");
    expect(questionCounter(7, 7)).toBe("Question 7 of 7");
    expect(questionCounter(0, 0)).toBe("");
  });

  it("leaves every normal project's checklist as today's panel marks it, away from the questions", () => {
    for (const step of [null, ...JOURNEY_STEPS]) {
      for (const briefReady of [false, true]) {
        for (const understoodConfirmed of [false, true]) {
          if (step === "sanitization") continue;
          expect(analystChecklistStates(step, { briefReady, understoodConfirmed }, null)).toEqual(checklistStates(step, briefReady));
        }
      }
    }
    // with both recorded, the questions step reads as before too
    expect(analystChecklistStates("sanitization", { briefReady: true, understoodConfirmed: true }, null)).toEqual(checklistStates("sanitization", true));
    // the live facts only count past the analysis (a brownfield still in setup or analysis follows its step)
    for (const step of ["business", "understanding", "sanitization", "requirements", "scope"] as const) {
      expect(analystChecklistStates(step, { briefReady: true, understoodConfirmed: true }, NOTHING)).toEqual(checklistStates(step, true));
    }
  });

  it("never marks the objective or the confirmation done on its own at the questions (where the hand-over lands)", () => {
    // E2E 08.11: straight after the hand-over both read "Done" although nothing was answered or confirmed
    const fresh = analystChecklistStates("sanitization", { briefReady: false, understoodConfirmed: false }, null);
    expect(fresh).toEqual({ brief: "open", understood: "open", questions: "now", requirements: "later", scope: "later" });
    // still to do, but not the current item: the questions stay where the conversation is
    expect(currentItem(checklistStates("sanitization", false))).toBe("questions");
    // each turns done from its own record
    expect(analystChecklistStates("sanitization", { briefReady: true, understoodConfirmed: false }, null))
      .toMatchObject({ brief: "done", understood: "open" });
    expect(analystChecklistStates("sanitization", { briefReady: false, understoodConfirmed: true }, null))
      .toMatchObject({ brief: "open", understood: "done" });
    // once the questions step is signed off, both are signed with it (as "What we understood" is: understandingSigned)
    for (const step of ["requirements", "scope", "board"] as const) {
      expect(analystChecklistStates(step, { briefReady: false, understoodConfirmed: false }, null)).toMatchObject({ brief: "done", understood: "done" });
    }
  });

  it("works from the recorded answers only, never from what was merely found", () => {
    const q = briefQuestions("Lunch");
    // nothing on the project and no answer: both missing, whatever the reading found elsewhere
    expect(briefAnswers({ name: "Lunch", goal: "", users: "", asked: [] }).missing).toEqual(["goal", "users"]);
    // the analyst's own question answered after the hand-over counts
    const asked = [{ Question: q.goal, Answer: "Everyone orders lunch for the week in one place", Status: "answered" }];
    expect(briefAnswers({ name: "Lunch", goal: "", users: "", asked }).missing).toEqual(["users"]);
  });

  it("takes the person's own answer however short it is; a word or two in the project's fields stays open", () => {
    const q = briefQuestions("Links");
    const asked = [
      { Question: q.goal, Answer: "to shorten link fast", Status: "answered" },
      { Question: q.users, Answer: "global users", Status: "answered" },
    ];
    expect(briefAnswers({ name: "Links", goal: "", users: "", asked })).toEqual({ goal: "to shorten link fast", users: "global users", missing: [] });
    expect(briefAnswers({ name: "Links", goal: "CRM", users: "Sales", asked: [] }).missing).toEqual(["goal", "users"]);
  });

  it("knows a live product past the analysis", () => {
    expect(livePastAnalysis(true, "board")).toBe(true);
    expect(livePastAnalysis(true, "build")).toBe(true);
    expect(livePastAnalysis(true, "release")).toBe(true);
    expect(livePastAnalysis(true, "scope")).toBe(false);
    expect(livePastAnalysis(true, null)).toBe(false);
    expect(livePastAnalysis(false, "build")).toBe(false);
  });

  it("marks a live product's items Not used unless their record says they happened", () => {
    // attached as it is live with nothing done: no item claims to be done, whatever the stored step says
    for (const step of ["board", "build", "release"] as const) {
      expect(analystChecklistStates(step, { briefReady: false, understoodConfirmed: false }, NOTHING)).toEqual({
        brief: "skipped", understood: "skipped", questions: "skipped", requirements: "skipped", scope: "skipped",
      });
    }
    // what did happen keeps its real state
    const ready = { briefReady: true, understoodConfirmed: false };
    const notReady = { briefReady: false, understoodConfirmed: false };
    expect(analystChecklistStates("build", ready, NOTHING).brief).toBe("done");
    expect(analystChecklistStates("build", notReady, { ...NOTHING, filesRead: 3 }).understood).toBe("done");
    expect(analystChecklistStates("build", notReady, { ...NOTHING, understoodConfirmed: true }).understood).toBe("done");
    expect(analystChecklistStates("build", notReady, { ...NOTHING, questionsHandled: 2 }).questions).toBe("done");
    expect(analystChecklistStates("build", notReady, { ...NOTHING, requirementsApproved: true }).requirements).toBe("done");
    expect(analystChecklistStates("build", notReady, { ...NOTHING, scopeLocked: true }).scope).toBe("done");
    expect(analystChecklistStates("build", ready, { ...NOTHING, filesRead: 2 })).toEqual({
      brief: "done", understood: "done", questions: "skipped", requirements: "skipped", scope: "skipped",
    });
  });
});
