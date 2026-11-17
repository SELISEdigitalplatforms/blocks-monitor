// The plan catalogue as anyone may see it, signed in or not (the pricing page): what billing.plans.public and
// GET /api/public/plans answer. Only the active plans, in their order, with exactly the fields below; nothing internal
// (record ids, the active flag, stamps, coupons, settings) ever leaves in it. Shared by the billing function, the public
// route and the pricing page, so the three agree field for field.
import { ASSISTED, type Assisted, type PlanView } from "./billing";

export interface PublicPlan {
  key: string;
  name: string;
  /** null: contact sales (no list price). */
  priceUsd: number | null;
  /** Credit included: per month for paid plans, once at sign-up for Free; 0 with contact sales (agreed with sales). */
  creditUsd: number;
  assisted: Assisted;
  /** null: agreed with sales. */
  maxParallelStreams: number | null;
  /** Queue weight: higher goes first. */
  priority: number;
  features: string[];
  contactSales: boolean;
  sortOrder: number;
}

/** The only fields a public plan carries (the tests hold the answers to exactly this list). */
export const PUBLIC_PLAN_FIELDS = [
  "key", "name", "priceUsd", "creditUsd", "assisted", "maxParallelStreams", "priority", "features", "contactSales", "sortOrder",
] as const;

const finite = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

/** A stored plan as the public sees it: a fresh copy of the allowed fields only. */
export function toPublicPlan(p: PlanView): PublicPlan {
  const contactSales = p.contactSales === true || p.priceUsd === null;
  const streams = p.maxParallelStreams;
  return {
    key: p.key,
    name: p.name,
    priceUsd: contactSales ? null : finite(p.priceUsd),
    creditUsd: Math.max(0, finite(p.creditUsd)),
    assisted: (ASSISTED as readonly string[]).includes(p.assisted) ? p.assisted : "none",
    maxParallelStreams: typeof streams === "number" && Number.isFinite(streams) && streams > 0 ? streams : null,
    priority: finite(p.priority),
    features: p.features.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim()),
    contactSales,
    sortOrder: finite(p.sortOrder),
  };
}

/** The active plans with a key, one per key (the first wins), in their order. */
export function publicPlansOf(plans: readonly PlanView[]): PublicPlan[] {
  const seen = new Set<string>();
  const out: PublicPlan[] = [];
  for (const p of plans) {
    if (p.active !== true || !p.key || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(toPublicPlan(p));
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---------------------------------------------------------------- reading an answer (the pricing page)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One plan of an answer, or null when it is not one. */
export function parsePublicPlan(v: unknown): PublicPlan | null {
  if (!isRecord(v)) return null;
  const key = typeof v.key === "string" ? v.key.trim() : "";
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!key || !name) return null;
  const contactSales = v.contactSales === true || v.priceUsd === null;
  const price = finite(v.priceUsd, NaN);
  if (!contactSales && !(price >= 0)) return null;
  const streams = finite(v.maxParallelStreams, NaN);
  return {
    key,
    name,
    priceUsd: contactSales ? null : price,
    creditUsd: Math.max(0, finite(v.creditUsd)),
    assisted: typeof v.assisted === "string" && (ASSISTED as readonly string[]).includes(v.assisted) ? (v.assisted as Assisted) : "none",
    maxParallelStreams: streams > 0 ? streams : null,
    priority: finite(v.priority),
    features: Array.isArray(v.features) ? v.features.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim()) : [],
    contactSales,
    sortOrder: finite(v.sortOrder),
  };
}

/** `{ ok: true, data: { plans: [...] } }` (the route) or `{ plans: [...] }` (the op's data): the plans (an empty list when
 *  the catalogue lists none), or null when the answer is not a catalogue (an error, a page, plans none of which reads). */
export function parsePublicPlans(body: unknown): PublicPlan[] | null {
  const data = isRecord(body) && body.ok === true && isRecord(body.data) ? body.data : body;
  if (!isRecord(data) || !Array.isArray(data.plans)) return null;
  const plans = data.plans.map(parsePublicPlan).filter((p): p is PublicPlan => p !== null);
  if (plans.length === 0 && data.plans.length > 0) return null;
  return plans.sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
