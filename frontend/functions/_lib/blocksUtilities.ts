// The Blocks OS Utilities client (subscription plans, discounts, subscriptions, credits, usage, payment providers) the
// billing functions and the sync script use. Routes, payloads and the answer envelope are read from the service's own
// controllers (src/domain/blocksUtilities.ts names them). Calls go through the official SDK's http.request against
// BLOCKS_API_URL + the Utilities base ("/utilities/v4" by default), with x-blocks-key and a bearer: the platform's
// service identity for the tenant catalogue, or a token issued for one IAM organization for that organization's
// subscription. Tokens, secrets and the service's messages are never logged.
import type { FnEnv } from "./env";
import type { SdkClient, SdkFactory } from "./sdk";
import type { TokenProvider } from "./serviceToken";
import {
  UTILITIES_DEFAULT_BASE,
  type UtilitiesAccess,
  type UtilitiesApi,
  type UtilitiesBillingProfile,
  type UtilitiesFinancialDocumentPage,
  type UtilitiesFailureInfo,
  type UtilitiesMerchantProfile,
  type UtilitiesSubscription,
} from "../../src/domain/blocksUtilities";

export type UtilitiesMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface UtilitiesHttpRequest {
  method: UtilitiesMethod;
  /** The route below the base, starting with "/" ("/subscription-plans"). */
  path: string;
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: unknown;
}

/** One HTTP exchange with Utilities: the status and the parsed body. Throws only when nothing answered. */
export type UtilitiesHttp = (req: UtilitiesHttpRequest) => Promise<{ status: number; body: unknown }>;

/** A refused or failed Utilities call. `code` is the service's own code, or one of the utilities_* transport codes. */
export class UtilitiesError extends Error implements UtilitiesFailureInfo {
  readonly code: string;
  readonly status: number | null;
  readonly fields: Record<string, string[]>;
  // The service's own sentence stays off `message`, so a stray log of the error shows only the code.
  readonly #detail: string;
  constructor(info: UtilitiesFailureInfo) {
    super(info.code);
    this.name = "UtilitiesError";
    this.code = info.code;
    this.status = info.status;
    this.fields = info.fields;
    this.#detail = info.message;
  }
  /** The service's sentence (for an operator, never shown to a buyer as is). */
  get detail(): string {
    return this.#detail;
  }
}

export const isUtilitiesError = (e: unknown): e is UtilitiesError => e instanceof UtilitiesError;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

function fieldsOf(v: unknown): Record<string, string[]> {
  if (!isRec(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(v)) if (Array.isArray(list)) out[k] = list.filter((x): x is string => typeof x === "string");
  return out;
}

function transportCode(status: number): string {
  if (status === 401) return "utilities_unauthorized";
  if (status === 403) return "utilities_forbidden";
  if (status === 404) return "utilities_not_found";
  if (status === 429) return "utilities_throttled";
  if (status >= 500) return "utilities_unavailable";
  return "utilities_refused";
}

/** The envelope's data, or a UtilitiesError for a refusal ({ success:false }) or a non-2xx answer. */
export function unwrap<T>(res: { status: number; body: unknown }): T {
  const b = res.body;
  const ok = res.status >= 200 && res.status < 300;
  if (isRec(b) && typeof b.success === "boolean") {
    if (b.success && ok) return b.data as T;
    const e = isRec(b.error) ? b.error : {};
    throw new UtilitiesError({
      code: text(e.code) || transportCode(res.status),
      status: res.status,
      message: text(e.message),
      fields: fieldsOf(e.fields),
    });
  }
  if (ok) return b as T;
  throw new UtilitiesError({ code: transportCode(res.status), status: res.status, message: "", fields: {} });
}

const enc = encodeURIComponent;
const orgQuery = (o?: { organizationId?: string }) => (o?.organizationId ? { organizationId: o.organizationId } : {});

/** The client over one HTTP layer (which carries the base, the key and the bearer). */
export function createUtilitiesClient(http: UtilitiesHttp): UtilitiesApi {
  const call = async <T,>(method: UtilitiesMethod, path: string, o: { query?: UtilitiesHttpRequest["query"]; body?: unknown } = {}): Promise<T> => {
    let res: { status: number; body: unknown };
    try {
      res = await http({ method, path, ...(o.query ? { query: o.query } : {}), ...(o.body !== undefined ? { body: o.body } : {}) });
    } catch (e) {
      if (isUtilitiesError(e)) throw e;
      throw new UtilitiesError({ code: "utilities_unavailable", status: null, message: "", fields: {} });
    }
    return unwrap<T>(res);
  };
  const list = async <T,>(path: string, query?: UtilitiesHttpRequest["query"]): Promise<T[]> => {
    const data = await call<unknown>("GET", path, query ? { query } : {});
    return Array.isArray(data) ? (data as T[]) : [];
  };
  return {
    plans: {
      list: (o = {}) => list("/subscription-plans", { ...(o.status ? { status: o.status } : {}), ...(o.familyCode ? { familyCode: o.familyCode } : {}), ...orgQuery(o) }),
      get: (planId, o) => call("GET", `/subscription-plans/${enc(planId)}`, { query: orgQuery(o) }),
      versions: (planId, o) => list(`/subscription-plans/${enc(planId)}/versions`, orgQuery(o)),
      create: (plan) => call("POST", "/subscription-plans", { body: plan }),
      update: (planId, plan) => call("PUT", `/subscription-plans/${enc(planId)}`, { body: plan }),
      archive: (planId, o) => call("PUT", `/subscription-plans/${enc(planId)}/archive`, { query: orgQuery(o) }),
      createPrice: (price) => call("POST", "/subscription-plans/prices", { body: price }),
      archivePrice: (priceId, o) => call("PUT", `/subscription-plans/prices/${enc(priceId)}/archive`, { query: orgQuery(o) }),
    },
    discounts: {
      list: (o) => list("/subscription-discounts", orgQuery(o)),
      get: (discountId, o) => call("GET", `/subscription-discounts/${enc(discountId)}`, { query: orgQuery(o) }),
      create: (d) => call("POST", "/subscription-discounts", { body: d }),
      update: (discountId, d, o) => call("PUT", `/subscription-discounts/${enc(discountId)}`, { body: d, query: orgQuery(o) }),
      archive: (discountId, o) => call("PUT", `/subscription-discounts/${enc(discountId)}/archive`, { query: orgQuery(o) }),
      preview: (s) => call("POST", "/subscription-discounts/preview", { body: s }),
    },
    subscriptions: {
      preview: (s) => call("POST", "/subscriptions/preview", { body: s }),
      subscribe: (s) => call("POST", "/subscriptions", { body: s }),
      current: async (o) => (await call<UtilitiesSubscription | null | undefined>("GET", "/subscriptions/current", { query: orgQuery(o) })) ?? null,
      mine: (o) => list("/subscriptions/mine", orgQuery(o)),
      cancel: (id, o = {}) =>
        call("DELETE", `/subscriptions/${enc(id)}`, {
          query: { ...(o.immediately ? { immediately: true } : {}), ...(o.reason ? { reason: o.reason } : {}), ...orgQuery(o) },
        }),
      withdrawCancellation: (id, o) => call("DELETE", `/subscriptions/${enc(id)}/cancellation`, { query: orgQuery(o) }),
      previewPlanChange: (id, c) => call("POST", `/subscriptions/${enc(id)}/plan/preview`, { body: c }),
      changePlan: (id, c) => call("PUT", `/subscriptions/${enc(id)}/plan`, { body: c }),
      cancelPendingPlanChange: (id, o) => call("DELETE", `/subscriptions/${enc(id)}/plan/pending`, { query: orgQuery(o) }),
    },
    credits: {
      list: (id, o = {}) =>
        list(`/subscriptions/${enc(id)}/credits`, { ...(o.meterKey ? { meterKey: o.meterKey } : {}), ...(o.status ? { status: o.status } : {}), ...orgQuery(o) }),
      grant: (id, g) => call("POST", `/subscriptions/${enc(id)}/credits/grants`, { body: g }),
      preview: (id, p) => call("POST", `/subscriptions/${enc(id)}/credits/preview`, { body: p }),
      purchase: (id, p) => call("POST", `/subscriptions/${enc(id)}/credits`, { body: p }),
    },
    entitlements: {
      get: (o) => call("GET", "/entitlements", { query: orgQuery(o) }),
    },
    invoices: {
      list: async (o = {}) => {
        const page = await call<Partial<UtilitiesFinancialDocumentPage> | null>("GET", "/subscriptions/invoices", {
          query: {
            ...(o.pageSize ? { pageSize: o.pageSize } : {}),
            ...(o.after ? { after: o.after } : {}),
            ...(o.subscriptionId ? { subscriptionId: o.subscriptionId } : {}),
            ...orgQuery(o),
          },
        });
        return { items: Array.isArray(page?.items) ? page.items : [], pageInfo: page?.pageInfo ?? { pageSize: 0, hasNextPage: false } };
      },
    },
    billingProfile: {
      get: async (o) => (await call<UtilitiesBillingProfile | null | undefined>("GET", "/subscription-billing-profile", { query: orgQuery(o) })) ?? null,
      put: (p) => call("PUT", "/subscription-billing-profile", { body: p }),
    },
    usage: {
      record: (u) => call("POST", "/subscription-usage", { body: u }),
      current: (o) => list("/subscription-usage/current", orgQuery(o)),
    },
    payments: {
      providers: () => list("/payments/providers"),
    },
    merchantProfile: {
      get: async () => (await call<UtilitiesMerchantProfile | null | undefined>("GET", "/subscription-merchant-profile")) ?? null,
    },
  };
}

// ---------------------------------------------------------------- the HTTP layer on the official SDK

function statusOf(e: unknown): number | null {
  if (!isRec(e) && !(e instanceof Error)) return null;
  const s = (e as { status?: unknown }).status;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}

const bodyOf = (e: unknown): unknown => (isRec(e) || e instanceof Error ? (e as { body?: unknown }).body : undefined);

export interface UtilitiesHttpOptions {
  env: Pick<FnEnv, "apiUrl" | "tenant">;
  sdk: SdkFactory;
  /** The bearer: the service identity's token, or one issued for an organization. */
  token: () => Promise<string>;
  /** Called once on a 401; a fresh token is then asked for and the call sent once more. */
  onUnauthorized?: () => void;
  /** The base ("/utilities/v4" through the gateway, or "https://<utilities host>/api"). */
  base?: string;
  fetch?: typeof fetch;
}

/**
 * Utilities over the SDK. A path base goes through http.request (the SDK adds x-blocks-key and the bearer and only ever
 * talks to BLOCKS_API_URL); an https base (the Utilities host itself, when the gateway does not route it) goes through
 * http.external with the same two headers set here.
 */
export function utilitiesHttp(o: UtilitiesHttpOptions): UtilitiesHttp {
  const base = (o.base ?? UTILITIES_DEFAULT_BASE).replace(/\/+$/, "");
  const absolute = /^https:\/\//.test(base);
  let client: { token: string; sdk: SdkClient } | null = null;
  const sdkFor = (token: string): SdkClient => {
    if (!client || client.token !== token) {
      client = { token, sdk: o.sdk({ apiUrl: o.env.apiUrl, xBlocksKey: o.env.tenant, accessToken: token, ...(o.fetch ? { fetch: o.fetch } : {}) }) };
    }
    return client.sdk;
  };
  const once = async (req: UtilitiesHttpRequest): Promise<{ status: number; body: unknown }> => {
    const token = await o.token();
    const sdk = sdkFor(token);
    try {
      if (!absolute) {
        const body = await sdk.http.request<unknown>(`${base}${req.path}`, {
          method: req.method,
          ...(req.query ? { query: req.query } : {}),
          ...(req.body !== undefined ? { body: req.body } : {}),
        });
        return { status: 200, body };
      }
      const url = new URL(`${base}${req.path}`);
      for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
      const headers: Record<string, string> = { Accept: "application/json", "x-blocks-key": o.env.tenant, Authorization: `Bearer ${token}` };
      if (req.body !== undefined) headers["Content-Type"] = "application/json";
      const body = await sdk.http.external<unknown>(url.toString(), {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
      return { status: 200, body };
    } catch (e) {
      const status = statusOf(e);
      if (status === null) throw e;
      return { status, body: bodyOf(e) };
    }
  };
  return async (req) => {
    const res = await once(req);
    if (res.status !== 401 || !o.onUnauthorized) return res;
    o.onUnauthorized();
    return once(req);
  };
}

/** The Utilities client on the platform's service identity (client credentials). */
export function serviceUtilities(o: { env: FnEnv; sdk: SdkFactory; tokens: TokenProvider; fetch?: typeof fetch }): UtilitiesApi {
  return createUtilitiesClient(
    utilitiesHttp({
      env: o.env,
      sdk: o.sdk,
      token: () => o.tokens.token(),
      onUnauthorized: () => o.tokens.invalidate(),
      base: o.env.utilitiesBase,
      ...(o.fetch ? { fetch: o.fetch } : {}),
    }),
  );
}

/** The caller's own verified token and the IAM organization it was issued for (Host A passes it to billing). */
export interface UtilitiesCaller {
  token: string;
  organizationId: string | null;
}

/**
 * Utilities for one request: the tenant catalogue on the service identity (built on first use), and a client for one
 * IAM organization's subscription. Utilities scopes a subscription to the bearer token's organization and ignores a
 * named one, so an organization is only ever reached with a token issued for it: the caller's own, when the caller's
 * session is in that organization. Otherwise forOrganization answers null and nothing is sent.
 */
export function createUtilitiesAccess(o: {
  env: FnEnv;
  sdk: SdkFactory;
  tokens: TokenProvider;
  caller?: UtilitiesCaller | null;
  fetch?: typeof fetch;
}): UtilitiesAccess {
  let service: UtilitiesApi | null = null;
  return {
    get service() {
      service ??= serviceUtilities(o);
      return service;
    },
    async forOrganization(organizationId) {
      const caller = o.caller;
      if (!organizationId || !caller?.token || caller.organizationId !== organizationId) return null;
      return createUtilitiesClient(
        utilitiesHttp({ env: o.env, sdk: o.sdk, token: async () => caller.token, base: o.env.utilitiesBase, ...(o.fetch ? { fetch: o.fetch } : {}) }),
      );
    },
  };
}
