// The setup details' pure rules: cleaning, validation of op input, stored-field round trip and the brief sections.
import { describe, expect, it } from "vitest";
import {
  BRIEF_SECTIONS, EMPTY_DETAILS, SETUP_LIMITS, briefSectionBodies, carrySetupSections, checkSetupDetails, cleanConstraints, cleanLines,
  cleanMustHaves, detailsFromRow, detailsToFields, extractBriefSections, refreshBriefSections,
} from "../../src/domain/setupDetails";
import { CLIENT_DOCS_FOLDER, findTopFolder, phaseStep, shareSummary } from "../../src/components/setup/shareModel";

describe("cleaning", () => {
  it("lines: trimmed, inner spaces folded, empty and repeated ones dropped (first spelling stays)", () => {
    expect(cleanLines(["  Pay  online ", "", "pay online", "Book\na slot"])).toEqual(["Pay online", "Book a slot"]);
  });
  it("must-haves keep the first priority of a repeat; an unknown priority reads as must", () => {
    expect(cleanMustHaves([{ text: "Book", priority: "could" }, { text: " book ", priority: "must" }, { text: "Pay", priority: "x" as never }]))
      .toEqual([{ text: "Book", priority: "could" }, { text: "Pay", priority: "must" }]);
  });
  it("constraints: one per kind, a picked kind without words stays, an empty 'other' goes", () => {
    expect(cleanConstraints([{ kind: "deadline", text: "1 March" }, { kind: "deadline", text: "2 March" }, { kind: "budget", text: "" }, { kind: "other", text: " " }, { kind: "x" as never, text: "y" }]))
      .toEqual([{ kind: "deadline", text: "1 March" }, { kind: "budget", text: "" }]);
  });
});

describe("checkSetupDetails (op input)", () => {
  it("accepts and cleans each sent detail; unsent details stay out", () => {
    const r = checkSetupDetails({ mustHaves: [{ text: " Book ", priority: "must" }], workflows: ["a", "A"], intendedChanges: "  faster  " });
    expect(r).toEqual({ ok: true, value: { mustHaves: [{ text: "Book", priority: "must" }], workflows: ["a"], intendedChanges: "faster" } });
  });
  it("refuses wrong shapes, extra keys, too many and too long", () => {
    expect(checkSetupDetails({ mustHaves: [{ text: "a", priority: "maybe" }] })).toMatchObject({ ok: false, params: { key: "mustHaves" } });
    expect(checkSetupDetails({ mustHaves: [{ text: "a", priority: "must", extra: 1 }] })).toMatchObject({ ok: false });
    expect(checkSetupDetails({ workflows: "a" })).toMatchObject({ ok: false, params: { key: "workflows" } });
    expect(checkSetupDetails({ constraints: [{ kind: "weather", text: "" }] })).toMatchObject({ ok: false, params: { key: "constraints" } });
    expect(checkSetupDetails({ exclusions: Array.from({ length: SETUP_LIMITS.exclusions + 1 }, (_, i) => `x${i}`) })).toMatchObject({ ok: false, messageKey: "input.tooMany" });
    expect(checkSetupDetails({ workflows: ["x".repeat(SETUP_LIMITS.workflowText + 1)] })).toMatchObject({ ok: false, messageKey: "input.tooLong" });
    expect(checkSetupDetails({ intendedChanges: 5 })).toMatchObject({ ok: false });
  });
});

describe("stored fields", () => {
  it("round trip: what is written reads back the same; broken or missing fields read as empty", () => {
    const d = {
      mustHaves: [{ text: "Book a slot", priority: "must" as const }], workflows: ["Staff log a return"], exclusions: ["No app store app"],
      constraints: [{ kind: "languages" as const, text: "German and French" }], intendedChanges: "Faster booking", changeTags: ["Make it faster"],
    };
    const f = detailsToFields(d);
    expect(Object.keys(f).sort()).toEqual(["IntendedChangeTags", "IntendedChanges", "SetupConstraints", "SetupExclusions", "SetupMustHaves", "SetupWorkflows"]);
    expect(detailsFromRow(f)).toEqual(d);
    expect(detailsFromRow({ SetupMustHaves: "not json", SetupWorkflows: "{}" })).toEqual(EMPTY_DETAILS);
  });
});

describe("the Project brief sections", () => {
  const BRIEF = "## About the project\n\n**Returns Desk**\n\n## Goal\n\nFaster refunds.\n";
  it("appends the sections in order, after what the brief already has", () => {
    const out = refreshBriefSections(BRIEF, briefSectionBodies({
      mustHaves: [{ text: "Pay", priority: "should" }, { text: "Book", priority: "must" }], exclusions: ["No app"], constraints: [{ kind: "budget", text: "" }],
    }));
    expect(out).toBe("## About the project\n\n**Returns Desk**\n\n## Goal\n\nFaster refunds.\n\n## What it must do\n\n- **Must:** Book\n- **Should:** Pay\n\n## Not included\n\n- No app\n\n## Constraints\n\n- **Budget**\n");
  });
  it("replaces a section in place (also under a known alias), keeps the rest, removes an emptied one", () => {
    const body = "## Goal\n\nX.\n\n## Must-haves\n\n- old\n\n## Not included\n\n- old\n\n## Notes\n\nKeep me.\n";
    const out = refreshBriefSections(body, briefSectionBodies({ mustHaves: [{ text: "New", priority: "must" }], exclusions: [] }));
    expect(out).toBe("## Goal\n\nX.\n\n## What it must do\n\n- **Must:** New\n\n## Notes\n\nKeep me.\n");
    expect(refreshBriefSections(out, briefSectionBodies({ mustHaves: [{ text: "New", priority: "must" }] }))).toBe(out);
  });
  it("writes a constraint of no particular kind as its own words, never as \"Something else\" (E2E 08.11)", () => {
    const md = briefSectionBodies({ constraints: [{ kind: "deadline", text: "Before May" }, { kind: "other", text: "Orders close at 10:30" }, { kind: "other", text: "" }] }).constraints;
    expect(md).toBe("- **Deadline**: Before May\n- Orders close at 10:30");
    expect(md).not.toContain("Something else");
  });
  it("approval: a name gives one sentence; not sent leaves the section alone", () => {
    const withOwner = refreshBriefSections(BRIEF, briefSectionBodies({}, { name: "Sandra Keller" }));
    expect(withOwner).toContain(`## ${BRIEF_SECTIONS.approval.heading}\n\nSandra Keller approves the result.`);
    expect(refreshBriefSections(withOwner, briefSectionBodies({ workflows: [] }))).toBe(withOwner);
  });
  it("a rewrite of the brief carries the setup sections over", () => {
    const old = refreshBriefSections(BRIEF, briefSectionBodies({ workflows: ["Staff log a return"] }, { name: "Sandra Keller" }));
    expect(extractBriefSections(old)).toEqual({ workflows: "- Staff log a return", approval: "Sandra Keller approves the result." });
    const rewritten = carrySetupSections(old, "## About the project\n\n**Returns Desk 2**");
    expect(rewritten).toContain("**Returns Desk 2**");
    expect(rewritten).toContain("## Key workflows\n\n- Staff log a return");
    expect(rewritten).toContain("## Approval");
    expect(carrySetupSections("## Goal\n\nX.", "## Goal\n\nY.")).toBe("## Goal\n\nY.");
  });
  it("headings inside a code block are not sections", () => {
    const body = "## Goal\n\n```\n## Not included\n```\n";
    expect(refreshBriefSections(body, briefSectionBodies({ exclusions: ["A"] }))).toBe("## Goal\n\n```\n## Not included\n```\n\n## Not included\n\n- A\n");
  });
});

describe("Share what you already have", () => {
  it("finds the top-level Client documents folder (case and spaces ignored, not one being deleted, not a subfolder)", () => {
    const f = (id: string, name: string, parentId = "", status: "active" | "deleting" = "active") => ({ id, name, parentId, status });
    expect(findTopFolder([f("a", "client documents", "x"), f("b", " Client Documents "), f("c", CLIENT_DOCS_FOLDER)], CLIENT_DOCS_FOLDER)).toBe("b");
    expect(findTopFolder([f("a", CLIENT_DOCS_FOLDER, "", "deleting")], CLIENT_DOCS_FOLDER)).toBeNull();
  });
  it("per-file progress and the summary", () => {
    expect(["queued", "checking", "uploading", "verifying", "done"].map((p) => phaseStep(p as never))).toEqual([0, 1, 2, 3, 4]);
    expect(shareSummary([{ phase: "done" }, { phase: "uploading" }, { phase: "failed" }, { phase: "queued" }])).toEqual({ total: 4, done: 1, busy: 2, failed: 1 });
  });
});
