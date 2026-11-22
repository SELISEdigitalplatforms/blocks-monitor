import { describe, expect, it } from "vitest";
import {
  LIVE_PRODUCT_SAYS, ackText, checklistNote, choiceIndex, followCurrent, itemPart, liveReadLine, myWords, partForQuestion, progressPct, sendsOnEnter,
  whyIAsk,
} from "../../src/components/analysis-next/analyst/analystModel";

describe("business analyst column model", () => {
  it("number keys pick a suggested answer only when there is one and nobody is typing", () => {
    expect(choiceIndex("1", 3)).toBe(0);
    expect(choiceIndex("3", 3)).toBe(2);
    expect(choiceIndex("4", 3)).toBeNull();
    expect(choiceIndex("0", 3)).toBeNull();
    expect(choiceIndex("a", 3)).toBeNull();
    expect(choiceIndex("2", 3, { typing: true })).toBeNull();
    expect(choiceIndex("2", 3, { modifier: true })).toBeNull();
    expect(choiceIndex("1", 0)).toBeNull();
  });

  it("Enter sends, Shift + Enter and composing don't", () => {
    expect(sendsOnEnter({ key: "Enter" })).toBe(true);
    expect(sendsOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(sendsOnEnter({ key: "Enter", isComposing: true })).toBe(false);
    expect(sendsOnEnter({ key: "a" })).toBe(false);
  });

  it("guesses modestly which part an answer feeds", () => {
    expect(partForQuestion("What happens when a payment fails?")).toBe("workflows");
    expect(partForQuestion("Who approves new makers before they can sell?")).toBe("workflows");
    expect(partForQuestion("Who will use it day to day?")).toBe("objective");
    expect(partForQuestion("Should it follow your brand colours?")).toBe("screens");
    expect(partForQuestion("By when do you need the first version?")).toBe("milestones");
    expect(partForQuestion("How will you know the project is a success?")).toBe("success");
    expect(partForQuestion("Do buyers need an account, or can they buy as guests?")).toBe("features");
  });

  it("says why it asks: the source when the record names one, and the part", () => {
    const refs = [{ id: "f1", type: "file", title: "bike-brief.md" }];
    const fromFile = whyIAsk({ question: "What happens when a payment fails?", sourceType: "doc-file", sourceRef: "f1", refs });
    expect(fromFile.part).toBe("workflows");
    expect(fromFile.from).toBe("“bike-brief.md”");
    expect(fromFile.text).toBe("It came up in “bike-brief.md”. Your answer goes into “Workflows, constraints & not included”.");
    expect(whyIAsk({ question: "Do buyers need an account?", sourceType: "doc-file", sourceRef: "gone", refs }).from).toBe("one of your files");
    expect(whyIAsk({ question: "Do buyers need an account?", sourceType: "doc-note" }).from).toBe("your notes");
    const engine = whyIAsk({ question: "Do buyers need an account?", sourceType: "engine" });
    expect(engine.from).toBeNull();
    expect(engine.text).toBe("Your answer goes into “Master features”.");
  });

  it("acknowledges each answer calmly and honestly", () => {
    expect(ackText("answered", { last: false })).toMatch(/^Got it\./);
    expect(ackText("answered", { last: true })).toBe("Got it, thank you.");
    expect(ackText("later", { last: false })).toMatch(/^No problem/);
    expect(ackText("notSure", { last: true })).toMatch(/suggest an answer/);
  });

  it("marks the checklist in small words", () => {
    expect(checklistNote("brief", "done")).toBe("Done");
    expect(checklistNote("scope", "later")).toBe("Later");
    expect(checklistNote("requirements", "now")).toBe("Now");
    expect(checklistNote("questions", "now", { open: 3, answered: 2, deferred: 0 })).toBe("3 left");
    expect(checklistNote("questions", "now", { open: 1, answered: 2, deferred: 0 })).toBe("1 left");
    expect(checklistNote("questions", "now", { open: 0, answered: 2, deferred: 1 })).toBe("Now");
    // a normal project (no live facts) reads the same with null
    expect(checklistNote("understood", "done", undefined, null)).toBe("Done");
    // an earlier item still to do while the questions run says what it waits for, never "Done"
    expect(checklistNote("brief", "open")).toBe("To answer");
    expect(checklistNote("understood", "open")).toBe("To confirm");
  });

  it("follows the item in progress only when the person was on it", () => {
    expect(followCurrent(null, "brief", null)).toBeNull();
    expect(followCurrent("brief", "brief", "brief")).toBeNull();
    expect(followCurrent("brief", "understood", "brief")).toBe("understood");
    expect(followCurrent("brief", "understood", null)).toBeNull();
    expect(followCurrent("questions", "requirements", "brief")).toBeNull();
  });

  it("opens the part each item fills", () => {
    expect(itemPart("brief")).toBe("objective");
    expect(itemPart("requirements")).toBe("features");
    expect(itemPart("scope")).toBe("scope");
  });

  it("fills the thin bar by the questions handled", () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(2, 7)).toBe(29);
    expect(progressPct(9, 7)).toBe(100);
  });

  it("speaks in the analyst's voice", () => {
    expect(myWords("Wait for the MADP draft to finish, or cancel it.")).toBe("Wait for my draft to finish, or cancel it.");
    expect(myWords("The product manager is reading your material")).toBe("Your business analyst is reading your material");
    expect(myWords("Save it first.")).toBe("Save it first.");
  });

  it("never claims a check nobody made on a live product", () => {
    const facts = { understoodConfirmed: false, filesRead: 3 };
    expect(checklistNote("requirements", "skipped")).toBe("Not used");
    expect(checklistNote("scope", "skipped", undefined, facts)).toBe("Not used");
    expect(checklistNote("understood", "done", undefined, facts)).toBe("3 files read");
    expect(checklistNote("understood", "done", undefined, { understoodConfirmed: false, filesRead: 1 })).toBe("1 file read");
    expect(checklistNote("understood", "done", undefined, { understoodConfirmed: true, filesRead: 3 })).toBe("Done");
    expect(checklistNote("brief", "done", undefined, facts)).toBe("Done");
  });

  it("says once, calmly, that a live product had no analysis", () => {
    expect(LIVE_PRODUCT_SAYS).toBe("This product came to the Factory as it is live, so there was no analysis to do. To change it, request a change or a new feature.");
    expect(liveReadLine(1)).toBe("I read one file.");
    expect(liveReadLine(4)).toBe("I read 4 files.");
  });
});
