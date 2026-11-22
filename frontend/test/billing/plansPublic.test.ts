// billing.plans.public and its no-sign-in route GET /api/public/plans: the stored, active plans only, the public fields
// only, nothing filled in before any plan is stored (no built-in plans or prices), read-only, limited per address,
// cached, and a 503 (never a partial answer) when the catalogue cannot be read.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, seedRow, type MemoryGateway } from "../../functions/_lib/testing";
import { billingPlansPublic, readPublicPlans } from "../../functions/billing/ops/plansPublic";
import { planToRow } from "../../functions/billing/ops/shared";
import { createPublicPlansHandler } from "../../server/fnHost/publicPlans";
import { opKind } from "../../src/blocks/fnKinds";
import { DEFAULT_PLANS } from "../../src/domain/billing";
import { PUBLIC_PLAN_FIELDS, parsePublicPlans, publicPlansOf } from "../../src/domain/publicPlans";
import { seedCatalogue } from "./catalogue";

const MEMBER = { userId: "member-1", email: "member@example.org" };
const FIELDS = [...PUBLIC_PLAN_FIELDS].sort();

function storePlans(gw: MemoryGateway) {
  for (const p of DEFAULT_PLANS) {
    const changed = p.key === "classic" ? { ...p, priceUsd: 249, creditUsd: 250, features: ["Weekly check-in with your consultant"] }
      // switched off by the super admin: never public, and not filled in from the defaults either
      : p.key === "speed" ? { ...p, active: false }
        : p;
    seedRow(gw, "Plan", { ...planToRow(changed), CreatedBy: "super-1", Tags: ["internal"] });
  }
  seedRow(gw, "Plan", planToRow({ ...DEFAULT_PLANS[1], key: "legacy", name: "Legacy", active: false, sortOrder: 9 }));
}

interface Answer { status: number; headers: Record<string, string>; body: string }

function request(handler: ReturnType<typeof createPublicPlansHandler>, o: { method?: string; url?: string; ip?: string; host?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
      end(body: string) { resolve({ status: res.statusCode, headers, body }); },
    };
    const req = { method: o.method ?? "GET", url: o.url ?? "/", headers: { host: o.host ?? "factory.example.org" }, socket: { remoteAddress: o.ip ?? "203.0.113.7" } };
    void handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });
}

describe("billing.plans.public (the op)", () => {
  it("is registered in mf-billing and only reads", async () => {
    expect(await listRegisteredOps("billing")).toContain("billing.plans.public");
    expect(billingPlansPublic.kind).toBe("view");
    expect(opKind("billing", "billing.plans.public")).toBe("read");
  });

  it("lists no plan before any plan is stored: nothing is filled in from built-in plans", async () => {
    const r = await runOp("billing", [billingPlansPublic], { ctx: fakeCtx(MEMBER), request: { op: "billing.plans.public" } });
    expect(r.status).toBe(200);
    expect(r.body.data.plans).toEqual([]);
    // a catalogue that holds some plans lists exactly those
    const gateway = memoryGateway();
    seedCatalogue(gateway, DEFAULT_PLANS.filter((p) => p.key === "free" || p.key === "enterprise"));
    expect((await readPublicPlans(gateway)).map((p) => p.key)).toEqual(["free", "enterprise"]);
  });

  it("lists the seeded catalogue with the public fields only", async () => {
    const gateway = memoryGateway();
    seedCatalogue(gateway);
    const r = await runOp("billing", [billingPlansPublic], { ctx: fakeCtx(MEMBER), gateway, request: { op: "billing.plans.public" } });
    const plans = r.body.data.plans as Record<string, unknown>[];
    expect(plans.map((p) => p.key)).toEqual(["free", "classic", "speed", "enterprise"]);
    for (const p of plans) expect(Object.keys(p).sort()).toEqual(FIELDS);
    expect(plans[3]).toMatchObject({ priceUsd: null, contactSales: true, maxParallelStreams: null });
    expect(plans).toEqual(publicPlansOf(DEFAULT_PLANS));
  });

  it("answers the stored, active plans only, never a record's internal fields", async () => {
    const gateway = memoryGateway();
    storePlans(gateway);
    const r = await runOp("billing", [billingPlansPublic], { ctx: fakeCtx(MEMBER), gateway, request: { op: "billing.plans.public" } });
    const plans = r.body.data.plans as Record<string, unknown>[];
    expect(plans.map((p) => p.key)).toEqual(["free", "classic", "enterprise"]);
    expect(plans[1]).toMatchObject({ priceUsd: 249, creditUsd: 250, features: ["Weekly check-in with your consultant"] });
    const text = JSON.stringify(r.body);
    for (const internal of ["ItemId", "itemId", "active", "Active", "CreatedBy", "super-1", "Tags", "internal", "FeaturesJson", "legacy"]) {
      expect(text).not.toContain(internal);
    }
    for (const p of plans) expect(Object.keys(p).sort()).toEqual(FIELDS);
  });

  it("takes no arguments and writes nothing", async () => {
    const gateway = memoryGateway();
    const before = gateway.rows("Plan").length;
    const bad = await runOp("billing", [billingPlansPublic], { ctx: fakeCtx(MEMBER), gateway, request: { op: "billing.plans.public", args: { includeInactive: true } } });
    expect(bad.status).toBe(400);
    await runOp("billing", [billingPlansPublic], { ctx: fakeCtx(MEMBER), gateway, request: { op: "billing.plans.public" } });
    expect(gateway.rows("Plan").length).toBe(before);
  });
});

describe("GET /api/public/plans (no sign-in)", () => {
  it("answers without a session or cookie, the same plans as the op", async () => {
    const raw = memoryGateway();
    storePlans(raw);
    const handler = createPublicPlansHandler({ raw, expectedHost: "factory.example.org" });
    const a = await request(handler);
    expect(a.status).toBe(200);
    expect(a.headers["content-type"]).toContain("application/json");
    expect(a.headers["set-cookie"]).toBeUndefined();
    const body = JSON.parse(a.body);
    expect(body.ok).toBe(true);
    expect(body.data.plans).toEqual(await readPublicPlans(raw));
    expect(body.data.plans.map((p: { key: string }) => p.key)).toEqual(["free", "classic", "enterprise"]);
    for (const p of body.data.plans) expect(Object.keys(p).sort()).toEqual(FIELDS);
    expect(a.body).not.toMatch(/ItemId|"active"|CreatedBy|Tags/);
    expect(parsePublicPlans(body)?.map((p) => p.key)).toEqual(["free", "classic", "enterprise"]);
  });

  it("allows GET and HEAD only, and nothing below the route or for another host", async () => {
    const handler = createPublicPlansHandler({ raw: memoryGateway(), expectedHost: "factory.example.org" });
    const post = await request(handler, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expect((await request(handler, { method: "HEAD" })).body).toBe("");
    expect((await request(handler, { url: "/free" })).status).toBe(404);
    expect((await request(handler, { host: "elsewhere.example.org" })).status).toBe(404);
    expect((await request(handler, { url: "/?x=1" })).status).toBe(200);
  });

  it("limits each address, and tells how long to wait", async () => {
    let t = 1_000_000;
    const handler = createPublicPlansHandler({ raw: memoryGateway(), perMinute: 3, now: () => t });
    for (let i = 0; i < 3; i += 1) expect((await request(handler)).status).toBe(200);
    const limited = await request(handler);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect((await request(handler, { ip: "198.51.100.4" })).status).toBe(200);
    t += 61_000;
    expect((await request(handler)).status).toBe(200);
  });

  it("reads the catalogue at most once a minute", async () => {
    let t = 5_000_000;
    let reads = 0;
    const gw = memoryGateway();
    const raw = { findAll: (...a: Parameters<MemoryGateway["findAll"]>) => { reads += 1; return gw.findAll(...a); } };
    const handler = createPublicPlansHandler({ raw, now: () => t });
    await Promise.all([request(handler), request(handler), request(handler, { ip: "198.51.100.9" })]);
    expect(reads).toBe(3); // one read of the rows (active, switched off) and of billing.source for all three
    t += 30_000;
    await request(handler);
    expect(reads).toBe(3);
    t += 31_000;
    await request(handler);
    expect(reads).toBe(6);
  });

  it("answers 503 when the catalogue cannot be read (the page then says the plans couldn't be loaded)", async () => {
    const handler = createPublicPlansHandler({ raw: { findAll: async () => { throw new Error("gateway down: secret detail"); } } });
    const a = await request(handler);
    expect(a.status).toBe(503);
    expect(a.body).not.toContain("secret detail");
    expect(JSON.parse(a.body)).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(parsePublicPlans(JSON.parse(a.body))).toBeNull();
  });
});
