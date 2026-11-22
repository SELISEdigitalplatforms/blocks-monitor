// Opening Scope & success on a project that has just arrived there queues the product manager's draft of the plan once
// (scope.open), never after people have features, and never a second time; the agent line and the Features chip say
// so. Plus the plain names the scope writers give features and screens from requirement sentences.
import { describe, expect, it, vi } from "vitest";
import { scopeOpen, wantsDraft } from "../../functions/project/ops/scope/open";
import { agentLine, nowChecklist } from "../../src/components/scope/blocks/nowChecklist";
import { lockChecklist } from "../../src/components/scope/blocks/pageState";
import { emptyTargets } from "../../src/domain/successTargets";
import { actorOf, featureNameOf, screenNameOf, wishOf } from "../../server/local/engine/kinds/scope/naming";
import { draftFeatures, storyText } from "../../server/local/engine/kinds/scope/draft";

type Row = Record<string, any>;
function envWith(rows: Record<string, Row[]>, o: { stage?: string; jobs?: Row[] } = {}) {
  const created: Row[] = [];
  const env: any = {
    projectId: "p1", workspaceId: "w1", userId: "u9", nowIso: "2026-10-26T10:00:00.000Z", issuedStamp: "2026-10-26T10:00:00.000Z", attempt: 1,
    project: { ItemId: "p1", Stage: o.stage ?? "scope", Name: "Cooking Class Booking", AssigneeUserId: "u2" },
    permissions: [], isSuperAdmin: false,
    isActiveMember: async (id: string) => id === "u2",
    db: {
      query: async (schema: string, filter: Row) => (rows[schema] ?? []).filter((r) => Object.entries(filter).every(([k, v]) => typeof v === "object" || r[k] === v)),
      update: vi.fn(async () => undefined),
    },
    jobs: {
      list: async () => o.jobs ?? [],
      create: async (j: Row) => { created.push(j); return { job: { ItemId: `j${created.length}`, ...j }, existing: false }; },
      cancelRows: async () => ({ cancelled: [], skipped: [] }),
    },
    audit: () => undefined,
    after: () => undefined,
  };
  return { env, created };
}
const req = (n: number, status = "draft"): Row => ({ ItemId: `r${n}`, ProjectId: "p1", Key: `req-${n}`, Status: status });

describe("scope.open queues the draft of the plan", () => {
  it.each(["describe", "sample", "figma"])("does not recreate screenshot designs for a confirmed %s brief", async (mode) => {
    const { env, created } = envWith({ Requirement: [req(1)], DesignBrief: [{ ItemId: "b1", ProjectId: "p1", Mode: mode,
      Status: "confirmed", ConfirmedAt: "2026-10-25T10:00:00.000Z", ConfirmedByUserId: "u2" }] });
    const res: any = await scopeOpen.run(env, { projectId: "p1" });
    expect(res.data.designJobId).toBeNull();
    expect(created.every((j) => j.kind !== "design.generate")).toBe(true);
    expect(created.map((j) => j.kind)).toEqual(["scope.draft"]);
  });
  it("once, for a project at the scope step with requirements and no features", async () => {
    const { env, created } = envWith({ Requirement: [req(1), req(2)] });
    const res: any = await scopeOpen.run(env, { projectId: "p1" });
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: "scope.draft", input: { projectId: "p1", scopeVersion: 1 }, eventKey: "scope.draft:p1:v1", requestedByUserId: "u2" });
    expect(res.data.draftJobId).toBe("j1");
  });

  it("not when people already have features, a draft job exists, the scope is locked or there is nothing to draft from", async () => {
    const withFeatures = envWith({ Requirement: [req(1)], ScopeVersion: [{ ItemId: "v1", ProjectId: "p1", Number: 1, Status: "draft" }], Feature: [{ ItemId: "f1", ProjectId: "p1", ScopeVersion: 1 }] });
    await scopeOpen.run(withFeatures.env, { projectId: "p1" });
    expect(withFeatures.created).toHaveLength(0);
    const ran = envWith({ Requirement: [req(1)] }, { jobs: [{ ItemId: "j0", Kind: "scope.draft", Status: "succeeded", CreatedDate: "2026-10-26T09:00:00.000Z" }] });
    await scopeOpen.run(ran.env, { projectId: "p1" });
    expect(ran.created).toHaveLength(0);
    const none = envWith({ Requirement: [req(1, "dropped")] });
    await scopeOpen.run(none.env, { projectId: "p1" });
    expect(none.created).toHaveLength(0);
    const early = envWith({ Requirement: [req(1)] }, { stage: "requirements" });
    await scopeOpen.run(early.env, { projectId: "p1" });
    expect(early.created).toHaveLength(0);
    expect(wantsDraft({ step: "scope", version: { number: 1, status: "locked" }, featureCount: 0, requirementCount: 3, draftJobs: 0 })).toBeNull();
    expect(wantsDraft({ step: "scope", version: { number: 2, status: "draft" }, featureCount: 0, requirementCount: 3, draftJobs: 0 })).toEqual({ scopeVersion: 2 });
  });

  it("the page names who is at work and keeps the Features chip calm while the draft runs", () => {
    expect(agentLine([{ kind: "scope.draft", status: "running", progress: 40 }, { kind: "design.generate", status: "running", progress: 10 }]))
      .toEqual({ text: "Your business analyst is drafting the features, user stories and milestones", progress: 40, running: true });
    const items = nowChecklist({
      lockItems: lockChecklist([], [], []), counts: { features: 0, stories: 0, milestones: 0 },
      screens: { count: 0, reviewedAt: null, reviewedBy: null, designing: false }, success: emptyTargets(),
      openComments: { threads: 0, comments: 0 }, approvals: { loading: false, stage: false, production: false }, drafting: true,
    });
    expect(items[0]).toMatchObject({ done: false, short: "being drafted", detail: "Your business analyst is drafting the features from the requirements" });
  });
});

describe("plain names from requirement sentences", () => {
  it("screens get short names, never sentence fragments", () => {
    expect(screenNameOf("Customers book a class online and pay by card or TWINT")).toBe("Book a class");
    expect(screenNameOf("Staff see the guest list per class")).toBe("Guest list");
    expect(screenNameOf("Documents are approved in one place")).toBe("Document approvals");
    expect(screenNameOf("The application should: reminder e-mail one day before")).toBe("Reminder e-mail");
    expect(screenNameOf("Sell online, fewer mistakes")).toBe("Sell online");
    expect(screenNameOf("Each customer sees only their articles at their own prices")).toBe("Articles");
    expect(screenNameOf("Staff export the herd record as a spreadsheet")).toBe("Herd record export");
    expect(screenNameOf("The customer signs on the phone")).toBe("Signature");
    expect(screenNameOf("Customers sign in securely")).toBe("Sign in");
    const titles = [
      "Customers follow the delivery status of an order", "The order desk can change orders before the cut-off", "A confirmation email goes out for every order",
      "Orders reach the ERP as a CSV export", "Find parts by the pump's serial number", "A “Field map” view that works on a phone", "Clients see what is still missing",
      "The service desk sees open and signed reports", "Employees download payslips and salary statements", "Table turn planner: show each room's cleaning status live",
    ];
    for (const t of titles) {
      const n = screenNameOf(t);
      expect(n.split(/\s+/).length, n).toBeLessThanOrEqual(4);
      expect(n[0], n).toMatch(/[A-Z]/);
      expect(n, n).not.toMatch(/\b(the|a|an|of|to|for|in|on|and|or|that|is)$/i);
      expect(n, n).not.toMatch(/fewer mistakes|^Customers |^Staff /);
    }
  });

  it("features are named after what people do; the person and the wish make the story", () => {
    expect(featureNameOf("Customers book a class online and pay by card or TWINT")).toBe("Book a class");
    expect(featureNameOf("Staff see the guest list per class")).toBe("See the guest list");
    expect(featureNameOf("Orders reach the ERP as a CSV export")).toBe("Orders to the ERP");
    expect(featureNameOf("It fits SAP for invoicing")).toBe("SAP connection");
    expect(actorOf("Staff see the guest list per class")).toBe("staff member");
    expect(actorOf("The order desk can change orders before the cut-off")).toBe("order desk");
    expect(storyText("customer", wishOf("Customers book a class online and pay by card or TWINT")))
      .toBe("As a customer, I want to book a class online and pay by card or TWINT.");
    expect(storyText("order desk", wishOf("The order desk can change orders before the cut-off"))).toBe("As the order desk, I want to change orders before the cut-off.");
    expect(storyText("HR contact", "to report new hires")).toBe("As an HR contact, I want to report new hires.");
    expect(storyText("customer", wishOf("A confirmation email goes out for every order"))).toBe("As a customer, I want to be sure that a confirmation email goes out for every order.");
  });

  it("the draft: one feature per requirement people use, exclusions as not included, workflows as stories", () => {
    const plan = draftFeatures({
      requirements: [
        { key: "book", title: "Customers book a class online and pay by card or TWINT", text: "", category: "functional", priority: "must", criteria: ["Card and TWINT work"], sortOrder: 2 },
        { key: "guests", title: "Staff see the guest list per class", text: "", category: "functional", priority: "must", criteria: [], sortOrder: 3 },
        { key: "remind", title: "The application should: reminder e-mail one day before", text: "", category: "functional", priority: "later", criteria: [], sortOrder: 4 },
        { key: "gdpr", title: "The application complies with GDPR", text: "", category: "nfr", priority: "must", criteria: [], sortOrder: 5 },
        { key: "signin", title: "Customers sign in securely", text: "", category: "security", priority: "nice", criteria: [], sortOrder: 6 },
      ],
      workflows: [{ title: "Book a class for a group", who: "Customer", steps: ["Opens the class calendar", "Books four places", "Pays by TWINT"] }],
      exclusions: ["Not included: gift vouchers"],
      targetUsers: "Customers, our own team",
    });
    expect(plan.map((f) => [f.name, f.priority, f.dropped])).toEqual([
      ["Book a class", "must", false], ["See the guest list", "must", false], ["Sign in securely", "nice", false], ["Reminder e-mail", "later", false], ["Gift vouchers", "later", true],
    ]);
    expect(plan[0]!.stories.map((s) => s.title)).toEqual(["Book a class online and pay by card or TWINT", "Book a class for a group"]);
    expect(plan[0]!.stories[1]!.criteria).toEqual(["Opens the class calendar", "Books four places", "Pays by TWINT"]);
    expect(plan[3]!.stories[0]!.text).toBe("As a customer, I want a reminder e-mail one day before.");
  });
});
