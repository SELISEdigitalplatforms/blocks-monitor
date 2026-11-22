// The payment providers behind checkout (src/domain/payments.ts PaymentProvider).
//
// "coupon" works now: codes pay plans, take discounts off or add credit; nothing is ever charged to a card.
// "blocks" is the Blocks OS payment gateway (Stripe underneath). It is a complete adapter over a transport port and
// refuses every call with "not connected" until the host provides both:
//   - the gateway configuration from host secrets (process env of the function host, filled from the Blocks secret
//     store; never Blocks data, never the UI): MF_BILLING_GATEWAY (the gateway's name: a Blocks Logic proxy slug or the
//     gateway service id), MF_BILLING_WEBHOOK_SECRET (the event signing secret) and MF_BILLING_PRICE_IDS (JSON
//     {planKey: priceId}); and
//   - a transport: the call path the Blocks team confirms (the @seliseblocks/client SDK with the service identity,
//     e.g. blocksClient.logic.proxy.request(slug, …) for a proxy that holds the Stripe key as {{$VAR.…}}).
// No Blocks payment service, SDK module or CLI command exists in the vendored skills or the installed SDK today, so no
// transport is wired: PlatformSetting billing.provider = "blocks" answers "not connected" until one is.
// The request shapes below follow Stripe's API (checkout sessions, subscriptions, billing portal, signed events) as a
// Blocks proxy would forward them.
import {
  CARD_NOT_CONNECTED,
  couponProvider,
  quoteCode,
  type PaymentProvider,
  type PaymentProviderId,
  type ProviderAnswer,
  type ProviderEvent,
} from "../../../src/domain/payments";

export interface GatewayConfig {
  /** The gateway's name (a Blocks Logic proxy slug or service id). */
  gateway: string;
  /** Verifies provider events (never sent anywhere). */
  webhookSecret: string;
  /** The gateway's price id per plan key. */
  priceIds: Readonly<Record<string, string>>;
}

/** The call path to the gateway; the host builds it with the Blocks SDK. Throws on a non-2xx answer. */
export interface GatewayTransport {
  request(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The gateway configuration from host secrets, or null when any part is missing. */
export function gatewayConfigFromEnv(env: Readonly<Record<string, string | undefined>>): GatewayConfig | null {
  const gateway = (env.MF_BILLING_GATEWAY ?? "").trim();
  const webhookSecret = (env.MF_BILLING_WEBHOOK_SECRET ?? "").trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(gateway) || !webhookSecret || webhookSecret.includes("{{")) return null;
  let priceIds: Record<string, string> = {};
  try {
    const parsed = JSON.parse(env.MF_BILLING_PRICE_IDS ?? "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      priceIds = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
    }
  } catch {
    return null;
  }
  if (!Object.keys(priceIds).length) return null;
  return { gateway, webhookSecret, priceIds };
}

const notConnected = <T,>(): ProviderAnswer<T> => ({ ok: false, code: "not_connected", message: CARD_NOT_CONNECTED });
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const iso = (unix: unknown): string => (typeof unix === "number" ? new Date(unix * 1000).toISOString() : "");

/** Constant-time compare of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Events older than this are refused (replays). */
const EVENT_TOLERANCE_S = 300;

/** The Blocks OS payment gateway adapter (Stripe underneath). */
export function blocksProvider(o: { config: GatewayConfig | null; transport: GatewayTransport | null; now?: () => number; planName?: (key: string) => string }): PaymentProvider {
  const connected = Boolean(o.config && o.transport);
  const now = o.now ?? (() => Date.now());
  const call = async <T,>(fn: (t: GatewayTransport, c: GatewayConfig) => Promise<T>): Promise<ProviderAnswer<T>> => {
    if (!o.config || !o.transport) return notConnected<T>();
    try {
      return { ok: true, value: await fn(o.transport, o.config) };
    } catch {
      return { ok: false, code: "unavailable", message: "The payment service did not answer. Nothing was charged; try again in a moment." };
    }
  };
  return {
    status: () => ({
      id: "blocks",
      connected,
      acceptsCards: connected,
      message: connected ? "Pay by card on the secure payment page." : CARD_NOT_CONNECTED,
    }),
    async createCheckout(c) {
      if (!o.config || !o.transport) return notConnected();
      const price = o.config.priceIds[c.planKey];
      if (!price) return { ok: false, code: "not_connected", message: "Card payments for this plan are being connected." };
      return call(async (t) => {
        const res = await t.request("POST", "checkout/sessions", {
          mode: "subscription",
          client_reference_id: c.paymentId,
          customer_email: c.customerEmail,
          line_items: [{ price, quantity: 1 }],
          metadata: { paymentId: c.paymentId, workspaceId: c.workspaceId, planKey: c.planKey, dueCents: c.dueCents },
        });
        return { providerRef: s(res.id), redirectUrl: s(res.url) || null };
      });
    },
    applyCode: (base, terms, nowIso) => quoteCode(base, terms, nowIso, o.planName),
    async confirm(c) {
      // Nothing due (a code paid it all): settled without the gateway, connected or not.
      if (c.dueCents <= 0) return { ok: true, value: { paidCents: 0, providerRef: c.providerRef || `coupon:${c.paymentId}` } };
      if (!o.config || !o.transport) return notConnected();
      if (!c.providerRef) return { ok: false, code: "payment_required", message: "Open the payment page to pay." };
      const res = await call((t) => t.request("GET", `checkout/sessions/${encodeURIComponent(c.providerRef)}`));
      if (!res.ok) return res;
      if (s(res.value.payment_status) !== "paid") return { ok: false, code: "payment_required", message: "The payment has not arrived yet." };
      return { ok: true, value: { paidCents: Math.round(n(res.value.amount_total)), providerRef: s(res.value.subscription) || c.providerRef } };
    },
    async cancel(x) {
      return call(async (t) => {
        await t.request("POST", `subscriptions/${encodeURIComponent(x.providerRef)}`, { cancel_at_period_end: true });
        return {};
      });
    },
    async resume(x) {
      return call(async (t) => {
        await t.request("POST", `subscriptions/${encodeURIComponent(x.providerRef)}`, { cancel_at_period_end: false });
        return {};
      });
    },
    async portalUrl(x) {
      return call(async (t) => {
        const res = await t.request("POST", "billing_portal/sessions", { subscription: x.providerRef, return_url: x.returnUrl });
        return { url: s(res.url) || null };
      });
    },
    async handleEvent(raw) {
      if (!o.config) return notConnected();
      // Stripe-Signature: t=<unix>,v1=<hex hmac of "<t>.<body>">
      const header = raw.headers["stripe-signature"] ?? "";
      const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2));
      const t = Number(parts.t);
      if (!Number.isFinite(t) || Math.abs(now() / 1000 - t) > EVENT_TOLERANCE_S || !parts.v1) {
        return { ok: false, code: "declined", message: "The event signature is not valid." };
      }
      if (!sameHex(await hmacHex(o.config.webhookSecret, `${parts.t}.${raw.body}`), parts.v1)) {
        return { ok: false, code: "declined", message: "The event signature is not valid." };
      }
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw.body) as Record<string, unknown>;
      } catch {
        return { ok: false, code: "declined", message: "The event is not readable." };
      }
      const obj = ((ev.data as Record<string, unknown> | undefined)?.object ?? {}) as Record<string, unknown>;
      const meta = (obj.metadata ?? {}) as Record<string, unknown>;
      const at = iso(ev.created) || new Date(now()).toISOString();
      let out: ProviderEvent | null = null;
      switch (s(ev.type)) {
        case "checkout.session.completed":
          out = { type: "payment.succeeded", paymentId: s(obj.client_reference_id) || s(meta.paymentId), providerRef: s(obj.subscription) || s(obj.id), paidCents: Math.round(n(obj.amount_total)), at };
          break;
        case "checkout.session.async_payment_failed":
          out = { type: "payment.failed", paymentId: s(obj.client_reference_id) || s(meta.paymentId), providerRef: s(obj.id), reason: "The payment did not go through.", at };
          break;
        case "invoice.paid": {
          const line = ((obj.lines as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0] ?? {};
          const period = (line.period ?? {}) as Record<string, unknown>;
          out = { type: "subscription.renewed", workspaceId: s(meta.workspaceId), providerRef: s(obj.subscription), paidCents: Math.round(n(obj.amount_paid)), periodStart: iso(period.start), periodEnd: iso(period.end), at };
          break;
        }
        case "customer.subscription.deleted":
          out = { type: "subscription.cancelled", workspaceId: s(meta.workspaceId), providerRef: s(obj.id), at };
          break;
        default:
          out = null;
      }
      if (!out) return { ok: false, code: "declined", message: "This event is not used." };
      return { ok: true, value: out };
    },
  };
}

/**
 * The transport to the Blocks payment gateway. None is wired until the Blocks team confirms the gateway's call path
 * (see the header): answering null keeps the "blocks" provider honestly "not connected".
 */
export function gatewayTransportFromHost(): GatewayTransport | null {
  return null;
}

/** The provider the platform uses now (PlatformSetting billing.provider; "coupon" by default). */
export function providerOf(id: PaymentProviderId, planName?: (key: string) => string, env: Readonly<Record<string, string | undefined>> = hostEnv()): PaymentProvider {
  if (id === "blocks") return blocksProvider({ config: gatewayConfigFromEnv(env), transport: gatewayTransportFromHost(), planName });
  return couponProvider(planName);
}

function hostEnv(): Readonly<Record<string, string | undefined>> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}
