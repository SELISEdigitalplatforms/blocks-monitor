// The Blocks Utilities client (functions/_lib/blocksUtilities.ts) over a fake HTTP layer: every route, method, query
// and body it sends, the envelope it unwraps, the errors it raises, and the SDK transport (gateway path or the
// Utilities host, the bearer, one retry after a 401).
import { describe, expect, it } from "vitest";
import {
  UtilitiesError,
  createUtilitiesClient,
  unwrap,
  utilitiesHttp,
  type UtilitiesHttpRequest,
} from "../../functions/_lib/blocksUtilities";
import { BILLING_INTERVAL, DISCOUNT_KIND, UTILITIES_DEFAULT_BASE, utilitiesBaseOf } from "../../src/domain/blocksUtilities";
import type { SdkFactory } from "../../functions/_lib/sdk";

const ok = (data: unknown) => ({ status: 200, body: { success: true, data, meta: { correlationId: "c-1" } } });
const refused = (status: number, code: string, fields?: Record<string, string[]>) => ({
  status,
  body: { success: false, error: { code, message: "The service's sentence.", fields: fields ?? null, traceId: "t-1" }, meta: { correlationId: "c-1" } },
});

function recorder(answer: (req: UtilitiesHttpRequest) => { status: number; body: unknown } = () => ok(null)) {
  const sent: UtilitiesHttpRequest[] = [];
  const client = createUtilitiesClient(async (req) => {
    sent.push(req);
    return answer(req);
  });
  return { client, sent };
}

describe("routes and payloads", () => {
  it("plans: list (filter, family), get, versions, create, update, archive, prices", async () => {
    const { client, sent } = recorder((req) => ok(req.method === "GET" && !req.path.match(/plan-1$/) ? [] : { planId: "plan-1" }));
    await client.plans.list({ status: "All", familyCode: "madp" });
    await client.plans.get("plan-1");
    await client.plans.versions("plan 1/x");
    const plan = {
      code: "classic", subscriberScope: 0, displayName: "Classic", featuresJson: "{}", trialRequiresPaymentMethod: false, oneTrialPerPlan: true,
      requirePaymentMethodUpfront: false, quantityDiscountCombinationPolicy: 0, usageInterval: BILLING_INTERVAL.Month, usageIntervalCount: 1,
      quantityItems: [], meters: [], entitlements: [], trialGrants: [],
    };
    await client.plans.create(plan);
    const { code: _c, subscriberScope: _s, ...definition } = plan;
    await client.plans.update("plan-1", definition);
    await client.plans.archive("plan-1");
    await client.plans.createPrice({ planId: "plan-1", currencyCode: "USD", unitAmountMinor: 19900, interval: BILLING_INTERVAL.Month, intervalCount: 1 });
    await client.plans.archivePrice("price-1");
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /subscription-plans",
      "GET /subscription-plans/plan-1",
      "GET /subscription-plans/plan%201%2Fx/versions",
      "POST /subscription-plans",
      "PUT /subscription-plans/plan-1",
      "PUT /subscription-plans/plan-1/archive",
      "POST /subscription-plans/prices",
      "PUT /subscription-plans/prices/price-1/archive",
    ]);
    expect(sent[0]!.query).toEqual({ status: "All", familyCode: "madp" });
    expect(sent[3]!.body).toMatchObject({ code: "classic", usageInterval: 2, subscriberScope: 0 });
    expect(sent[6]!.body).toEqual({ planId: "plan-1", currencyCode: "USD", unitAmountMinor: 19900, interval: 2, intervalCount: 1 });
  });

  it("discounts: list, get, create, update (expected version), archive, preview a code", async () => {
    const { client, sent } = recorder((req) => ok(req.method === "GET" && req.path === "/subscription-discounts" ? [] : { discountId: "d-1" }));
    await client.discounts.list();
    await client.discounts.get("d-1");
    const terms = {
      displayName: "Half off", kind: DISCOUNT_KIND.Percent, percentBasisPoints: 5000, durationPeriods: 2, applicablePlanCodes: ["classic"],
      applicablePriceIds: [], scope: "Subscription" as const, applicableMeterKeys: [], oneUsePerOrganization: true,
    };
    await client.discounts.create({ code: "half-off", ...terms });
    await client.discounts.update("d-1", { ...terms, expectedVersion: 3 });
    await client.discounts.archive("d-1");
    await client.discounts.preview({ planCode: "classic", priceId: "price-1", discountCode: "half-off" });
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /subscription-discounts",
      "GET /subscription-discounts/d-1",
      "POST /subscription-discounts",
      "PUT /subscription-discounts/d-1",
      "PUT /subscription-discounts/d-1/archive",
      "POST /subscription-discounts/preview",
    ]);
    expect(sent[2]!.body).toMatchObject({ code: "half-off", kind: 0, percentBasisPoints: 5000, scope: "Subscription" });
    expect(sent[3]!.body).toMatchObject({ expectedVersion: 3 });
    expect(sent[5]!.body).toEqual({ planCode: "classic", priceId: "price-1", discountCode: "half-off" });
  });

  it("subscriptions: preview, subscribe, current (none is null), cancel, resume, plan change and its pending undo", async () => {
    const { client, sent } = recorder((req) => (req.path === "/subscriptions/current" ? ok(null) : ok({ subscriptionId: "s-1", status: "Active" })));
    await client.subscriptions.preview({ planCode: "classic", priceId: "p-1" });
    const sub = await client.subscriptions.subscribe({ planCode: "classic", priceId: "p-1", discountCode: "half-off", organizationId: "org-1" });
    expect(sub.subscriptionId).toBe("s-1");
    expect(await client.subscriptions.current({ organizationId: "org-1" })).toBeNull();
    await client.subscriptions.cancel("s-1");
    await client.subscriptions.cancel("s-1", { immediately: true, reason: "moving" });
    await client.subscriptions.withdrawCancellation("s-1");
    await client.subscriptions.previewPlanChange("s-1", { planCode: "speed", priceId: "p-2" });
    await client.subscriptions.changePlan("s-1", { planCode: "speed", priceId: "p-2" });
    await client.subscriptions.cancelPendingPlanChange("s-1");
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /subscriptions/preview",
      "POST /subscriptions",
      "GET /subscriptions/current",
      "DELETE /subscriptions/s-1",
      "DELETE /subscriptions/s-1",
      "DELETE /subscriptions/s-1/cancellation",
      "POST /subscriptions/s-1/plan/preview",
      "PUT /subscriptions/s-1/plan",
      "DELETE /subscriptions/s-1/plan/pending",
    ]);
    expect(sent[2]!.query).toEqual({ organizationId: "org-1" });
    expect(sent[3]!.query).toEqual({});
    expect(sent[4]!.query).toEqual({ immediately: true, reason: "moving" });
  });

  it("credits, usage, payment providers and the merchant profile", async () => {
    const { client, sent } = recorder((req) => ok(req.method === "GET" ? [] : { grantId: "g-1", allowed: true }));
    await client.credits.list("s-1", { meterKey: "ai-usage" });
    await client.credits.grant("s-1", { meterKey: "ai-usage", quantity: 5000, reason: "Sign-up credit" });
    await client.credits.preview("s-1", { meterKey: "ai-usage", quantity: 100 });
    await client.credits.purchase("s-1", { meterKey: "ai-usage", quantity: 100, idempotencyKey: "buy-1" });
    await client.usage.record({ meterKey: "ai-usage", quantity: 123, idempotencyKey: "job:j-1:1", metadata: { jobId: "j-1" } });
    await client.usage.current();
    await client.payments.providers();
    await client.merchantProfile.get();
    await client.entitlements.get();
    await client.invoices.list({ pageSize: 10, after: "cur-1" });
    await client.billingProfile.get();
    await client.billingProfile.put({ legalName: "Acme AG", billingContactName: "Owner", billingContactEmail: "owner@example.org" });
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /subscriptions/s-1/credits",
      "POST /subscriptions/s-1/credits/grants",
      "POST /subscriptions/s-1/credits/preview",
      "POST /subscriptions/s-1/credits",
      "POST /subscription-usage",
      "GET /subscription-usage/current",
      "GET /payments/providers",
      "GET /subscription-merchant-profile",
      "GET /entitlements",
      "GET /subscriptions/invoices",
      "GET /subscription-billing-profile",
      "PUT /subscription-billing-profile",
    ]);
    expect(sent[9]!.query).toEqual({ pageSize: 10, after: "cur-1" });
    expect(sent[11]!.body).toEqual({ legalName: "Acme AG", billingContactName: "Owner", billingContactEmail: "owner@example.org" });
    expect(sent[0]!.query).toEqual({ meterKey: "ai-usage" });
    expect(sent[4]!.body).toEqual({ meterKey: "ai-usage", quantity: 123, idempotencyKey: "job:j-1:1", metadata: { jobId: "j-1" } });
  });
});

describe("answers and errors", () => {
  it("unwraps the envelope; a refusal is a UtilitiesError with the service's code, status and fields", async () => {
    expect(unwrap(ok({ a: 1 }))).toEqual({ a: 1 });
    const { client } = recorder(() => refused(409, "subscription_plan_changed", { code: ["taken"] }));
    const e = await client.plans.create({} as never).catch((x) => x);
    expect(e).toBeInstanceOf(UtilitiesError);
    expect(e).toMatchObject({ code: "subscription_plan_changed", status: 409, fields: { code: ["taken"] } });
    // the service's sentence is kept off the message (a log of the error shows only the code)
    expect(e.message).toBe("subscription_plan_changed");
    expect(e.detail).toBe("The service's sentence.");
    expect(JSON.stringify(e)).not.toContain("sentence");
  });

  it("names the transport failures: no envelope, an error status, nothing answered", async () => {
    const plain = (status: number) => recorder(() => ({ status, body: "<html>bad gateway</html>" })).client;
    await expect(plain(503).plans.list()).rejects.toMatchObject({ code: "utilities_unavailable", status: 503 });
    await expect(plain(401).plans.list()).rejects.toMatchObject({ code: "utilities_unauthorized", status: 401 });
    await expect(plain(403).plans.list()).rejects.toMatchObject({ code: "utilities_forbidden", status: 403 });
    await expect(plain(404).plans.list()).rejects.toMatchObject({ code: "utilities_not_found", status: 404 });
    const down = createUtilitiesClient(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(down.subscriptions.current()).rejects.toMatchObject({ code: "utilities_unavailable", status: null });
    // a success with an envelope but a list where a list is expected stays a list; anything else is an empty list
    expect(await recorder(() => ok({ not: "a list" })).client.plans.list()).toEqual([]);
  });
});

describe("the SDK transport", () => {
  function fakeSdk(answer: (call: { kind: "request" | "external"; path: string; opts: any; token: string }) => unknown) {
    const calls: { kind: "request" | "external"; path: string; opts: any; token: string; apiUrl: string; key: string }[] = [];
    const sdk = ((o: { apiUrl: string; xBlocksKey: string; accessToken: string }) => ({
      http: {
        request: async (path: string, opts: unknown) => {
          const c = { kind: "request" as const, path, opts, token: o.accessToken, apiUrl: o.apiUrl, key: o.xBlocksKey };
          calls.push(c);
          return answer(c);
        },
        external: async (path: string, opts: unknown) => {
          const c = { kind: "external" as const, path, opts, token: o.accessToken, apiUrl: o.apiUrl, key: o.xBlocksKey };
          calls.push(c);
          return answer(c);
        },
      },
    })) as unknown as SdkFactory;
    return { sdk, calls };
  }
  const env = { apiUrl: "https://api.test.invalid", tenant: "TENANT-KEY" };
  const apiError = (status: number, body: unknown) => Object.assign(new Error("Request failed"), { status, statusText: "", body });

  it("goes through http.request on the gateway path with the bearer and x-blocks-key the SDK adds", async () => {
    const { sdk, calls } = fakeSdk(() => ({ success: true, data: [{ planId: "p" }] }));
    const client = createUtilitiesClient(utilitiesHttp({ env, sdk, token: async () => "svc-token" }));
    expect(await client.plans.list({ status: "Active" })).toEqual([{ planId: "p" }]);
    expect(calls).toEqual([
      { kind: "request", path: `${UTILITIES_DEFAULT_BASE}/subscription-plans`, opts: { method: "GET", query: { status: "Active" } }, token: "svc-token", apiUrl: env.apiUrl, key: env.tenant },
    ]);
  });

  it("hands a refused call's status and body to the envelope reader; a 401 renews the token once", async () => {
    let first = true;
    const { sdk, calls } = fakeSdk(() => {
      if (first) {
        first = false;
        throw apiError(401, "");
      }
      throw apiError(400, { success: false, error: { code: "subscription_discount_expired", message: "x" } });
    });
    let token = "old";
    let renewed = 0;
    const client = createUtilitiesClient(utilitiesHttp({ env, sdk, token: async () => token, onUnauthorized: () => { renewed++; token = "fresh"; } }));
    await expect(client.discounts.preview({ planCode: "classic", priceId: "p" })).rejects.toMatchObject({ code: "subscription_discount_expired", status: 400 });
    expect(renewed).toBe(1);
    expect(calls.map((c) => c.token)).toEqual(["old", "fresh"]);
    expect(calls[0]!.opts).toEqual({ method: "POST", body: { planCode: "classic", priceId: "p" } });
  });

  it("calls the Utilities host itself through http.external with the two headers when the base is an https URL", async () => {
    const { sdk, calls } = fakeSdk(() => ({ success: true, data: null }));
    const client = createUtilitiesClient(utilitiesHttp({ env, sdk, token: async () => "org-token", base: "https://utilities.test.invalid/api" }));
    expect(await client.subscriptions.current({ organizationId: "org 1" })).toBeNull();
    await client.subscriptions.subscribe({ planCode: "classic", priceId: "p" });
    expect(calls[0]).toMatchObject({
      kind: "external",
      path: "https://utilities.test.invalid/api/subscriptions/current?organizationId=org+1",
      opts: { method: "GET", headers: { Authorization: "Bearer org-token", "x-blocks-key": env.tenant, Accept: "application/json" } },
    });
    expect(calls[1]!.opts).toMatchObject({ method: "POST", body: JSON.stringify({ planCode: "classic", priceId: "p" }), headers: { "Content-Type": "application/json" } });
  });

  it("reads the base setting: a path or an https root, anything else the gateway default", () => {
    expect(utilitiesBaseOf(undefined)).toBe("/utilities/v4");
    expect(utilitiesBaseOf("/utilities/v4/")).toBe("/utilities/v4");
    expect(utilitiesBaseOf("https://utilities.seliseblocks.com/api")).toBe("https://utilities.seliseblocks.com/api");
    expect(utilitiesBaseOf("http://utilities.seliseblocks.com/api")).toBe("/utilities/v4");
    expect(utilitiesBaseOf("/../etc")).toBe("/utilities/v4");
    expect(utilitiesBaseOf("utilities/v4")).toBe("/utilities/v4");
  });
});
