import { useMemo, useState } from "react";
import { useGetReport } from "@/hooks/use-repos";
import {
  hasNoReport,
  transformVulnerabilities,
  type ScaSeverity,
} from "@/components/module/repos/sca-transform";
import { ScaDependenciesTable } from "@/components/module/repos/sca-dependencies-table";
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

const SEVERITY_COLORS: Record<ScaSeverity | "Total", string> = {
  Total: "border-red-600",
  Critical: "border-red-500",
  High: "border-orange-500",
  Medium: "border-yellow-500",
  Low: "border-green-500",
  Unassigned: "border-slate-500",
};

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
    <section className="rounded-sm border bg-background p-6 shadow-sm" data-testid="sca-tab">
      <h2 className="text-lg font-semibold text-high-emphasis">Software library package</h2>

      <div className="mt-8 flex flex-wrap gap-4 text-sm" data-testid="sca-header">
        <InlineStat label="Total components" value={details.components} />
        <InlineStat label="Vulnerable components" value={details.vulnerableComponents} />
        <InlineStat label="Risk Score" value={details.inheritedRiskScore} />
      </div>

      <div
        className="mt-7 grid gap-5 md:grid-cols-3 xl:grid-cols-6"
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

      <div className="my-6 border-t" />

      <ScaDependenciesTable rows={rows} severityFilter={severity} />
    </section>
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
    <span className="text-muted-foreground">
      {label}: <span className="font-semibold text-high-emphasis">{display(value)}</span>
    </span>
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
      <p className="font-semibold text-high-emphasis">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-high-emphasis">{value}</p>
    </>
  );

  const className = `border-l-4 ${SEVERITY_COLORS[severity]} py-1 pl-4 text-left ${
    active ? "bg-secondary/70" : ""
  }`;

  if (!onClick) {
    return (
      <div className={className} data-testid="sca-tile-total">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`sca-tile-${severity.toLowerCase()}`}
      aria-pressed={active}
      className={`${className} transition hover:bg-secondary/70`}
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
