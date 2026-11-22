// Rows for the change request render tests: one project ("Asset Market"), one member, one change request per state.
import type { DeliveryChangeRequest, DeliveryMilestone, DeliveryRelease, PolicyRecord } from "../../src/blocks/delivery/types";
import type { DeliveryContext } from "../../src/blocks/delivery/context";
import type { EngineJob } from "../../src/blocks/engine/types";
import type { ChangeAnalysis } from "../../src/domain/changeAnalysis";

export const OWNER = "u-owner";
export const OTHER = "u-other";
export const NAMES: Record<string, string> = { [OWNER]: "Mira Keller", [OTHER]: "Jonas Brandt" };

export function fakeCtx(o: { members?: string[]; userId?: string } = {}): DeliveryContext {
  const members = o.members ?? [OWNER];
  return {
    projectId: "p-asset", status: "ready", error: null, workspaceId: "w-1",
    project: { id: "p-asset", workspaceId: "w-1", name: "Asset Market", stage: "release", currentScopeVersion: 1, scopeLocked: true, scopeLockedAt: null, assigneeUserId: null, createdByUserId: OWNER },
    userId: o.userId ?? OWNER, isSuperAdmin: false, me: null, permissions: [], can: () => true,
    members: members.map((u) => ({ userId: u, displayName: NAMES[u] ?? "", roleKey: "owner" })), activeMemberIds: members,
    memberName: (id: string | null | undefined) => (id ? NAMES[id] ?? "Former member" : ""),
  } as unknown as DeliveryContext;
}

export const ANALYSIS: ChangeAnalysis = {
  v: 1,
  kind: "change",
  route: "fast",
  summary: "Buyers can filter the asset list by price range. The list, its filter bar and the saved searches change; nothing else in the scope moves.",
  impact: {
    features: ["Asset catalogue"],
    stories: ["As a buyer I filter assets by price", "As a buyer I save a search"],
    screens: ["Asset list", "Saved searches"],
    milestones: ["Milestone 1: Marketplace basics"],
  },
  scopeChange: false,
  conflicts: [],
  risks: ["Saved searches made before the change have no price range; they keep working without one."],
  acceptanceCriteria: [
    "The asset list has a minimum and a maximum price field.",
    "Only assets inside the range are listed; an empty field means no limit.",
    "A saved search keeps its price range.",
  ],
  tickets: [
    { title: "Price range filter on the asset list", description: "Two number fields in the filter bar; the list follows them." },
    { title: "Keep the price range in saved searches", description: "Store the range with the search and apply it when the search opens." },
  ],
  estimate: { tickets: 2 },
  questions: [
    { id: "q1", text: "Which currency should the price range use?", options: ["The listing's own currency", "Always CHF"], answer: null, answeredBy: null, answeredAt: null },
    { id: "q2", text: "Should assets without a price show when a range is set?", options: ["Yes, at the end of the list", "No, hide them"], answer: null, answeredBy: null, answeredAt: null },
  ],
  contextVersion: 31,
};

export const answered = (a: ChangeAnalysis, answers: Record<string, string>): ChangeAnalysis => ({
  ...a,
  questions: a.questions.map((q) => (answers[q.id] ? { ...q, answer: answers[q.id], answeredBy: OWNER, answeredAt: "2026-10-31T10:20:00.000Z" } : q)),
});

export const FEATURE: ChangeAnalysis = {
  ...ANALYSIS,
  kind: "feature",
  route: "scope",
  scopeChange: true,
  summary: "An auction mode for assets is a new feature: bids, a closing time and a winner. It is not part of the locked scope.",
  conflicts: ["The locked scope sells assets at a fixed price only."],
  questions: [],
};

export function cr(over: Partial<DeliveryChangeRequest> & { analysisValue?: ChangeAnalysis | null } = {}): DeliveryChangeRequest {
  const { analysisValue, ...rest } = over;
  return {
    id: "cr-2", number: 2, lane: "change", featureRef: "feature:catalogue",
    title: "Filter assets by price range",
    description: "Buyers ask to narrow the asset list to a price range, and to keep that range in a saved search.",
    status: "draft", version: null, createdByUserId: OWNER, createdByName: "",
    analysis: analysisValue ? JSON.stringify(analysisValue) : null, analysedAt: analysisValue ? "2026-10-31T10:12:00.000Z" : null,
    decidedAt: null, decidedByUserId: null, decisionNote: null, selfApproved: false,
    ...rest,
  };
}

/** CR-001 on Asset Market: built and released to development before the analysis existed. */
export const LEGACY = cr({
  id: "cr-1", number: 1, title: "Show the seller's rating on each asset", description: "Each asset card shows the seller's average rating.",
  status: "released-dev", version: "1.1.0",
});

export const DEV_RELEASE: DeliveryRelease = {
  id: "r-1", projectId: "p-asset", environment: "dev", version: "1.1.0", url: "", changeRequestIds: ["cr-1"], releasedAt: "2026-10-30T16:00:00.000Z",
  releasedByUserId: OWNER, approvalRequestId: null,
};

export const MILESTONE = { id: "m-1", number: 1, name: "Marketplace basics", featureRefs: ["feature:catalogue"] } as unknown as DeliveryMilestone;

export function job(kind: EngineJob["kind"], status: EngineJob["status"], progress: number, changeRequestId = "cr-2"): EngineJob {
  return {
    id: `j-${kind}-${status}`, workspaceId: "w-1", projectId: "p-asset", kind, status,
    inputJson: JSON.stringify({ projectId: "p-asset", changeRequestId }), outputRefs: [], progress, message: null, errorCode: null, attempts: 1,
    claimedBy: null, claimedAt: null, finishedAt: null, createdBy: OWNER, createdAt: "2026-10-31T10:10:00.000Z", updatedAt: null,
  };
}

export const POLICIES: PolicyRecord[] = [];
