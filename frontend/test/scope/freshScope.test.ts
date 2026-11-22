// UI pass 31.10: the Scope page follows the jobs that change it, the lock waits for a milestone re-plan, the "no screens"
// line waits for a fresh read, sign-in opens the person's own workspace, and counts read "1 file", never "1 files".
import { describe, expect, it } from "vitest";
import { finishedKinds, finishRefreshSchemas } from "../../src/blocks/engine/jobs";
import type { EngineJobRow } from "../../src/blocks/engine/types";
import { designCameBackEmpty } from "../../src/components/scope/blocks/ScreensSection";
import { LOCK_BY_TEAM, REPLAN_TEXT, lockDisabledReason } from "../../src/components/scope/blocks/LockCard";
import { LockDialogBody, REPLAN_DIALOG_TEXT, lockDesign, lockScreensText } from "../../src/components/scope/blocks/LockDialog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultWorkspace } from "../../src/blocks/workspaces/sync";
import type { MyWorkspace } from "../../src/blocks/workspaces/store";
import { plural, pluralWord } from "../../src/lib/format";

const job = (id: string, kind: string, status: string): EngineJobRow =>
  ({ ItemId: id, WorkspaceId: "w", ProjectId: "p", Kind: kind, Status: status }) as EngineJobRow;

describe("jobs that change the Scope page", () => {
  it("read their outputs again when they finish", () => {
    expect(finishRefreshSchemas("milestones.suggest")).toContain("Milestone");
    expect(finishRefreshSchemas("scope.draft")).toEqual(expect.arrayContaining(["ScopeVersion", "Feature", "Story", "Milestone"]));
    expect(finishRefreshSchemas("scope.success")).toContain("ScopeVersion");
    expect(finishRefreshSchemas("design.generate")).toContain("DesignBrief");
    expect(finishRefreshSchemas("design.generate")).not.toContain("DesignScreen");
    // the requirements draft asks a question where an answer and a document differ: the questions are read again
    expect(finishRefreshSchemas("requirements.draft")).toEqual(expect.arrayContaining(["Requirement", "Objective", "Clarification"]));
  });

  it("a job seen running and then finished counts", () => {
    const key = "list-a";
    expect(finishedKinds(key, [job("a1", "milestones.suggest", "running")])).toEqual([]);
    expect(finishedKinds(key, [job("a1", "milestones.suggest", "succeeded")])).toEqual(["milestones.suggest"]);
    expect(finishedKinds(key, [job("a1", "milestones.suggest", "succeeded")])).toEqual([]);
  });

  it("a job queued and finished between two reads counts too; old jobs on the first read do not", () => {
    const key = "list-b";
    expect(finishedKinds(key, [job("b0", "scope.draft", "succeeded")])).toEqual([]);
    expect(finishedKinds(key, [job("b1", "milestones.suggest", "succeeded"), job("b0", "scope.draft", "succeeded")])).toEqual(["milestones.suggest"]);
  });
});

describe("the lock waits for a milestone re-plan", () => {
  it("says so in plain words, after who signs off", () => {
    expect(lockDisabledReason(true, [], true)).toBe(REPLAN_TEXT);
    expect(lockDisabledReason(false, [], true)).toBe(LOCK_BY_TEAM);
    expect(lockDisabledReason(true, [{ key: "placed", ok: true, text: "ok" }], false)).toBeNull();
    expect(REPLAN_TEXT).toMatch(/re-planning the milestones/);
  });
  it("the dialog lists the milestones it is given and says when a re-plan is on its way", () => {
    const props = { counts: { features: 1, stories: 1, screens: 1 }, milestones: [{ id: "m1", number: 1, name: "Catalogue", featureCount: 1 }], advisories: [], error: null };
    const calm = renderToStaticMarkup(createElement(LockDialogBody, props));
    expect(calm).toContain("Catalogue");
    expect(calm).toContain("1 feature · 1 user story · 1 screen");
    expect(calm).not.toContain(REPLAN_DIALOG_TEXT);
    expect(renderToStaticMarkup(createElement(LockDialogBody, { ...props, replanning: true }))).toContain(REPLAN_DIALOG_TEXT);
  });
});

describe("the lock dialog's screens", () => {
  const figma = (screens: number) => JSON.stringify({
    provider: "figma-design", projectId: "p1", projectUrl: "[private]", previewUrl: `/api/design-preview/p1/${"a".repeat(64)}`,
    revision: "a".repeat(64), source: "factory-v1:ux-current", jobId: "job-1", artifactFileId: "art-1",
    screens: Array.from({ length: screens }, (_, i) => ({ name: `Screen ${i + 1}`, nodeId: `1:${i + 2}`, requirementKeys: ["R-1"] })),
  });

  it("never says 0 screens over an approved design: it names the design's screens until the scope has its own", () => {
    // E2E 08.11: "0 screens" although 10 designs were approved (the scope's own screens are drawn later)
    const approved = lockDesign({ status: "confirmed", prototypeJson: figma(10) });
    expect(approved).toEqual({ approved: true, screens: 10 });
    expect(lockScreensText({ features: 7, stories: 10, screens: 0, design: approved })).toBe("10 approved screen designs");
    expect(lockScreensText({ features: 7, stories: 10, screens: 0, design: lockDesign({ status: "draft", prototypeJson: figma(1) }) })).toBe("1 screen design");
    expect(lockScreensText({ features: 7, stories: 10, screens: 0, design: { approved: true, screens: 0 } })).toBe("screens follow from the approved design");
    // the scope's own screens win once there are any; without any design the count is what it is
    expect(lockScreensText({ features: 7, stories: 10, screens: 4, design: approved })).toBe("4 screens");
    expect(lockScreensText({ features: 7, stories: 10, screens: 0, design: null })).toBe("0 screens");
    expect(lockDesign({ status: "confirmed", prototypeJson: null })).toBeNull();
    const html = renderToStaticMarkup(createElement(LockDialogBody, { counts: { features: 7, stories: 10, screens: 0, design: approved }, milestones: [], advisories: [], error: null }));
    expect(html).toContain("7 features · 10 user stories · 10 approved screen designs");
  });
});

describe("\"The design came back without screens\"", () => {
  const base = { succeeded: true, screenCount: 0, jobNamesScreens: false, readAfterDone: true, fetching: false, rereads: 0 };
  it("shows only after a fresh read of the screens found none", () => {
    expect(designCameBackEmpty(base)).toBe(true);
    expect(designCameBackEmpty({ ...base, readAfterDone: false })).toBe(false);
    expect(designCameBackEmpty({ ...base, fetching: true })).toBe(false);
    expect(designCameBackEmpty({ ...base, screenCount: 3 })).toBe(false);
    expect(designCameBackEmpty({ ...base, succeeded: false })).toBe(false);
  });
  it("waits for the re-reads when the job names screens", () => {
    expect(designCameBackEmpty({ ...base, jobNamesScreens: true })).toBe(false);
    expect(designCameBackEmpty({ ...base, jobNamesScreens: true, rereads: 4 })).toBe(true);
  });
});

describe("the workspace after sign-in", () => {
  const ws = (id: string, name: string, viaPlatform: boolean): MyWorkspace =>
    ({ id, name, createdAt: "", role: "owner", roleKey: "owner", roleName: "Owner", status: "active", membershipId: viaPlatform ? null : `m-${id}`, viaPlatform }) as MyWorkspace;
  it("is the person's own workspace, not one reached through platform access", () => {
    expect(defaultWorkspace([ws("a", "Isolation probe (A)", true), ws("t", "Test", false)])?.id).toBe("t");
    expect(defaultWorkspace([ws("a", "Isolation probe (A)", true)])?.id).toBe("a");
    expect(defaultWorkspace([])).toBeNull();
  });
});

describe("counts", () => {
  it("use the right word form", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
    expect(plural(0, "file")).toBe("0 files");
    expect(plural(1, "user story", "user stories")).toBe("1 user story");
    expect(pluralWord(1, "ticket")).toBe("ticket");
  });
});
