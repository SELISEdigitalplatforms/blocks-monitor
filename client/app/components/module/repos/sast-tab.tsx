import { useMemo, useState, type ReactNode } from "react";
import { useGetReport } from "@/hooks/use-repos";
import { hasNoReport } from "@/components/module/repos/sca-transform";
import {
  ReportErrorCard,
  ReportLoadingCard,
  ReportNoDataCard,
} from "@/components/module/repos/report-states";

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
  const [scope, setScope] = useState<SastScope>("new");

  const details = data?.data?.details ?? null;
  const view = useMemo(() => (details ? mapSastDetails(details, scope) : null), [details, scope]);

  if (isLoading) return <ReportLoadingCard label="Loading SAST report..." />;
  if (isError) return <ReportErrorCard onRetry={() => refetch()} />;
  if (hasNoReport(data?.data ?? null)) return <ReportNoDataCard />;
  if (!view) return <ReportNoDataCard />;

  return (
    <section className="rounded-sm border bg-background p-6 shadow-sm" data-testid="sast-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-high-emphasis">Overview</h2>
          <div className="mt-7 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Quality Gate</span>
            <StatusPill failed={view.qualityGate === "Failed"} testId="sast-quality-gate">
              {view.qualityGate}
            </StatusPill>
            <span className="text-muted-foreground">Lines of code</span>
            <span className="font-semibold" data-testid="sast-ncloc">
              {view.ncloc}
            </span>
          </div>
        </div>
      </div>

      <div className="my-6 border-t" />

      <div className="inline-flex rounded-sm bg-secondary p-1">
        <button
          type="button"
          className={`rounded-sm px-4 py-2 text-sm font-semibold ${
            scope === "new" ? "bg-background text-high-emphasis shadow-sm" : "text-muted-foreground"
          }`}
          onClick={() => setScope("new")}
        >
          New Code
        </button>
        <button
          type="button"
          className={`rounded-sm px-4 py-2 text-sm font-semibold ${
            scope === "overall"
              ? "bg-background text-high-emphasis shadow-sm"
              : "text-muted-foreground"
          }`}
          onClick={() => setScope("overall")}
        >
          Overall Code
        </button>
      </div>

      {scope === "new" ? <NewCodeView view={view} /> : <OverallCodeView view={view} />}
    </section>
  );
}

function NewCodeView({ view }: Readonly<{ view: SastView }>) {
  return (
    <div className="mt-6 space-y-5">
      <p className="text-sm font-medium text-high-emphasis">
        New code{view.newCodeSince ? `: Since ${view.newCodeSince}` : ""}
      </p>

      <div className="rounded-sm border p-4 text-sm">
        <p className="font-semibold text-red-500">{view.failedConditions} conditions failed</p>
        <div className="mt-2 space-y-1 font-medium">
          <p>
            {view.coverage} Coverage is less than {view.requiredCoverage}
          </p>
          <p>{view.hotspotsReviewed} Security Hotspots Reviewed is less than 100.0%</p>
          <p>{view.newIssues} Issues is greater than 0</p>
        </div>
      </div>

      <div className="grid gap-x-12 gap-y-7 md:grid-cols-3">
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
    </div>
  );
}

function OverallCodeView({ view }: Readonly<{ view: SastView }>) {
  return (
    <div className="mt-6 space-y-8">
      <div className="grid gap-x-12 gap-y-8 md:grid-cols-3">
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
    </div>
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
    <div className="grid min-h-20 grid-cols-[1fr_auto] gap-4" data-testid={testId}>
      <div>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-high-emphasis">{title}</p>
          {failed && <StatusPill failed>Failed</StatusPill>}
        </div>
        <p className="mt-1 text-2xl font-semibold leading-none text-high-emphasis">{value}</p>
        {helper && (
          <p className={`mt-2 text-sm ${failed ? "text-red-500" : "text-muted-foreground"}`}>
            {helper}
          </p>
        )}
      </div>
      {visual && <div className="self-center justify-self-end">{visual}</div>}
    </div>
  );
}

function SeverityChips({ view }: Readonly<{ view: SastView }>) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-high-emphasis">Issues by severity</p>
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <Chip>Blocker {view.blocker}</Chip>
        <Chip>High {view.high}</Chip>
        <Chip>Medium {view.medium}</Chip>
        <Chip>Low {view.low}</Chip>
        <Chip>Info {view.info}</Chip>
      </div>
    </div>
  );
}

function StatusPill({
  failed,
  children,
  testId,
}: Readonly<{
  failed?: boolean;
  children: ReactNode;
  testId?: string;
}>) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        failed ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
      }`}
    >
      {children}
    </span>
  );
}

function Chip({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <span className="rounded-full bg-secondary px-3 py-1 text-muted-foreground">{children}</span>
  );
}

function GradeCircle({ letter }: Readonly<{ letter: RatingLetter | null }>) {
  if (!letter) return null;
  return (
    <span
      data-testid={`grade-${letter}`}
      className={`inline-flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold ${RATING_CLASS[letter]}`}
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
    <svg width="78" height="78" viewBox="0 0 78 78" aria-label={label} data-testid="sast-donut">
      <circle
        cx="39"
        cy="39"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        className="text-muted"
      />
      <circle
        cx="39"
        cy="39"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className="text-primary"
        transform="rotate(-90 39 39)"
      />
    </svg>
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
