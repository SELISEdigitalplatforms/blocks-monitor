// Step 4 as a client meets it: the Features chip names what is open in a few words, a finished job's "Done" line does
// not linger for days, the lock reason says who signs off, and the approvals editor starts production with the QA step
// a production release needs.
import { describe, expect, it } from "vitest";
import { lockChecklist } from "../../src/components/scope/blocks/pageState";
import { jobWorthShowing, nowChecklist } from "../../src/components/scope/blocks/nowChecklist";
import { LOCK_BY_TEAM, lockDisabledReason } from "../../src/components/scope/blocks/LockCard";
import { approvalsSummary } from "../../src/components/scope/blocks/ApprovalsEntry";
import { scopeName, versionLine } from "../../src/components/scope/blocks/ScopeHeader";
import { lockDialogTitle } from "../../src/components/scope/blocks/LockDialog";
import { PrintBody, scopeVersionText } from "../../src/components/scope/blocks/BlocksScopePrint";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editorDraftFrom, stepMissingApprovers } from "../../src/components/approvals/approvalsUi";
import { policyGaps } from "../../src/domain/promotion";
import { emptyTargets } from "../../src/domain/successTargets";

const f = (id: string, priority = "must") => ({ id, ref: `feature:${id}`, priority });
const s = (featureId: string) => ({ featureId, text: "As a buyer I can order" });

const now = (lockItems: ReturnType<typeof lockChecklist>) => nowChecklist({
  lockItems, counts: { features: 2, stories: 2, milestones: 1 },
  screens: { count: 0, reviewedAt: null, reviewedBy: null, designing: false }, success: emptyTargets(),
  openComments: { threads: 0, comments: 0 }, approvals: { loading: false, stage: false, production: false },
});

describe("the Features chip value", () => {
  it("names the open condition in a few words", () => {
    const unplaced = lockChecklist([f("a"), f("b")], [s("a"), s("b")], [{ featureRefs: ["feature:a"] }]);
    expect(now(unplaced)[0]).toMatchObject({ done: false, short: "1 not in a milestone", detail: "1 included feature is not in a milestone" });
    const noStories = lockChecklist([f("a"), f("b")], [s("a")], [{ featureRefs: ["feature:a", "feature:b"] }]);
    expect(now(noStories)[0]!.short).toBe("1 without stories");
    const noMilestones = lockChecklist([f("a")], [s("a")], []);
    expect(now(noMilestones)[0]!.short).toBe("no milestones yet");
    const empty = lockChecklist([f("a")], [s("a")], [{ featureRefs: ["feature:a"] }, { featureRefs: [] }]);
    expect(now(empty)[0]!.short).toBe("1 empty milestone");
  });

  it("reads the counts once everything is in place", () => {
    const ok = lockChecklist([f("a"), f("b")], [s("a"), s("b")], [{ featureRefs: ["feature:a", "feature:b"] }]);
    expect(now(ok)[0]).toMatchObject({ done: true, short: "2 · 1 milestone" });
  });
});

describe("job status lines", () => {
  const at = Date.parse("2026-10-26T10:00:00Z");
  it("show while running, failed or just finished; not an old success", () => {
    expect(jobWorthShowing(null)).toBeNull();
    expect(jobWorthShowing({ status: "running", finishedAt: null }, at)).not.toBeNull();
    expect(jobWorthShowing({ status: "failed", finishedAt: "2026-10-20T10:00:00Z" }, at)).not.toBeNull();
    expect(jobWorthShowing({ status: "succeeded", finishedAt: "2026-10-26T09:58:00Z" }, at)).not.toBeNull();
    expect(jobWorthShowing({ status: "succeeded", finishedAt: "2026-10-23T09:58:00Z" }, at)).toBeNull();
    expect(jobWorthShowing({ status: "succeeded", finishedAt: null }, at)).toBeNull();
  });
});

describe("the lock and the approvals", () => {
  it("someone without the lock permission is told who signs off", () => {
    expect(lockDisabledReason(false, [])).toBe(LOCK_BY_TEAM);
    expect(LOCK_BY_TEAM).not.toMatch(/viewer/i);
    expect(lockDisabledReason(true, [{ key: "placed", ok: false, text: "1 included feature is not in a milestone" }])).toBe("1 included feature is not in a milestone");
    expect(lockDisabledReason(true, [{ key: "placed", ok: true, text: "Every included feature is in a milestone" }])).toBeNull();
  });

  it("a new production policy already has the QA step a production release needs", () => {
    const prod = editorDraftFrom(null, "production");
    expect(prod.steps.map((x) => x.type)).toEqual(["architect", "security", "qa"]);
    expect(policyGaps("production", prod)).toEqual([]);
    const stage = editorDraftFrom(null, "stage");
    expect(stage.steps.find((x) => x.type === "qa")?.required).toBe(false);
    expect(policyGaps("stage", stage)).toEqual([]);
  });

  it("with one active member, the suggestion already ticks that person; with more, nobody", () => {
    const one = editorDraftFrom(null, "production", ["u1"]);
    expect(one.steps.every((x) => x.approverUserIds.join() === "u1")).toBe(true);
    expect(stepMissingApprovers("production", one.steps)).toBeNull();
    const two = editorDraftFrom(null, "stage", ["u1", "u2"]);
    expect(two.steps.every((x) => x.approverUserIds.length === 0)).toBe(true);
    expect(stepMissingApprovers("stage", two.steps)).toBe(0);
    // an optional step without approvers is not pointed at
    expect(stepMissingApprovers("stage", [{ type: "architect", required: true, approverUserIds: ["u1"] }, { type: "security", required: true, approverUserIds: ["u1"] }, { type: "qa", required: false, approverUserIds: [] }])).toBeNull();
  });

  it("the summary speaks of staging and production", () => {
    expect(approvalsSummary(null)).toBe("Staging: not set up yet · Production: not set up yet");
  });
});

describe("plain words on the scope step (UI pass 31.10)", () => {
  it("names the scope without a made-up version number or a bare 'v'", () => {
    expect(scopeName(null)).toBe("Scope");
    expect(scopeName(undefined)).toBe("Scope");
    expect(scopeName(1)).toBe("Scope");
    expect(scopeName(2)).toBe("Scope version 2");
    const name = () => "Anna Rossi";
    expect(versionLine({ number: 1, status: "draft", updatedAt: null }, name)).toBe("Scope · draft");
    expect(versionLine({ number: 3, status: "locked", lockedAt: null, lockedByUserId: "u1" }, name)).toBe("Scope version 3 · locked by Anna Rossi");
    expect(versionLine(null, name)).toBe("Scope · not saved yet");
    expect(lockDialogTitle(1, 3)).toBe("Lock the scope and its 3 milestones?");
    expect(lockDialogTitle(2, 1)).toBe("Lock scope version 2 and its 1 milestone?");
    expect(scopeVersionText(null)).toBe("Not started");
    expect(scopeVersionText(1)).toBe("First version");
    expect(scopeVersionText(4)).toBe("Version 4");
    for (const t of [scopeName(1), scopeName(7), versionLine({ number: 2, status: "draft" }, name), lockDialogTitle(1, 2), scopeVersionText(2)]) {
      expect(t).not.toMatch(/\bv\d|Gate/);
    }
  });

  it("the approvals card shows only what is saved, and who approves by name (never an id)", () => {
    const step = (type: "architect" | "security" | "qa", ids: string[]) => ({ id: `s-${type}`, type, required: true, approverUserIds: ids });
    const names: Record<string, string> = { u1: "Anna Rossi", u2: "Ben Okafor" };
    const nameOf = (id: string) => names[id] ?? "Former member";
    const saved = { stage: { id: "p1", environment: "stage" as const, steps: [step("architect", ["u1"]), step("security", ["u1", "u2"])] }, production: null };
    expect(approvalsSummary(saved, nameOf)).toBe("Staging: Anna Rossi, Ben Okafor · Production: not set up yet");
    const nobody = { stage: { id: "p1", environment: "stage" as const, steps: [step("architect", []), step("security", [])] }, production: null };
    expect(approvalsSummary(nobody, nameOf)).toBe("Staging: architect, security (no approver chosen yet) · Production: not set up yet");
    expect(approvalsSummary({ stage: "unreadable", production: null }, nameOf)).toBe("Staging: couldn't be read · Production: not set up yet");
    expect(approvalsSummary(saved, nameOf)).not.toMatch(/u1|u2/);
  });
});

describe("the scope document lists names, never raw references", () => {
  it("a milestone's feature that is not read is left out instead of showing its ref", () => {
    const html = renderToStaticMarkup(createElement(PrintBody, {
      job: { type: "scope" },
      data: {
        projectName: "Asset market", objective: null, versionNumber: 1,
        features: [{ id: "f1", ref: "feature:upload", name: "Creator upload", priority: "must" }],
        stories: [], screens: [],
        milestones: [{ id: "m1", number: 1, name: "First release", featureRefs: ["feature:upload", "feature:9db24c71-039a"] }],
      },
    }));
    expect(html).toContain("Creator upload");
    expect(html).toContain("First version");
    expect(html).not.toContain("9db24c71");
    expect(html).not.toContain("feature:");
  });
});
