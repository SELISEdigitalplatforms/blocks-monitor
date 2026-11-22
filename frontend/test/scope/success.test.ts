// Success & performance: the stored targets, the lock rule, the server's normalising, the checklist, the ops and the
// product manager's proposals.
import { describe, expect, it, vi } from "vitest";
import {
  acceptOpen, emptyTargets, isBlank, markUnsure, normalizeTargets, parseSuccessTargets, reopen, serializeSuccessTargets, setAgreement, setValue,
  successBlockers, successBlockersText, successDetail, successLockReason, successSummary, takeAnswer, targetState, type SuccessTargets,
} from "../../src/domain/successTargets";
import { agentLine, nowChecklist, nowSentence, successLockItem } from "../../src/components/scope/blocks/nowChecklist";
import { scopeScreensReview, scopeSuccessAsk, scopeSuccessSave } from "../../functions/project/ops/scope/success";
import { scopeLock } from "../../functions/project/ops/scope/lock";
import { applyProposals, proposeTargets, type SuccessFacts } from "../../server/local/engine/kinds/scope/success";

const AT = "2026-10-26T09:00:00.000Z";
const LATER = "2026-10-26T10:00:00.000Z";

function complete(): SuccessTargets {
  const t = emptyTargets();
  t.outcome = setValue(t.outcome, "70% of repeat orders online", "u1", AT);
  t.users = setValue(t.users, "about 400 buyers", "u1", AT);
  t.responseTime = setValue(t.responseTime, "under 1 second", "u1", AT, "fast");
  t.dataVolume = setValue(t.dataVolume, "30,000 orders a year", "u1", AT);
  return t;
}

describe("successTargets: reading and states", () => {
  it("reads empty, broken and partial JSON safely", () => {
    expect(isBlank(parseSuccessTargets(undefined))).toBe(true);
    expect(isBlank(parseSuccessTargets("{nope"))).toBe(true);
    const t = parseSuccessTargets(JSON.stringify({ users: { value: "50 people" }, outcome: "Orders online", junk: 1 }));
    expect(t.users.value).toBe("50 people");
    expect(t.outcome.value).toBe("Orders online");
    expect(t.dataVolume).toEqual(emptyTargets().dataVolume);
    expect(parseSuccessTargets(serializeSuccessTargets(t))).toEqual(t);
  });

  it("the four required values block the lock until set; peak times is optional", () => {
    const t = emptyTargets();
    expect(successBlockers(t).map((b) => b.key)).toEqual(["outcome", "users", "responseTime", "dataVolume"]);
    expect(successBlockers(complete())).toEqual([]);
    expect(successSummary(complete())).toMatchObject({ set: 4, required: 4, done: true });
    expect(successLockReason(complete())).toBeNull();
    expect(successLockReason(t)).toMatch(/^Set the success & performance targets: success outcome, expected users, response time and data volume\.$/);
  });

  it("an unsure value is a question that blocks until answered or accepted", () => {
    const t = complete();
    t.availability = markUnsure(t.availability, "availability", "u1", AT, "B2B Order Portal");
    expect(targetState(t.availability)).toBe("open");
    expect(t.availability.question?.text).toContain("B2B Order Portal");
    expect(successBlockers(t)).toEqual([{ key: "availability", kind: "openQuestion" }]);
    expect(successLockReason(t)).toBe("Answer or accept the business analyst's question on peak times.");
    // the product manager answers: still waiting for the team
    t.availability = { ...t.availability, question: { ...t.availability.question!, status: "proposed", answer: "weekdays 06:00–20:00", reason: "r", answeredAt: AT } };
    expect(targetState(t.availability)).toBe("proposed");
    expect(successBlockers(t)).toHaveLength(1);
    // the team uses the answer
    const used = takeAnswer(t.availability, "u1", LATER);
    expect(used).toMatchObject({ value: "weekdays 06:00–20:00", unsure: false, question: { status: "answered", resolvedBy: "u1" } });
    expect(targetState(used)).toBe("set");
    // or goes ahead without a fixed value, and can take that back
    const accepted = acceptOpen(t.availability, "u1", LATER);
    expect(targetState(accepted)).toBe("accepted");
    expect(successBlockers({ ...t, availability: accepted })).toEqual([]);
    expect(targetState(reopen(accepted))).toBe("proposed");
  });

  it("marking a value unsure clears it; typing a value answers the question", () => {
    const t = setValue(emptyTargets().users, "50 people", "u1", AT);
    const unsure = markUnsure(t, "users", "u1", AT);
    expect(unsure).toMatchObject({ value: "", unsure: true, question: { status: "open" } });
    const typed = setValue(unsure, "120 people", "u2", LATER);
    expect(typed).toMatchObject({ value: "120 people", unsure: false, question: { status: "answered", resolvedBy: "u2" } });
  });

  it("the detail line and the lock's blocker sentence", () => {
    const t = complete();
    t.dataVolume = markUnsure(t.dataVolume, "dataVolume", "u1", AT);
    expect(successDetail(t)).toBe("3 of 4 set · 1 question for the business analyst");
    expect(successBlockersText([{ key: "dataVolume", kind: "openQuestion" }, { key: "bogus", kind: "missing" }]))
      .toBe("Answer or accept the business analyst's question on data volume.");
    expect(successBlockersText([])).toBeNull();
  });
});

describe("normalizeTargets (what scope.success.save stores)", () => {
  it("never takes the product manager's answer from the page", () => {
    const prev = complete();
    prev.dataVolume = markUnsure(prev.dataVolume, "dataVolume", "u1", AT);
    const next = parseSuccessTargets(serializeSuccessTargets(prev));
    next.dataVolume = { ...next.dataVolume, question: { ...next.dataVolume.question!, status: "proposed", answer: "forged", reason: "x" } };
    const out = normalizeTargets(next, prev, "u2", LATER);
    expect(out.dataVolume.question).toMatchObject({ status: "open", answer: "", askedBy: "u1", askedAt: AT });
  });

  it("keeps the stored answer when the page did not know it yet, and stamps decisions with the caller", () => {
    const prev = complete();
    prev.dataVolume = markUnsure(prev.dataVolume, "dataVolume", "u1", AT);
    const page = parseSuccessTargets(serializeSuccessTargets(prev)); // the page's copy, before the answer landed
    prev.dataVolume = { ...prev.dataVolume, question: { ...prev.dataVolume.question!, status: "proposed", answer: "30,000 orders", reason: "r", answeredAt: AT } };
    expect(normalizeTargets(page, prev, "u2", LATER).dataVolume.question).toMatchObject({ status: "proposed", answer: "30,000 orders" });
    const accepted = { ...page, dataVolume: acceptOpen(page.dataVolume, "", "") };
    expect(normalizeTargets(accepted, prev, "u2", LATER).dataVolume.question).toMatchObject({ status: "accepted", resolvedBy: "u2", resolvedAt: LATER });
  });

  it("a new unsure value gets its question from the server; withdrawing it drops the question", () => {
    const next = emptyTargets();
    next.users = { ...next.users, unsure: true };
    const out = normalizeTargets(next, emptyTargets(), "u3", LATER, "Spare Parts Webshop");
    expect(out.users.question).toMatchObject({ status: "open", askedBy: "u3", askedAt: LATER });
    expect(out.users.question?.text).toContain("Spare Parts Webshop");
    const back = normalizeTargets({ ...out, users: { ...out.users, unsure: false } }, out, "u3", LATER);
    expect(back.users.question).toBeNull();
  });
});

describe("the What to do now checklist", () => {
  const base = {
    lockItems: [{ key: "features", ok: true, text: "3 features are included" }],
    counts: { features: 3, stories: 9, milestones: 2 },
    screens: { count: 6, reviewedAt: null, reviewedBy: null, designing: false },
    success: complete(),
    openComments: { threads: 2, comments: 4 },
    approvals: { loading: false, stage: true, production: false },
  };

  it("five items with live details; only features and success block", () => {
    const items = nowChecklist(base);
    expect(items.map((i) => [i.id, i.done, i.blocking])).toEqual([
      ["features", true, true], ["screens", false, false], ["success", true, true], ["comments", false, false], ["approvals", false, false],
    ]);
    expect(items[0]!.detail).toBe("3 features · 9 user stories · 2 milestones");
    expect(items[3]!.detail).toBe("4 comments on 2 items still open");
    expect(items[4]!.detail).toBe("Production approvals are not set up yet");
    expect(nowSentence(items, false)).toMatch(/Everything the lock needs is in place/);
  });

  it("names what blocks", () => {
    const items = nowChecklist({ ...base, lockItems: [{ key: "placed", ok: false, text: "1 included feature is not in a milestone" }], success: emptyTargets() });
    expect(items[0]).toMatchObject({ done: false, detail: "1 included feature is not in a milestone" });
    expect(nowSentence(items, false)).toBe("Agree the features and set what success looks like, then lock the scope.");
    expect(successLockItem(emptyTargets())).toMatchObject({ key: "success", ok: false });
    expect(successLockItem(complete())).toEqual({ key: "success", ok: true, text: "Success & performance targets are set" });
  });

  it("chip values are short", () => {
    const items = nowChecklist(base);
    expect(items.map((i) => i.short)).toEqual(["3 · 2 milestones", "6 to review", "4 of 4", "4 open", "not set up"]);
    const q = complete();
    q.dataVolume = markUnsure(q.dataVolume, "dataVolume", "u1", AT);
    expect(nowChecklist({ ...base, success: q })[2]!.short).toBe("1 question for your business analyst");
  });

  it("the agent line names the role at work, or nothing when idle", () => {
    expect(agentLine([{ kind: "scope.grill", status: "succeeded" }])).toBeNull();
    expect(agentLine([{ kind: "design.generate", status: "running", progress: 30 }, { kind: "scope.success", status: "queued", progress: 0 }]))
      .toEqual({ text: "Your business analyst is working on the success & performance targets", progress: 0, running: false });
    expect(agentLine([{ kind: "scope.grill", status: "running", progress: 140 }])?.progress).toBe(100);
  });

  it("screens: reviewed, still being designed", () => {
    expect(nowChecklist({ ...base, screens: { count: 6, reviewedAt: AT, reviewedBy: "Sandra Keller", designing: false } })[1]!.done).toBe(true);
    expect(nowChecklist({ ...base, screens: { count: 0, reviewedAt: null, reviewedBy: null, designing: true } })[1]!.detail).toBe("The screens are still being designed");
  });
});

/* ── the ops with a small in-memory env ─────────────────────────────────────────────────────────────────────── */

type Row = Record<string, any>;
function envWith(rows: Record<string, Row[]>, project: Row = { ItemId: "p1", Stage: "scope", Name: "B2B Order Portal" }) {
  const updates: [string, string, Row][] = [];
  const created: Row[] = [];
  const env: any = {
    projectId: "p1", workspaceId: "w1", userId: "u9", nowIso: LATER, issuedStamp: LATER, attempt: 1, project, permissions: [], isSuperAdmin: false,
    db: {
      query: async (schema: string, filter: Row) => (rows[schema] ?? []).filter((r) => Object.entries(filter).every(([k, v]) => typeof v === "object" || r[k] === v)),
      update: vi.fn(async (schema: string, id: string, patch: Row) => {
        updates.push([schema, id, patch]);
        const r = (rows[schema] ?? []).find((x) => x.ItemId === id);
        if (r) Object.assign(r, patch);
      }),
    },
    jobs: {
      list: async () => [],
      create: async (j: Row) => { created.push(j); return { job: { ItemId: "j1", ...j }, existing: false }; },
      cancelRows: async () => ({ cancelled: [], skipped: [] }),
    },
    audit: () => undefined,
    after: () => undefined,
  };
  return { env, updates, created };
}
const version = (extra: Row = {}): Row => ({ ItemId: "v1", ProjectId: "p1", Number: 1, Status: "draft", ...extra });

describe("scope.success.* and scope.screens.review", () => {
  it("save stores the normalised JSON on the version", async () => {
    const { env, updates } = envWith({ ScopeVersion: [version()] });
    const args = scopeSuccessSave.parse({ projectId: "p1", scopeVersionId: "v1", targets: complete() }) as any;
    expect(args.ok).toBe(true);
    const res: any = await scopeSuccessSave.run(env, args.value);
    expect(res.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(parseSuccessTargets(updates[0]![2].SuccessTargets).responseTime).toMatchObject({ value: "under 1 second", choice: "fast" });
  });

  it("refuses a locked version and a project outside the scope step", async () => {
    const locked = envWith({ ScopeVersion: [version({ Status: "locked" })] });
    expect(await scopeSuccessSave.run(locked.env, { projectId: "p1", scopeVersionId: "v1", targets: {} })).toMatchObject({ ok: false, messageKey: "scope.locked" });
    const board = envWith({ ScopeVersion: [version()] }, { ItemId: "p1", Stage: "board" });
    expect(await scopeScreensReview.run(board.env, { projectId: "p1", scopeVersionId: "v1", reviewed: true })).toMatchObject({ ok: false, messageKey: "scope.notOpen" });
  });

  it("ask queues one scope.success job with the mode and keys", async () => {
    const { env, created } = envWith({ ScopeVersion: [version()] });
    const parsed = scopeSuccessAsk.parse({ projectId: "p1", scopeVersionId: "v1", mode: "answer", keys: ["dataVolume", "nope"] }) as any;
    const res: any = await scopeSuccessAsk.run(env, parsed.value);
    expect(res.ok).toBe(true);
    expect(created[0]).toMatchObject({ kind: "scope.success", targetId: "v1", input: { mode: "answer", keys: ["dataVolume"], scopeVersion: 1 } });
    expect((scopeSuccessAsk.parse({ projectId: "p1", scopeVersionId: "v1", mode: "guess" }) as any).ok).toBe(false);
  });

  it("screens review sets and clears the mark", async () => {
    const { env, updates } = envWith({ ScopeVersion: [version()] });
    await scopeScreensReview.run(env, { projectId: "p1", scopeVersionId: "v1", reviewed: true });
    await scopeScreensReview.run(env, { projectId: "p1", scopeVersionId: "v1", reviewed: false });
    expect(updates.map((u) => u[2])).toEqual([{ ScreensReviewedAt: LATER, ScreensReviewedBy: "u9" }, { ScreensReviewedAt: "", ScreensReviewedBy: "" }]);
  });

  it("scope.lock answers the success blockers next to the scope's own", async () => {
    const open = envWith({ ScopeVersion: [version()], Feature: [], Story: [], Milestone: [] });
    const r1: any = await scopeLock.run(open.env, { projectId: "p1", scopeVersionId: "v1" });
    expect(r1).toMatchObject({ ok: false, messageKey: "scope.lockBlocked" });
    expect(r1.params.success.map((b: any) => b.key)).toEqual(["outcome", "users", "responseTime", "dataVolume"]);
    const set = envWith({ ScopeVersion: [version({ SuccessTargets: serializeSuccessTargets(complete()) })], Feature: [], Story: [], Milestone: [] });
    const r2: any = await scopeLock.run(set.env, { projectId: "p1", scopeVersionId: "v1" });
    expect(r2.params.success).toEqual([]);
  });
});

describe("the product manager's proposals (local engine)", () => {
  const facts = (o: Partial<SuccessFacts> = {}): SuccessFacts => ({
    name: "B2B Order Portal", goal: "Customers stop e-mailing Excel orders and order online", targetUsers: "Buyers at restaurant customers",
    brief: "", industry: "Food wholesale", existingProduct: false, featureText: "Order catalogue Repeat order Delivery status", featureCount: 3, ...o,
  });

  it("fits the project: external buyers ordering get fast pages and order volumes", () => {
    const p = proposeTargets(facts());
    expect(p.responseTime.choice).toBe("fast");
    expect(p.outcome.value).toMatch(/orders/);
    expect(p.users.value).toMatch(/buyers/);
    expect(p.dataVolume.value).toMatch(/orders a year/);
    expect(p.users.reason.length).toBeGreaterThan(10);
  });

  it("an internal team tool gets normal response times", () => {
    const p = proposeTargets(facts({ targetUsers: "Back office staff", goal: "Save time on manual invoice checks", featureText: "Case list" }));
    expect(p.responseTime.choice).toBe("normal");
    expect(p.users.value).toMatch(/back office staff/);
    expect(p.outcome.value).toMatch(/Handling time/);
  });

  it("propose fills only empty values; answer answers only open questions", () => {
    const t = complete();
    t.users = emptyTargets().users;
    t.dataVolume = markUnsure(t.dataVolume, "dataVolume", "u1", AT);
    const props = proposeTargets(facts());
    const proposed = applyProposals(t, "propose", props, [], LATER);
    expect(proposed.changed).toEqual(["users", "availability"]);
    expect(proposed.targets.users).toMatchObject({ suggested: true });
    expect(proposed.targets.outcome.value).toBe("70% of repeat orders online");
    const answered = applyProposals(t, "answer", props, [], LATER);
    expect(answered.changed).toEqual(["dataVolume"]);
    expect(answered.targets.dataVolume.question).toMatchObject({ status: "proposed", answeredAt: LATER });
    expect(answered.targets.dataVolume.question?.answer).toBe(props.dataVolume.value);
    expect(applyProposals(t, "answer", props, ["users"], LATER).changed).toEqual([]);
  });
});

describe("a set value is agreed only when someone agreed it", () => {
  it("is Proposed while the business analyst's proposal is untouched, and agreed with the scope after the lock", () => {
    const t = complete();
    const proposal = { ...t.users, suggested: true };
    expect(setAgreement(proposal, false)).toBe("proposed");
    expect(setAgreement(proposal, true)).toBe("agreedWithScope");
    // the team's own value, or the analyst's answer taken over, was agreed by the person
    expect(setAgreement(t.users, false)).toBe("agreed");
    expect(setAgreement(setValue(proposal, "about 500 buyers", "u1", LATER), false)).toBe("agreed");
    const asked = markUnsure(t.dataVolume, "dataVolume", "u1", AT);
    const answered = { ...asked, question: { ...asked.question!, status: "proposed" as const, answer: "40,000 orders a year" } };
    expect(setAgreement(takeAnswer(answered, "u1", LATER), false)).toBe("agreed");
  });
});
