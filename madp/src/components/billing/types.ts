// What the billing function answers (the shared platform contract, functions/billing): the plan list, a workspace's
// usage summary, and the outcome of a coupon or a purchase request. Every reply is read defensively: a field the
// function leaves out reads as nothing, never as an invented figure.
import { t } from "@/i18n";

export type PlanKey = "free" | "classic" | "speed" | "enterprise";

/** Who helps the workspace besides the agents: nobody, a tech-lead consultant, a business consultant, a dedicated team. */
export type Assisted = "none" | "tech-lead" | "business" | "dedicated";

/** billing.summary → plan */
export interface SummaryPlan {
  key: string;
  name: string;
  assisted: Assisted;
  /** null: custom (Enterprise) */
  maxParallelStreams: number | null;
}

/** billing.summary → perProject[] */
export interface ProjectUsage {
  projectId: string;
  name: string;
  costUsd: number;
  tokens: number;
}

/** A plan or credit request of the workspace that waits for a platform administrator (billing.summary → pendingRequests). */
export interface PendingRequest {
  id: string;
  planKey: string | null;
  amountUsd: number | null;
  createdAt: string | null;
}

/** billing.summary {workspaceId}: the contract's fields, plus the additive ones the billing function answers (null when
 *  it leaves them out). Balance, granted and consumed are all-time; the month figures are since the 1st (UTC). */
export interface BillingSummary {
  /** null: the workspace has no plan yet */
  plan: SummaryPlan | null;
  balanceUsd: number;
  grantedUsd: number;
  consumedUsd: number;
  tokens: number;
  perProject: ProjectUsage[];
  activeAgents: number;
  runningJobs: number;
  /** used since the first day of this month; null when the function does not say */
  monthUsedUsd?: number | null;
  monthTokens?: number | null;
  /** when the plan's next credit comes (the subscription's RenewsAt) */
  renewsAt?: string | null;
  pendingRequests?: PendingRequest[];
}

/** One plan of billing.plans.list (the Plan schema). */
export interface BillingPlan {
  key: string;
  name: string;
  /** null: contact sales (no price) */
  priceUsd: number | null;
  creditUsd: number | null;
  assisted: Assisted;
  maxParallelStreams: number | null;
  priority: number | null;
  features: string[];
  contactSales: boolean;
  active: boolean;
  sortOrder: number;
}

/** What one build has cost (its usage entry, as charged), so far while it runs. */
export interface BuildUsage {
  /** charged so far; null: nothing charged (yet) */
  costUsd: number | null;
  tokens: number | null;
  /** true while the build runs: what is shown is what its finished parts have cost so far */
  running: boolean;
}

/** billing.jobs.usage → jobs[]: what one job of the workspace has cost so far (charged, never the measured cost). */
export interface JobUsageView {
  jobId: string;
  costUsd: number;
  tokens: number;
  at: string | null;
}

/** billing.requestPurchase {workspaceId, planKey | amountUsd} */
export type PurchaseRequestArgs = { workspaceId: string; planKey: string; amountUsd?: never; note?: string }
  | { workspaceId: string; amountUsd: number; planKey?: never; note?: string };

/* ── reading the replies ──────────────────────────────────────────────────── */

const ASSISTED: readonly Assisted[] = ["none", "tech-lead", "business", "dedicated"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
/** A field by its camelCase name, else the record's PascalCase name (a plan list may answer raw Plan rows). */
const field = (r: Record<string, unknown>, name: string): unknown =>
  r[name] !== undefined ? r[name] : r[name.charAt(0).toUpperCase() + name.slice(1)];

export function toAssisted(v: unknown): Assisted {
  return typeof v === "string" && (ASSISTED as readonly string[]).includes(v) ? (v as Assisted) : "none";
}

function toSummaryPlan(v: unknown): SummaryPlan | null {
  if (!isRecord(v)) return null;
  const key = str(v.key);
  if (!key) return null;
  return { key, name: str(v.name) ?? key, assisted: toAssisted(v.assisted), maxParallelStreams: num(v.maxParallelStreams) };
}

function toProjectUsage(v: unknown): ProjectUsage | null {
  if (!isRecord(v)) return null;
  const projectId = str(v.projectId);
  if (!projectId) return null;
  return { projectId, name: str(v.name) ?? t("billing.data.removedProject", "A removed project"), costUsd: num(v.costUsd) ?? 0, tokens: Math.max(0, Math.round(num(v.tokens) ?? 0)) };
}

/** A billing.summary reply, or null when it is not one (no balance: nothing to show). */
export function toBillingSummary(v: unknown): BillingSummary | null {
  if (!isRecord(v)) return null;
  const balanceUsd = num(v.balanceUsd);
  if (balanceUsd === null) return null;
  const perProject = Array.isArray(v.perProject) ? v.perProject.map(toProjectUsage).filter((p): p is ProjectUsage => p !== null) : [];
  perProject.sort((a, b) => b.costUsd - a.costUsd || a.name.localeCompare(b.name));
  const month = num(v.monthUsedUsd);
  const monthTokens = num(v.monthTokens);
  const sub = isRecord(v.subscription) ? v.subscription : null;
  // no "next credit" for a plan that ends on its renewal day (cancelled at period end)
  const renewsAt = sub && sub.status === "active" && sub.cancelAtPeriodEnd !== true && typeof sub.renewsAt === "string" && Number.isFinite(Date.parse(sub.renewsAt)) ? sub.renewsAt : null;
  const pendingRequests = Array.isArray(v.pendingRequests) ? v.pendingRequests.map(toPendingRequest).filter((p): p is PendingRequest => p !== null) : [];
  return {
    plan: toSummaryPlan(v.plan),
    balanceUsd,
    grantedUsd: Math.max(0, num(v.grantedUsd) ?? 0),
    consumedUsd: Math.max(0, num(v.consumedUsd) ?? 0),
    tokens: Math.max(0, Math.round(num(v.tokens) ?? 0)),
    perProject,
    activeAgents: Math.max(0, Math.round(num(v.activeAgents) ?? 0)),
    runningJobs: Math.max(0, Math.round(num(v.runningJobs) ?? 0)),
    monthUsedUsd: month === null ? null : Math.max(0, month),
    monthTokens: monthTokens === null ? null : Math.max(0, Math.round(monthTokens)),
    renewsAt,
    pendingRequests,
  };
}

function toPendingRequest(v: unknown): PendingRequest | null {
  if (!isRecord(v) || (v.status !== undefined && v.status !== "pending")) return null;
  const id = str(v.id);
  if (!id) return null;
  return { id, planKey: str(v.planKey), amountUsd: num(v.amountUsd), createdAt: str(v.createdAt) };
}

function toFeatures(v: unknown): string[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.map(str).filter((s): s is string => s !== null) : [];
}

/** One plan row (camelCase or the schema's PascalCase), or null without a key. */
export function toBillingPlan(v: unknown): BillingPlan | null {
  if (!isRecord(v)) return null;
  const key = str(field(v, "key"));
  if (!key) return null;
  const contactSales = field(v, "contactSales") === true;
  const priceUsd = contactSales ? null : num(field(v, "priceUsd"));
  return {
    key,
    name: str(field(v, "name")) ?? key,
    priceUsd,
    creditUsd: num(field(v, "creditUsd")),
    assisted: toAssisted(field(v, "assisted")),
    maxParallelStreams: num(field(v, "maxParallelStreams")),
    priority: num(field(v, "priority")),
    features: toFeatures(field(v, "features") ?? field(v, "featuresJson")),
    contactSales: contactSales || (priceUsd === null && key === "enterprise"),
    active: field(v, "active") !== false,
    sortOrder: num(field(v, "sortOrder")) ?? 0,
  };
}

/** billing.plans.list: an array or { plans: [...] }; the active plans, in their order. */
export function toBillingPlans(v: unknown): BillingPlan[] {
  const rows = Array.isArray(v) ? v : isRecord(v) && Array.isArray(v.plans) ? v.plans : isRecord(v) && Array.isArray(v.items) ? v.items : [];
  return rows.map(toBillingPlan).filter((p): p is BillingPlan => p !== null && p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
}

/** billing.jobs.usage: { jobs: [...] }; rows without a job id are left out, figures never below zero. */
export function toJobUsages(v: unknown): JobUsageView[] {
  const rows = isRecord(v) && Array.isArray(v.jobs) ? v.jobs : [];
  return rows.flatMap((r): JobUsageView[] => {
    if (!isRecord(r)) return [];
    const jobId = str(r.jobId);
    if (!jobId) return [];
    return [{ jobId, costUsd: Math.max(0, num(r.costUsd) ?? 0), tokens: Math.max(0, Math.round(num(r.tokens) ?? 0)), at: str(r.at) }];
  });
}

/** The build in focus as "This build": `usage` is its charge (null: none, undefined: not read yet). A running build
 *  shows what its finished parts cost so far; a finished build without a charge reads as not counted; nothing while
 *  the charge of a finished build is still being read. */
export function toBuildUsage(usage: JobUsageView | null | undefined, running: boolean): BuildUsage | null {
  if (running) return { costUsd: usage ? usage.costUsd : null, tokens: usage ? usage.tokens : null, running: true };
  if (usage === undefined) return null;
  return usage ? { costUsd: usage.costUsd, tokens: usage.tokens, running: false } : { costUsd: null, tokens: null, running: false };
}
