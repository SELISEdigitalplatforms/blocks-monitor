// Platform management → Engine & capacity: each engine host's last heartbeat (CPU, memory, disk, load, the work, lanes
// and agents running, the queue, the release) and its last 24 hours (CPU, memory, agents), with a table view.
// The layout shows the section's name and summary; this file renders the content only.
// Every state is said in plain words: reading, no host yet, the engine offline (no heartbeat since <time>), one of
// several hosts silent, the history missing (with "Try again"), the latest reading failed while an older one is shown
// (with "Try again"), and nothing readable at all (with "Try again"). No state is an endless spinner.
import { useState } from "react";
import { AlertTriangle, Server } from "lucide-react";
import { Banner, Bar, Button, Card, Chip, EmptyState, Segmented } from "@/ui/kit";
import { usePlatformAccess } from "@/blocks/admin";
import { useT } from "@/i18n";
import { formatDateTime } from "@/i18n/format";
import { ENGINE_VIEW_PERMISSION, STATUS_WINDOW_MS, hostIsStale, pct, type EngineHostView, type EngineSampleView, type EngineStatus } from "@/domain/platformEngine";
import { ago, clockTime, duration, gb, samplesByHour, useEngineStatus, useRetryEngineHistory } from "../engineData";
import { TrendChart } from "../TrendChart";

const ICON = { size: 18, strokeWidth: 1.75 } as const;

function Meter({ label, value, detail, share }: { label: string; value: string; detail?: string; share: number | null }) {
  const tone = share === null ? "neutral" : share >= 90 ? "danger" : share >= 75 ? "warning" : "accent";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink2">{label}</span>
        <span className="text-[15px] font-medium tabular-nums text-ink">{value}</span>
      </div>
      <Bar value={share ?? 0} tone={tone} className="mt-2" />
      {detail && <div className="mt-1 text-[12px] text-ink3">{detail}</div>}
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-block bg-surface2 px-3 py-2.5">
      <div className="text-[12px] text-ink3">{label}</div>
      <div className="text-[18px] font-medium tabular-nums text-ink">{value}</div>
      {hint && <div className="text-[11px] text-ink3">{hint}</div>}
    </div>
  );
}

export function HostCard({ host, now }: { host: EngineHostView; now: number }) {
  const t = useT();
  const stale = hostIsStale(host.lastSeenAt, now);
  const memShare = pct(host.memUsedMb, host.memTotalMb);
  const diskShare = pct(host.diskUsedGb, host.diskTotalGb);
  const loadShare = host.cpuCount > 0 ? Math.min(100, Math.round((host.load1 / host.cpuCount) * 100)) : null;
  return (
    <Card
      title={host.name || host.hostId}
      icon={<Server {...ICON} />}
      action={
        stale ? (
          <Chip tone="danger" icon={<AlertTriangle size={14} strokeWidth={1.75} />}>{t("platform.engine.host.notReporting", "Not reporting · last seen {ago}", { ago: ago(host.lastSeenAt, now) })}</Chip>
        ) : (
          <Chip tone="success">{t("platform.engine.host.reporting", "Reporting · {ago}", { ago: ago(host.lastSeenAt, now) })}</Chip>
        )
      }
    >
      {stale && (
        <p className="mb-4 text-[14px] text-ink2">
          {host.lastSeenAt && Number.isFinite(Date.parse(host.lastSeenAt))
            ? t("platform.engine.host.staleSince", "No heartbeat since {time}, so the numbers below are from its last report. Its engine worker may have stopped or lost its connection.", { time: formatDateTime(host.lastSeenAt) })
            : t("platform.engine.host.staleNever", "This host has not sent a heartbeat yet. Its engine worker may not have started.")}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Meter label={t("platform.engine.host.cpu", "CPU")} value={`${Math.round(host.cpuPercent)} %`} share={host.cpuPercent} detail={t("platform.engine.host.cores", "{n} cores", { n: host.cpuCount })} />
        <Meter label={t("platform.engine.host.memory", "Memory")} value={t("platform.engine.host.usedOf", "{used} of {total}", { used: gb(host.memUsedMb), total: gb(host.memTotalMb) })} share={memShare} detail={memShare !== null ? t("platform.engine.host.inUse", "{share} % in use", { share: memShare }) : undefined} />
        <Meter label={t("platform.engine.host.disk", "Disk")} value={t("platform.engine.host.diskUsedOf", "{used} of {total} GB", { used: host.diskUsedGb.toFixed(0), total: host.diskTotalGb.toFixed(0) })} share={diskShare} detail={diskShare !== null ? t("platform.engine.host.inUse", "{share} % in use", { share: diskShare }) : undefined} />
        <Meter label={t("platform.engine.host.load", "Load (1 min)")} value={host.load1.toFixed(2)} share={loadShare} detail={t("platform.engine.host.loadDetail", "5 min {load5} · 15 min {load15}", { load5: host.load5.toFixed(2), load15: host.load15.toFixed(2) })} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={t("platform.engine.host.jobsRunning", "Jobs running")} value={host.runningJobs} />
        <Figure label={t("platform.engine.host.lanesRunning", "Lanes running")} value={host.runningLanes} />
        <Figure label={t("platform.engine.host.agentsWorking", "Agents working")} value={host.activeAgents} />
        <Figure label={t("platform.engine.host.queue", "Waiting in the queue")} value={host.queueLength} />
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink2">
        <div className="flex gap-1"><dt className="text-ink3">{t("platform.engine.host.release", "Release")}</dt><dd className="break-all">{host.release || "—"}</dd></div>
        <div className="flex gap-1"><dt className="text-ink3">{t("platform.engine.host.upFor", "Up for")}</dt><dd>{duration(host.uptime)}</dd></div>
        <div className="flex gap-1"><dt className="text-ink3">{t("platform.engine.host.hostId", "Host id")}</dt><dd className="break-all">{host.hostId}</dd></div>
      </dl>
    </Card>
  );
}

export function HostTrends({ host, samples, now }: { host: EngineHostView; samples: readonly EngineSampleView[]; now: number }) {
  const t = useT();
  const [view, setView] = useState<"chart" | "table">("chart");
  const from = now - STATUS_WINDOW_MS;
  const mine = samples.filter((s) => s.hostId === host.hostId);
  const peakAgents = Math.max(4, ...mine.map((s) => s.activeAgents));
  const rows = samplesByHour(mine);
  return (
    <Card
      title={t("platform.engine.trends.title", "Last 24 hours · {host}", { host: host.name || host.hostId })}
      action={
        <Segmented
          label={t("platform.engine.trends.showAs", "Show the last 24 hours as")}
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          options={[{ value: "chart", label: t("platform.engine.trends.charts", "Charts") }, { value: "table", label: t("platform.engine.trends.table", "Table") }]}
        />
      }
    >
      {view === "chart" ? (
        <div className="grid gap-6 md:grid-cols-3">
          <TrendChart title={t("platform.engine.host.cpu", "CPU")} points={mine.map((s) => ({ at: s.at, value: s.cpuPercent }))} max={100} format={(v) => `${Math.round(v)} %`} from={from} to={now} />
          <TrendChart title={t("platform.engine.host.memory", "Memory")} points={mine.map((s) => ({ at: s.at, value: s.memUsedMb }))} max={host.memTotalMb || Math.max(1, ...mine.map((s) => s.memUsedMb))} format={gb} from={from} to={now} />
          <TrendChart title={t("platform.engine.host.agentsWorking", "Agents working")} points={mine.map((s) => ({ at: s.at, value: s.activeAgents }))} max={peakAgents} format={(v) => String(Math.round(v))} from={from} to={now} />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-ink3">{t("platform.engine.trends.noSamples", "No samples in the last 24 hours.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <caption className="sr-only">{t("platform.engine.trends.caption", "Hourly averages and peaks of {host} over the last 24 hours", { host: host.name || host.hostId })}</caption>
            <thead className="text-ink3">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">{t("platform.engine.trends.hour", "Hour")}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.engine.trends.cpuAverage", "CPU average")}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.engine.trends.cpuPeak", "CPU peak")}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.engine.trends.memoryAverage", "Memory average")}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.engine.trends.jobsPeak", "Jobs peak")}</th>
                <th scope="col" className="py-2 text-right font-medium">{t("platform.engine.trends.agentsPeak", "Agents peak")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-ink">
              {rows.map((r) => (
                <tr key={r.hour} className="border-t border-line">
                  <td className="py-2 pr-4">{clockTime(r.hour)}</td>
                  <td className="py-2 pr-4 text-right">{r.cpuAvg} %</td>
                  <td className="py-2 pr-4 text-right">{r.cpuMax} %</td>
                  <td className="py-2 pr-4 text-right">{gb(r.memAvgMb)}</td>
                  <td className="py-2 pr-4 text-right">{r.jobsMax}</td>
                  <td className="py-2 text-right">{r.agentsMax}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The newest heartbeat of any host ("" when none ever reported). */
export function lastHeartbeat(hosts: readonly EngineHostView[]): string {
  let newest = "";
  for (const h of hosts) if (Number.isFinite(Date.parse(h.lastSeenAt)) && h.lastSeenAt > newest) newest = h.lastSeenAt;
  return newest;
}

/** What the section shows for a status answer: no host yet, every host silent (the engine is offline), some silent, or all reporting. */
export type EngineState = "empty" | "offline" | "partial" | "reporting";

export function engineState(hosts: readonly EngineHostView[], now: number): EngineState {
  if (hosts.length === 0) return "empty";
  const silent = hosts.filter((h) => hostIsStale(h.lastSeenAt, now)).length;
  return silent === 0 ? "reporting" : silent === hosts.length ? "offline" : "partial";
}

export interface EngineViewProps {
  status: EngineStatus;
  now: number;
  /** The history could not be read: when it was last read (epoch ms, 0 = never), and the retry. */
  history?: { failed: boolean; readAt: number; onRetry?: () => void };
  /** The latest read failed: the reading shown is the last one that succeeded (its server time), and the retry. */
  readFailed?: { at: string; onRetry: () => void } | null;
}

/** The section's content for a status answer (rendered by tests without the data layer). */
export function EngineView({ status, now, history, readFailed }: EngineViewProps) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const failedBanner = readFailed ? (
    <Banner tone="warning" title={t("platform.engine.readAgain.title", "The engine hosts could not be read just now")}
      text={t("platform.engine.readAgain.text", "Showing the last reading, from {time}. Nothing was changed.", { time: formatDateTime(readFailed.at) })}
      action={<Button onClick={readFailed.onRetry}>{t("platform.engine.readFailed.retry", "Try again")}</Button>} />
  ) : null;
  const state = engineState(status.hosts, now);
  if (state === "empty") {
    return (
      <div className="space-y-6">
        {failedBanner}
        <EmptyState icon={<Server size={28} strokeWidth={1.75} />} title={t("platform.engine.empty.title", "No engine host is reporting yet")}
          text={t("platform.engine.empty.text", "Each engine host appears here once it reports: its load, memory and disk, and the work and agents running on it.")} />
      </div>
    );
  }
  const silent = status.hosts.filter((h) => hostIsStale(h.lastSeenAt, now));
  const newest = lastHeartbeat(status.hosts);
  const chartHost = status.hosts.find((h) => h.hostId === picked) ?? status.hosts[0]!;
  return (
    <div className="space-y-6">
      {failedBanner}
      {state === "offline" && (
        <Banner tone="danger" title={t("platform.engine.offline.title", "The engine is offline")}
          text={newest
            ? t("platform.engine.offline.since", "No heartbeat since {time} ({ago}). New work waits until an engine host reports again. Check that the engine service is running.", { time: formatDateTime(newest), ago: ago(newest, now) })
            : t("platform.engine.offline.never", "No engine host has sent a heartbeat yet. New work waits until one reports. Check that the engine service is running.")} />
      )}
      {state === "partial" && (
        <Banner tone="danger" title={silent.length === 1 ? t("platform.engine.silent.one", "One engine host is not reporting") : t("platform.engine.silent.many", "{n} engine hosts are not reporting", { n: silent.length })}
          text={t("platform.engine.silent.text", "New work waits until an engine host reports again. Check that its engine service is running.")} />
      )}
      {status.hosts.map((h) => <HostCard key={h.hostId} host={h} now={now} />)}
      {status.hosts.length > 1 && (
        <Segmented label={t("platform.engine.trends.hostPicker", "Host shown in the charts")} value={chartHost.hostId} onChange={setPicked}
          options={status.hosts.map((h) => ({ value: h.hostId, label: h.name || h.hostId }))} />
      )}
      {history?.failed && (
        <Banner tone="warning" title={t("platform.engine.history.failedTitle", "The last 24 hours could not be read")}
          text={history.readAt > 0
            ? t("platform.engine.history.failedOlder", "The charts show the history as read at {time} and the latest heartbeat. It is read again in a few minutes.", { time: formatDateTime(history.readAt) })
            : t("platform.engine.history.failedEmpty", "The charts show only the latest heartbeat. The history is read again in a few minutes.")}
          action={history.onRetry ? <Button onClick={history.onRetry}>{t("platform.engine.readFailed.retry", "Try again")}</Button> : undefined} />
      )}
      <HostTrends host={chartHost} samples={status.samples} now={now} />
    </div>
  );
}

export default function EngineSection() {
  const t = useT();
  const access = usePlatformAccess();
  const allowed = access.isSuperAdmin || access.permissions.includes(ENGINE_VIEW_PERMISSION);
  const q = useEngineStatus(allowed);
  const retryHistory = useRetryEngineHistory();
  if (!allowed) {
    return <EmptyState icon={<Server size={28} strokeWidth={1.75} />} title={t("platform.engine.denied.title", "You can't see the engine's capacity")} text={t("platform.engine.denied.text", "Ask a platform admin for the permission to see the engine's capacity.")} />;
  }
  if (q.isLoading) return <p className="text-[14px] text-ink3" role="status">{t("platform.engine.loading", "Reading the engine hosts…")}</p>;
  if (!q.data) {
    return (
      <EmptyState icon={<Server size={28} strokeWidth={1.75} />} title={t("platform.engine.readFailed.title", "The engine hosts could not be read")}
        text={t("platform.engine.readFailed.text", "Nothing was changed. Try again in a moment.")} action={<Button onClick={() => void q.refetch()}>{t("platform.engine.readFailed.retry", "Try again")}</Button>} />
    );
  }
  const serverNow = Date.parse(q.data.now);
  // The server's clock at the answer, moved on by the time since it arrived (a browser clock that is off never marks a
  // host silent). When the latest read failed, the reading shown is judged at its own time: a failed read says nothing
  // about whether the hosts still report.
  const failed = q.isError;
  const now = !Number.isFinite(serverNow) ? Date.now() : failed ? serverNow : serverNow + (Date.now() - q.dataUpdatedAt);
  return (
    <EngineView status={q.data} now={now}
      history={{ failed: q.data.historyFailed, readAt: q.data.historyReadAt, onRetry: retryHistory }}
      readFailed={failed ? { at: q.data.now, onRetry: () => void q.refetch() } : null} />
  );
}
