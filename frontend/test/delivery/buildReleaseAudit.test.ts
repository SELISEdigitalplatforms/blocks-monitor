// The Build / Release / change request audit of 08.11.2026: what was shown or allowed did not match what the server does.
//   npx vitest run --config test/delivery/vitest.config.ts test/delivery/buildReleaseAudit.test.ts
import { describe, expect, it } from "vitest";
import { blocksKeys } from "../../src/blocks/data/keys";
import { DELIVERY_MESSAGES, deliveryMutationConfig } from "../../src/blocks/delivery/actions";
import type { PolicyRecord } from "../../src/blocks/delivery/types";
import { policyGap } from "../../src/components/approvals/approvalsUi";
import { changeRightFor } from "../../src/components/changes/changeDecide";
import { changeStage } from "../../src/components/changes/changeFlow";
import { checkChangeForSubmit } from "../../src/domain/delivery";
import { ANALYSIS, OTHER, OWNER, answered } from "../changes/fixtures";

describe("a ticket comment refreshes what it may create", () => {
  it("re-reads the tickets and the jobs (a comment on a finished ticket adds a fix ticket and may queue its build)", () => {
    const keys = deliveryMutationConfig("ticket.comment", "w-1", "p-1").invalidate as readonly (readonly unknown[])[];
    for (const schema of ["Ticket", "TicketEvent", "EngineJob"]) expect(keys).toContainEqual(blocksKeys.schema("w-1", schema));
  });

  it("words every refusal of a change request draft", () => {
    for (const key of ["badLane", "featureRequired", "unknownFeature", "titleTooLong", "descriptionTooLong", "empty"]) {
      expect(DELIVERY_MESSAGES[`delivery.cr.${key}`]).toBeTruthy();
    }
  });
});

describe("approving a change follows the permission cr.decide declares", () => {
  const policies: PolicyRecord[] = [];
  it("offers no decision to a role without release.approve, even when every member counts as an approver", () => {
    expect(changeRightFor({ userId: OTHER, requesterId: OWNER, policies, activeMemberIds: [OWNER, OTHER], canApprove: false }))
      .toMatchObject({ ok: false, reason: "notApprover" });
  });
  it("keeps the approver rule for a role that holds it", () => {
    expect(changeRightFor({ userId: OTHER, requesterId: OWNER, policies, activeMemberIds: [OWNER, OTHER], canApprove: true })).toEqual({ ok: true, self: false });
  });
});

describe("a change whose analysis the system stopped is never stuck", () => {
  const decided = { decidedAt: null };
  const all = answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" });
  it("analysing with its newest analysis job failed or cancelled: the analysis can be tried again", () => {
    expect(changeStage("analysing", null, decided, null, { status: "failed" })).toBe("analysisFailed");
    expect(changeStage("analysing", null, decided, null, { status: "cancelled" })).toBe("analysisFailed");
    expect(changeStage("analysing", null, decided, null, { status: "running" })).toBe("analysing");
    expect(changeStage("analysing", null, decided)).toBe("analysing");
  });
  it("refining answered questions with the refinement stopped: tried again; open questions stay questions", () => {
    expect(changeStage("questions", all, decided, null, { status: "failed" })).toBe("analysisFailed");
    expect(changeStage("questions", all, decided, null, { status: "queued" })).toBe("refining");
    expect(changeStage("questions", ANALYSIS, decided, null, { status: "failed" })).toBe("questions");
  });
  it("cr.submit takes such a change again, and only such a change", () => {
    const base = { title: "Price filter", description: "Filter assets by price.", decidedAt: null };
    expect(checkChangeForSubmit({ ...base, status: "analysing", analysisStopped: true }, 1).ok).toBe(true);
    expect(checkChangeForSubmit({ ...base, status: "questions", analysisStopped: true }, 1).ok).toBe(true);
    expect(checkChangeForSubmit({ ...base, status: "analysing", analysisStopped: false }, 1)).toMatchObject({ ok: false });
    expect(checkChangeForSubmit({ ...base, status: "review", analysisStopped: true }, 1)).toMatchObject({ ok: false });
  });
});

describe("the release page says up front what release.promote refuses", () => {
  const record = (environment: "stage" | "production", types: ("architect" | "security" | "qa")[]): PolicyRecord => ({
    id: `pol-${environment}`, environment, updatedAt: null,
    policy: { environment, steps: types.map((type) => ({ type, required: true, approverUserIds: [OWNER] })) },
  });
  it("a production policy without a QA step is not complete", () => {
    expect(policyGap("production", record("production", ["architect", "security"]))).toMatch(/QA approval step/);
    expect(policyGap("production", record("production", ["architect", "security", "qa"]))).toBeNull();
  });
  it("staging needs architect and security only", () => {
    expect(policyGap("stage", record("stage", ["architect", "security"]))).toBeNull();
  });
});
