import { describe, expect, it } from "vitest";
import {
  NEXT_TEXT, answerTitle, blockedText, conflictsText, inMyWords, nextActionFrom, type NextFacts,
} from "../../src/components/analysis-next/next/nextAction";

const brief = (o: Partial<NonNullable<NextFacts["brief"]>> = {}) => ({ missing: 0, canAnswer: true, ...o });
const understood = (o: Partial<NonNullable<NextFacts["understood"]>> = {}) =>
  ({ filesReading: 0, filesFailed: 0, conflicts: 0, confirmed: false, canConfirm: true, ...o });
const questions = (o: Partial<NonNullable<NextFacts["questions"]>> = {}) =>
  ({ open: 0, next: "confirm" as const, readFailed: false, canEdit: true, ...o });
const requirements = (o: Partial<NonNullable<NextFacts["requirements"]>> = {}) =>
  ({ drafting: null, count: 4, blockers: [], openItems: 0, canApprove: true, ...o });
const scope = (o: Partial<NonNullable<NextFacts["scope"]>> = {}) =>
  ({ drafting: false, replanning: false, locked: false, blockers: [], canLock: true, ...o });

const at = (step: NextFacts["step"], more: Partial<NextFacts> = {}): NextFacts => ({ step, loading: false, ...more });

/** Every action the card may show must read calmly: no "AI", no "product manager", never a shout. */
function expectCalm(a: ReturnType<typeof nextActionFrom>) {
  for (const t of [a.title, a.detail, a.blockedBecause ?? "", a.button ?? ""]) {
    expect(t).not.toMatch(/\bAI\b/);
    expect(t).not.toMatch(/product manager/i);
    expect(t).not.toMatch(/!/);
  }
  if (a.working) expect(a.button).toBeNull();
}

describe("next action: loading and outside the analysis", () => {
  it("says a neutral word while the project opens, never an action", () => {
    for (const f of [at(null), at("understanding", { loading: true }), at("scope", { loading: true, scope: scope() })]) {
      const a = nextActionFrom(f);
      expect(a).toEqual({ title: NEXT_TEXT.loading.title, detail: NEXT_TEXT.loading.detail, item: null, button: null, working: true });
      expectCalm(a);
    }
  });

  it("treats a missing group at its own step as still loading", () => {
    expect(nextActionFrom(at("understanding", { brief: brief() })).working).toBe(true);
    expect(nextActionFrom(at("sanitization")).item).toBeNull();
    expect(nextActionFrom(at("requirements")).button).toBeNull();
    expect(nextActionFrom(at("scope")).title).toBe(NEXT_TEXT.loading.title);
  });

  it("says when something could not be read, without an action", () => {
    const a = nextActionFrom(at("requirements", { trouble: true }));
    expect(a).toEqual({ title: NEXT_TEXT.trouble.title, detail: NEXT_TEXT.trouble.detail, item: null, button: null });
  });

  it("waits for the hand-over while the project is in setup", () => {
    const a = nextActionFrom(at("business"));
    expect(a.item).toBeNull();
    expect(a.button).toBeNull();
    expect(a.title).toBe("Not started yet");
  });

  it("points to Software Engineering once the scope is locked", () => {
    for (const step of ["board", "build"] as const) {
      expect(nextActionFrom(at(step, { loading: true }))).toEqual({
        title: "All done here", detail: "The scope is locked. The team is building it in Software Engineering.", item: null, button: null, finished: true,
      });
    }
    expect(nextActionFrom(at("release"))).toEqual({
      title: "All done here", detail: "The scope is locked and built. The rest happens in Release.", item: null, button: null, finished: true,
    });
    expect(nextActionFrom(at("scope", { scope: scope({ locked: true, blockers: ["Add at least one milestone"] }) })).title).toBe("All done here");
  });

  it("never claims a locked scope for an existing product attached as it is live", () => {
    for (const step of ["board", "build", "release"] as const) {
      const a = nextActionFrom(at(step, { attachedLive: true }));
      expect(a).toEqual({
        title: "All done here", detail: "This product came to the Factory as it is live, so there is no analysis to do here.", item: null, button: null, finished: true,
      });
      expect(a.detail).not.toMatch(/scope is locked/);
      expectCalm(a);
    }
  });
});

describe("next action: objective and end users, what I understood", () => {
  it("asks for the objective and the users when either is missing or thin", () => {
    for (const missing of [1, 2]) {
      const a = nextActionFrom(at("understanding", { brief: brief({ missing }), understood: understood({ filesReading: 2 }) }));
      expect(a).toEqual({
        title: "Tell me the objective and who will use it", detail: "Two short answers, then I'll check everything I read.",
        item: "brief", button: "Start",
      });
    }
  });

  it("says who answers when the person may not", () => {
    const a = nextActionFrom(at("understanding", { brief: brief({ missing: 1, canAnswer: false }), understood: understood() }));
    expect(a.item).toBe("brief");
    expect(a.blockedBecause).toBe("The project team answers this.");
  });

  it("works quietly while files are still being read", () => {
    const a = nextActionFrom(at("understanding", { brief: brief(), understood: understood({ filesReading: 1 }) }));
    expect(a).toEqual({ title: "Nothing for you right now", detail: "I'm reading your files…", item: "understood", button: null, working: true });
  });

  it("asks to check what I understood once everything is read (a failed file does not block)", () => {
    for (const filesFailed of [0, 2]) {
      const a = nextActionFrom(at("understanding", { brief: brief(), understood: understood({ filesFailed }) }));
      expect(a).toEqual({
        title: "Check what I understood", detail: "Takes a minute. Then I'll ask a few questions.", item: "understood", button: "Review",
      });
    }
  });

  it("names open disagreements between sources as the reason", () => {
    expect(nextActionFrom(at("understanding", { brief: brief(), understood: understood({ conflicts: 1 }) })).blockedBecause)
      .toBe("One point disagrees between your sources. Settle it before you confirm.");
    expect(nextActionFrom(at("understanding", { brief: brief(), understood: understood({ conflicts: 3 }) })).blockedBecause)
      .toBe("3 points disagree between your sources. Settle them before you confirm.");
  });

  it("says who confirms when the person may not", () => {
    const a = nextActionFrom(at("understanding", { brief: brief(), understood: understood({ canConfirm: false, conflicts: 2 }) }));
    expect(a.blockedBecause).toBe("The project team confirms this.");
    expect(a.button).toBe("Review");
  });

  it("moves on to the questions once confirmed", () => {
    const a = nextActionFrom(at("understanding", { brief: brief(), understood: understood({ confirmed: true }) }));
    expect(a.working).toBe(true);
    expect(a.item).toBe("questions");
    expect(a.detail).toBe("I'm getting my questions ready…");
  });
});

describe("next action: my questions", () => {
  it("counts the open questions exactly", () => {
    expect(nextActionFrom(at("sanitization", { questions: questions({ open: 1 }) }))).toEqual({
      title: "Answer 1 question", detail: "One at a time; you can leave any for later.", item: "questions", button: "Start",
    });
    expect(nextActionFrom(at("sanitization", { questions: questions({ open: 7, next: "answer" }) })).title).toBe("Answer 7 questions");
    expect(answerTitle(2)).toBe("Answer 2 questions");
  });

  it("lets anyone answer while I'm still writing more questions", () => {
    expect(nextActionFrom(at("sanitization", { questions: questions({ open: 2, next: "wait", canEdit: false }) })).button).toBe("Start");
  });

  it("works while I write the questions or the first requirements", () => {
    expect(nextActionFrom(at("sanitization", { questions: questions({ next: "wait" }) })))
      .toEqual({ title: "Nothing for you right now", detail: "I'm writing my questions…", item: "questions", button: null, working: true });
    expect(nextActionFrom(at("sanitization", { questions: questions({ next: "preparing" }) })).detail).toBe("I'm writing the requirements…");
  });

  it("starts the reading (again) when it never ran or stopped", () => {
    const first = nextActionFrom(at("sanitization", { questions: questions({ next: "start" }) }));
    expect(first).toMatchObject({ item: "questions", button: "Start", title: NEXT_TEXT.read.title });
    const again = nextActionFrom(at("sanitization", { questions: questions({ next: "start", readFailed: true }) }));
    expect(again.title).toBe(NEXT_TEXT.readAgain.title);
    expect(nextActionFrom(at("sanitization", { questions: questions({ next: "start", canEdit: false }) })).blockedBecause)
      .toBe("The project team starts the reading.");
  });

  it("continues to the requirements once every question is handled", () => {
    const prepare = nextActionFrom(at("sanitization", { questions: questions({ next: "prepare" }) }));
    expect(prepare).toEqual({ title: "Continue to the requirements", detail: NEXT_TEXT.toRequirements.prepare, item: "questions", button: "Continue" });
    const confirm = nextActionFrom(at("sanitization", { questions: questions({ next: "confirm" }) }));
    expect(confirm.detail).toBe(NEXT_TEXT.toRequirements.confirm);
    expect(nextActionFrom(at("sanitization", { questions: questions({ next: "confirm", canEdit: false }) })).blockedBecause)
      .toBe("The project team confirms this step.");
  });
});

describe("next action: the requirements", () => {
  it("works while I draft or review", () => {
    expect(nextActionFrom(at("requirements", { requirements: requirements({ drafting: "draft", count: 0 }) })))
      .toEqual({ title: "Nothing for you right now", detail: "I'm writing the requirements…", item: "requirements", button: null, working: true });
    expect(nextActionFrom(at("requirements", { requirements: requirements({ drafting: "review" }) })).detail).toBe("I'm reviewing the requirements…");
    expect(nextActionFrom(at("requirements", { requirements: requirements({ count: 0 }) })).working).toBe(true);
  });

  it("asks to approve when nothing blocks (open checklist items only ask 'approve anyway')", () => {
    expect(nextActionFrom(at("requirements", { requirements: requirements({ openItems: 3 }) }))).toEqual({
      title: "Approve the requirements", detail: "Read them through, change anything, then approve.", item: "requirements", button: "Review",
    });
  });

  it("gives the first blocker and how many more", () => {
    const one = nextActionFrom(at("requirements", { requirements: requirements({ blockers: ["Write the objective."] }) }));
    expect(one.blockedBecause).toBe("Write the objective.");
    const three = nextActionFrom(at("requirements", { requirements: requirements({
      blockers: ["2 requirements lack acceptance criteria.", "Add acceptance criteria to the objective.", "Review and approve the interactive product design."],
    }) }));
    expect(three.blockedBecause).toBe("2 requirements lack acceptance criteria, and 2 more.");
    expect(three.button).toBe("Review");
  });

  it("says who approves when the person may not", () => {
    expect(nextActionFrom(at("requirements", { requirements: requirements({ canApprove: false, blockers: ["Write the objective."] }) })).blockedBecause)
      .toBe("The project team approves the requirements.");
  });
});

describe("next action: the scope", () => {
  it("works while I write the scope or re-plan the milestones", () => {
    expect(nextActionFrom(at("scope", { scope: scope({ drafting: true, blockers: ["Include at least one feature"] }) })))
      .toEqual({ title: "Nothing for you right now", detail: "I'm writing the scope…", item: "scope", button: null, working: true });
    expect(nextActionFrom(at("scope", { scope: scope({ replanning: true }) })).detail).toBe("I'm arranging the milestones again…");
  });

  it("asks to lock when the checklist is met", () => {
    const a = nextActionFrom(at("scope", { scope: scope() }));
    expect(a).toMatchObject({ title: "Lock the scope", item: "scope", button: "Review" });
    expect(a.blockedBecause).toBeUndefined();
  });

  it("gives the lock's first open condition, in my own voice", () => {
    const a = nextActionFrom(at("scope", { scope: scope({ blockers: [
      "2 included features have no user stories", "Answer or accept the product manager's question on uptime.",
    ] }) }));
    expect(a.blockedBecause).toBe("2 included features have no user stories, and 1 more.");
    const b = nextActionFrom(at("scope", { scope: scope({ blockers: ["Answer or accept the product manager's questions on uptime and response time."] }) }));
    expect(b.blockedBecause).toBe("Answer or accept my questions on uptime and response time.");
    expectCalm(b);
  });

  it("says who locks when the person may not", () => {
    expect(nextActionFrom(at("scope", { scope: scope({ canLock: false }) })).blockedBecause).toBe("The project team locks the scope.");
  });
});

describe("next action: wording helpers", () => {
  it("joins the first reason with the count of the rest, without repeats", () => {
    expect(blockedText([])).toBeNull();
    expect(blockedText(["Add at least one milestone"])).toBe("Add at least one milestone.");
    expect(blockedText(["A.", "A.", "B"])).toBe("A, and 1 more.");
  });

  it("speaks as the analyst", () => {
    expect(inMyWords("Your product manager is re-planning")).toBe("Your business analyst is re-planning.");
    expect(inMyWords("Answer the product manager's question")).toBe("Answer my question.");
    expect(conflictsText(2)).toMatch(/^2 points disagree/);
  });

  it("never shows a pressuring or off-voice line in any case", () => {
    const cases: NextFacts[] = [
      at(null), at("business"), at("board"), at("requirements", { trouble: true }),
      at("understanding", { brief: brief({ missing: 2 }), understood: understood() }),
      at("understanding", { brief: brief(), understood: understood({ filesReading: 1 }) }),
      at("sanitization", { questions: questions({ open: 4 }) }),
      at("requirements", { requirements: requirements({ blockers: ["Review and approve the generated Figma Make screens."] }) }),
      at("scope", { scope: scope({ blockers: ["Answer or accept the product manager's question on uptime."] }) }),
    ];
    for (const f of cases) expectCalm(nextActionFrom(f));
  });
});
