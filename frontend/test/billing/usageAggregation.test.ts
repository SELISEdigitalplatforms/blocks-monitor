// Usage sums are made over every credit entry of their scope, never over one page, and the same scope reads the same
// number everywhere: the organization's summary (credit pill, usage pills, Plan and usage), the platform's report by
// organization, project and person, and the balances. Plus billing.jobs.usage (the build in focus), the running-job
// count the platform pages pace by, and how soon a charge written by the engine host is seen (the 5 s server window).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow, seedWorkspace, type MemoryGateway } from "../../functions/_lib/testing";
import { createSdkWire } from "../../functions/_lib/testing/sdkWire";
import { createRawGateway } from "../../functions/_lib/gateway";
import { f } from "../../functions/_lib/filter";
import { BILLING_DEFS } from "../../functions/billing/ops/index";
import { MAX_USAGE_JOBS } from "../../functions/billing/ops/handlers";
import { SUMMARY_CACHE_MS, noteBillingWrite } from "../../functions/billing/ops/readCache";
import { recordLaneUsage } from "../../server/local/engine/usage";

const OWNER = { userId: "owner-1", email: "owner@example.org", displayName: "Olivia Owner" };
const MEMBER = { userId: "member-1", email: "member@example.org", displayName: "Max Member" };
const OTHER = { userId: "other-1", email: "other@example.org", displayName: "Otto Other" };
const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-super-admin"] };
const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const PROJECTS = ["project-a", "project-b", "project-c"];
const USERS = [OWNER.userId, MEMBER.userId];
/** More usage entries than four gateway pages (the gateway answers at most 100 rows a page to these reads). */
const N = 450;

type Entry = { project: string; user: string; cents: number; tokens: number; job: string };

function usageRow(workspaceId: string, e: Entry, i: number) {
  return {
    WorkspaceId: workspaceId, UserId: e.user, ProjectId: e.project, JobId: e.job, Kind: "usage",
    AmountUsd: -e.cents / 100, AmountCents: -e.cents, Tokens: e.tokens, Note: "change.build",
    At: new Date(Date.parse("2026-11-01T00:00:00.000Z") + i * 60_000).toISOString(), CouponCode: "", PlanKey: "",
    DetailJson: JSON.stringify({ v: 1, tokens: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4, total: e.tokens }, costUsd: e.cents / 100, models: ["m"], agents: 1, lanes: 1, priceFactor: 1 }),
    RequestKey: `usage:${e.job}`, CreatedByUserId: e.user, UpdatedByUserId: e.user,
  };
}

function setup() {
  noteBillingWrite();
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { name: "Acme", members: [{ ...OWNER, roleKey: "owner" }, { ...MEMBER, roleKey: "member" }] });
  const other = seedWorkspace(gateway, { name: "Other", members: [{ ...OTHER, roleKey: "owner" }] }).workspaceId;
  seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
  for (const p of PROJECTS) seedRow(gateway, "Project", { ItemId: p, WorkspaceId: workspaceId, Name: `Name of ${p}`, Stage: "build", Status: "active", ReaderIds: [OWNER.userId] });
  // a grant, then N usage entries spread over three projects and two people, and some usage of another organization
  seedRow(gateway, "CreditEntry", {
    WorkspaceId: workspaceId, UserId: OWNER.userId, ProjectId: "", JobId: "", Kind: "signup", AmountUsd: 5000, AmountCents: 500_000, Tokens: 0,
    Note: "Sign-up credit", At: "2026-10-01T00:00:00.000Z", CouponCode: "", PlanKey: "free", DetailJson: "", RequestKey: "signup:user:owner-1",
    CreatedByUserId: OWNER.userId, UpdatedByUserId: OWNER.userId,
  });
  const entries: Entry[] = [];
  for (let i = 0; i < N; i++) {
    const e = { project: PROJECTS[i % 3]!, user: USERS[i % 2]!, cents: 100 + i, tokens: 10_000 + i, job: `job-${i}` };
    entries.push(e);
    seedRow(gateway, "CreditEntry", usageRow(workspaceId, e, i));
  }
  for (let i = 0; i < 30; i++) seedRow(gateway, "CreditEntry", usageRow(other, { project: "project-x", user: OTHER.userId, cents: 50, tokens: 500, job: `other-${i}` }, i));
  let n = 0;
  const call = (who: { userId: string; email: string; roles?: string[] }, op: string, args: Record<string, unknown> = {}) =>
    runOp("billing", BILLING_DEFS, { ctx: fakeCtx(who), gateway, now: () => NOW, request: { op, args, requestId: `req-${String(++n).padStart(4, "0")}-abcdefghijklmnop` } });
  return { gateway, workspaceId, other, entries, call };
}

const data = (r: { status: number; body: any }) => {
  if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.data;
};
const sum = (xs: readonly Entry[], k: "cents" | "tokens") => xs.reduce((a, e) => a + e[k], 0);
const usd = (cents: number) => Math.round(cents) / 100;

describe("the gateway reads every page of a sum", () => {
  it("findAll walks every 100-row page and returns each row once; over its limit it refuses, never a short read", async () => {
    const wire = createSdkWire();
    wire.seed("CreditEntry", Array.from({ length: N }, (_, i) => ({ WorkspaceId: "w", Kind: "usage", AmountCents: -(100 + i), Tokens: 10 + i })));
    const raw = createRawGateway({
      env: { apiUrl: "https://api.example.org", tenant: "T", clientId: "c", clientSecret: "s" },
      sdk: wire.sdk,
      tokens: { token: async () => "t", claims: async () => ({}), invalidate: () => undefined },
      batch: false,
    });
    const rows = await raw.findAll("CreditEntry", { where: f.eq("WorkspaceId", "w"), fields: ["ItemId", "AmountCents", "Tokens"], max: 5000 });
    expect(rows).toHaveLength(N);
    expect(new Set(rows.map((r) => r.ItemId)).size).toBe(N);
    expect(rows.reduce((a, r) => a + Number(r.Tokens), 0)).toBe(Array.from({ length: N }, (_, i) => 10 + i).reduce((a, b) => a + b, 0));
    expect(wire.calls().filter((c) => c.kind === "list")).toHaveLength(Math.ceil(N / 100));
    await expect(raw.findAll("CreditEntry", { where: f.eq("WorkspaceId", "w"), fields: ["ItemId"], max: 400 })).rejects.toMatchObject({ code: "limit_reached" });
  });
});

describe("one scope, one number", () => {
  it("the organization: summary, report by organization and balances agree over all 450 entries", async () => {
    const t = setup();
    const s = data(await t.call(MEMBER, "billing.summary", { workspaceId: t.workspaceId }));
    const cents = sum(t.entries, "cents");
    const tokens = sum(t.entries, "tokens");
    expect(s.consumedUsd).toBeCloseTo(usd(cents), 2);
    expect(s.tokens).toBe(tokens);
    expect(s.monthUsedUsd).toBeCloseTo(usd(cents), 2);
    expect(s.monthTokens).toBe(tokens);
    expect(s.balanceUsd).toBeCloseTo(5000 - usd(cents), 2);

    const range = { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z" };
    const byOrg = data(await t.call(SUPER, "billing.usage.report", { ...range, groupBy: "workspace" }));
    const acme = byOrg.rows.find((r: { key: string }) => r.key === t.workspaceId);
    expect(acme).toMatchObject({ label: "Acme", tokens, jobs: N });
    expect(acme.chargedUsd).toBeCloseTo(s.monthUsedUsd, 2);
    expect(byOrg.totals.jobs).toBe(N + 30);

    const balances = data(await t.call(SUPER, "billing.balances.list"));
    const row = balances.rows.find((r: { workspaceId: string }) => r.workspaceId === t.workspaceId);
    expect(row).toMatchObject({ tokens });
    expect(row.balanceUsd).toBeCloseTo(s.balanceUsd, 2);
    expect(row.consumedUsd).toBeCloseTo(s.consumedUsd, 2);
  });

  it("each project: the summary's per-project figure equals the report by project", async () => {
    const t = setup();
    const s = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    const report = data(await t.call(SUPER, "billing.usage.report", { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", groupBy: "project" }));
    for (const p of PROJECTS) {
      const mine = t.entries.filter((e) => e.project === p);
      const inSummary = s.perProject.find((x: { projectId: string }) => x.projectId === p);
      const inReport = report.rows.find((x: { key: string }) => x.key === p);
      expect(inSummary).toMatchObject({ name: `Name of ${p}`, tokens: sum(mine, "tokens") });
      expect(inSummary.costUsd).toBeCloseTo(usd(sum(mine, "cents")), 2);
      expect(inReport).toMatchObject({ label: `Name of ${p}`, tokens: inSummary.tokens, jobs: mine.length });
      expect(inReport.chargedUsd).toBeCloseTo(inSummary.costUsd, 2);
    }
  });

  it("each person: the report by person sums every entry the person started", async () => {
    const t = setup();
    const report = data(await t.call(SUPER, "billing.usage.report", { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", groupBy: "user" }));
    for (const u of USERS) {
      const mine = t.entries.filter((e) => e.user === u);
      const r = report.rows.find((x: { key: string }) => x.key === u);
      expect(r).toMatchObject({ tokens: sum(mine, "tokens"), jobs: mine.length });
      expect(r.chargedUsd).toBeCloseTo(usd(sum(mine, "cents")), 2);
    }
    // labelled by the person's name or e-mail from the membership, never by the id
    expect([OWNER.displayName, OWNER.email]).toContain(report.rows.find((x: { key: string }) => x.key === OWNER.userId).label);
  });

  it("the credit history is a list (the newest 200), never what a total is made of", async () => {
    const t = setup();
    const { entries } = data(await t.call(SUPER, "billing.entries.list", { workspaceId: t.workspaceId }));
    expect(entries).toHaveLength(200);
    expect(entries[0].jobId).toBe(`job-${N - 1}`);
  });
});

describe("billing.jobs.usage: the build in focus", () => {
  it("answers each asked job's charge and tokens, only for jobs of the caller's organization", async () => {
    const t = setup();
    const { jobs } = data(await t.call(MEMBER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: ["job-0", "job-449", "other-0", "job-unknown"] }));
    expect(jobs).toEqual(expect.arrayContaining([
      { jobId: "job-0", costUsd: 1, tokens: 10_000, at: "2026-11-01T00:00:00.000Z" },
      { jobId: "job-449", costUsd: 5.49, tokens: 10_449, at: expect.any(String) },
    ]));
    expect(jobs).toHaveLength(2); // another organization's job and a job never charged are left out
  });

  it("is for members, takes 1 to 20 job ids", async () => {
    const t = setup();
    expect((await t.call(OTHER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: ["job-0"] })).body.error?.code).toBe("not_member");
    expect((await t.call(OWNER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: [] })).body.error?.code).toBe("invalid_input");
    const many = Array.from({ length: MAX_USAGE_JOBS + 1 }, (_, i) => `job-${i}`);
    expect((await t.call(OWNER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: many })).body.error?.code).toBe("invalid_input");
    expect(data(await t.call(OWNER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: many.slice(0, MAX_USAGE_JOBS) })).jobs).toHaveLength(MAX_USAGE_JOBS);
  });
});

function seedJob(gateway: MemoryGateway, workspaceId: string, status: string): string {
  return seedRow(gateway, "EngineJob", {
    WorkspaceId: workspaceId, ReaderIds: [OWNER.userId], ProjectId: "project-a", Kind: "change.build", Status: status, ActiveKey: `k-${status}-${Math.random()}`,
    RequestedByUserId: OWNER.userId, CreatedByUserId: OWNER.userId, Attempts: 1, Progress: 10,
  });
}

describe("while engine jobs run", () => {
  afterEach(() => vi.useRealTimers());

  it("the report and the balances say how many jobs run on the platform (the pages read faster then)", async () => {
    const t = setup();
    seedJob(t.gateway, t.workspaceId, "running");
    seedJob(t.gateway, t.other, "claimed");
    seedJob(t.gateway, t.workspaceId, "queued");
    seedJob(t.gateway, t.workspaceId, "succeeded");
    const report = data(await t.call(SUPER, "billing.usage.report", { from: "2026-11-01T00:00:00.000Z", to: "2026-12-01T00:00:00.000Z", groupBy: "workspace" }));
    expect(report.runningJobs).toBe(2);
    expect(data(await t.call(SUPER, "billing.balances.list")).runningJobs).toBe(2);
    expect(data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId })).runningJobs).toBe(1);
  });

  it("a lane's charge written by the engine host shows in the summary and the job's usage within the 5 s window", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const t = setup();
    const before = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    const jobId = seedJob(t.gateway, t.workspaceId, "running");
    // the engine host's own process: it writes the job's UsageJson and its usage entry, no billing op runs
    await recordLaneUsage(t.gateway, jobId, "tokens: 2000 (in 10 / out 20 / cache-read 1900 / cache-write 70), cost $2.5000, models m", new Date(NOW).toISOString());
    // the build in focus reads its entry directly: at once
    expect(data(await t.call(OWNER, "billing.jobs.usage", { workspaceId: t.workspaceId, jobIds: [jobId] })).jobs).toEqual([
      { jobId, costUsd: 2.5, tokens: 2000, at: new Date(NOW).toISOString() },
    ]);
    // the summary is the shared answer of the last 5 s at most: the same answer inside the window, the charge after it
    expect(data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId })).consumedUsd).toBeCloseTo(before.consumedUsd, 2);
    vi.setSystemTime(NOW + SUMMARY_CACHE_MS + 1);
    const after = data(await t.call(OWNER, "billing.summary", { workspaceId: t.workspaceId }));
    expect(after.consumedUsd).toBeCloseTo(before.consumedUsd + 2.5, 2);
    expect(after.tokens).toBe(before.tokens + 2000);
    expect(after.runningJobs).toBe(before.runningJobs + 1);
    expect(after.perProject.find((p: { projectId: string }) => p.projectId === "project-a").tokens)
      .toBe(before.perProject.find((p: { projectId: string }) => p.projectId === "project-a").tokens + 2000);
  });
});
