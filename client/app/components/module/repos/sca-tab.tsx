import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/core";
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
  Total: "border-red-800",
  Critical: "border-red-500",
  High: "border-orange-500",
  Medium: "border-yellow-500",
  Low: "border-green-500",
  Unassigned: "border-gray-500",
};

const SEVERITY_TINT: Record<ScaSeverity, { hover: string; active: string }> = {
  Critical: {
    hover: "hover:bg-red-50 dark:hover:bg-red-950/40",
    active: "bg-red-50 dark:bg-red-950/40",
  },
  High: {
    hover: "hover:bg-orange-50 dark:hover:bg-orange-950/40",
    active: "bg-orange-50 dark:bg-orange-950/40",
  },
  Medium: {
    hover: "hover:bg-yellow-50 dark:hover:bg-yellow-950/40",
    active: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  Low: {
    hover: "hover:bg-green-50 dark:hover:bg-green-950/40",
    active: "bg-green-50 dark:bg-green-950/40",
  },
  Unassigned: {
    hover: "hover:bg-gray-50 dark:hover:bg-slate-800/70",
    active: "bg-secondary dark:bg-slate-800/70",
  },
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
    <Card data-testid="sca-tab">
      <CardHeader className="flex flex-col gap-5">
        <CardTitle className="flex items-center text-lg">Software library package</CardTitle>
        <div
          className="flex flex-col gap-3 text-xs font-medium sm:flex-row"
          data-testid="sca-header"
        >
          <InlineStat label="Total components" value={details.components} />
          <InlineStat label="Vulnerable components" value={details.vulnerableComponents} />
          <InlineStat label="Risk Score" value={details.inheritedRiskScore} />
        </div>
      </CardHeader>

      <CardContent>
        <div className="border-b pb-5 transition-colors">
          <div
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-6"
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
      </CardContent>
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
    <div className="flex gap-2">
      <span className="text-low-emphasis">{label}:</span>
      <span className="font-semibold">{display(value)}</span>
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
      <span className="mb-1 block text-xs font-medium text-high-emphasis">{label}</span>
      <span className="block text-xl font-bold sm:text-2xl">{value}</span>
    </>
  );

  const className = `border-l-4 ${SEVERITY_COLORS[severity]} pl-2 text-left sm:pl-3`;

  if (!onClick || severity === "Total") {
    return (
      <div className={className} data-testid="sca-tile-total">
        {content}
      </div>
    );
  }

  const tint = SEVERITY_TINT[severity];

  return (
    <button
      type="button"
      data-testid={`sca-tile-${severity.toLowerCase()}`}
      aria-pressed={active}
      className={`${className} w-full cursor-pointer transition-colors ${tint.hover} ${
        active ? tint.active : ""
      }`}
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
