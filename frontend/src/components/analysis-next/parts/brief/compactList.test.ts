import { describe, expect, it } from "vitest";
import {
  allOpen, checksLabel, commentEntry, commentMode, expandAll, extraActions, extraSource, extraSourceLabel, moveBounds, moveWithinPriority,
  priorityGroups, requirementActions, requirementSource, rowNumber, sameWords, stepsLabel, toggleIn,
} from "./compactList";

const r = (id: string, priority: string) => ({ id, priority });
// the stored order interleaves the priorities (must / nice / later = Must / Should / Could)
const list = [r("a", "nice"), r("b", "must"), r("c", "later"), r("d", "must"), r("e", "nice"), r("f", "must")];

describe("priorityGroups", () => {
  it("groups Must, Should, Could, each in the list's order, numbered across the groups", () => {
    const g = priorityGroups(list);
    expect(g.map((x) => x.priority)).toEqual(["must", "nice", "later"]);
    expect(g.map((x) => x.items.map((i) => `${i.n}${i.item.id}`))).toEqual([["1b", "2d", "3f"], ["4a", "5e"], ["6c"]]);
  });
  it("keeps the numbers when a filter shows one group", () => {
    const g = priorityGroups(list, "nice");
    expect(g).toHaveLength(1);
    expect(g[0].items.map((i) => i.n)).toEqual([4, 5]);
  });
  it("leaves empty groups out", () => {
    expect(priorityGroups([r("a", "must")]).map((x) => x.priority)).toEqual(["must"]);
    expect(priorityGroups([r("a", "must")], "later")).toEqual([]);
    expect(priorityGroups([])).toEqual([]);
  });
  it("counts an unknown priority as Must", () => {
    expect(priorityGroups([r("a", "urgent")])[0]).toMatchObject({ priority: "must", items: [{ n: 1 }] });
  });
});

describe("moveWithinPriority", () => {
  it("swaps with the nearest item of the same priority; the others keep their places", () => {
    expect(moveWithinPriority(list, "d", -1)).toEqual(["a", "d", "c", "b", "e", "f"]);
    expect(moveWithinPriority(list, "d", 1)).toEqual(["a", "b", "c", "f", "e", "d"]);
    expect(moveWithinPriority(list, "a", 1)).toEqual(["e", "b", "c", "d", "a", "f"]);
  });
  it("is null at the group's edge or for an unknown id", () => {
    expect(moveWithinPriority(list, "b", -1)).toBeNull();
    expect(moveWithinPriority(list, "f", 1)).toBeNull();
    expect(moveWithinPriority(list, "c", 1)).toBeNull();
    expect(moveWithinPriority(list, "zz", 1)).toBeNull();
  });
  it("moveBounds says which way an item can go", () => {
    expect(moveBounds(list, "b")).toEqual({ up: false, down: true });
    expect(moveBounds(list, "d")).toEqual({ up: true, down: true });
    expect(moveBounds(list, "c")).toEqual({ up: false, down: false });
  });
});

describe("expanded rows", () => {
  it("toggles one id", () => {
    expect([...toggleIn(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleIn(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
  it("expands the shown rows, then collapses them, leaving hidden rows as they are", () => {
    const open = new Set(["x"]);
    const all = expandAll(["a", "b"], open);
    expect([...all].sort()).toEqual(["a", "b", "x"]);
    expect(allOpen(["a", "b"], all)).toBe(true);
    expect([...expandAll(["a", "b"], all)]).toEqual(["x"]);
    expect(allOpen([], all)).toBe(false);
  });
});

describe("row words", () => {
  it("counts checks and steps, and says when there are none", () => {
    expect(checksLabel(0)).toBe("No checks yet");
    expect(checksLabel(1)).toBe("1 check");
    expect(checksLabel(3)).toBe("3 checks");
    expect(stepsLabel(0)).toBe("No steps yet");
    expect(stepsLabel(1)).toBe("1 step");
    expect(stepsLabel(4)).toBe("4 steps");
  });
  it("numbers rows with two digits", () => {
    expect(rowNumber(3)).toBe("03");
    expect(rowNumber(12)).toBe("12");
  });
  it("shows a detail that only repeats the title once", () => {
    expect(sameWords("Sign in with e-mail.", "sign in with e-mail")).toBe(true);
    expect(sameWords("Sign in with e-mail and a code", "Sign in with e-mail")).toBe(false);
  });
  it("names the source of a requirement and of an extra", () => {
    expect(requirementSource("sanitization")).toBe("analysis");
    expect(requirementSource("suggestion")).toBe("suggestion");
    expect(requirementSource("manual")).toBe("person");
    expect(extraSource({ fromSetup: true, origin: "person" })).toBe("setup");
    expect(extraSource({ fromSetup: false, origin: "engine" })).toBe("draft");
    expect(extraSourceLabel({ fromSetup: false, origin: "engine" }, null)).toBe("From your business analyst's draft");
    expect(extraSourceLabel({ fromSetup: false, origin: "person" }, " Ana ")).toBe("Added by Ana");
    expect(extraSourceLabel({ fromSetup: false, origin: "person" }, null)).toBe("Added by a workspace member");
  });
});

describe("the ⋯ menu", () => {
  it("offers commenting while the step is open and the person may comment", () => {
    expect(commentMode({ commentable: true, canComment: true, stepOpen: true, count: 0 })).toBe("comment");
  });
  it("offers only reading a thread that exists otherwise, and nothing when there is none", () => {
    expect(commentMode({ commentable: true, canComment: false, stepOpen: true, count: 2 })).toBe("view");
    expect(commentMode({ commentable: true, canComment: true, stepOpen: false, count: 1 })).toBe("view");
    expect(commentMode({ commentable: true, canComment: false, stepOpen: true, count: 0 })).toBeNull();
    expect(commentMode({ commentable: false, canComment: true, stepOpen: true, count: 3 })).toBeNull();
  });
  it("gives an editor every action, in order", () => {
    expect(requirementActions({ editable: true, comment: "comment" })).toEqual(["edit", "priority", "checks", "comment", "moveUp", "moveDown", "delete"]);
    expect(extraActions({ editable: true, comment: "comment" })).toEqual(["edit", "comment", "moveUp", "moveDown", "delete"]);
    expect(extraActions({ editable: true, comment: null })).toEqual(["edit", "moveUp", "moveDown", "delete"]);
  });
  it("gives a read-only person nothing they cannot use", () => {
    expect(requirementActions({ editable: false, comment: "comment" })).toEqual(["comment"]);
    expect(requirementActions({ editable: false, comment: "view" })).toEqual(["comment"]);
    expect(requirementActions({ editable: false, comment: null })).toEqual([]);
    expect(extraActions({ editable: false, comment: null })).toEqual([]);
  });
  it("words the comment entry with its count", () => {
    expect(commentEntry("comment", 0)).toEqual({ label: "Comment" });
    expect(commentEntry("comment", 2)).toEqual({ label: "Comments", hint: "2" });
    expect(commentEntry("view", 1)).toEqual({ label: "View comments", hint: "1" });
  });
});
