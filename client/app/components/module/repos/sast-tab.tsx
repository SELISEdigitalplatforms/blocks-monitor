import { useMemo, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/core";
import { useGetReport } from "@/hooks/use-repos";
import { hasNoReport } from "@/components/module/repos/sca-transform";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";
import { getDeploymentLogEventBadgeClassName } from "@/utils/deployment-logs.utils";

const MISSING = "-";

type RatingLetter = "A" | "B" | "C" | "D" | "E";
type SastScope = "new" | "overall";

const RATING_CLASS: Record<RatingLetter, string> = {
  A: "bg-green-100 text-green-700",
  B: "bg-lime-100 text-lime-700",
  C: "bg-yellow-100 text-yellow-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-red-100 text-red-700",
};

const STATS_GRID = "grid w-full grid-cols-1 gap-x-10 gap-y-2 sm:grid-cols-2 md:grid-cols-3";

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
    <Card data-testid="sast-tab">
      <CardHeader className="mb-0 flex flex-col gap-4">
        <CardTitle>Overview</CardTitle>
        <div className="flex flex-wrap gap-2 text-xs">
          <div>
            <span className="text-low-emphasis">Quality Gate</span>
            <span
              data-testid="sast-quality-gate"
              className={`${getDeploymentLogEventBadgeClassName(
                newView.qualityGate === MISSING ? "Pending" : newView.qualityGate,
              )} ml-2`}
            >
              {newView.qualityGate}
            </span>
          </div>
          <div>
            <span className="text-low-emphasis">Lines of code</span>
            <span className="pl-2" data-testid="sast-ncloc">
              {newView.ncloc}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Separator orientation="horizontal" className="my-4 w-full" />
        <Tabs defaultValue="new">
          <TabsList>
            <TabsTrigger value="new">New Code</TabsTrigger>
            <TabsTrigger value="overall">Overall Code</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="mt-4 space-y-3">
            <NewCodeView view={newView} />
          </TabsContent>
          <TabsContent value="overall" className="mt-4 space-y-3">
            <OverallCodeView view={overallView} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function NewCodeView({ view }: Readonly<{ view: SastView }>) {
  const failed = view.failedConditions !== "0";
  return (
    <>
      {view.newCodeSince && (
        <p className="text-xs text-medium-emphasis">New code: Since {view.newCodeSince}</p>
      )}

      <div className="space-y-1 rounded-md border border-border p-3 text-xs">
        {failed ? (
          <>
            <p className="font-medium text-red-700">{view.failedConditions} conditions failed</p>
            <ul className="space-y-1 text-medium-emphasis">
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
          <p className="text-green-700">All conditions passed</p>
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
    <div className="flex h-20 items-start gap-4" data-testid={testId}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm text-high-emphasis">{title}</p>
          {failed && (
            <span className={`${getDeploymentLogEventBadgeClassName("Failed")} text-[10px]`}>
              Failed
            </span>
          )}
        </div>
        <p className="text-lg font-semibold">{value}</p>
        {helper && (
          <p className={`text-xs ${failed ? "text-red-600" : "text-gray-400"}`}>{helper}</p>
        )}
      </div>
      {visual && <div className="flex items-center gap-2">{visual}</div>}
    </div>
  );
}

function SeverityChips({ view }: Readonly<{ view: SastView }>) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-high-emphasis">Issues by severity</p>
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
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-medium-emphasis">
      {children}
    </span>
  );
}

function GradeCircle({ letter }: Readonly<{ letter: RatingLetter | null }>) {
  if (!letter) return null;
  return (
    <span
      data-testid={`grade-${letter}`}
      className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${RATING_CLASS[letter]}`}
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
    <div className="relative h-16 w-16">
      <svg className="h-full w-full" viewBox="0 0 64 64" aria-label={label} data-testid="sast-donut">
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="transparent"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted"
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
