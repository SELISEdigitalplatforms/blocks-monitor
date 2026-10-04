import { useMemo, useState } from "react";
import { formatDate } from "@seliseblocks/genesis-os/utils";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/core";
import type { IBuild, IBuildEvent, IRepo } from "@/models/repos.model";
import {
  formatElapsedTime,
  getDeploymentLogEventBadgeClassName,
} from "@/utils/deployment-logs.utils";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const EVENT_GROUP_ORDER = ["Clone", "Build", "Sast", "Sca", "Deploy"];

type StepStatus = "success" | "error" | "running" | "pending";

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
    <div className="space-y-4">
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
      className="rounded-sm border bg-background p-6 shadow-sm"
      data-testid="deployment-general-info"
    >
      <h2 className="text-lg font-semibold text-high-emphasis">General information</h2>

      <div className="mt-8 grid gap-8 text-sm md:grid-cols-2">
        <div className="space-y-6">
          <InfoField label="Repo URL">
            {repoUrl ? <ExternalValue href={repoUrl} value={repoUrl} /> : "N/A"}
          </InfoField>
          <InfoField label="Deploys To">
            {deploysTo ? <ExternalValue href={deploysTo} value={deploysTo} /> : "N/A"}
          </InfoField>
          <InfoField label="Custom Deployment URL">
            {customUrl ? <ExternalValue href={customUrl} value={customUrl} /> : "N/A"}
          </InfoField>
        </div>

        <div className="space-y-6">
          <InfoField label="Deployment Status">
            <span className={getDeploymentLogEventBadgeClassName(build.status)}>
              {build.status || "Unknown"}
            </span>
          </InfoField>
          <InfoField label="Latest Deployment Date">
            {build.createdDate
              ? formatDate(new Date(build.createdDate), DEPLOYMENT_DATE_FORMAT)
              : "N/A"}
          </InfoField>
        </div>
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
      className="rounded-sm border bg-background p-6 shadow-sm"
      data-testid="deployment-logs-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-high-emphasis">Deployment logs</h2>
        {build && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusIcon status={build.status} />
            <span>
              {wholeStatus} at {build.eventName || "Deploy"}
              {totalDuration ? ` - ${totalDuration}` : ""}
            </span>
          </div>
        )}
      </div>

      {steps.length === 0 ? (
        <div className="mt-6 rounded-sm border py-10 text-center text-sm text-muted-foreground">
          No deployment logs available for this build.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-sm border">
          {steps.map((step, index) => {
            const isExpanded = expanded.has(step.id);
            const expandable = step.logs.length > 0;
            const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;
            return (
              <div key={step.id} className={index < steps.length - 1 ? "border-b" : ""}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-4 py-3 text-left ${
                    isExpanded ? "bg-secondary" : "bg-background"
                  } ${expandable ? "hover:bg-secondary/80" : ""}`}
                  onClick={() => toggle(step)}
                >
                  <span className="flex items-center gap-3 text-sm font-semibold">
                    {expandable ? (
                      <ExpandIcon className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <span className="w-4" />
                    )}
                    <StatusIcon status={step.status} />
                    {displayStepName(step.name)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{step.duration}</span>
                </button>

                {isExpanded && step.logs.length > 0 && (
                  <div className="bg-secondary">
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground">
                      Started {formatEventTime(step.startedAt)} - Ended{" "}
                      {formatEventTime(step.endedAt)} - Took {step.duration}
                    </div>
                    <div className="max-h-[360px] overflow-auto pb-2 font-mono text-xs">
                      {step.logs.map((log, logIndex) => (
                        <div key={`${step.id}-${logIndex}`} className="flex px-4 py-1">
                          <span className="w-10 shrink-0 select-none text-right text-muted-foreground">
                            {String(logIndex + 1).padStart(2, "0")}
                          </span>
                          <span className="ml-6 min-w-0 whitespace-pre-wrap break-words">
                            {log}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NoBuildCard() {
  return (
    <section
      className="rounded-sm border bg-background p-6 text-sm text-muted-foreground"
      data-testid="no-build-card"
    >
      This repository has not been deployed yet
    </section>
  );
}

function InfoField({
  label,
  children,
}: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <div>
      <p className="mb-3 font-semibold text-high-emphasis">{label}</p>
      <div className="font-medium text-high-emphasis">{children}</div>
    </div>
  );
}

function ExternalValue({ href, value }: Readonly<{ href: string; value: string }>) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate text-primary hover:underline"
      >
        {value}
      </a>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground"
        aria-label="Copy value"
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        <Copy className="h-4 w-4" />
      </Button>
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
    return <XCircle className="h-4 w-4 text-red-500" aria-hidden />;
  }
  if (normalized === "succeeded" || normalized === "success" || normalized === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden />;
  }
  if (normalized === "running" || normalized === "started") {
    return <Circle className="h-4 w-4 fill-blue-500 text-blue-500" aria-hidden />;
  }
  return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
}
