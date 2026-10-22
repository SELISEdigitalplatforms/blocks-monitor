import { useMemo, useState } from "react";
import { Card } from "@/components/core";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import { useGetReport } from "@/hooks/use-repos";
import {
  hasNoReport,
  transformVulnerabilities,
  type ScaSeverity,
} from "@/components/module/repos/sca-transform";
import {
  ScaDependenciesTable,
  SCA_SEVERITY_ACCENT,
} from "@/components/module/repos/sca-dependencies-table";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";

const SEVERITIES: Array<ScaSeverity | "Total"> = [
  "Total",
  "Critical",
  "High",
  "Medium",
  "Low",
  "Unassigned",
];

export function ScaTab({
  projectKey,
  buildId,
  isActive,
}: Readonly<{
  projectKey: string;
  buildId: string | undefined;
  isActive: boolean;
}>) {
  const { data, isLoading, isError, refetch } = useGetReport(
    projectKey,
    buildId,
    "sca-libraries",
    isActive,
  );
  const [severity, setSeverity] = useState<ScaSeverity | null>(null);

  const details = data?.data?.details ?? null;
  const rows = useMemo(
    () => transformVulnerabilities(data?.data?.vulnerabilities),
    [data?.data?.vulnerabilities],
  );

  if (isLoading) return <ReportLoadingCard label="Loading SCA report..." />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!details) return <ReportNoDataCard />;

  return (
    <Card data-testid="sca-tab" className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeading
          title="Software library package"
          description="Known vulnerabilities in the latest build's dependencies."
        />
        <dl
          className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]"
          data-testid="sca-header"
        >
          <InlineStat label="Total components" value={details.components} />
          <InlineStat label="Vulnerable components" value={details.vulnerableComponents} />
          <InlineStat label="Risk Score" value={details.inheritedRiskScore} />
        </dl>
      </div>

      <div className="border-b border-border/60 px-5 py-4">
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          data-testid="sca-summary-tiles"
        >
          {SEVERITIES.map((item) => (
            <SeverityMetric
              key={item}
              label={item === "Total" ? "Total vulnerabilities" : item}
              value={countFor(details, item)}
              severity={item}
              active={severity === item}
              onClick={
                item === "Total"
                  ? undefined
                  : () => setSeverity((prev) => (prev === item ? null : item))
              }
            />
          ))}
        </div>
      </div>

      <ScaDependenciesTable rows={rows} severityFilter={severity} />
    </Card>
  );
}

function InlineStat({
  label,
  value,
}: Readonly<{
  label: string;
  value?: string;
}>) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-high-emphasis">{display(value)}</dd>
    </div>
  );
}

function SeverityMetric({
  label,
  value,
  severity,
  active,
  onClick,
}: Readonly<{
  label: string;
  value: string;
  severity: ScaSeverity | "Total";
  active: boolean;
  onClick?: () => void;
}>) {
  const content = (
    <>
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-xl font-semibold tabular-nums text-high-emphasis">
        {value}
      </span>
    </>
  );

  const base = "block w-full rounded-sm border-l-[3px] px-3 py-2.5 text-left";

  if (!onClick || severity === "Total") {
    return (
      <div
        className={cn(base, "border-high-emphasis/70 bg-surface-warm/40")}
        data-testid="sca-tile-total"
      >
        {content}
      </div>
    );
  }

  const accent = SCA_SEVERITY_ACCENT[severity];

  return (
    <button
      type="button"
      data-testid={`sca-tile-${severity.toLowerCase()}`}
      aria-pressed={active}
      className={cn(
        base,
        "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        accent.border,
        active ? accent.active : cn("bg-surface-warm/40", accent.hover),
      )}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

function countFor(details: Record<string, string>, severity: ScaSeverity | "Total"): string {
  if (severity === "Total") return display(details.vulnerabilities);
  return display(details[severity.toLowerCase()]);
}

function display(value?: string): string {
  return value != null && value !== "" ? value : "0";
}
