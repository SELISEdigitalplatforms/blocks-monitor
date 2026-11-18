import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Building2, CircleCheck, Gauge, ScrollText, Wallet } from "lucide-react";
import { useAccessRequests, useAuditPage, usePlatformAccess } from "@/madp/blocks/admin";
import { auditActionLabel } from "@/madp/components/admin/auditLabels";
import { platformSectionsFor, type PlatformSectionKey } from "@/madp/domain/platformSections";
import { useT } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import { Card, Dot, EmptyState } from "@/madp/ui/kit";
import {
  attentionItems, formatTokens, formatUsd, isHostSilent, useAiAccounts, useEngineHosts, useMonthUsage, useOrganizationCounts,
  usePendingPurchases,
  type AttentionItem,
} from "../overviewData";

const ICON = { size: 18, strokeWidth: 1.75 } as const;

function when(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** One figure that drives a decision; while it cannot be read the tile says so in plain words. */
function Tile({ label, inSentence, icon, value, foot, empty, loading, to }: {
  label: string; inSentence: string; icon: ReactNode; value: ReactNode | null; foot?: ReactNode; empty: string; loading: boolean; to: string;
}) {
  const t = useT();
  return (
    <Card bodyClassName="flex h-full flex-col gap-3 pt-5">
      <div className="flex items-center gap-2 text-ink2">
        {icon}
        <span className="text-[15px]">{label}</span>
        <Link to={to} aria-label={t("platform.overview.openTile", "Open {name}", { name: inSentence })} className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-accent/50">
          <ArrowRight size={16} strokeWidth={1.75} />
        </Link>
      </div>
      {loading ? (
        <div aria-busy="true" aria-label={t("platform.overview.loadingTile", "Loading {name}", { name: inSentence })} className="h-11 w-40 rounded-full bg-ink/[0.06]" />
      ) : value === null ? (
        <p className="text-[14px] text-ink2">{empty}</p>
      ) : (
        <>
          <div className="num text-[40px] font-medium leading-none tracking-[-0.03em] [overflow-wrap:anywhere]">{value}</div>
          {foot && <div className="text-[13px] text-ink3">{foot}</div>}
        </>
      )}
    </Card>
  );
}

const TONE: Record<AttentionItem["tone"], "danger" | "warning" | "neutral"> = { danger: "danger", warning: "warning", neutral: "neutral" };

function Attention({ items, loading }: { items: AttentionItem[]; loading: boolean }) {
  const t = useT();
  return (
    <Card title={t("platform.overview.attentionTitle", "Needs your attention")} bodyClassName="flex flex-col gap-3">
      {items.length === 0 ? (
        loading ? (
          <div aria-busy="true" aria-label={t("platform.overview.attentionLoading", "Looking for what needs your attention")} className="h-16 rounded-block bg-surface2" />
        ) : (
          <div className="flex items-center gap-3 rounded-block bg-surface2 px-4 py-4 text-[14px] text-ink2">
            <CircleCheck {...ICON} className="shrink-0 text-success" />
            {t("platform.overview.attentionEmpty", "Nothing waits for you right now.")}
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li key={it.id}>
              <Link to={it.to}
                className="flex min-h-[48px] items-center gap-3 rounded-block bg-surface2 px-4 py-3 text-[14px] outline-none transition hover:bg-surface2/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
                <Dot tone={TONE[it.tone]} />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.text}</span>
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LatestActivity({ enabled }: { enabled: boolean }) {
  const t = useT();
  const audit = useAuditPage({ page: 1, pageSize: 6 }, enabled);
  const entries = (audit.data?.entries ?? []).slice(0, 6);
  return (
    <Card title={t("platform.overview.latestTitle", "Latest activity")} icon={<ScrollText {...ICON} />}
      action={<Link to="/admin/audit" className="rounded-full px-3 py-1.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">{t("platform.overview.openAudit", "Open the audit")}</Link>}
      bodyClassName="flex flex-col gap-3">
      {audit.isPending ? (
        <div aria-busy="true" aria-label={t("platform.overview.latestLoading", "Loading the latest activity")} className="h-16 rounded-block bg-surface2" />
      ) : audit.isError || entries.length === 0 ? (
        <EmptyState icon={<ScrollText {...ICON} />} title={t("platform.overview.latestEmptyTitle", "No activity yet")} text={t("platform.overview.latestEmptyText", "Changes made on the platform appear here as they happen.")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] [overflow-wrap:anywhere]">{auditActionLabel(e.action)}{e.targetLabel ? ` · ${e.targetLabel}` : ""}</div>
                <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{e.actorName || e.actorEmail} · {e.workspaceName || t("platform.overview.platformScope", "Platform")}</div>
              </div>
              <time dateTime={e.at} className="shrink-0 text-[13px] text-ink3">{when(e.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Platform management → Overview: three figures, what waits for the super admin, and the latest changes. */
export default function OverviewSection() {
  const t = useT();
  const access = usePlatformAccess();
  const allowed = platformSectionsFor(access);
  const can = (k: PlatformSectionKey) => allowed.includes(k);

  const usage = useMonthUsage(can("usage"));
  const orgs = useOrganizationCounts(can("organizations"));
  const hosts = useEngineHosts(can("engine"));
  const ai = useAiAccounts(can("ai-accounts"));
  const purchases = usePendingPurchases(can("credits"));
  const requests = useAccessRequests(1, can("people"));

  const now = Date.now();
  // only what this person may open counts (a cached answer from someone else's visit is never shown)
  const items = attentionItems({
    pendingPurchases: can("credits") ? purchases.data ?? null : null,
    waitingPeople: can("people") && requests.data ? (requests.data.totalCount ?? requests.data.items.length) : null,
    hosts: can("engine") ? hosts.data ?? null : null,
    aiAccounts: can("ai-accounts") ? ai.data ?? null : null,
    now,
  });
  const attentionLoading = [purchases, hosts, ai].some((q) => q.isFetching && q.data === undefined) || (can("people") && requests.isPending);


  const liveHosts = (hosts.data ?? []).filter((h) => !isHostSilent(h, now));
  const busiest = liveHosts.reduce<number | null>((m, h) => (h.cpuPercent === null ? m : Math.max(m ?? 0, h.cpuPercent)), null);
  const running = liveHosts.reduce((s, h) => s + h.runningJobs, 0);
  const agents = liveHosts.reduce((s, h) => s + h.activeAgents, 0);

  const tiles: ReactNode[] = [];
  if (can("usage")) {
    const u = usage.data ?? null;
    tiles.push(
      <Tile key="usage" label={t("platform.overview.usageTile", "Credit used this month")} inSentence={t("platform.overview.usageTileInSentence", "credit used this month")} icon={<Wallet {...ICON} />} to="/admin/usage" loading={usage.isPending && usage.isFetching}
        value={u ? formatUsd(u.costUsd) : null} foot={u ? formatTokens(u.tokens) : undefined}
        empty={t("platform.overview.usageEmpty", "No usage measured this month yet.")} />,
    );
  }
  if (can("organizations")) {
    const o = orgs.data ?? null;
    const of = o ? (o.total === 1
      ? t("platform.overview.orgsOfOne", "of {total} organization", { total: o.total })
      : t("platform.overview.orgsOfMany", "of {total} organizations", { total: o.total })) : "";
    tiles.push(
      <Tile key="orgs" label={t("platform.overview.orgsTile", "Active organizations")} inSentence={t("platform.overview.orgsTileInSentence", "active organizations")} icon={<Building2 {...ICON} />} to="/admin/organizations" loading={orgs.isPending && orgs.isFetching}
        value={o ? o.active : null} foot={o && o.counted < o.total ? t("platform.overview.orgsCountedFirst", "{of} · counted from the first {counted}", { of, counted: o.counted }) : of}
        empty={t("platform.overview.orgsEmpty", "The organizations could not be counted right now.")} />,
    );
  }
  if (can("engine")) {
    tiles.push(
      <Tile key="engine" label={t("platform.overview.engineTile", "Engine load")} inSentence={t("platform.overview.engineTileInSentence", "engine load")} icon={<Gauge {...ICON} />} to="/admin/engine" loading={hosts.isPending && hosts.isFetching}
        value={liveHosts.length > 0 && busiest !== null ? `${Math.round(busiest)}%` : null}
        foot={`${liveHosts.length > 1 ? t("platform.overview.busiestOf", "Busiest of {count} hosts · ", { count: liveHosts.length }) : ""}${running === 1 ? t("platform.overview.jobsOne", "{count} job running", { count: running }) : t("platform.overview.jobsMany", "{count} jobs running", { count: running })} · ${agents === 1 ? t("platform.overview.agentsOne", "{count} agent working", { count: agents }) : t("platform.overview.agentsMany", "{count} agents working", { count: agents })}`}
        empty={(hosts.data?.length ?? 0) > 0 ? t("platform.overview.engineSilent", "No engine host has reported in the last five minutes.") : t("platform.overview.engineNone", "No engine host is reporting yet.")} />,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {tiles.length > 0 && (
        <div className={cn("grid gap-4 sm:grid-cols-2", tiles.length >= 3 && "xl:grid-cols-3")}>{tiles.slice(0, 3)}</div>
      )}
      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Attention items={items} loading={attentionLoading} />
        {can("audit") ? <LatestActivity enabled /> : null}
      </div>
    </div>
  );
}
