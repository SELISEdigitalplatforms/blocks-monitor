import { useMemo, type ReactNode } from "react";
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/core";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import { useGetReport } from "@/hooks/use-repos";
import { hasNoReport } from "@/components/module/repos/sca-transform";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";
import { RepoStatusBadge } from "@/components/module/repos/repo-status-badge";

const MISSING = "-";

type RatingLetter = "A" | "B" | "C" | "D" | "E";
type SastScope = "new" | "overall";

/** Rating grades on the console's soft status surfaces, best (A) to worst (E). */
const RATING_CLASS: Record<RatingLetter, string> = {
  A: "bg-forest-soft text-forest-ink",
  B: "bg-forest-soft/60 text-forest-ink",
  C: "bg-sunset-soft text-warn-ink",
  D: "bg-rose-soft text-rose-ink",
  E: "bg-destructive/10 text-danger-ink",
};

const STATS_GRID = "grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3";

export function SastTab({
  projectKey,
  buildId,
  isActive,
}: Readonly<{
  projectKey: string;
  buildId: string | undefined;
  isActive: boolean;
}>) {
  const { data, isLoading, isError, refetch } = useGetReport(projectKey, buildId, "sast", isActive);

  const details = data?.data?.details ?? null;
  const newView = useMemo(() => (details ? mapSastDetails(details, "new") : null), [details]);
  const overallView = useMemo(
    () => (details ? mapSastDetails(details, "overall") : null),
    [details],
  );

  if (isLoading) return <ReportLoadingCard label="Loading SAST report..." />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!newView || !overallView) return <ReportNoDataCard />;

  return (
    <Card data-testid="sast-tab" className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading title="Overview" description="Static analysis of the latest build." />
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Quality Gate</dt>
            <dd>
              <RepoStatusBadge
                testId="sast-quality-gate"
                status={newView.qualityGate === MISSING ? "Pending" : newView.qualityGate}
                label={newView.qualityGate}
              />
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Lines of code</dt>
            <dd className="font-medium tabular-nums text-high-emphasis" data-testid="sast-ncloc">
              {newView.ncloc}
            </dd>
          </div>
        </dl>
      </div>
      <Tabs defaultValue="new" className="px-5 pb-5 pt-3">
        <TabsList>
          <TabsTrigger value="new">New Code</TabsTrigger>
          <TabsTrigger value="overall">Overall Code</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4 space-y-4">
          <NewCodeView view={newView} />
        </TabsContent>
        <TabsContent value="overall" className="mt-4 space-y-4">
          <OverallCodeView view={overallView} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function NewCodeView({ view }: Readonly<{ view: SastView }>) {
  const failed = view.failedConditions !== "0";
  return (
    <>
      {view.newCodeSince && (
        <p className="text-xs text-muted-foreground">New code: Since {view.newCodeSince}</p>
      )}

      <div
        className={cn(
          "space-y-1.5 rounded-sm px-4 py-3 text-[13px]",
          failed ? "bg-rose-soft/60" : "bg-forest-soft/60",
        )}
      >
        {failed ? (
          <>
            <p className="font-medium text-rose-ink">{view.failedConditions} conditions failed</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-high-emphasis">{view.coverage}</span> Coverage is
                less than {view.requiredCoverage}
              </li>
              <li>
                <span className="font-medium text-high-emphasis">{view.hotspotsReviewed}</span>{" "}
                Security Hotspots Reviewed is less than 100.0%
              </li>
              <li>
                <span className="font-medium text-high-emphasis">{view.newIssues}</span> Issues is
                greater than 0
              </li>
            </ul>
          </>
        ) : (
          <p className="font-medium text-forest-ink">All conditions passed</p>
        )}
      </div>

      <div className={STATS_GRID}>
        <MetricBlock
          title="New issues"
          value={view.newIssues}
          failed
          helper="Required = 0"
          testId="sast-reliability"
        />
        <MetricBlock
          title="Accepted issues"
          value={view.accepted}
          helper="Valid issues that were not fixed"
        />
        <MetricBlock
          title="Coverage"
          value={view.coverage}
          failed
          helper={`Required >= ${view.requiredCoverage}`}
          visual={<Donut percent={view.coverageNum} label="coverage" />}
          testId="sast-coverage"
        />
        <MetricBlock
          title="Duplications"
          value={view.duplications}
          helper={`On ${view.duplicatedLines} new lines`}
          visual={<Donut percent={view.dupNum} label="duplications" />}
          testId="sast-duplications"
        />
        <MetricBlock
          title="Security hotspots"
          value={view.hotspots}
          failed={view.hotspotsWarn}
          helper="Required >= 100.0%"
          visual={<GradeCircle letter={view.securityGrade} />}
          testId="sast-hotspots"
        />
      </div>

      <SeverityChips view={view} />
    </>
  );
}

function OverallCodeView({ view }: Readonly<{ view: SastView }>) {
  return (
    <>
      <div className={STATS_GRID}>
        <MetricBlock
          title="Security"
          value={view.securityIssues}
          helper="Open issues"
          visual={<GradeCircle letter={view.securityGrade} />}
          testId="sast-security"
        />
        <MetricBlock
          title="Reliability"
          value={view.bugs}
          helper="Open issues"
          visual={<GradeCircle letter={view.reliabilityGrade} />}
          testId="sast-reliability"
        />
        <MetricBlock
          title="Maintainability"
          value={view.codeSmells}
          helper="Open issues"
          visual={<GradeCircle letter={view.maintainabilityGrade} />}
          testId="sast-maintainability"
        />
        <MetricBlock
          title="Accepted issues"
          value={view.accepted}
          helper="Valid issues that were not fixed"
        />
        <MetricBlock
          title="Coverage"
          value={view.coverage}
          helper={`On ${view.linesToCover} lines to cover`}
          visual={<Donut percent={view.coverageNum} label="coverage" />}
          testId="sast-coverage"
        />
        <MetricBlock
          title="Duplications"
          value={view.duplications}
          helper={`On ${view.duplicatedLines} lines`}
          visual={<Donut percent={view.dupNum} label="duplications" />}
          testId="sast-duplications"
        />
        <MetricBlock
          title="Security hotspots"
          value={view.hotspots}
          visual={<GradeCircle letter={view.hotspotsWarn ? "E" : view.securityGrade} />}
          testId="sast-hotspots"
        />
        <MetricBlock title="Technical debt" value={view.newDebt} testId="sast-new-debt" />
      </div>

      <SeverityChips view={view} />
    </>
  );
}

function MetricBlock({
  title,
  value,
  helper,
  failed,
  visual,
  testId,
}: Readonly<{
  title: string;
  value: string;
  helper?: string;
  failed?: boolean;
  visual?: ReactNode;
  testId?: string;
}>) {
  return (
    <div
      className="flex min-h-20 items-center gap-4 rounded-sm bg-surface-warm/40 px-4 py-3"
      data-testid={testId}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] text-muted-foreground">{title}</p>
          {failed && <RepoStatusBadge status="Failed" className="px-2 py-0.5 text-[10px]" />}
        </div>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-high-emphasis">{value}</p>
        {helper && (
          <p className={cn("text-xs", failed ? "text-danger-ink" : "text-muted-foreground")}>
            {helper}
          </p>
        )}
      </div>
      {visual && <div className="flex shrink-0 items-center gap-2">{visual}</div>}
    </div>
  );
}

function SeverityChips({ view }: Readonly<{ view: SastView }>) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Issues by severity
      </p>
      <div className="flex flex-wrap gap-2">
        <Chip>Blocker {view.blocker}</Chip>
        <Chip>High {view.high}</Chip>
        <Chip>Medium {view.medium}</Chip>
        <Chip>Low {view.low}</Chip>
        <Chip>Info {view.info}</Chip>
      </div>
    </div>
  );
}

function Chip({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-warm px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function GradeCircle({ letter }: Readonly<{ letter: RatingLetter | null }>) {
  if (!letter) return null;
  return (
    <span
      data-testid={`grade-${letter}`}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full text-base font-bold",
        RATING_CLASS[letter],
      )}
    >
      {letter}
    </span>
  );
}

function Donut({ percent, label }: Readonly<{ percent: number | null; label: string }>) {
  const p = percent == null || !Number.isFinite(percent) ? 0 : Math.max(0, Math.min(100, percent));
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (p / 100) * c;
  return (
    <div className="relative h-12 w-12">
      <svg
        className="h-full w-full"
        viewBox="0 0 64 64"
        aria-label={label}
        data-testid="sast-donut"
      >
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="8"
          className="text-border-default"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="8"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="butt"
          className="text-primary"
          transform="rotate(-90 32 32)"
        />
      </svg>
    </div>
  );
}

interface SastView {
  qualityGate: string;
  ncloc: string;
  securityGrade: RatingLetter | null;
  reliabilityGrade: RatingLetter | null;
  maintainabilityGrade: RatingLetter | null;
  securityIssues: string;
  bugs: string;
  codeSmells: string;
  hotspots: string;
  hotspotsReviewed: string;
  hotspotsWarn: boolean;
  accepted: string;
  coverage: string;
  coverageNum: number | null;
  requiredCoverage: string;
  linesToCover: string;
  duplications: string;
  dupNum: number | null;
  duplicatedLines: string;
  newDebt: string;
  newIssues: string;
  newCodeSince: string;
  failedConditions: string;
  blocker: string;
  high: string;
  medium: string;
  low: string;
  info: string;
}

function mapSastDetails(details: Record<string, string>, scope: SastScope): SastView {
  const prefix = scope === "new" ? "new_" : "";
  const coverageRaw = pick(details, `${prefix}coverage`, "coverage");
  const dupRaw = pick(details, `${prefix}duplicated_lines_density`, "duplicated_lines_density");
  const hotspotsRaw = pick(details, `${prefix}security_hotspots`, "security_hotspots");
  const newIssues = pick(details, `${prefix}violations`, "new_issues", "violations", "bugs", "0");
  const coverageNum = toNumber(coverageRaw);
  const dupNum = toNumber(dupRaw);
  const hotspotsNum = toNumber(hotspotsRaw);
  const qualityGate = qualityGateLabel(details.alert_status);
  const technicalDebt = pick(
    details,
    `${prefix}technical_debt`,
    "new_technical_debt",
    "sqale_index",
  );
  const newDebt = technicalDebt === MISSING ? MISSING : `${technicalDebt} min`;

  return {
    qualityGate,
    ncloc: formatCount(details.ncloc),
    securityGrade: toGrade(details.security_rating),
    reliabilityGrade: toGrade(details.reliability_rating),
    maintainabilityGrade: toGrade(details.sqale_rating),
    securityIssues: formatCount(pick(details, "security_issues", "vulnerabilities", "0")),
    bugs: formatCount(details.bugs),
    codeSmells: formatCount(details.code_smells),
    hotspots: formatCount(hotspotsRaw),
    hotspotsReviewed: formatPercent(pick(details, "security_hotspots_reviewed", "0")),
    hotspotsWarn: hotspotsNum != null && hotspotsNum > 0,
    accepted: formatCount(pick(details, `${prefix}accepted_issues`, "accepted_issues")),
    coverage: formatPercent(coverageRaw),
    coverageNum,
    requiredCoverage: formatPercent(pick(details, "required_coverage", "5")),
    linesToCover: formatCount(pick(details, `${prefix}lines_to_cover`, "lines_to_cover")),
    duplications: formatPercent(dupRaw),
    dupNum,
    duplicatedLines: formatCount(pick(details, `${prefix}duplicated_lines`, "duplicated_lines")),
    newDebt,
    newIssues: formatCount(newIssues),
    newCodeSince: pick(details, "new_code_period", "new_code_since", ""),
    failedConditions: qualityGate === "Failed" ? "3" : "0",
    blocker: formatCount(pick(details, "blocker_violations", "blocker", "0")),
    high: formatCount(pick(details, "critical_violations", "high", "0")),
    medium: formatCount(pick(details, "major_violations", "medium", "0")),
    low: formatCount(pick(details, "minor_violations", "low", "0")),
    info: formatCount(pick(details, "info_violations", "info", "0")),
  };
}

function pick(details: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = details[key];
    if (value != null && value !== "") return value;
  }
  return MISSING;
}

function toGrade(rating: string | undefined): RatingLetter | null {
  if (rating == null || rating === "") return null;
  const n = Math.round(Number(rating));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return (["A", "B", "C", "D", "E"] as const)[n - 1];
}

function toNumber(value: string | undefined): number | null {
  if (value == null || value === "" || value === MISSING) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCount(value: string | undefined): string {
  if (value == null || value === "" || value === MISSING) return MISSING;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING;
  return Math.trunc(n).toLocaleString("en-US");
}

function formatPercent(value: string | undefined): string {
  if (value == null || value === "" || value === MISSING) return MISSING;
  const n = Number(value);
  if (!Number.isFinite(n)) return MISSING;
  return `${n.toFixed(1)}%`;
}

function qualityGateLabel(status: string | undefined): string {
  if (status === "OK") return "Passed";
  if (status === "ERROR") return "Failed";
  return MISSING;
}
