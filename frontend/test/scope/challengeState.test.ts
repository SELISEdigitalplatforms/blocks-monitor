// An accepted second-opinion point shows what really happened to it, never "apply" for a fix that is already applied.
import { describe, expect, it } from "vitest";
import { acceptedState, replanJobOf } from "../../src/components/scope/blocks/challengeState";
import type { EngineJob } from "../../src/blocks/engine/types";

const job = (o: Partial<EngineJob> & { note: string }): EngineJob => ({
  id: "j1", workspaceId: "w", projectId: "p", kind: "milestones.suggest", status: "running",
  inputJson: JSON.stringify({ projectId: "p", scopeVersion: 1, note: o.note }), outputRefs: [], progress: 10, message: null, errorCode: null,
  attempts: 1, claimedBy: null, claimedAt: null, finishedAt: null, createdBy: null, createdAt: "2026-10-31T06:16:05Z", updatedAt: null, ...o,
});
const fix = 'Move "Get a licence certificate PDF" from milestone 1 to milestone 2, next to "Receive order confirmation e-mail".';
const point = { status: "accepted", question: "q", suggestedFix: fix, finalText: fix, decidedAt: "2026-10-31T06:16:00Z", target: null };

describe("accepted second-opinion points", () => {
  it("a milestone fix follows its re-plan job: running, then done", () => {
    expect(acceptedState(point, [job({ note: fix })], [], [])).toEqual({ kind: "replanning" });
    expect(acceptedState(point, [job({ note: fix, status: "succeeded", finishedAt: "2026-10-31T06:17:00Z" })], [], []))
      .toEqual({ kind: "replanned", at: "2026-10-31T06:17:00Z" });
    expect(acceptedState(point, [job({ note: fix, status: "failed" })], [], [])).toEqual({ kind: "replan-failed" });
  });

  it("matches a note cut with an ellipsis, and ignores an older re-plan", () => {
    expect(replanJobOf(fix, point.decidedAt, [job({ note: `${fix.slice(0, 40)}…` })])).not.toBeNull();
    expect(replanJobOf(fix, point.decidedAt, [job({ note: fix, createdAt: "2026-10-31T05:00:00Z" })])).toBeNull();
  });

  it("a milestone fix without a re-plan points at Edit milestones, never at apply", () => {
    expect(acceptedState(point, [], [], [])).toEqual({ kind: "edit-milestones" });
  });

  it("any other fix is in the scope once its story changed after the decision", () => {
    const p = { ...point, suggestedFix: "Add checks for a friendly empty message.", finalText: "", target: { type: "story" as const, id: "s1" } };
    expect(acceptedState(p, [], [], [{ id: "s1", key: "s1", updatedAt: "2026-10-31T06:10:00Z" }])).toEqual({ kind: "not-yet" });
    expect(acceptedState(p, [], [], [{ id: "s1", key: "s1", updatedAt: "2026-10-31T06:20:00Z" }])).toEqual({ kind: "in-scope", at: "2026-10-31T06:20:00Z" });
  });

  it("a fix for a new feature is in the scope once a feature with its text was added", () => {
    const p = { ...point, suggestedFix: "Refunds for faulty orders within 14 days", finalText: "" };
    const f = { id: "f1", key: "f1", name: "Refunds for faulty orders within 14 days", description: "", updatedAt: "2026-10-31T06:30:00Z" };
    expect(acceptedState(p, [], [f], [])).toEqual({ kind: "in-scope", at: f.updatedAt });
    expect(acceptedState({ ...p, status: "answered" }, [], [f], [])).toBeNull();
  });
});
