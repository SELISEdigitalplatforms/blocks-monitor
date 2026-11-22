// The tech lead's thread after the audit of 08.11.2026: a release's deployment is not a build, the start of a change
// build is offered only to a role that may run it, and a taken offer keeps the server's own words.
//   npx vitest run --config test/team/vitest.config.ts test/team/teamAudit.test.ts
import { describe, expect, it } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { ANALYSIS, NAMES, OWNER } from "../changes/fixtures";
import { isReleaseDeploy, leadThread, type TeamMessage } from "../../src/components/team/teamMessages";

const job = (o: Partial<EngineJob> & Pick<EngineJob, "id" | "kind" | "status">): EngineJob => ({
  workspaceId: "w-1", projectId: "p-1", inputJson: null, outputRefs: [], progress: 0, message: null, errorCode: null, attempts: 1,
  claimedBy: null, claimedAt: null, finishedAt: null, createdBy: OWNER, createdAt: "2026-11-08T09:00:00.000Z", updatedAt: null, ...o,
});
const nameOf = (id: string | null) => (id ? NAMES[id] ?? "Former member" : "");
const base = { projectId: "p-1", meId: OWNER, nameOf, changes: [] as DeliveryChangeRequest[], milestones: [], previews: [], jobs: [] as EngineJob[], canRun: true };
const all = (t: { groups: { messages: TeamMessage[] }[] }) => t.groups.flatMap((g) => g.messages);

describe("the tech lead's thread", () => {
  it("leaves a release's deployment (to development on the last acceptance, or a promotion) out of the builds", () => {
    const prod = job({ id: "j-prod", kind: "preview.deploy", status: "running", inputJson: JSON.stringify({ environment: "production", version: "1.2.0", releaseId: "r-1" }) });
    const dev = job({ id: "j-dev", kind: "preview.deploy", status: "succeeded", inputJson: JSON.stringify({ milestoneId: "m-1", version: "1.0.0", release: "1.0.0" }) });
    const preview = job({ id: "j-prev", kind: "preview.deploy", status: "running", inputJson: JSON.stringify({ milestoneId: "m-1" }) });
    expect([prod, dev, preview].map(isReleaseDeploy)).toEqual([true, true, false]);
    const m = all(leadThread({ ...base, jobs: [prod, dev] }));
    expect(m).toEqual([]);
    // nothing offers to pause a production deployment
    expect(all(leadThread({ ...base, jobs: [prod, preview] })).filter((x) => x.action?.kind === "pause").map((x) => x.action)).toEqual([
      expect.objectContaining({ jobId: "j-prev" }),
    ]);
  });

  it("offers the start of an approved change only to a role that may run builds", () => {
    const cr: DeliveryChangeRequest = {
      id: "cr-1", number: 3, lane: "change", featureRef: "feature:assets", title: "Price filter", description: "Filter assets by price.",
      status: "approved", version: null, createdByUserId: OWNER, createdByName: "", analysis: serializeChangeAnalysis(ANALYSIS), analysedAt: null,
      decidedAt: "2026-11-08T08:00:00.000Z", decidedByUserId: OWNER, decisionNote: null, selfApproved: false,
    };
    const action = (canRun: boolean) => all(leadThread({ ...base, changes: [cr], canRun })).find((x) => x.id === "cr-1:ready")?.action;
    expect(action(true)).toMatchObject({ kind: "startChange", changeRequestId: "cr-1" });
    expect(action(false)).toMatchObject({ kind: "open", href: "/p/p-1/build?cr=3" });
  });

  it("keeps the server's words for a taken offer, and its own line for a plain saved draft", () => {
    const row = { role: "agent" as const, kind: "task-created" as const, authorUserId: "", at: "2026-11-08T09:01:00.000Z", task: { target: "change-request", code: "CR-004", title: "Export to CSV" } };
    const m = all(leadThread({ ...base, chat: [
      { ...row, id: "c-1", engineJobId: "j-chat", text: "I sent CR-004 to your business analyst for analysis: Export to CSV" },
      { ...row, id: "c-2", engineJobId: "", text: "" },
    ] }));
    expect(m.find((x) => x.id === "c-1")?.text).toBe("I sent CR-004 to your business analyst for analysis: Export to CSV");
    expect(m.find((x) => x.id === "c-2")?.text).toContain("(a draft)");
  });
});
