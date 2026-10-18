import { useMemo, useState } from "react";
import { formatDate } from "@seliseblocks/app-kit/utils";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderGit2,
  Loader2,
  Logs,
  Network,
  Package,
  Rocket,
  ShieldCheck,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import type { IBuild, IBuildEvent, IRepo } from "@/models/repos.model";
import { formatElapsedTime } from "@/utils/deployment-logs.utils";
import { RepoStatusBadge } from "@/components/module/repos/repo-status-badge";
import {
  DetailItem,
  DetailList,
  ExternalValue,
  MissingValue,
} from "@/components/module/repos/repo-detail-fields";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const EVENT_GROUP_ORDER = ["Clone", "Build", "Sast", "Sca", "Deploy"];

/** Each pipeline stage's icon and accent, as in console's `deployment-steps.tsx`. */
const STEP_STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  Clone: { icon: FolderGit2, tone: "bg-primary/[0.07] text-primary" },
  Build: { icon: Package, tone: "bg-sunset-soft text-warn-ink" },
  Sast: { icon: ShieldCheck, tone: "bg-lavender-soft text-lavender-ink" },
  Sca: { icon: Network, tone: "bg-rose-soft text-rose-ink" },
  Deploy: { icon: Rocket, tone: "bg-forest-soft text-forest-ink" },
};

type StepStatus = "success" | "error" | "running" | "pending";

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  success: "succeeded",
  error: "failed",
  running: "running",
  pending: "not started",
};

interface BuildStep {
  id: string;
  name: string;
  status: StepStatus;
  duration: string;
  logs: string[];
  startedAt: string | null;
  endedAt: string | null;
}

export function RepoDeploymentLogsTab({
  repo,
  build,
}: Readonly<{
  repo: IRepo | null;
  build: IBuild | null;
}>) {
  return (
    <div className="space-y-8">
      {build ? <GeneralInformationCard repo={repo} build={build} /> : <NoBuildCard />}
      <DeploymentLogsCard build={build} />
    </div>
  );
}

function GeneralInformationCard({
  repo,
  build,
}: Readonly<{
  repo: IRepo | null;
  build: IBuild;
}>) {
  const repoUrl = repo?.repoUrl || build.repoUrl || "";
  const deploysTo = build.customDeploymentUrl || build.defaultDeploymentUrl || "";
  const customUrl = build.customDeploymentUrl || "";

  return (
    <section
      aria-label="General information"
      className="min-w-0 space-y-2"
      data-testid="deployment-general-info"
    >
      <SectionHeading
        title="General information"
        description="Where this repository deploys and its latest deployment."
      />
      <div className="rounded-sm bg-card px-5 py-5 shadow-surface-ring sm:px-6">
        <DetailList>
          <DetailItem label="Repo URL" wide>
            {repoUrl ? (
              <ExternalValue href={repoUrl} value={repoUrl} copyLabel="Copy repo URL" />
            ) : (
              <MissingValue />
            )}
          </DetailItem>
          <DetailItem label="Deploys To" wide>
            {deploysTo ? (
              <ExternalValue href={deploysTo} value={deploysTo} copyLabel="Copy deployment URL" />
            ) : (
              <MissingValue />
            )}
          </DetailItem>
          <DetailItem label="Custom Deployment URL" wide>
            {customUrl ? (
              <ExternalValue href={customUrl} value={customUrl} copyLabel="Copy custom URL" />
            ) : (
              <MissingValue />
            )}
          </DetailItem>
          <DetailItem label="Deployment Status">
            <RepoStatusBadge status={build.status || "Unknown"} />
          </DetailItem>
          <DetailItem label="Latest Deployment Date">
            {build.createdDate ? (
              formatDate(new Date(build.createdDate), DEPLOYMENT_DATE_FORMAT)
            ) : (
              <MissingValue />
            )}
          </DetailItem>
        </DetailList>
      </div>
    </section>
  );
}

function DeploymentLogsCard({ build }: Readonly<{ build: IBuild | null }>) {
  const steps = useMemo(() => buildSteps(build), [build]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(steps[0]?.logs.length ? [steps[0].id] : []),
  );

  let wholeStatus = "";
  if (build) {
    wholeStatus = build.status === "Failed" ? "Failed" : "Successful";
  }
  const totalDuration =
    build?.createdDate && build?.lastUpdatedDate
      ? formatElapsedTime(Date.parse(build.lastUpdatedDate) - Date.parse(build.createdDate))
      : "";

  const toggle = (step: BuildStep) => {
    if (step.logs.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(step.id)) next.delete(step.id);
      else next.add(step.id);
      return next;
    });
  };

  return (
    <section
      aria-label="Deployment logs"
      className="min-w-0 space-y-2"
      data-testid="deployment-logs-card"
    >
      <SectionHeading
        title="Deployment logs"
        description={build ? undefined : "Logs appear here once the repository is built."}
        actions={
          build && (
            <span
              className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"
              data-testid="deployment-logs-summary"
            >
              <StatusIcon status={build.status} />
              <span>
                {wholeStatus} at {build.eventName || "Deploy"}
                {totalDuration ? ` · ${totalDuration}` : ""}
              </span>
            </span>
          )
        }
      />

      <div className="overflow-hidden rounded-sm bg-card shadow-surface-ring">
        {steps.length === 0 ? (
          <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 px-5 py-10 text-center text-sm text-muted-foreground">
            <Logs className="h-6 w-6" aria-hidden="true" />
            No deployment logs available for this build.
          </div>
        ) : (
          <ol className="divide-y divide-border/50">
            {steps.map((step) => {
              const isExpanded = expanded.has(step.id);
              const expandable = step.logs.length > 0;
              const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    aria-expanded={expandable ? isExpanded : undefined}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      expandable ? "cursor-pointer hover:bg-surface-warm/40" : "cursor-default",
                    )}
                    onClick={() => toggle(step)}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {expandable ? (
                        <ExpandIcon
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : (
                        <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <StepTile name={step.name} status={step.status} />
                      <span className="truncate text-[13px] font-medium text-high-emphasis">
                        {displayStepName(step.name)}
                      </span>
                      <span className="sr-only">{STEP_STATUS_LABEL[step.status]}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {step.duration}
                    </span>
                  </button>

                  {isExpanded && step.logs.length > 0 && (
                    <div className="border-t border-border/50 bg-surface-warm/40">
                      <div className="flex flex-wrap items-center gap-x-2 border-b border-border/50 px-5 py-2 text-xs text-muted-foreground">
                        Started {formatEventTime(step.startedAt)} - Ended{" "}
                        {formatEventTime(step.endedAt)} - Took {step.duration}
                      </div>
                      <div className="max-h-[360px] overflow-auto py-1 font-mono text-xs text-high-emphasis">
                        {step.logs.map((log, logIndex) => (
                          <div key={`${step.id}-${logIndex}`} className="flex">
                            <span className="w-14 shrink-0 select-none px-3 py-0.5 text-right tabular-nums text-muted-foreground">
                              {String(logIndex + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word px-3 py-0.5">
                              {log}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function NoBuildCard() {
  return (
    <section
      className="flex min-h-60 flex-col items-center justify-center rounded-sm bg-card px-5 py-10 text-center shadow-surface-ring"
      data-testid="no-build-card"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm bg-primary/[0.07] text-primary">
        <Rocket className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold tracking-tight text-high-emphasis">
        No deployments yet
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        This repository has not been deployed yet
      </p>
    </section>
  );
}

/** A stage's own icon in its accent, with a corner badge for its outcome. */
function StepTile({ name, status }: Readonly<{ name: string; status: StepStatus }>) {
  const { icon: Icon, tone } = STEP_STYLE[name] ?? STEP_STYLE.Build;
  return (
    <span
      className={cn(
        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm",
        tone,
        status === "pending" && "opacity-40",
        status === "error" && "ring-1 ring-error/60",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {status !== "pending" && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ring-1 ring-card",
            status === "success" && "bg-success text-white",
            status === "error" && "bg-error text-white",
            status === "running" && "bg-card text-primary",
          )}
        >
          {status === "success" && <Check className="h-2 w-2" strokeWidth={4} />}
          {status === "error" && <X className="h-2 w-2" strokeWidth={4} />}
          {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
        </span>
      )}
    </span>
  );
}

function buildSteps(build: IBuild | null): BuildStep[] {
  const events = build?.events ?? [];
  if (!build || events.length === 0) return [];

  const grouped = new Map<string, IBuildEvent[]>();
  events.forEach((event) => {
    const group = normalizeGroup(event.eventGroup);
    const existing = grouped.get(group) ?? [];
    existing.push(event);
    grouped.set(group, existing);
  });

  return Array.from(grouped.entries())
    .map(([group, groupEvents]) => {
      const ordered = [...groupEvents].sort((a, b) => eventTime(a) - eventTime(b));
      const logs = ordered
        .filter((event) => event.eventType === "Log")
        .flatMap((event) => splitLogMessage(event.message));
      const status = stepStatus(ordered);
      const startedAt = ordered[0] ? eventDate(ordered[0]) : null;
      const lastEvent = ordered.at(-1);
      const endedAt = lastEvent ? eventDate(lastEvent) : null;
      return {
        id: `${build.itemId}-${group}`,
        name: group,
        status,
        duration: formatStepDuration(startedAt, endedAt),
        logs,
        startedAt,
        endedAt,
      };
    })
    .sort((a, b) => EVENT_GROUP_ORDER.indexOf(a.name) - EVENT_GROUP_ORDER.indexOf(b.name));
}

function normalizeGroup(group?: string | null): string {
  const lower = (group || "Build").toLowerCase();
  if (lower === "sast") return "Sast";
  if (lower === "sca") return "Sca";
  const found = EVENT_GROUP_ORDER.find((item) => item.toLowerCase() === lower);
  return found ?? "Build";
}

function stepStatus(events: IBuildEvent[]): StepStatus {
  if (events.some((event) => event.eventType === "EventFailed")) return "error";
  if (events.some((event) => event.eventType === "EventFinished")) return "success";
  if (events.some((event) => event.eventType === "EventStarted")) return "running";
  return "pending";
}

function splitLogMessage(message?: string | null): string[] {
  if (!message) return [];
  return message
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function eventDate(event: IBuildEvent): string | null {
  return event.createdAt || event.createdDate || event.lastUpdateDate || null;
}

function eventTime(event: IBuildEvent): number {
  const value = eventDate(event);
  return value ? Date.parse(value) || 0 : 0;
}

function formatStepDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "-";
  return formatElapsedTime(Date.parse(end) - Date.parse(start));
}

function formatEventTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function displayStepName(name: string): string {
  return name === "Sast" || name === "Sca" ? name.toUpperCase() : name;
}

function StatusIcon({ status }: Readonly<{ status?: string | null }>) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "failed" || normalized === "error") {
    return <XCircle className="h-4 w-4 text-error" aria-hidden />;
  }
  if (normalized === "succeeded" || normalized === "success" || normalized === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  }
  if (normalized === "running" || normalized === "started") {
    return <Circle className="h-4 w-4 fill-primary text-primary" aria-hidden />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
}
