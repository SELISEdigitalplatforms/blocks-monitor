// What the Platform overview reads from the billing and engine functions. Every read is defensive: an op that is not
// there yet, refused or failing answers null, and the overview shows a plain empty state instead of an error.
import { useQuery } from "@tanstack/react-query";
import { callFunction } from "@/blocks/fn";
import { useSession } from "@/blocks/session";
import type { FunctionName } from "@/blocks/functions";
import { listWorkspaces } from "@/blocks/workspaces/ops";
import { t } from "@/i18n";
import { FRESHNESS_MS, freshnessQuery } from "@/blocks/data/freshness";

type Row = Record<string, unknown>;

/** One op's data, or null when it cannot be read for any reason. */
export async function readOp(fn: string, op: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    const out = await callFunction<unknown>(fn as FunctionName, op, args, { timeoutMs: 15_000 });
    return out.data ?? null;
  } catch {
    return null;
  }
}

/** The first op that answers (the engine ops live in a platform function or in the admin function; a function name the
 *  app does not know fails at once, without a request). */
async function readFirst(calls: readonly (readonly [string, string, Record<string, unknown>?])[]): Promise<unknown> {
  for (const [fn, op, args] of calls) {
    const v = await readOp(fn, op, args ?? {});
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** A list from an answer that is the list itself or holds it under one of `keys`. */
export function listFrom(data: unknown, keys: readonly string[]): Row[] {
  if (Array.isArray(data)) return data.filter(isRow);
  if (!isRow(data)) return [];
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) return v.filter(isRow);
  }
  return [];
}

/** A field in either spelling the functions use (CpuPercent or cpuPercent). */
export function field(r: Row, name: string): unknown {
  if (name in r) return r[name];
  const alt = name[0] === name[0].toUpperCase() ? name[0].toLowerCase() + name.slice(1) : name[0].toUpperCase() + name.slice(1);
  return r[alt];
}

export function numField(r: Row, name: string): number | null {
  const v = field(r, name);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function textField(r: Row, name: string): string {
  const v = field(r, name);
  return typeof v === "string" ? v : "";
}

const tokensOf = (r: Row): number => {
  const t = field(r, "tokens");
  if (typeof t === "number") return t;
  if (isRow(t)) return numField(t, "total") ?? 0;
  return 0;
};

export interface MonthUsage { costUsd: number; tokens: number; rows: number; /** engine jobs running on the platform */ runningJobs?: number }

/** This month's measured cost across the platform, from billing.usage.report; null when it cannot be read. */
export function usageFromReport(data: unknown): MonthUsage | null {
  if (data === null || data === undefined) return null;
  const rows = listFrom(data, ["rows", "items"]);
  if (!Array.isArray(data) && !isRow(data)) return null;
  if (isRow(data) && rows.length === 0) {
    const cost = numField(data, "totalCostUsd") ?? numField(data, "costUsd");
    if (cost !== null) return { costUsd: cost, tokens: numField(data, "totalTokens") ?? tokensOf(data), rows: 0 };
  }
  const running = isRow(data) ? numField(data, "runningJobs") : null;
  return {
    costUsd: rows.reduce((s, r) => s + (numField(r, "costUsd") ?? 0), 0),
    tokens: rows.reduce((s, r) => s + tokensOf(r), 0),
    rows: rows.length,
    ...(running !== null ? { runningJobs: running } : {}),
  };
}

export interface EngineHostView {
  id: string; name: string; lastSeenAt: string | null; cpuPercent: number | null;
  runningJobs: number; activeAgents: number; queueLength: number;
}

export function hostsFrom(data: unknown): EngineHostView[] {
  return listFrom(data, ["hosts", "items"]).map((h) => ({
    id: textField(h, "HostId") || textField(h, "ItemId"),
    name: textField(h, "Name") || textField(h, "HostId") || t("platform.overview.engineHostFallback", "Engine host"),
    lastSeenAt: textField(h, "LastSeenAt") || null,
    cpuPercent: numField(h, "CpuPercent"),
    runningJobs: numField(h, "RunningJobs") ?? 0,
    activeAgents: numField(h, "ActiveAgents") ?? 0,
    queueLength: numField(h, "QueueLength") ?? 0,
  }));
}

/** A host that has not reported for this long is called out on the overview. */
export const HOST_SILENT_MS = 5 * 60_000;

export function isHostSilent(h: EngineHostView, now: number): boolean {
  const at = h.lastSeenAt ? Date.parse(h.lastSeenAt) : NaN;
  return !Number.isFinite(at) || now - at > HOST_SILENT_MS;
}

export interface AiAccountView { label: string; status: string; usage5h: number | null; resetsAt: string | null }

export function aiAccountsFrom(data: unknown): AiAccountView[] {
  return listFrom(data, ["accounts", "items"]).map((a) => ({
    label: textField(a, "Label") || t("platform.overview.aiAccountFallback", "A model account"),
    status: textField(a, "Status").toLowerCase(),
    usage5h: numField(a, "Usage5hPercent"),
    resetsAt: textField(a, "ResetsAt") || null,
  }));
}

export function pendingPurchasesFrom(data: unknown): number {
  return listFrom(data, ["items", "requests", "purchases"]).filter((r) => (textField(r, "Status") || "pending").toLowerCase() === "pending").length;
}

export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** The overview's tiles are near (docs/FRESHNESS.md): read again every 60 s while the page is open and the tab shown;
 *  an answer the tile cannot use (null) is not a failure, so it keeps the pace. */
const OVERVIEW_QUERY = { retry: false, refetchOnWindowFocus: false, ...freshnessQuery("near") } as const;

/** Credit used this month follows the agents' work like every usage figure (the usage tier: every 10 s while an engine
 *  job runs on the platform, every minute otherwise). */
export function useMonthUsage(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "overview", "usage", monthStart(new Date())],
    queryFn: async () => usageFromReport(await readOp("billing", "billing.usage.report", {
      from: monthStart(new Date()), to: new Date().toISOString(), groupBy: "workspace",
    })),
    enabled, ...OVERVIEW_QUERY,
    ...freshnessQuery<MonthUsage | null>("usage", { busy: (d) => (d?.runningJobs ?? 0) > 0 }),
  });
}

export function useEngineHosts(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "overview", "engine"],
    queryFn: async () => {
      // the hosts only: the tiles show no history, so no day of samples per host is read for them
      const data = await readFirst([["platform", "platform.engine.status", { samples: false }], ["admin", "platform.engine.status", { samples: false }]]);
      return data === null ? null : hostsFrom(data);
    },
    enabled, ...OVERVIEW_QUERY,
  });
}

export function useAiAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "overview", "ai-accounts"],
    queryFn: async () => {
      const data = await readFirst([["platform", "platform.ai.accounts.list"], ["admin", "platform.ai.accounts.list"]]);
      return data === null ? null : aiAccountsFrom(data);
    },
    enabled, ...OVERVIEW_QUERY,
  });
}

export interface OrganizationCounts { active: number; total: number; counted: number }

/** The most organizations the overview counts (10 pages of the platform list). */
export const ORG_COUNT_PAGES = 10;

/** Active and total organizations over every page of workspace.list (up to ORG_COUNT_PAGES), or null when unreadable. */
export async function countOrganizations(list: (page: number) => ReturnType<typeof listWorkspaces> = listWorkspaces): Promise<OrganizationCounts | null> {
  let active = 0;
  let counted = 0;
  let total = 0;
  for (let page = 1; page <= ORG_COUNT_PAGES; page++) {
    let out: Awaited<ReturnType<typeof listWorkspaces>>;
    try { out = await list(page); } catch { return page === 1 ? null : { active, total, counted }; }
    if (!out.ok) return page === 1 ? null : { active, total, counted };
    const { items, totalCount } = out.value;
    total = totalCount;
    counted += items.length;
    active += items.filter((w) => !w.status || w.status === "active").length;
    if (items.length === 0 || counted >= totalCount) break;
  }
  return { active, total, counted };
}

/** workspace.list is an audited read: counted at most once in five minutes, like the Organizations list itself. */
export function useOrganizationCounts(enabled: boolean) {
  const uid = useSession((s) => s.profile?.userId ?? null);
  return useQuery({
    queryKey: ["platform", "overview", "organizations", uid ?? ""], queryFn: () => countOrganizations(),
    // calm, and never on a clock (each read is audited): when the overview opens, at most once in five minutes
    enabled: enabled && Boolean(uid), ...OVERVIEW_QUERY, staleTime: FRESHNESS_MS.calm.busy, refetchInterval: false,
  });
}

export function usePendingPurchases(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "overview", "purchases"],
    queryFn: async () => {
      const data = await readOp("billing", "billing.purchases.list", { status: "pending" });
      return data === null ? null : pendingPurchasesFrom(data);
    },
    // a request waits for a person, not for the engine: near at its calmer pace (every 2 min)
    enabled, ...OVERVIEW_QUERY, ...freshnessQuery("near", { busy: false }),
  });
}

export interface AttentionItem { id: string; text: string; to: string; tone: "danger" | "warning" | "neutral" }

function clock(at: string | null): string {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
}

/** What waits for the super admin, most urgent first. A source that could not be read (null) adds nothing. */
export function attentionItems(i: {
  pendingPurchases: number | null; waitingPeople: number | null;
  hosts: readonly EngineHostView[] | null; aiAccounts: readonly AiAccountView[] | null; now: number;
}): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const h of i.hosts ?? []) {
    if (isHostSilent(h, i.now)) {
      const since = clock(h.lastSeenAt);
      out.push({ id: `host-silent-${h.id || h.name}`, tone: "danger", to: "/admin/engine",
        text: since
          ? t("platform.overview.attention.hostSilentSince", "{name} has not reported since {since}", { name: h.name, since })
          : t("platform.overview.attention.hostSilent", "{name} has not reported yet", { name: h.name }) });
    } else if ((h.cpuPercent ?? 0) >= 90) {
      out.push({ id: `host-busy-${h.id || h.name}`, tone: "warning", to: "/admin/engine",
        text: t("platform.overview.attention.hostBusy", "{name} is under heavy load ({cpu}% CPU)", { name: h.name, cpu: Math.round(h.cpuPercent ?? 0) }) });
    }
  }
  const accounts = i.aiAccounts ?? [];
  if (accounts.length > 0 && !accounts.some((a) => a.status === "active")) {
    out.push({ id: "ai-none-active", tone: "danger", to: "/admin/ai-accounts", text: t("platform.overview.attention.noAiActive", "No model account is active: the engine cannot start new work") });
  }
  for (const a of accounts) {
    if (a.status === "cooling") {
      const until = clock(a.resetsAt);
      out.push({ id: `ai-cooling-${a.label}`, tone: "neutral", to: "/admin/ai-accounts",
        text: until
          ? t("platform.overview.attention.aiRestingUntil", "{label} is resting until {until}", { label: a.label, until })
          : t("platform.overview.attention.aiResting", "{label} is resting until its limit resets", { label: a.label }) });
    } else if (a.status === "active" && (a.usage5h ?? 0) >= 90) {
      out.push({ id: `ai-high-${a.label}`, tone: "warning", to: "/admin/ai-accounts",
        text: t("platform.overview.attention.aiHigh", "{label} has used {percent}% of its 5-hour limit", { label: a.label, percent: Math.round(a.usage5h ?? 0) }) });
    }
  }
  if ((i.pendingPurchases ?? 0) > 0) {
    const n = i.pendingPurchases ?? 0;
    out.push({ id: "purchases", tone: "warning", to: "/admin/credits",
      text: n === 1
        ? t("platform.overview.attention.purchasesOne", "{count} purchase request waits for your decision", { count: n })
        : t("platform.overview.attention.purchasesMany", "{count} purchase requests wait for your decision", { count: n }) });
  }
  if ((i.waitingPeople ?? 0) > 0) {
    const n = i.waitingPeople ?? 0;
    out.push({ id: "people", tone: "neutral", to: "/admin/people", text: n === 1
      ? t("platform.overview.attention.peopleOne", "{count} person waits for an account", { count: n })
      : t("platform.overview.attention.peopleMany", "{count} people wait for an account", { count: n }) });
  }
  return out;
}

export function formatUsd(n: number): string {
  return `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatTokens(n: number): string {
  return t("platform.overview.tokens", "{amount} tokens", { amount: new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) });
}
