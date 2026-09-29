import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import { useGetReport } from "@/hooks/use-repos";
import {
  hasNoReport,
  transformVulnerabilities,
  type ScaSeverity,
} from "@/components/module/repos/sca-transform";
import { ScaSummaryHeader, ScaSummaryTiles } from "@/components/module/repos/sca-summary";
import { ScaDependenciesTable } from "@/components/module/repos/sca-dependencies-table";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";

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

  if (isLoading) return <ReportLoadingCard label="Loading SCA report…" />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!details) return <ReportNoDataCard />;

  return (
    <div className="space-y-4" data-testid="sca-tab">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Software composition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ScaSummaryHeader details={details} />
          <ScaSummaryTiles
            details={details}
            activeSeverity={severity}
            onToggleSeverity={(s) => setSeverity((prev) => (prev === s ? null : s))}
          />
        </CardContent>
      </Card>
      <ScaDependenciesTable rows={rows} severityFilter={severity} />
    </div>
  );
}
