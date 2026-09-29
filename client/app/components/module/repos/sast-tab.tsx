import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import { useGetReport } from "@/hooks/use-repos";
import { hasNoReport } from "@/components/module/repos/sca-transform";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";

const MISSING = "—";

type RatingLetter = "A" | "B" | "C" | "D" | "E";

const RATING_CLASS: Record<RatingLetter, string> = {
  A: "bg-green-100 text-green-700",
  B: "bg-lime-100 text-lime-700",
  C: "bg-yellow-100 text-yellow-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700",
};

function toGrade(rating: string | undefined): RatingLetter | null {
  if (rating == null || rating === "") return null;
  const n = Math.round(Number(rating));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return (["A", "B", "C", "D", "E"] as const)[n - 1];
}

function formatCount(value: string | undefined): string {
  if (value == null || value === "") return MISSING;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING;
  return Math.trunc(n).toLocaleString("en-US");
}

function formatPercent(value: string | undefined): string {
  if (value == null || value === "") return MISSING;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING;
  return `${n.toFixed(1)}%`;
}

function qualityGateLabel(status: string | undefined): string {
  if (status === "OK") return "Passed";
  if (status === "ERROR") return "Failed";
  return MISSING;
}

function GradeCircle({ letter }: Readonly<{ letter: RatingLetter | null }>) {
  if (!letter) return null;
  return (
    <span
      data-testid={`grade-${letter}`}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${RATING_CLASS[letter]}`}
    >
      {letter}
    </span>
  );
}

function Donut({ percent, label }: Readonly<{ percent: number | null; label: string }>) {
  const p = percent == null || !Number.isFinite(percent) ? 0 : Math.max(0, Math.min(100, percent));
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-label={label} data-testid="sast-donut">
      <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className="text-primary"
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}

export function SastTab({
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
    "sast",
    isActive,
  );

  const details = data?.data?.details ?? null;

  const view = useMemo(() => {
    if (!details) return null;
    const securityGrade = toGrade(details.security_rating);
    const reliabilityGrade = toGrade(details.reliability_rating);
    const maintainabilityGrade = toGrade(details.sqale_rating);
    const hotspots = details.security_hotspots;
    const hotspotsNum = hotspots != null && hotspots !== "" ? Number(hotspots) : null;
    const coverageRaw = details.coverage;
    const coverageNum =
      coverageRaw != null && coverageRaw !== "" && Number.isFinite(Number(coverageRaw))
        ? Number(coverageRaw)
        : null;
    const dupRaw = details.duplicated_lines_density;
    const dupNum =
      dupRaw != null && dupRaw !== "" && Number.isFinite(Number(dupRaw)) ? Number(dupRaw) : null;

    return {
      qualityGate: qualityGateLabel(details.alert_status),
      ncloc: formatCount(details.ncloc),
      securityGrade,
      bugs: formatCount(details.bugs),
      reliabilityGrade,
      codeSmells: formatCount(details.code_smells),
      maintainabilityGrade,
      hotspots: formatCount(hotspots),
      hotspotsWarn: hotspotsNum != null && hotspotsNum > 0,
      accepted: formatCount(details.accepted_issues),
      coverage: formatPercent(coverageRaw),
      coverageNum,
      linesToCover: formatCount(details.lines_to_cover),
      duplications: formatPercent(dupRaw),
      dupNum,
      duplicatedLines: formatCount(details.duplicated_lines),
      newDebt:
        details.new_technical_debt != null && details.new_technical_debt !== ""
          ? `${details.new_technical_debt} min`
          : MISSING,
    };
  }, [details]);

  if (isLoading) return <ReportLoadingCard label="Loading SAST report…" />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!view) return <ReportNoDataCard />;

  return (
    <div className="space-y-4" data-testid="sast-tab">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-muted-foreground">Quality Gate</p>
            <p data-testid="sast-quality-gate" className="font-medium">
              {view.qualityGate}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Lines of code</p>
            <p data-testid="sast-ncloc" className="font-medium">
              {view.ncloc}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3" data-testid="sast-overall-grid">
        <MetricTile title="Security" value={MISSING} grade={view.securityGrade} testId="sast-security" hideValue />
        <MetricTile title="Reliability" value={view.bugs} grade={view.reliabilityGrade} testId="sast-reliability" />
        <MetricTile
          title="Maintainability"
          value={view.codeSmells}
          grade={view.maintainabilityGrade}
          testId="sast-maintainability"
        />
        <MetricTile
          title="Security hotspots"
          value={view.hotspots}
          testId="sast-hotspots"
          warn={view.hotspotsWarn}
        />
        <MetricTile title="Accepted issues" value={view.accepted} testId="sast-accepted" />
        <div className="flex items-start gap-3 rounded-lg border p-4" data-testid="sast-coverage">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Coverage</p>
            <p className="text-lg font-semibold">{view.coverage}</p>
            <p className="text-xs text-muted-foreground">On {view.linesToCover} lines to cover</p>
          </div>
          <Donut percent={view.coverageNum} label="coverage" />
        </div>
        <div className="flex items-start gap-3 rounded-lg border p-4" data-testid="sast-duplications">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Duplications</p>
            <p className="text-lg font-semibold">{view.duplications}</p>
            <p className="text-xs text-muted-foreground">On {view.duplicatedLines} lines</p>
          </div>
          <Donut percent={view.dupNum} label="duplications" />
          <span className="mt-2 h-2 w-2 rounded-full bg-primary" aria-hidden />
        </div>
        <MetricTile title="New technical debt" value={view.newDebt} testId="sast-new-debt" />
      </div>
    </div>
  );
}

function MetricTile({
  title,
  value,
  grade,
  testId,
  warn,
  hideValue,
}: Readonly<{
  title: string;
  value: string;
  grade?: RatingLetter | null;
  testId: string;
  warn?: boolean;
  hideValue?: boolean;
}>) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-4" data-testid={testId}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          {warn && <AlertTriangle className="h-4 w-4 text-yellow-600" data-testid={`${testId}-warn`} />}
        </div>
        {!hideValue && <p className="text-lg font-semibold">{value}</p>}
        {hideValue && grade == null && <p className="text-lg font-semibold">{MISSING}</p>}
      </div>
      <GradeCircle letter={grade ?? null} />
    </div>
  );
}
