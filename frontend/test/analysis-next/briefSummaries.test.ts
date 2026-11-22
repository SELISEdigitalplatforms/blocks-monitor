import { describe, expect, it } from "vitest";
import {
  featuresSummary, filesSummary, fingerprintOf, firstSentence, noFilesText, objectiveSummary, rankLabels, requirementRefLabel, requirementsApproved,
  selectFeatureItems, understandingSigned, understoodAnswers, understoodSummary, workflowsSummary, type FeatureItem,
} from "../../src/components/analysis-next/parts/brief/summaries";
import { briefQuestions } from "../../src/domain/projectBrief";

const understood = {
  open: true, loading: false, signed: false, canAct: true,
  about: "A web app where customers book repair slots. They pay online.", objective: "Fewer phone calls", users: "Bike shop customers",
  conflictsOpen: 0, toCheck: 0, reading: 0, sources: ["Your project setup", "brief.pdf", "brief.pdf"], content: 1,
};

describe("summary helpers", () => {
  it("takes the first sentence on one line and clips it", () => {
    expect(firstSentence("A web app where customers book repair slots. They pay online.")).toBe("A web app where customers book repair slots");
    expect(firstSentence("  Line one\nstill one!  Next.")).toBe("Line one still one!");
    expect(firstSentence("")).toBe("");
    expect(firstSentence("x".repeat(200), 20)).toHaveLength(20);
  });
  it("fingerprints content stably and differently", () => {
    expect(fingerprintOf([1, "a"])).toBe(fingerprintOf([1, "a"]));
    expect(fingerprintOf([1, "a"])).not.toBe(fingerprintOf([1, "b"]));
  });
  it("ranks labels by frequency", () => {
    expect(rankLabels(["b", "a", "a", " ", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("what we understood reads the facts every agent reads", () => {
  const q = briefQuestions("Team lunch");
  const none = { name: "Team lunch", goal: "", users: "", asked: [], objectiveStatement: "" };

  it("takes the project's own fields first", () => {
    expect(understoodAnswers({ ...none, goal: "Order lunch for the week in one place", users: "About 25 people and one admin", objectiveStatement: "Drafted" }))
      .toEqual({ objective: "Order lunch for the week in one place", users: "About 25 people and one admin" });
  });

  it("else the answers to the business analyst's own questions", () => {
    const asked = [
      { Question: q.goal, Answer: "Everyone orders lunch for the week in one place", Status: "answered" },
      { Question: q.users, Answer: "About 25 people, one admin", Status: "answered" },
    ];
    expect(understoodAnswers({ ...none, asked, objectiveStatement: "Drafted objective" }))
      .toEqual({ objective: "Everyone orders lunch for the week in one place", users: "About 25 people, one admin" });
  });

  it("shows the drafted objective once there is one, so it never says the objective isn't answered over it", () => {
    // E2E 08.11: "The objective isn't answered yet" stayed after the objective was drafted
    const a = understoodAnswers({ ...none, objectiveStatement: "Team members pick their lunch for the week; the admin sends one list." });
    expect(a.objective).toBe("Team members pick their lunch for the week; the admin sends one list.");
    const s = understoodSummary({ ...understood, objective: a.objective, users: "Team members" });
    expect(s.issues ?? []).not.toContain("The objective isn't answered yet");
    // nothing recorded and nothing drafted: it says so
    expect(understoodAnswers(none)).toEqual({ objective: "", users: "" });
    expect(understoodSummary({ ...understood, objective: "", users: "" }).issues)
      .toEqual(expect.arrayContaining(["The objective isn't answered yet", "Who will use it isn't answered yet"]));
  });
});

describe("what we understood", () => {
  it("is not started before its step", () => {
    expect(understoodSummary({ ...understood, open: false }).status).toBe("not-started");
  });
  it("is a draft with the first sentence and source chips", () => {
    const s = understoodSummary(understood);
    expect(s).toMatchObject({ status: "draft", summary: "A web app where customers book repair slots", sources: ["brief.pdf", "Project setup"] });
    expect(s.issues).toBeUndefined();
  });
  it("needs you for missing answers, disagreements and found items", () => {
    const s = understoodSummary({ ...understood, users: "", conflictsOpen: 2, toCheck: 3 });
    expect(s.status).toBe("needs-you");
    expect(s.issues).toEqual(["Who will use it isn't answered yet", "2 points disagree between your sources", "3 found items to confirm or set aside"]);
  });
  it("stays a draft for someone who can't act, and is confirmed once signed", () => {
    expect(understoodSummary({ ...understood, toCheck: 1, canAct: false }).status).toBe("draft");
    expect(understoodSummary({ ...understood, toCheck: 1, signed: true })).toMatchObject({ status: "confirmed", issues: undefined });
  });
  it("shows a quiet loading row", () => {
    expect(understoodSummary({ ...understood, loading: true })).toMatchObject({ loading: true });
  });
});

describe("files", () => {
  const files = [
    { fileId: "1", name: "a.pdf", status: "ready", observationCount: 2 },
    { fileId: "2", name: "b.pdf", status: "ready", observationCount: 0 },
    { fileId: "3", name: "c.docx", status: "processing", observationCount: 0 },
    { fileId: "4", name: "d.pdf", status: "failed", observationCount: 0 },
  ];
  const base = { open: true, loading: false, error: false, signed: false, canAct: true, files };
  it("counts read, reading and failed files", () => {
    const s = filesSummary(base);
    expect(s.summary).toBe("2 files read · 1 still reading · 1 couldn't be read");
    expect(s.status).toBe("needs-you");
    expect(s.sources).toEqual(["a.pdf", "b.pdf", "c.docx", "d.pdf"]);
    expect(s.issues).toEqual(["One file is still being read", "One file needs another try"]);
  });
  it("is a draft while files are only being read, confirmed once signed", () => {
    expect(filesSummary({ ...base, files: files.slice(0, 3) }).status).toBe("draft");
    expect(filesSummary({ ...base, signed: true }).status).toBe("confirmed");
  });
  it("says when no file was shared", () => {
    expect(filesSummary({ ...base, files: [] }).summary).toMatch(/^No files shared/);
  });
  it("counts the shared notes as Project setup does, so a shared note never reads as nothing shared (E2E 08.11)", () => {
    expect(filesSummary({ ...base, files: [], notes: 1 }).summary).toBe("1 note shared, no files. What we know comes from your note and your project setup.");
    expect(filesSummary({ ...base, files: [], notes: 2 }).summary).toBe("2 notes shared, no files. What we know comes from your notes and your project setup.");
    expect(filesSummary({ ...base, files: [], notes: 0 }).summary).toBe("No files shared. What we know comes from your project setup.");
    expect(filesSummary({ ...base, files: files.slice(0, 2), notes: 1 }).summary).toBe("2 files read · 1 note shared");
    expect(filesSummary({ ...base, files: [], notes: 1, signed: true })).toMatchObject({ status: "skipped", summary: "1 note and no files were shared for this project." });
    expect(filesSummary({ ...base, files: [], signed: true }).summary).toBe("No files were shared for this project.");
    expect(noFilesText(1)).toBe("1 note shared, no files");
    expect(noFilesText(0)).toBe("No files shared");
  });
  it("changes its fingerprint when a file's status changes", () => {
    const after = files.map((f) => (f.fileId === "3" ? { ...f, status: "ready" } : f));
    expect(filesSummary({ ...base, files: after }).fingerprint).not.toBe(filesSummary(base).fingerprint);
  });
});

describe("objective", () => {
  const base = { open: true, loading: false, approved: false, canAct: true, text: "Customers book a repair slot online without calling. More text.", criteria: ["Half the calls"], origin: "engine" };
  it("shows the first sentence, as a draft", () => {
    expect(objectiveSummary(base)).toMatchObject({ status: "draft", summary: "Customers book a repair slot online without calling", sources: ["From your answers"] });
  });
  it("needs you when missing or without a check", () => {
    expect(objectiveSummary({ ...base, text: "" })).toMatchObject({ status: "needs-you", issues: ["Write the objective"] });
    expect(objectiveSummary({ ...base, criteria: [" "] })).toMatchObject({ status: "needs-you", issues: ["Add how we'll know it worked"] });
  });
  it("is confirmed once the requirements are approved", () => {
    expect(objectiveSummary({ ...base, approved: true }).status).toBe("confirmed");
  });
});

describe("master features", () => {
  const req = (id: string, extra: Partial<FeatureItem> = {}): FeatureItem => ({ id, title: id, priority: "must", criteria: ["works"], status: "draft", sourceRefs: [], ...extra });
  const known = { files: new Map([["f1", "brief.pdf"]]), answers: new Set(["c1"]) };
  const base = { open: true, loading: false, approved: false, canAct: true, openSuggestions: 0, known };
  it("labels where a requirement comes from", () => {
    expect(requirementRefLabel("manual:u1", known)).toBe("Added by your team");
    expect(requirementRefLabel("suggestion:s1", known)).toBe("Accepted suggestion");
    expect(requirementRefLabel("f1", known)).toBe("brief.pdf");
    expect(requirementRefLabel("file:f1", known)).toBe("brief.pdf");
    expect(requirementRefLabel("c1", known)).toBe("Your answers");
    expect(requirementRefLabel("zz", known)).toBe("Your project material");
  });
  it("counts features and what is still to confirm", () => {
    const s = featuresSummary({ ...base, openSuggestions: 2, requirements: [req("a", { sourceRefs: ["f1", "c1"] }), req("b", { sourceRefs: ["c1"] })] });
    expect(s.summary).toBe("2 master features · 2 still to confirm");
    expect(s.status).toBe("needs-you");
    expect(s.sources).toEqual(["Your answers", "brief.pdf"]);
  });
  it("names requirements without a check", () => {
    const s = featuresSummary({ ...base, requirements: [req("a"), req("b", { criteria: [] }), req("c", { criteria: [], priority: "nice" })] });
    expect(s.issues).toEqual(["2 requirements have no check yet"]);
  });
  it("is a draft when nothing waits, confirmed once approved", () => {
    expect(featuresSummary({ ...base, requirements: [req("a")] }).status).toBe("draft");
    expect(featuresSummary({ ...base, approved: true, requirements: [req("a")] })).toMatchObject({ status: "confirmed", issues: undefined });
  });
  it("reads the rows with their source refs, active only", () => {
    const items = selectFeatureItems([
      { ItemId: "2", Title: "B", Status: "draft", SortOrder: 2, SourceRefs: ["c1"], AcceptanceCriteria: ["x"], Priority: "nice" },
      { ItemId: "1", Title: "A", Status: "confirmed", SortOrder: 1, Priority: "weird" },
      { ItemId: "3", Title: "C", Status: "dropped", SortOrder: 0 },
    ]);
    expect(items.map((i) => [i.id, i.priority, i.sourceRefs])).toEqual([["1", "must", []], ["2", "nice", ["c1"]]]);
  });
});

describe("workflows", () => {
  it("counts the three lists and their origins", () => {
    const s = workflowsSummary({
      open: true, loading: false, approved: false,
      items: [
        { id: "1", kind: "workflow", title: "Book", who: "Customer", steps: [], origin: "setup" },
        { id: "2", kind: "constraint", title: "GDPR", who: "", steps: [], origin: "engine" },
        { id: "3", kind: "exclusion", title: "App", who: "", steps: [], origin: "engine" },
      ],
    });
    expect(s).toMatchObject({ status: "draft", summary: "1 workflow · 1 constraint · 1 not included", sources: ["Your business analyst", "Project setup"] });
  });
});

describe("sign-off rules", () => {
  it("reads the understanding as signed once confirmed or moved past the questions", () => {
    expect(understandingSigned({ confirmedAt: "2026-11-08" }, "understanding")).toBe(true);
    expect(understandingSigned(null, "sanitization")).toBe(false);
    expect(understandingSigned(null, "requirements")).toBe(true);
  });
  it("reads the requirements as approved once stored or moved on", () => {
    expect(requirementsApproved("requirements", null)).toBe(false);
    expect(requirementsApproved("requirements", "2026-11-08")).toBe(true);
    expect(requirementsApproved("scope", null)).toBe(true);
  });
});
