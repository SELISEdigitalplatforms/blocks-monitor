import { describe, expect, it } from "vitest";
import { READ_ONLY_LIVE, READ_ONLY_MOVED_ON, READ_ONLY_NO_RIGHTS, liveProductAttached, setupChipMode } from "../../src/components/business/setupChips";
import { codeHomeStillOpen } from "../../src/components/business/NewRepositoryCard";

// The server's own rules: project.setup answers project.setupLocked once the project is past its setup step, and
// project.update answers project.repoLocked for an existing product's repository then; business.handOver answers
// business.alreadyHandedOver. The page never offers what the server refuses.
describe("an existing product attached to the Factory as it is live (PrimaBook)", () => {
  const primaBook = { type: "brownfield", step: "release", handedOverAt: null };

  it("is recognised: existing, never handed over, past the setup step", () => {
    expect(liveProductAttached(primaBook)).toBe(true);
    expect(liveProductAttached({ existing: true, step: "release", handedOverAt: null })).toBe(true);
    // an existing product still being set up is not one, nor one that went through the analysis, nor a new product
    expect(liveProductAttached({ ...primaBook, step: "business" })).toBe(false);
    expect(liveProductAttached({ ...primaBook, handedOverAt: "2026-11-01T10:00:00Z" })).toBe(false);
    expect(liveProductAttached({ ...primaBook, type: "greenfield" })).toBe(false);
  });

  it("shows its setup answers read-only with the reason, never a Save the server refuses", () => {
    expect(setupChipMode({ canEdit: true, step: "release", handedOverAt: null, existing: true })).toEqual({ kind: "read", note: READ_ONLY_LIVE });
    expect(setupChipMode({ canEdit: false, step: "release", handedOverAt: null, existing: true })).toEqual({ kind: "read", note: READ_ONLY_LIVE });
    expect(READ_ONLY_LIVE).toMatch(/live product/);
    expect(READ_ONLY_LIVE).not.toMatch(/\bAI\b|AGIS/);
  });

  it("never offers to change the repository once it is past its setup", () => {
    const p = { type: "brownfield" as const, step: "release" as const, handedOverAt: null, repoOwner: "o", repoName: "web", repoBranch: "dev", repoExisting: true, setupAnswers: "" };
    expect(codeHomeStillOpen(p)).toBe(false);
    expect(codeHomeStillOpen({ ...p, step: "business" })).toBe(true);
  });

  it("every other project keeps its rules: edit only in setup with the rights", () => {
    expect(setupChipMode({ canEdit: true, step: "business", handedOverAt: null, existing: true }).kind).toBe("edit");
    expect(setupChipMode({ canEdit: true, step: "business", handedOverAt: null })).toEqual({ kind: "edit" });
    expect(setupChipMode({ canEdit: true, step: "release", handedOverAt: "2026-11-01T10:00:00Z", existing: true })).toEqual({ kind: "read", note: READ_ONLY_MOVED_ON });
    expect(setupChipMode({ canEdit: true, step: "scope", handedOverAt: null, existing: false })).toEqual({ kind: "read", note: READ_ONLY_MOVED_ON });
    expect(setupChipMode({ canEdit: false, step: "business", handedOverAt: null, existing: true })).toEqual({ kind: "read", note: READ_ONLY_NO_RIGHTS });
  });
});
