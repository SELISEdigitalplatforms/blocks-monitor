// The brief shows what the engine's readings found, nothing guessed (server/api/brief/builder.ts): the requirements
// stay one list instead of features named from keywords, and "your files disagree" is never made up from a keyword
// match ("login" in one file, "no login" in another).
import { describe, expect, it } from "vitest";
import { REQUIREMENTS_GROUP, mergeToBrief, type BriefInputs } from "../../server/api/brief/builder";

const PID = "e34a92e7-2204-4729-8774-716321bb4f74";
const findings = (sourceId: string, fileName: string, o: { reqs?: string[]; obs?: string[] }) => ({
  sourceId, sourceType: "pdf", fileName, summary: "", warnings: [], openQuestions: [],
  observations: (o.obs ?? []).map((text, i) => ({ id: `OBS-${i + 1}`, kind: "business_rule" as const, text, location: "" })),
  candidateRequirements: (o.reqs ?? []).map((text) => ({ text, basis: "inferred" as const, evidenceRefs: [] })),
});
const inputs = (sources: BriefInputs["sources"]): BriefInputs => ({
  source: "blocks", answers: { name: "Shop" }, sources, decisions: { requirements: {}, conflicts: {} }, fingerprint: "f",
});

describe("the brief, from the readings only", () => {
  it("lists the requirements in one group, never in features guessed from keywords", () => {
    const b = mergeToBrief(PID, 1, inputs([
      { fileId: "f1", name: "Spec.pdf", status: "ready", hash: "h", at: "", findings: findings("f1", "Spec.pdf", { reqs: ["Customers pay by card at checkout", "People sign in with their e-mail and a password", "Export the monthly report as CSV", "Send an e-mail when an order ships"] }) },
    ]));
    expect(b.features.map((f) => f.name)).toEqual([REQUIREMENTS_GROUP]);
    expect(b.features[0]!.proposedRequirements.map((r) => r.description)).toHaveLength(4);
    for (const guess of ["Payments", "Sign-in and accounts", "Exports", "Notifications", "General"]) expect(JSON.stringify(b)).not.toContain(`"${guess}"`);
  });
  it("lists no disagreement the readings did not report", () => {
    const b = mergeToBrief(PID, 1, inputs([
      { fileId: "f1", name: "A.pdf", status: "ready", hash: "h1", at: "", findings: findings("f1", "A.pdf", { obs: ["Every user must log in with a password"] }) },
      { fileId: "f2", name: "B.pdf", status: "ready", hash: "h2", at: "", findings: findings("f2", "B.pdf", { obs: ["The catalogue is open to everyone, no login"] }) },
    ]));
    expect(b.conflicts).toEqual([]);
    expect(JSON.stringify(b)).not.toMatch(/disagree/);
  });
  it("shows nothing when nothing was read yet", () => {
    const b = mergeToBrief(PID, 1, inputs([{ fileId: "f1", name: "Spec.pdf", status: "pending", hash: "", at: "" }]));
    expect(b.features).toEqual([]);
    expect(b.conflicts).toEqual([]);
    expect(b.attachmentStatus.map((a) => a.status)).toEqual(["pending"]);
  });
});
