// Platform > Usage: what the engine's work measured and charged in a period, grouped by organization, project, person,
// model or day. One series in the accent, direct value labels, and the table below as the full, accessible readout.
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { freshnessQuery } from "@/blocks/data/freshness";
import { BarChart3 } from "lucide-react";
import { Card, EmptyState, Input, Label, Segmented } from "@/ui/kit";
import { callFunction } from "@/blocks/fn";
import { adminErrorMessage } from "@/blocks/admin";
import { cn } from "@/lib/cn";
import type { UsageGroup, UsageReport, UsageRow } from "@/domain/billing";
import { t, useT } from "@/i18n";

/* ── formatting ──────────────────────────────────────────────────────────── */

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `USD ${money(n)}`;
const compact = (n: number) => {
  const a = Math.abs(n);
  const fmt = (v: number, unit: string) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))} ${unit}`;
  if (a >= 1e9) return fmt(n / 1e9, "B");
  if (a >= 1e6) return fmt(n / 1e6, "M");
  if (a >= 1e3) return fmt(n / 1e3, "K");
  return String(Math.round(n));
};
const pad = (n: number) => String(n).padStart(2, "0");
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
/** "2026-11-03" -> "03.11.2026" (the day as the report keys it, UTC). */
const dayLabel = (key: string) => {
  const m = DAY.exec(key);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : key;
};
const dayShort = (key: string) => {
  const m = DAY.exec(key);
  return m ? `${m[3]}.${m[2]}` : key;
};

/* ── period ──────────────────────────────────────────────────────────────── */

type Preset = "this-month" | "last-month" | "last-30" | "custom";
type Range = { from: string; to: string };

const utcDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayStart = (ymd: string) => `${ymd}T00:00:00.000Z`;
const addDays = (ymd: string, n: number) => {
  const d = new Date(dayStart(ymd));
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d);
};

/** A preset as a half-open UTC range [from, to). Stable within a day, so the query key does not change every render. */
function presetRange(p: Exclude<Preset, "custom">, now = new Date()): Range {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (p === "this-month") return { from: new Date(Date.UTC(y, m, 1)).toISOString(), to: new Date(Date.UTC(y, m + 1, 1)).toISOString() };
  if (p === "last-month") return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
  const today = utcDay(now);
  return { from: dayStart(addDays(today, -29)), to: dayStart(addDays(today, 1)) };
}

const presets = (): { value: Preset; label: string }[] => [
  { value: "this-month", label: t("platform.usage.presetThisMonth", "This month") },
  { value: "last-month", label: t("platform.usage.presetLastMonth", "Last month") },
  { value: "last-30", label: t("platform.usage.presetLast30", "Last 30 days") },
  { value: "custom", label: t("platform.usage.presetCustom", "Custom") },
];

type GroupDef = { value: UsageGroup; label: string; column: string; noun: string; tableLabel: string };
const GROUP_VALUES: readonly UsageGroup[] = ["workspace", "project", "user", "model", "day"];
const groups = (): GroupDef[] => [
  { value: "workspace", label: t("platform.usage.groupOrganization", "Organization"), column: t("platform.usage.groupOrganization", "Organization"),
    noun: t("platform.usage.nounOrganization", "organization"), tableLabel: t("platform.usage.tableByOrganization", "Usage by organization") },
  { value: "project", label: t("platform.usage.groupProject", "Project"), column: t("platform.usage.groupProject", "Project"),
    noun: t("platform.usage.nounProject", "project"), tableLabel: t("platform.usage.tableByProject", "Usage by project") },
  { value: "user", label: t("platform.usage.groupPerson", "Person"), column: t("platform.usage.groupPerson", "Person"),
    noun: t("platform.usage.nounPerson", "person"), tableLabel: t("platform.usage.tableByPerson", "Usage by person") },
  { value: "model", label: t("platform.usage.groupModel", "Model"), column: t("platform.usage.groupModel", "Model"),
    noun: t("platform.usage.nounModel", "model"), tableLabel: t("platform.usage.tableByModel", "Usage by model") },
  { value: "day", label: t("platform.usage.groupDay", "Day"), column: t("platform.usage.groupDay", "Day"),
    noun: t("platform.usage.nounDay", "day"), tableLabel: t("platform.usage.tableByDay", "Usage by day") },
];

type Metric = "chargedUsd" | "rawCostUsd" | "tokens";
const metrics = (): { value: Metric; label: string; title: string }[] => [
  { value: "chargedUsd", label: t("platform.usage.metricCharged", "Charged"), title: t("platform.usage.metricCharged", "Charged") },
  { value: "rawCostUsd", label: t("platform.usage.metricMeasured", "Measured cost"), title: t("platform.usage.metricMeasured", "Measured cost") },
  { value: "tokens", label: t("platform.usage.metricTokens", "Tokens"), title: t("platform.usage.metricTokens", "Tokens") },
];
const metricTitle = (m: Metric): string => metrics().find((x) => x.value === m)?.title ?? "";
const metricText = (m: Metric, v: number) => (m === "tokens" ? compact(v) : usd(v));

const TOP = 12;
const TH = "whitespace-nowrap px-4 py-2.5 text-left text-[12px] font-medium uppercase tracking-wider text-ink3";
const TD = "px-4 py-3 align-middle";

/* ── the section ─────────────────────────────────────────────────────────── */

export default function UsageSection() {
  const t = useT();
  const [preset, setPreset] = useState<Preset>("this-month");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => {
    const today = utcDay(new Date());
    return { from: addDays(today, -6), to: today };
  });
  const [groupBy, setGroupBy] = useState<UsageGroup>("workspace");
  const [metric, setMetric] = useState<Metric>("chargedUsd");

  const customError = preset !== "custom" ? null
    : !custom.from || !custom.to ? t("platform.usage.errorBothDates", "Choose both dates.")
    : custom.from > custom.to ? t("platform.usage.errorDateOrder", "The start date must be on or before the end date.")
    : null;
  const range: Range | null = useMemo(() => {
    if (preset !== "custom") return presetRange(preset);
    if (customError) return null;
    return { from: dayStart(custom.from), to: dayStart(addDays(custom.to, 1)) };
  }, [preset, custom, customError]);

  const q = useQuery({
    queryKey: ["billing", "usage", range?.from ?? "", range?.to ?? "", groupBy],
    queryFn: async () => (await callFunction<UsageReport>("billing", "billing.usage.report", { from: range!.from, to: range!.to, groupBy })).data,
    enabled: range !== null,
    placeholderData: keepPreviousData,
    // usage: read again every 10 s while an engine job runs on the platform, every minute otherwise (paused while the
    // tab is hidden, slower after failures; the server keeps an answer 5 s)
    ...freshnessQuery<UsageReport>("usage", { busy: (d) => (d?.runningJobs ?? 0) > 0 }),
    retry: 0,
  });

  const report = q.data;
  // while the next answer loads the previous one stays on screen, drawn as what it is (its own grouping and period)
  const shown: UsageGroup = report && GROUP_VALUES.includes(report.groupBy) ? report.groupBy : groupBy;
  const groupDefs = groups();
  const group = groupDefs.find((g) => g.value === shown) ?? groupDefs[0];
  const rows = report?.rows ?? [];
  const totals = report?.totals;
  const reloading = q.isFetching && q.isPlaceholderData;

  return (
    <div className="grid min-w-0 gap-6">
      {/* filters: one row above everything they scope */}
      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-full">
          <Label>{t("platform.usage.periodLabel", "Period")}</Label>
          <div className="scroll-thin max-w-full overflow-x-auto">
            <Segmented label={t("platform.usage.periodLabel", "Period")} options={presets()} value={preset} onChange={setPreset} />
          </div>
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label htmlFor="usage-from"><Label>{t("platform.usage.fromLabel", "From")}</Label></label>
              <Input id="usage-from" type="date" value={custom.from} max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </div>
            <div className="w-40">
              <label htmlFor="usage-to"><Label>{t("platform.usage.toLabel", "To")}</Label></label>
              <Input id="usage-to" type="date" value={custom.to} min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          </div>
        )}
        <div className="min-w-0 max-w-full">
          <Label>{t("platform.usage.groupByLabel", "Group by")}</Label>
          <div className="scroll-thin max-w-full overflow-x-auto">
            <Segmented label={t("platform.usage.groupByLabel", "Group by")} options={groupDefs.map(({ value, label }) => ({ value, label }))} value={groupBy} onChange={setGroupBy} />
          </div>
        </div>
      </div>
      {customError && <p role="alert" className="text-[14px] text-danger">{customError}</p>}

      {q.error && !q.data ? (
        <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(q.error)}</p>
      ) : !report ? (
        range && <p className="text-[14px] text-ink2" aria-busy="true">{t("platform.usage.loading", "Loading usage…")}</p>
      ) : (
        <div className={cn("grid min-w-0 gap-6 transition-opacity", reloading && "opacity-60")} aria-busy={q.isFetching}>
          {q.error && <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(q.error)}</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile label={t("platform.usage.metricTokens", "Tokens")} value={compact(totals?.tokens ?? 0)}
              foot={t("platform.usage.jobsCount", "{count} jobs", { count: (totals?.jobs ?? 0).toLocaleString("en-US") })}
              title={(totals?.tokens ?? 0).toLocaleString("en-US")} />
            <Tile label={t("platform.usage.metricMeasured", "Measured cost")} value={usd(totals?.rawCostUsd ?? 0)} foot={t("platform.usage.measuredFoot", "What the engine measured")} />
            <Tile label={t("platform.usage.metricCharged", "Charged")} value={usd(totals?.chargedUsd ?? 0)} foot={t("platform.usage.chargedFoot", "Taken from organizations' credit")} />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={<BarChart3 size={20} strokeWidth={1.75} />} title={t("platform.usage.emptyTitle", "No usage in this period yet")}
              text={t("platform.usage.emptyText", "When agents work on projects, the tokens they use and what they cost appear here.")} />
          ) : (
            <>
              <Card title={shown === "day"
                ? t("platform.usage.chartTitlePerDay", "{metric} per day", { metric: metricTitle(metric) })
                : t("platform.usage.chartTitleBy", "{metric} by {noun}", { metric: metricTitle(metric), noun: group.noun })}
                action={<Segmented label={t("platform.usage.showLabel", "Show")} options={metrics().map(({ value, label }) => ({ value, label }))} value={metric} onChange={setMetric} />}>
                {shown === "day"
                  ? <DayColumns rows={rows} metric={metric} range={report.from && report.to ? { from: report.from, to: report.to } : range ?? presetRange("this-month")} />
                  : <TopBars rows={rows} metric={metric} noun={group.noun} />}
              </Card>
              <UsageTable rows={rows} groupBy={shown} column={group.column} tableLabel={group.tableLabel} metric={metric} totals={totals} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, foot, title }: { label: string; value: string; foot: string; title?: string }) {
  return (
    <Card bodyClassName="pt-5">
      <div className="text-[14px] text-ink2">{label}</div>
      <div className="mt-2 break-words text-[30px] font-medium leading-tight tracking-[-0.02em]" title={title}>{value}</div>
      <div className="mt-1 text-[13px] text-ink3">{foot}</div>
    </Card>
  );
}

/* ── horizontal bars: the top 12, descending ─────────────────────────────── */

function TopBars({ rows, metric, noun }: { rows: UsageRow[]; metric: Metric; noun: string }) {
  const t = useT();
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label));
  const top = sorted.slice(0, TOP);
  const max = Math.max(0, ...top.map((r) => r[metric]));
  const rest = sorted.length - top.length;
  return (
    <figure className="m-0 grid gap-4">
      <ol className="grid gap-3" aria-label={t("platform.usage.barsLabel", "{metric} by {noun}, highest first", { metric: metricTitle(metric), noun })}>
        {top.map((r) => {
          const v = r[metric];
          // the longest bar takes 80 % of the track, leaving room for its value at the tip
          const pct = max > 0 ? (v / max) * 80 : 0;
          return (
            <li key={r.key} tabIndex={0}
              aria-label={t("platform.usage.barLabel", "{label}: {value}. {tokens} tokens, measured {measured}, charged {charged}, {jobs} jobs.", {
                label: r.label, value: metricText(metric, v), tokens: compact(r.tokens), measured: usd(r.rawCostUsd), charged: usd(r.chargedUsd), jobs: r.jobs,
              })}
              className="group relative grid gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
              <span className="min-w-0 break-words text-[14px] text-ink2">{r.label}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-5 shrink-0 rounded-r-[4px] bg-accent transition-colors group-hover:bg-accent-hover group-focus-visible:bg-accent-hover"
                  style={{ width: `${pct}%`, minWidth: v > 0 ? 2 : 0 }} aria-hidden />
                <span className="num whitespace-nowrap text-[13px] font-medium text-ink" aria-hidden>{metricText(metric, v)}</span>
              </span>
              <Tooltip row={r} metric={metric} className="right-0 top-0 -translate-y-[calc(100%+6px)]" />
            </li>
          );
        })}
      </ol>
      {rest > 0 && (
        <figcaption className="num text-[13px] text-ink3">
          {t("platform.usage.topOf", "The top {top} of {total}. The other {rest} are in the table below.", { top: TOP, total: sorted.length, rest })}
        </figcaption>
      )}
    </figure>
  );
}

function Tooltip({ row, metric, label, className }: { row: UsageRow; metric: Metric; label?: string; className?: string }) {
  const t = useT();
  return (
    <span aria-hidden
      className={cn("pointer-events-none absolute z-10 hidden w-max max-w-[16rem] rounded-block bg-surface px-3 py-2 text-[13px] shadow-float ring-1 ring-line group-hover:block group-focus-visible:block", className)}>
      <span className="num block text-[15px] font-medium text-ink">{metricText(metric, row[metric])}</span>
      <span className="block break-words text-ink2">{label ?? row.label}</span>
      <span className="num mt-1 block text-ink3">
        {t("platform.usage.tooltipTokensJobs", "{tokens} tokens · {jobs} jobs", { tokens: compact(row.tokens), jobs: row.jobs })}<br />
        {t("platform.usage.tooltipCost", "Measured {measured} · charged {charged}", { measured: usd(row.rawCostUsd), charged: usd(row.chargedUsd) })}
      </span>
    </span>
  );
}

/* ── vertical columns: one per day ───────────────────────────────────────── */

const MAX_DAYS = 400;

/** Every day of the range (half-open, UTC), the report's rows placed on their day and the rest at zero. */
function fillDays(rows: UsageRow[], range: Range): { key: string; row: UsageRow }[] {
  const zero = (key: string): UsageRow => ({ key, label: key, tokens: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, chargedUsd: 0, rawCostUsd: 0, jobs: 0 });
  const byDay = new Map<string, UsageRow>();
  for (const r of rows) {
    const m = DAY.exec(r.key);
    if (!m) return rows.map((x) => ({ key: x.key, row: x })).sort((a, b) => a.key.localeCompare(b.key));
    byDay.set(`${m[1]}-${m[2]}-${m[3]}`, r);
  }
  const first = utcDay(new Date(range.from));
  // days still to come are not drawn: the chart ends with today (UTC)
  const tomorrow = addDays(utcDay(new Date()), 1);
  const rangeEnd = utcDay(new Date(range.to));
  const end = rangeEnd < tomorrow ? rangeEnd : tomorrow;
  const out: { key: string; row: UsageRow }[] = [];
  for (let d = first; d < end && out.length < MAX_DAYS; d = addDays(d, 1)) out.push({ key: d, row: byDay.get(d) ?? zero(d) });
  // a day the report has outside the range still shows (never drop a value)
  for (const [k, r] of byDay) if (!out.some((o) => o.key === k)) out.push({ key: k, row: r });
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** A clean axis maximum and its ticks (0 and three steps). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
  return [0, step, step * 2, step * 3];
}

function DayColumns({ rows, metric, range }: { rows: UsageRow[]; metric: Metric; range: Range }) {
  const t = useT();
  const days = fillDays(rows, range);
  const max = Math.max(0, ...days.map((d) => d.row[metric]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const peak = days.reduce((best, d, i) => (d.row[metric] > (days[best]?.row[metric] ?? -1) ? i : best), 0);
  const every = Math.max(1, Math.ceil(days.length / 8));
  const tick = (v: number) => (metric === "tokens" ? compact(v) : v >= 1000 ? compact(v) : Number(v.toFixed(2)).toString());
  const H = 200;
  const PAD = 24;

  return (
    <figure className="m-0">
      <div className="flex min-w-0 gap-2" role="img"
        aria-label={t("platform.usage.daysLabel", "{metric} per day, {count} days. Highest on {day}: {value}. Every day is in the table below.", {
          metric: metricTitle(metric), count: days.length, day: dayLabel(days[peak]?.key ?? ""), value: metricText(metric, days[peak]?.row[metric] ?? 0),
        })}>
        {/* the y axis: clean ticks, hairline grid */}
        <div className="relative w-12 shrink-0" style={{ height: H, marginTop: PAD }} aria-hidden>
          {metric !== "tokens" && <span className="absolute -top-6 right-0 text-[12px] text-ink3">USD</span>}
          {ticks.map((tv) => (
            <span key={tv} className="num absolute right-0 -translate-y-1/2 text-[12px] text-ink3" style={{ top: H - (tv / top) * H }}>{tick(tv)}</span>
          ))}
        </div>
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="relative" style={{ minWidth: days.length * 10, paddingTop: PAD }}>
            <div className="relative" style={{ height: H }}>
              {ticks.map((tv) => (
                <span key={tv} aria-hidden className="absolute inset-x-0 h-px bg-line" style={{ top: H - (tv / top) * H }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden>
                {days.map((d, i) => {
                  const v = d.row[metric];
                  const h = (v / top) * H;
                  const right = i > days.length / 2;
                  return (
                    <div key={d.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
                      {i === peak && v > 0 && (
                        <span className={cn("num absolute z-[1] whitespace-nowrap text-[12px] font-medium text-ink",
                          i < 2 ? "left-0" : i > days.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2")} style={{ bottom: h + 4 }}>
                          {metricText(metric, v)}
                        </span>
                      )}
                      <div className="w-full max-w-[24px] rounded-t-[4px] bg-accent transition-colors group-hover:bg-accent-hover"
                        style={{ height: v > 0 ? Math.max(2, h) : 0 }} />
                      <Tooltip row={d.row} metric={metric} label={dayLabel(d.key)}
                        className={cn("top-0", right ? "right-1/2" : "left-1/2")} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex gap-[2px]" aria-hidden>
              {days.map((d, i) => (
                <span key={d.key} className="num relative min-w-0 flex-1 text-center text-[12px] text-ink3">
                  {i % every === 0 ? <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">{dayShort(d.key)}</span> : null}
                </span>
              ))}
            </div>
            <div className="h-4" aria-hidden />
          </div>
        </div>
      </div>
    </figure>
  );
}

/* ── the table: every row, the accessible readout ─────────────────────────── */

function UsageTable({ rows, groupBy, column, tableLabel, metric, totals }: {
  rows: UsageRow[]; groupBy: UsageGroup; column: string; tableLabel: string; metric: Metric; totals: UsageReport["totals"] | undefined;
}) {
  const t = useT();
  const sorted = groupBy === "day"
    ? [...rows].sort((a, b) => a.key.localeCompare(b.key))
    : [...rows].sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label));
  const name = (r: UsageRow) => (groupBy === "day" ? dayLabel(r.key) : r.label);
  return (
    <Card bodyClassName="p-0">
      <div className="scroll-thin overflow-x-auto" role="region" aria-label={tableLabel} tabIndex={0}>
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={TH}>{column}</th>
              <th scope="col" className={cn(TH, "text-right")}>{t("platform.usage.colJobs", "Jobs")}</th>
              <th scope="col" className={cn(TH, "text-right")}>{t("platform.usage.metricTokens", "Tokens")}</th>
              <th scope="col" className={cn(TH, "text-right")}>{t("platform.usage.metricMeasured", "Measured cost")}</th>
              <th scope="col" className={cn(TH, "text-right")}>{t("platform.usage.metricCharged", "Charged")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map((r) => (
              <tr key={r.key}>
                <th scope="row" className={cn(TD, "min-w-[12rem] break-words text-left font-medium")}>{name(r)}</th>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")}>{r.jobs.toLocaleString("en-US")}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")} title={r.tokens.toLocaleString("en-US")}>{compact(r.tokens)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")}>{usd(r.rawCostUsd)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium")}>{usd(r.chargedUsd)}</td>
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="border-t border-line">
              <tr>
                <th scope="row" className={cn(TD, "text-left font-medium")}>{t("platform.usage.total", "Total")}</th>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium")}>{totals.jobs.toLocaleString("en-US")}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium")} title={totals.tokens.toLocaleString("en-US")}>{compact(totals.tokens)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium")}>{usd(totals.rawCostUsd)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium")}>{usd(totals.chargedUsd)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
