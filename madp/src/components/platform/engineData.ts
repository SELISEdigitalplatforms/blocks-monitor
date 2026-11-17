// Platform → Engine & capacity and Model accounts: the reads and the one write (the admin function's platform.engine.*
// and platform.ai.accounts.* ops), and the pure helpers the sections render with.
// Freshness (docs/FRESHNESS.md): the host cards are live (every 30 s while a host runs work, its heartbeat's pace), the
// 24-hour sample history is batch (read in full when the page opens and then every 30 min; between those reads each
// host's live reading is added as the newest point, so the charts end at "now" without reading a day of samples
// every 30 s), the AI accounts are near (every 60 s).
// A history that cannot be read never hides the host cards: the hosts are shown, the page says the history is missing,
// and the history is tried again after ENGINE_HISTORY_RETRY_MS or at once with "Try again".
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { callFunction } from "@/blocks/fn";
import { t } from "@/i18n";
import { FRESHNESS_MS, freshnessQuery } from "@/blocks/data/freshness";
import { STATUS_WINDOW_MS, type AiAccountChange, type AiAccountsAnswer, type EngineHostView, type EngineSampleView, type EngineStatus } from "@/domain/platformEngine";

export const engineKeys = {
  status: ["platform", "engine", "status"] as const,
  accounts: ["platform", "engine", "ai-accounts"] as const,
};

/** How old the sample history may get before the next status read takes it in full again. */
export const ENGINE_HISTORY_MS = FRESHNESS_MS.batch.busy;
/** After a history read failed, the next status read tries it again once this much time has passed. */
export const ENGINE_HISTORY_RETRY_MS = FRESHNESS_MS.calm.busy;

/** The status as the Engine page holds it: the server's sample history kept apart from the live points added to it. */
export interface EngineStatusHeld extends EngineStatus {
  /** The samples of the last full read that succeeded (the server's rows only). */
  history: EngineSampleView[];
  /** When the history was read (browser clock, epoch ms; 0 = never). */
  historyReadAt: number;
  /** The last try to read the history failed: the history above is older (or empty) and the charts may have gaps. */
  historyFailed: boolean;
  /** When the history was last tried (browser clock, epoch ms). */
  historyTriedAt: number;
}

export type EngineStatusCall = (args: Record<string, unknown>) => Promise<EngineStatus>;

const callStatus: EngineStatusCall = async (args) => (await callFunction<EngineStatus>("admin", "platform.engine.status", args)).data;

/** The history plus each host's live reading (its last heartbeat) as the newest point, inside the 24-hour window. */
export function withLivePoints(history: readonly EngineSampleView[], hosts: readonly EngineHostView[], serverNow: string): EngineSampleView[] {
  const nowMs = Date.parse(serverNow);
  const since = Number.isFinite(nowMs) ? nowMs - STATUS_WINDOW_MS : -Infinity;
  const kept = history.filter((s) => Date.parse(s.at) >= since);
  const newest = new Map<string, string>();
  for (const s of kept) if ((newest.get(s.hostId) ?? "") < s.at) newest.set(s.hostId, s.at);
  const live = hosts
    .filter((h) => h.lastSeenAt && h.lastSeenAt > (newest.get(h.hostId) ?? "") && Date.parse(h.lastSeenAt) >= since)
    .map((h): EngineSampleView => ({ hostId: h.hostId, at: h.lastSeenAt, cpuPercent: h.cpuPercent, memUsedMb: h.memUsedMb, runningJobs: h.runningJobs, activeAgents: h.activeAgents }));
  return live.length ? [...kept, ...live].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) : kept;
}

/** True when the next status read should take the sample history too. */
export function historyDue(prev: EngineStatusHeld | undefined, now: number): boolean {
  if (!prev) return true;
  if (prev.historyFailed) return now - prev.historyTriedAt >= ENGINE_HISTORY_RETRY_MS;
  return now - prev.historyReadAt >= ENGINE_HISTORY_MS;
}

/** One status read: the hosts every time, the sample history only when it is due (historyDue: one small read instead
 *  of up to 1,450 samples per host on every live tick). A history read that fails, as an answer with samplesFailed or
 *  as a failed call, keeps the hosts: a failed call is followed by a hosts-only read, and only when that fails too does
 *  the read fail (the page then shows its error with "Try again"). */
export async function readEngineStatus(prev: EngineStatusHeld | undefined, now: number, call: EngineStatusCall = callStatus): Promise<EngineStatusHeld> {
  const kept = { history: prev?.history ?? [], historyReadAt: prev?.historyReadAt ?? 0 };
  const held = (fresh: EngineStatus, h: { history: EngineSampleView[]; historyReadAt: number; historyFailed: boolean; historyTriedAt: number }): EngineStatusHeld =>
    ({ ...fresh, ...h, samples: withLivePoints(h.history, fresh.hosts, fresh.now) });
  if (!historyDue(prev, now)) {
    const fresh = await call({ samples: false });
    return held(fresh, { ...kept, historyFailed: prev!.historyFailed, historyTriedAt: prev!.historyTriedAt });
  }
  let fresh: EngineStatus;
  try {
    fresh = await call({});
  } catch (error) {
    let hostsOnly: EngineStatus;
    try {
      hostsOnly = await call({ samples: false });
    } catch {
      throw error;
    }
    return held(hostsOnly, { ...kept, historyFailed: true, historyTriedAt: now });
  }
  if (fresh.samplesFailed) return held(fresh, { ...kept, historyFailed: true, historyTriedAt: now });
  return held(fresh, { history: fresh.samples, historyReadAt: now, historyFailed: false, historyTriedAt: now });
}

/** Something runs on a host: the live pace. */
export const engineBusy = (s: EngineStatus | undefined): boolean => Boolean(s?.hosts.some((h) => h.runningJobs > 0 || h.activeAgents > 0 || h.queueLength > 0));

export function useEngineStatus(enabled = true): UseQueryResult<EngineStatusHeld, Error> {
  const qc = useQueryClient();
  return useQuery({
    queryKey: engineKeys.status,
    queryFn: () => readEngineStatus(qc.getQueryData<EngineStatusHeld>(engineKeys.status), Date.now()),
    enabled,
    ...freshnessQuery<EngineStatusHeld>("live", { busy: engineBusy }),
    retry: 1,
  });
}

/** "Try again" for a history that could not be read: the next status read takes the history at once. */
export function useRetryEngineHistory(): () => void {
  const qc = useQueryClient();
  return () => {
    const state = qc.getQueryState<EngineStatusHeld>(engineKeys.status);
    qc.setQueryData<EngineStatusHeld>(engineKeys.status, (d) => (d ? { ...d, historyTriedAt: Number.NEGATIVE_INFINITY } : d), { updatedAt: state?.dataUpdatedAt });
    void qc.refetchQueries({ queryKey: engineKeys.status, exact: true });
  };
}

export function useAiAccounts(enabled = true): UseQueryResult<AiAccountsAnswer, Error> {
  return useQuery({
    queryKey: engineKeys.accounts,
    queryFn: async () => (await callFunction<AiAccountsAnswer>("admin", "platform.ai.accounts.list", {})).data,
    enabled,
    ...freshnessQuery("near"),
    retry: 1,
  });
}

export function useSaveAiAccounts(): UseMutationResult<AiAccountsAnswer, Error, { changes?: AiAccountChange[]; rotateAtPercent?: number }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args) => (await callFunction<AiAccountsAnswer>("admin", "platform.ai.accounts.save", args)).data,
    onSuccess: (data) => qc.setQueryData(engineKeys.accounts, data),
  });
}

/** "just now", "40 s ago", "12 min ago", "3 h ago", "2 days ago"; "never" without a time. */
export function ago(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return t("platform.engine.time.never", "never");
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return t("platform.engine.time.justNow", "just now");
  if (s < 60) return t("platform.engine.time.secondsAgo", "{s} s ago", { s });
  const m = Math.round(s / 60);
  if (m < 60) return t("platform.engine.time.minutesAgo", "{m} min ago", { m });
  const h = Math.round(m / 60);
  if (h < 48) return t("platform.engine.time.hoursAgo", "{h} h ago", { h });
  return t("platform.engine.time.daysAgo", "{d} days ago", { d: Math.round(h / 24) });
}

/** "in 2 h 10 min", "in 25 min"; "" when unknown or past. */
export function until(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at <= now) return "";
  const m = Math.round((at - now) / 60_000);
  if (m < 60) return t("platform.engine.time.inMinutes", "in {m} min", { m: Math.max(1, m) });
  const h = Math.floor(m / 60);
  if (h < 48) {
    return m % 60
      ? t("platform.engine.time.inHoursMinutes", "in {h} h {m} min", { h, m: m % 60 })
      : t("platform.engine.time.inHours", "in {h} h", { h });
  }
  return t("platform.engine.time.inDays", "in {d} days", { d: Math.round(h / 24) });
}

/** 93784 s → "1 day 2 h", 7260 → "2 h 1 min". */
export function duration(seconds: number): string {
  if (!(seconds > 0)) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) {
    const days = d === 1 ? t("platform.engine.time.oneDay", "1 day") : t("platform.engine.time.days", "{d} days", { d });
    return h ? t("platform.engine.time.daysHours", "{days} {h} h", { days, h }) : days;
  }
  if (h > 0) return m ? t("platform.engine.time.hoursMinutes", "{h} h {m} min", { h, m }) : t("platform.engine.time.hours", "{h} h", { h });
  return t("platform.engine.time.minutes", "{m} min", { m });
}

export const gb = (mb: number): string => `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;

export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "—";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "—";
  return at.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export interface HourRow {
  hour: string;
  cpuAvg: number;
  cpuMax: number;
  memAvgMb: number;
  agentsMax: number;
  jobsMax: number;
}

/** The samples of one host by hour (the table view of the charts): averages and peaks, oldest first. */
export function samplesByHour(samples: readonly EngineSampleView[]): HourRow[] {
  const groups = new Map<string, EngineSampleView[]>();
  for (const s of samples) {
    const key = s.at.slice(0, 13);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, list]) => {
      const avg = (f: (s: EngineSampleView) => number) => list.reduce((t, s) => t + f(s), 0) / list.length;
      const max = (f: (s: EngineSampleView) => number) => Math.max(...list.map(f));
      return {
        hour: `${key}:00:00.000Z`,
        cpuAvg: Math.round(avg((s) => s.cpuPercent)),
        cpuMax: Math.round(max((s) => s.cpuPercent)),
        memAvgMb: Math.round(avg((s) => s.memUsedMb)),
        agentsMax: max((s) => s.activeAgents),
        jobsMax: max((s) => s.runningJobs),
      };
    });
}
