// Pure rules of Goals & requirements: Must / Should / Could, the step frame's checklist and status, and the key
// workflows / not included / constraints lists (cleaning, the setup answers as items, rows as records).
import { describe, expect, it } from "vitest";
import {
  countPriorities, filterByPriority, groupByPriority, priorityLine, toStoredPriority, PRIORITY_WORD,
} from "../../src/components/requirements/priority";
import { goalsChips, goalsStatus, lookAndFeelState, nowItems, type NowInput } from "../../src/components/requirements/goalsNow";
import { extraProblem, linesOf } from "../../src/components/requirements/extrasForm";
import { extraTitle } from "../../src/components/requirements/WorkflowsTab";
import { mergeExtraRows } from "../../src/blocks/requirements/extrasMutations";
import {
  checkExtra, constraintTag, constraintText, extraFromRow, extrasFromSetup, freeConstraintKinds, groupExtras, setupRecords, workflowFromLine,
} from "../../src/domain/requirementsExtras";

describe("priorities", () => {
  it("shows the stored values as Must / Should / Could and maps setup words onto them", () => {
    expect(PRIORITY_WORD).toEqual({ must: "Must", nice: "Should", later: "Could" });
    expect(["must", "should", "could", "nice", "later", "x", undefined].map(toStoredPriority)).toEqual(["must", "nice", "later", "nice", "later", "must", "must"]);
  });
  it("counts, filters and groups (Must first, order kept, empty groups left out)", () => {
    const list = [{ id: 1, priority: "later" }, { id: 2, priority: "must" }, { id: 3, priority: "later" }, { id: 4, priority: "must" }];
    const c = countPriorities(list);
    expect(c).toEqual({ must: 2, nice: 0, later: 2 });
    expect(priorityLine(c)).toBe("2 must · 2 could");
    expect(priorityLine({ must: 0, nice: 0, later: 0 })).toBe("");
    expect(filterByPriority(list, "later").map((r) => r.id)).toEqual([1, 3]);
    expect(filterByPriority(list, "all")).toHaveLength(4);
    expect(groupByPriority(list).map((g) => [g.priority, g.items.map((r) => r.id)])).toEqual([["must", [2, 4]], ["later", [1, 3]]]);
  });
});

const base: NowInput = {
  objective: { text: "Employers report hours online", criteria: ["Reports arrive by the 15th"] },
  priorities: { must: 3, nice: 1, later: 0 }, workflows: 2, exclusions: 1, constraints: 0, openComments: 1,
};

describe("the checklist of the step", () => {
  it("has six items in order, each done from the live counts", () => {
    const items = nowItems(base);
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ["goal", true], ["musts", true], ["workflows", true], ["exclusions", true], ["constraints", false], ["comments", false],
    ]);
    expect(items[1].detail).toBe("3 must · 1 should");
    expect(items[5].detail).toBe("1 comment thread still open");
  });
  it("a goal needs its words and a way to know it worked; must-haves need at least one Must", () => {
    expect(nowItems({ ...base, objective: null })[0]).toMatchObject({ done: false, detail: "Write what the product should achieve" });
    expect(nowItems({ ...base, objective: { text: "X", criteria: [" "] } })[0]).toMatchObject({ done: false, detail: "Add how you'll know it's reached" });
    expect(nowItems({ ...base, priorities: { must: 0, nice: 2, later: 0 } })[1]).toMatchObject({ done: false, detail: "Mark at least one requirement as Must" });
  });
  it("as the frame's chips: short labels and values, comments need attention", () => {
    const chips = goalsChips(nowItems(base), base);
    expect(chips.map((c) => [c.label, c.state, c.value])).toEqual([
      ["Goal", "done", "agreed"], ["Must-haves", "done", "3 must"], ["Workflows", "done", "2"], ["Not included", "done", "1"],
      ["Constraints", "todo", ""], ["Comments", "attention", "1 open"],
    ]);
  });
  it("the one-line status", () => {
    const s = (o: Partial<Parameters<typeof goalsStatus>[0]>) => goalsStatus({ approved: false, drafting: null, left: 0, blockers: 0, requirements: 3, ...o }).text;
    expect(s({ approved: true })).toBe("Approved");
    expect(s({ drafting: "draft" })).toBe("Your business analyst is drafting");
    expect(s({ requirements: 0 })).toMatch(/^Waiting for the first draft/);
    expect(s({})).toBe("Ready to approve");
    expect(s({ left: 2 })).toBe("Review the draft, then approve");
  });
});

describe("workflows, not included, constraints", () => {
  it("checks an item: kind, words, limits; a constraint kind may stand alone, 'other' needs words", () => {
    expect(checkExtra({ kind: "workflow", title: "  Approve  leave ", who: " Team lead ", steps: ["Ask", "", "ask", "Approve"] }))
      .toEqual({ ok: true, value: { kind: "workflow", title: "Approve leave", who: "Team lead", steps: ["Ask", "Approve"], constraintKind: "" } });
    expect(checkExtra({ kind: "exclusion", title: "No app", who: "ignored", steps: ["x"] })).toEqual({ ok: true, value: { kind: "exclusion", title: "No app", who: "", steps: [], constraintKind: "" } });
    expect(checkExtra({ kind: "constraint", title: "", constraintKind: "deadline" })).toMatchObject({ ok: true });
    expect(checkExtra({ kind: "constraint", title: "", constraintKind: "other" })).toMatchObject({ ok: false, field: "title", reason: "required" });
    expect(checkExtra({ kind: "constraint", title: "x", constraintKind: "weather" })).toMatchObject({ ok: false, field: "constraintKind" });
    expect(checkExtra({ kind: "feature", title: "x" })).toMatchObject({ ok: false, field: "kind" });
    expect(checkExtra({ kind: "exclusion", title: "x".repeat(301) })).toMatchObject({ ok: false, reason: "too_long" });
    expect(checkExtra({ kind: "workflow", title: "x", steps: Array.from({ length: 21 }, (_, i) => `s${i}`) })).toMatchObject({ ok: false, field: "steps", reason: "too_many" });
  });
  it("reads a setup line as a workflow: who before a short colon, steps at arrows or semicolons", () => {
    expect(workflowFromLine("Employee: asks for days off → team lead approves → payroll sees it")).toEqual({
      title: "Employee: Asks for days off", who: "Employee", steps: ["Asks for days off", "Team lead approves", "Payroll sees it"],
    });
    expect(workflowFromLine("The dispatcher plans the day from the dock plan")).toEqual({ title: "The dispatcher plans the day from the dock plan", who: "", steps: [] });
  });
  it("turns the setup answers into items with stable ids, in kind order", () => {
    const setup = { workflows: ["Buyer: opens last order; sends it"], exclusions: ["No payments"], constraints: [{ kind: "deadline" as const, text: "1 March" }, { kind: "languages" as const, text: "" }] };
    expect(extrasFromSetup(setup).map((e) => [e.kind, e.title, e.constraintKind])).toEqual([
      ["workflow", "Buyer: Opens last order", ""], ["exclusion", "No payments", ""], ["constraint", "1 March", "deadline"], ["constraint", "", "languages"],
    ]);
    expect(setupRecords(setup).map((r) => r.id)).toEqual(["setup:workflow:1", "setup:exclusion:1", "setup:constraint:1", "setup:constraint:2"]);
    expect(setupRecords(setup).every((r) => r.fromSetup && r.origin === "setup")).toBe(true);
  });
  it("reads rows (removed ones and unknown kinds left out) and groups them in their order", () => {
    const rows = [
      { ItemId: "a", Kind: "exclusion", Title: "B", SortOrder: 2, Status: "active", Origin: "engine" },
      { ItemId: "b", Kind: "exclusion", Title: "A", SortOrder: 1, Status: "active" },
      { ItemId: "c", Kind: "exclusion", Title: "gone", SortOrder: 3, Status: "removed" },
      { ItemId: "d", Kind: "note", Title: "?" },
      { ItemId: "e", Kind: "constraint", Title: "x", ConstraintKind: "weird" },
    ];
    const recs = rows.map(extraFromRow).filter((r) => r !== null);
    expect(recs.map((r) => r!.id)).toEqual(["a", "b", "e"]);
    expect(recs[1]!.origin).toBe("person");
    expect(recs[2]!.constraintKind).toBe("other");
    expect(groupExtras(recs as never).exclusion.map((r) => r.title)).toEqual(["A", "B"]);
  });
  it("words and free kinds of constraints", () => {
    expect(constraintText({ constraintKind: "deadline", title: "1 March" })).toBe("Deadline: 1 March");
    expect(constraintText({ constraintKind: "budget", title: "" })).toBe("Budget");
    expect(constraintText({ constraintKind: "other", title: "Offline first" })).toBe("Offline first");
    expect(freeConstraintKinds([{ constraintKind: "deadline" }, { constraintKind: "other" }])).toEqual(["budget", "compliance", "languages", "integrations", "other"]);
  });
  it("lists a constraint of no particular kind by its own words, never as \"Something else\" (E2E 08.11)", () => {
    expect(constraintTag("other")).toBe("");
    expect(constraintTag("")).toBe("");
    expect(constraintTag("deadline")).toBe("Deadline");
    expect(extraTitle({ kind: "constraint", constraintKind: "other", title: "Orders close at 10:00 each working day" })).toBe("Orders close at 10:00 each working day");
    expect(extraTitle({ kind: "constraint", constraintKind: "budget", title: "About CHF 90 000" })).toBe("Budget: About CHF 90 000");
    expect(extraTitle({ kind: "workflow", constraintKind: "", title: "Approve leave" })).toBe("Approve leave");
  });
  it("the form's own check and lines", () => {
    const v = { title: "", who: "", steps: [], constraintKind: "other" as const };
    expect(extraProblem("workflow", v)).toBe("Name the workflow.");
    expect(extraProblem("constraint", { ...v, constraintKind: "deadline" })).toBeNull();
    expect(extraProblem("workflow", { ...v, title: "x", steps: ["y".repeat(301)] })).toMatch(/Each step/);
    expect(linesOf(" a \n\n b ")).toEqual(["a", "b"]);
  });
  it("merges an answer's rows into the cached list by id, in SortOrder", () => {
    const old = [{ ItemId: "a", SortOrder: 1, Title: "A" }, { ItemId: "b", SortOrder: 2, Title: "B" }];
    expect(mergeExtraRows(old, [{ ItemId: "b", SortOrder: 0, Title: "B2" }, { ItemId: "c", SortOrder: 3 }])!.map((r) => [r.ItemId, r.Title])).toEqual([["b", "B2"], ["a", "A"], ["c", undefined]]);
    expect(mergeExtraRows(undefined, [{ ItemId: "x" }])).toBeUndefined();
  });
});

describe("the product manager's draft (local engine)", async () => {
  const { plannedExtras } = await import("../../server/local/engine/kinds/analysis/extras");
  const runOf = (project: Record<string, unknown>, existing: unknown[] = []) =>
    ({ p: { project, rows: (s: string) => (s === "RequirementExtra" ? existing : []) } }) as never;
  it("plans the setup answers as the lists, numbered per kind, only while the project has none", () => {
    const project = { ItemId: "p", SetupExclusions: JSON.stringify(["No app", "No payments"]), SetupConstraints: JSON.stringify([{ kind: "budget", text: "CHF 90 000" }]) };
    expect(plannedExtras(runOf(project)).map((e) => [e.kind, e.at, e.title])).toEqual([["exclusion", 1, "No app"], ["exclusion", 2, "No payments"], ["constraint", 1, "CHF 90 000"]]);
    expect(plannedExtras(runOf(project, [{ ItemId: "x" }]))).toEqual([]);
    expect(plannedExtras(runOf({ ItemId: "p" }))).toEqual([]);
  });
  it("adds what the material says after the setup's items, without repeating them", () => {
    const project = { ItemId: "p", SetupExclusions: JSON.stringify(["No payments"]) };
    const ai = [
      { kind: "exclusion" as const, title: "No payments", who: "", steps: [], constraintKind: "" as const },
      { kind: "exclusion" as const, title: "Coupons", who: "", steps: [], constraintKind: "" as const },
      { kind: "constraint" as const, title: "EUR only at launch", who: "", steps: [], constraintKind: "other" as const },
    ];
    expect(plannedExtras(runOf(project), ai).map((e) => [e.kind, e.at, e.title, e.origin])).toEqual([
      ["exclusion", 1, "No payments", "setup"], ["exclusion", 2, "Coupons", "engine"], ["constraint", 1, "EUR only at launch", "engine"],
    ]);
  });
});

describe("the look & feel in the requirements document", () => {
  it("requires separate screen approval, never a manual description or sample", () => {
    const words = "Clean and calm, large buttons for people on the go.";
    expect(lookAndFeelState({ mode: "figma", instructions: words, status: "draft" }, 0)).toMatchObject({ tag: null, approvable: false });
    expect(lookAndFeelState({ mode: "figma", instructions: words, status: "confirmed" }, 0)).toMatchObject({ tag: "Agreed", approvable: false });
    expect(lookAndFeelState({ mode: "describe", instructions: "Blue", status: "draft" }, 0)).toMatchObject({ approvable: false, tag: null });
    expect(lookAndFeelState({ mode: "sample", instructions: "", status: "draft" }, 2)).toMatchObject({ samples: 0, approvable: false });
    expect(lookAndFeelState({ mode: "sample", instructions: "", status: "draft" }, 0)).toMatchObject({ approvable: false, empty: true });
    const none = lookAndFeelState(null, 0);
    expect(none).toMatchObject({ approvable: false, empty: true, tag: null });
    expect(none.text).toMatch(/Figma Make screens automatically/);
    expect(lookAndFeelState(null, 0, true).text).toMatch(/first requirements are ready/);
    for (const t of [none.text, lookAndFeelState(null, 0, true).text]) expect(t).not.toMatch(/instruction|design brief/i);
  });
});

describe("open questions: the owner is a name, never an id (QA 31.10 U4)", () => {
  it("shows the member's name, You, a plain-word owner as given, or nothing", async () => {
    const { ownerShown } = await import("../../src/components/requirements/ownerName");
    const id = "9db24c71-039a-431f-b87f-debdcea1c4be";
    expect(ownerShown(id, { selfId: null, name: "Anna Rossi" })).toBe("Anna Rossi");
    expect(ownerShown(id, { selfId: id.toUpperCase(), name: "" })).toBe("You");
    expect(ownerShown(id, { selfId: null, name: "" })).toBe("");
    expect(ownerShown(id, { selfId: null, name: id })).toBe("");
    expect(ownerShown("Product manager", { selfId: null, name: "" })).toBe("Product manager");
  });
});
