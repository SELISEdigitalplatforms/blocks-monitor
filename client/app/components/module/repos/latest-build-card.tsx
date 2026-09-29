import type { ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import { formatDate } from "@seliseblocks/genesis-os/utils";
import type { IBuild } from "@/models/repos.model";
import {
  formatElapsedTime,
  getDeploymentLogEventBadgeClassName,
  isLiveBuildStatus,
} from "@/utils/deployment-logs.utils";

const DEPLOYMENT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function deploysTo(build: IBuild): string | null {
  return build.customDeploymentUrl || build.defaultDeploymentUrl || null;
}

function commitUrl(build: IBuild): string | null {
  if (build.repoUrl?.startsWith("https://github.com/") && build.commit) {
    return `${build.repoUrl}/commit/${build.commit}`;
  }
  return null;
}

export function LatestBuildCard({ build }: { build: IBuild }) {
  const durationLabel = isLiveBuildStatus(build.status)
    ? "Running…"
    : formatElapsedTime(
        Date.parse(build.lastUpdatedDate) - Date.parse(build.createdDate),
      );
  const url = deploysTo(build);
  const cUrl = commitUrl(build);
  const shortSha = build.commit?.slice(0, 7);

  return (
    <Card data-testid="latest-build-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Latest build</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
        <Field label="Status">
          <span className={getDeploymentLogEventBadgeClassName(build.status)}>{build.status}</span>
        </Field>
        <Field label="Build ID">
          <span className="font-mono text-xs">{build.itemId}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-1 h-6 w-6 p-0"
            aria-label="Copy build id"
            onClick={() => void navigator.clipboard?.writeText(build.itemId)}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </Field>
        <Field label="Branch">{build.branch}</Field>
        <Field label="Commit">
          {cUrl && shortSha ? (
            <a href={cUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              {shortSha} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            shortSha || "—"
          )}
        </Field>
        <Field label="Started">
          {build.createdDate ? formatDate(new Date(build.createdDate), DEPLOYMENT_DATE_FORMAT) : "—"}
        </Field>
        <Field label="Duration">{durationLabel}</Field>
        <Field label="Deploys to">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              {url.replace(/^https?:\/\//, "").slice(0, 48)} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Pipeline">
          {build.html_url && build.pipelineRunName ? (
            <a href={build.html_url} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              {build.pipelineRunName} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            build.pipelineRunName || "—"
          )}
        </Field>
      </CardContent>
    </Card>
  );
}

export function NoBuildCard() {
  return (
    <Card data-testid="no-build-card">
      <CardContent className="p-6 text-sm text-muted-foreground">
        This repository has not been deployed yet
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <div className="mt-0.5 font-medium">{children}</div>
    </div>
  );
}
