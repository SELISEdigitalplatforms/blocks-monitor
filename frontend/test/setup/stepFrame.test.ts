// The shared step frame's pure helpers and the Project setup page built on it: chip status, sign-off line, the
// Project setup chips' short labels and values, and the tree with the Project brief pinned on top.
//   npx vitest run --config frontend/test/setup/vitest.config.ts
import { describe, expect, it } from "vitest";
import { chipsLeft, chipsStatus, chipsStatusText, firstName, formatSignOffTime, signOffText } from "../../src/components/step/stepModel";
import { SETUP_CHIP_LABEL, setupChipValue, sharedCount, sharedNoteCount, type SetupFacts } from "../../src/components/business/setupChips";
import { reviewReadOnlyReason } from "../../src/components/setup/agent/reviewReason";
import { SCRATCH_ID, flattenVisible } from "../../src/components/business/treeModel";
import { buildTree } from "../../src/domain/docs";

describe("step frame status", () => {
  it("counts open chips in both shapes (state, or done)", () => {
    expect(chipsLeft([{ state: "done" }, { state: "todo" }, { state: "attention" }, { state: "info" }])).toBe(2);
    expect(chipsLeft([{ done: true }, { done: false }])).toBe(1);
  });
  it("reads Ready, 1 thing left, n things left", () => {
    expect(chipsStatusText([{ done: true }], "Ready for analysis")).toBe("Ready for analysis");
    expect(chipsStatusText([{ done: false }, { done: true }])).toBe("1 thing left");
    expect(chipsStatus([{ state: "todo" }, { state: "todo" }])).toEqual({ tone: "todo", text: "2 things left" });
    expect(chipsStatus([])).toEqual({ tone: "done", text: "Ready" });
  });
  it("writes the sign-off line", () => {
    const at = "2026-10-26T08:45:00.000Z";
    expect(signOffText({ verb: "Analysis started", by: "Sandra Keller", at })).toBe(`Analysis started by Sandra Keller on ${formatSignOffTime(at)}`);
    expect(signOffText({})).toBe("Signed off");
    expect(formatSignOffTime("not a date")).toBe("not a date");
  });
  it("takes the first name", () => {
    expect(firstName(" Anna  Rossi ")).toBe("Anna");
    expect(firstName("")).toBe("");
  });
});

describe("Project setup chips", () => {
  const facts: SetupFacts = { existing: false, repoSaved: false, repoName: "", sharedCount: 8 };
  it("has short labels", () => {
    expect(Object.values(SETUP_CHIP_LABEL)).toEqual(["About", "Code", "Material"]);
  });
  it("shows short values only where they say something", () => {
    expect(setupChipValue("share", facts)).toBe("8");
    expect(setupChipValue("about", facts)).toBe("");
    expect(setupChipValue("where", facts)).toBe("");
    expect(setupChipValue("where", { ...facts, repoSaved: true, repoName: "returns-desk" })).toBe("returns-desk");
    expect(setupChipValue("share", { ...facts, sharedCount: 0 })).toBe("");
  });
});

describe("tree with the Project brief pinned", () => {
  const note = (id: string, folderId: string, title: string, sortOrder: number) =>
    ({ id, folderId, title, sortOrder, isScratch: false, createdDate: "2026-10-01T00:00:00Z" });
  const folder = { id: "f1", parentId: "", name: "Client documents", kind: "other" as const, sortOrder: 1, status: "active" as const, createdDate: "2026-10-01T00:00:00Z" };
  const tree = buildTree([folder], [note("n0", "", "Kick-off", 0), note("brief", "", "Project brief", 5), note("n1", "f1", "Inside", 0)], []);

  it("puts the pinned note first, then the scratch pad, then the rest", () => {
    const rows = flattenVisible(tree, new Set(), null, "brief");
    expect(rows.map((r) => r.id)).toEqual(["brief", SCRATCH_ID, ...tree.roots.filter((n) => n.id !== "brief").map((n) => n.id)]);
    expect(rows.map((r) => r.posInSet)).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.setSize === 4)).toBe(true);
  });
  it("is the old order without a pin (or with a pin that is not a top-level note)", () => {
    const plain = flattenVisible(tree, new Set(), null);
    expect(plain[0].id).toBe(SCRATCH_ID);
    expect(flattenVisible(tree, new Set(), null, "n1").map((r) => r.id)).toEqual(plain.map((r) => r.id));
  });
});

describe("Project setup: the Material count and the read-only findings (QA 31.10 U1)", () => {
  const data = {
    scratch: { id: "s" },
    notes: [{ id: "s" }, { id: "brief", isProjectBrief: true }, { id: "n1" }],
    files: [{ status: "ready" }, { status: "uploading" }],
  };
  it("counts notes with text and ready files, never the Project brief note", () => {
    expect(sharedCount(data, true)).toBe(3);
    expect(sharedCount(data, false)).toBe(2);
    expect(sharedCount({ scratch: { id: "s" }, notes: [{ id: "s" }], files: [] }, true)).toBe(1);
    expect(sharedCount(undefined, true)).toBe(0);
  });
  it("counts the shared notes alone by the same rule (Business Analysis shows them beside the files)", () => {
    expect(sharedNoteCount(data, true)).toBe(2);
    expect(sharedNoteCount(data, false)).toBe(1);
  });
  it("says in plain words why the findings can't be added", () => {
    expect(reviewReadOnlyReason({ inSetup: true, canEdit: true })).toBeNull();
    expect(reviewReadOnlyReason({ inSetup: false, canEdit: true })?.title).toBe("Your project has moved past setup");
    expect(reviewReadOnlyReason({ inSetup: true, canEdit: false })?.title).toMatch(/not add them/);
  });
});
