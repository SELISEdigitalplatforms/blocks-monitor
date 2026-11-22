// The team threads are worded from real rows only: the change request and its analysis for the business analyst, the
// delivery jobs for the tech lead. Nothing is invented; a row without a time gets none.
import { describe, expect, it } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import type { ChangeDecideRight } from "../../src/domain/delivery";
import { ANALYSIS, NAMES, OTHER, OWNER, answered } from "../changes/fixtures";
import { analystThread, firstContact, isUnread, leadThread, type TeamMessage } from "../../src/components/team/teamMessages";

const cr = (o: Partial<DeliveryChangeRequest> = {}): DeliveryChangeRequest => ({
  id: "cr-1", number: 3, lane: "change", featureRef: "feature:assets", title: "Price filter", description: "Filter assets by price.",
  status: "analysing", version: null, createdByUserId: OWNER, createdByName: "", analysis: null, analysedAt: null,
  decidedAt: null, decidedByUserId: null, decisionNote: null, selfApproved: false, ...o,
});

const job = (o: Partial<EngineJob> & Pick<EngineJob, "id" | "kind" | "status">): EngineJob => ({
  workspaceId: "w-1", projectId: "p-1", inputJson: null, outputRefs: [], progress: 0, message: null, errorCode: null, attempts: 1,
  claimedBy: null, claimedAt: null, finishedAt: null, createdBy: OWNER, createdAt: "2026-11-08T09:00:00.000Z", updatedAt: null, ...o,
});

const nameOf = (id: string | null) => (id ? NAMES[id] ?? "Former member" : "");
const approver: ChangeDecideRight = { ok: true, self: false };
const base = { projectId: "p-1", meId: OWNER, nameOf, rightOf: () => approver, canRun: true, hasDev: true };
const all = (t: { groups: { messages: TeamMessage[] }[] }) => t.groups.flatMap((g) => g.messages);

describe("the business analyst's thread", () => {
  it("shows the request and the analysis in progress with the job's real progress", () => {
    const t = analystThread({
      ...base, changes: [cr()],
      jobs: [job({ id: "j-a", kind: "change.analyse", status: "running", progress: 40, inputJson: JSON.stringify({ changeRequestId: "cr-1" }), claimedAt: "2026-11-08T09:00:05.000Z" })],
    });
    const m = all(t);
    expect(m[0]).toMatchObject({ author: "person", name: "You", text: "Price filter\nFilter assets by price.", at: "2026-11-08T09:00:00.000Z" });
    expect(m[1]).toMatchObject({ author: "analyst", tone: "working", job: { id: "j-a", progress: 40, working: true } });
    expect(m[1]!.text).toContain("I'm analysing CR-003");
    expect(t.groups[0]!.href).toBe("/p/p-1/build?cr=3");
  });

  it("relays conflicts as checked with the tech lead only when the analysis read the code, then asks its questions", () => {
    const withCode = { ...ANALYSIS, conflicts: ["The list sorts by date today, but the request sorts by price"], codeAreas: ["web: src/assets/"] };
    const t = analystThread({ ...base, changes: [cr({ status: "questions", analysis: JSON.stringify(withCode), analysedAt: "2026-11-08T09:05:00.000Z" })], jobs: [] });
    const texts = all(t).map((x) => x.text);
    expect(texts).toContain("I checked this with the tech lead against the code: The list sorts by date today, but the request sorts by price.");
    expect(texts).toContain("The tech lead points out a risk: Saved searches made before the change have no price range; they keep working without one.");
    expect(texts).toContain("I need your call on 2 things:");
    const q = all(t).filter((x) => x.action?.kind === "question");
    expect(q).toHaveLength(2);
    expect(q.every((x) => x.needsYou)).toBe(true);
    expect(t.needsYou).toBe(2);

    const noCode = analystThread({ ...base, changes: [cr({ status: "questions", analysis: JSON.stringify({ ...ANALYSIS, conflicts: ["Differs from the locked scope"] }) })], jobs: [] });
    expect(all(noCode).map((x) => x.text)).toContain("I checked this against the locked scope: Differs from the locked scope.");
    expect(all(noCode).map((x) => x.text)).not.toContain(expect.stringContaining("tech lead"));
  });

  it("shows answers as the person's messages and asks for approval when the approver is the signed-in person", () => {
    const a = answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" });
    const t = analystThread({ ...base, changes: [cr({ status: "review", analysis: JSON.stringify(a), analysedAt: "2026-11-08T09:30:00.000Z" })], jobs: [] });
    const m = all(t);
    expect(m.filter((x) => x.author === "person").map((x) => x.text)).toEqual(["Price filter\nFilter assets by price.", "Always CHF", "No, hide them"]);
    expect(m.map((x) => x.text)).toContain("I planned 2 tickets.");
    const review = m.find((x) => x.action?.kind === "decide");
    expect(review).toMatchObject({ text: "CR-003 is waiting for your approval.", needsYou: true });
  });

  it("names the other approver when the four-eyes rule keeps the requester from deciding", () => {
    const t = analystThread({
      ...base, rightOf: () => ({ ok: false, reason: "ownRequest", others: [OTHER] }),
      changes: [cr({ status: "review", analysis: JSON.stringify(answered(ANALYSIS, { q1: "x", q2: "y" })) })], jobs: [],
    });
    expect(all(t).some((x) => x.action?.kind === "decide")).toBe(false);
    expect(all(t).map((x) => x.text)).toContain("You asked for this change, so Jonas Brandt approves it. I'll tell you when it's decided.");
    expect(t.needsYou).toBe(0);
  });

  it("offers to send a draft only when it can be sent", () => {
    const t = analystThread({ ...base, hasDev: false, changes: [cr({ status: "draft" })], jobs: [] });
    const draft = all(t).find((x) => x.action?.kind === "submit");
    expect(draft?.action).toMatchObject({ kind: "submit", disabledReason: "It can be sent once the first milestone is on the development environment." });
    expect(draft?.at).toBeNull();
  });
});

describe("the tech lead's thread", () => {
  const ms = [{ id: "m-2", number: 2, name: "Checkout", status: "building" }];
  const lead = (jobs: EngineJob[], o: Partial<Parameters<typeof leadThread>[0]> = {}) =>
    leadThread({ projectId: "p-1", changes: [], jobs, milestones: ms, previews: [], meId: OWNER, nameOf, canRun: true, ...o });

  it("posts a running build with its progress and a pause action", () => {
    const t = lead([job({ id: "b-1", kind: "build.run", status: "running", progress: 55, message: "Building the checkout API", inputJson: JSON.stringify({ milestoneId: "m-2" }), claimedAt: "2026-11-08T09:01:00.000Z" })]);
    const m = all(t);
    expect(t.groups[0]!.title).toBe("Milestone 2: Checkout");
    expect(m.map((x) => x.text)).toEqual(["I started building milestone 2.", "Working on it: Building the checkout API."]);
    expect(m[1]).toMatchObject({ tone: "working", job: { id: "b-1", progress: 55 }, action: { kind: "pause", jobId: "b-1" } });
  });

  it("says a change build is on development with the change request's version, by its increment", () => {
    const change = cr({ id: "cr-9", number: 9, status: "released-dev", version: "0.9.0" });
    const t = lead([job({ id: "c-1", kind: "change.build", status: "succeeded", inputJson: JSON.stringify({ changeRequestId: "cr-9" }), finishedAt: "2026-11-08T10:00:00.000Z" })],
      { changes: [change], incrementOf: () => ({ n: 2, of: 3 }) });
    expect(all(t).map((x) => x.text)).toContain("Build 2 of 3 of CR-009 is on development as version 0.9.0.");
  });

  it("says what a fix round and putting development back do, for the increment they work on", () => {
    const change = cr({ id: "cr-18", number: 18, status: "approved", version: "2.3.1" });
    const fix = job({ id: "f-1", kind: "change.build", status: "running", message: "Fixing what the checks found in CR-018 (round 1): reading the code",
      inputJson: JSON.stringify({ changeRequestId: "cr-18", fixChecks: true, afterJobId: "c-1", baseJobId: "c-1", round: 1, auto: true }), claimedAt: "2026-11-08T10:01:00.000Z" });
    const texts = all(lead([fix], { changes: [change], incrementOf: () => ({ n: 1, of: 2 }) })).map((x) => x.text);
    expect(texts[0]).toBe("I started fixing what the checks found in build 1 of 2 of CR-018 (round 1).");
    expect(texts.join(" ")).not.toMatch(/building|2 of 2/);
    const back = job({ id: "r-1", kind: "change.build", status: "succeeded", finishedAt: "2026-11-08T11:00:00.000Z",
      inputJson: JSON.stringify({ changeRequestId: "cr-18", revertChecks: true, afterJobId: "f-1", baseJobId: "c-1", auto: true }), claimedAt: "2026-11-08T10:40:00.000Z" });
    expect(all(lead([back], { changes: [change], incrementOf: () => ({ n: 1, of: 2 }) })).map((x) => x.text))
      .toEqual(["I started putting development back without build 1 of 2 of CR-018.", "Development was put back without build 1 of 2 of CR-018."]);
  });

  it("offers resume on the newest stopped build only while nothing else builds, and only with build.run", () => {
    const stopped = job({ id: "b-2", kind: "build.run", status: "cancelled", inputJson: JSON.stringify({ milestoneId: "m-2" }), finishedAt: "2026-11-08T09:10:00.000Z" });
    expect(all(lead([stopped])).find((x) => x.action?.kind === "resume")?.action).toMatchObject({ how: "milestone", targetId: "m-2" });
    const failed = { ...stopped, status: "failed" as const, attempts: 1 };
    expect(all(lead([failed])).find((x) => x.action?.kind === "resume")?.action).toMatchObject({ how: "retry", jobId: "b-2" });
    const running = job({ id: "b-3", kind: "change.build", status: "running", inputJson: JSON.stringify({ changeRequestId: "x" }), createdAt: "2026-11-08T09:20:00.000Z" });
    expect(all(lead([stopped, running])).some((x) => x.action?.kind === "resume")).toBe(false);
    expect(all(lead([stopped], { canRun: false })).some((x) => x.action?.kind === "resume")).toBe(false);
  });

  it("resumes a stopped change build through cr.startBuild, as the change request page does", () => {
    const change = cr({ id: "cr-5", number: 5, status: "building", analysis: JSON.stringify(answered(ANALYSIS, { q1: "a", q2: "b" })), decidedAt: "2026-11-08T08:00:00.000Z" });
    const stopped = job({ id: "c-5", kind: "change.build", status: "cancelled", inputJson: JSON.stringify({ changeRequestId: "cr-5" }), finishedAt: "2026-11-08T09:30:00.000Z" });
    const m = all(lead([stopped], { changes: [change] }));
    expect(m.find((x) => x.action?.kind === "resume")?.action).toMatchObject({ how: "change", targetId: "cr-5" });
    expect(m.map((x) => x.text)).toContain("The build of CR-005 is paused. Its tickets stay on the board, and I can start it again when you say so.");
  });

  it("keeps a technical question waiting until its answer names the job", () => {
    const chat = [
      { id: "u1", role: "user" as const, kind: "text" as const, text: "Which database do we use?", authorUserId: OWNER, engineJobId: "r-1", at: "2026-11-08T11:00:00.000Z", task: null },
    ];
    expect(all(lead([], { chat })).find((x) => x.id === "u1")).toMatchObject({ author: "person", name: "You", waitingJobId: "r-1" });
    const replied = [...chat, { id: "a1", role: "agent" as const, kind: "text" as const, text: "PostgreSQL.", authorUserId: "", engineJobId: "r-1", at: "2026-11-08T11:00:30.000Z", task: null }];
    const t = lead([], { chat: replied });
    expect(all(t).find((x) => x.id === "u1")?.waitingJobId).toBeUndefined();
    expect(t.latestFromContact).toBe(Date.parse("2026-11-08T11:00:30.000Z"));
  });
});

describe("unread", () => {
  it("is what the team member wrote since the thread was opened; before that, only what waits for the person", () => {
    expect(isUnread({ latestFromContact: 100, needsYou: 0 }, 50)).toBe(true);
    expect(isUnread({ latestFromContact: 100, needsYou: 3 }, 100)).toBe(false);
    expect(isUnread({ latestFromContact: 100, needsYou: 1 }, null)).toBe(true);
    expect(isUnread({ latestFromContact: 100, needsYou: 0 }, null)).toBe(false);
    expect(firstContact({ analyst: false, lead: true }, { analyst: 1, lead: 0 })).toBe("lead");
    expect(firstContact({ analyst: false, lead: false }, { analyst: 0, lead: 2 })).toBe("lead");
  });
});
