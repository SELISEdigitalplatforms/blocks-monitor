import type { ReactNode } from "react";
import { ArrowUpRight, Copy, Rocket } from "lucide-react";
import { Button, Card } from "@/components/core";
import { formatDate } from "@seliseblocks/app-kit/utils";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import type { IBuild } from "@/models/repos.model";
import { formatElapsedTime, isLiveBuildStatus } from "@/utils/deployment-logs.utils";
import { RepoStatusBadge } from "@/components/module/repos/repo-status-badge";
import { DetailItem, DetailList, MissingValue } from "@/components/module/repos/repo-detail-fields";

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

function ExternalLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 font-normal text-primary hover:underline"
    >
      <span className="truncate">{children}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

export function LatestBuildCard({ build }: Readonly<{ build: IBuild }>) {
  const durationLabel = isLiveBuildStatus(build.status)
    ? "Running…"
    : formatElapsedTime(Date.parse(build.lastUpdatedDate) - Date.parse(build.createdDate));
  const url = deploysTo(build);
  const cUrl = commitUrl(build);
  const shortSha = build.commit?.slice(0, 7);

  return (
    <Card data-testid="latest-build-card" className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-5 py-3">
        <SectionHeading title="Latest build" />
      </div>
      <div className="px-5 py-5 sm:px-6">
        <DetailList>
          <DetailItem label="Status">
            <RepoStatusBadge status={build.status} />
          </DetailItem>
          <DetailItem label="Build ID">
            <span className="flex items-center gap-1">
              <span className="truncate font-mono text-[13px] font-normal text-muted-foreground">
                {build.itemId}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 rounded-sm text-muted-foreground hover:bg-surface-warm hover:text-high-emphasis"
                aria-label="Copy build id"
                title="Copy build id"
                onClick={() => void navigator.clipboard?.writeText(build.itemId)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </span>
          </DetailItem>
          <DetailItem label="Branch">
            <span className="font-mono text-[13px]">{build.branch}</span>
          </DetailItem>
          <DetailItem label="Commit">
            {cUrl && shortSha ? (
              <ExternalLink href={cUrl}>
                <span className="font-mono">{shortSha}</span>
              </ExternalLink>
            ) : (
              <MissingValue>{shortSha || "—"}</MissingValue>
            )}
          </DetailItem>
          <DetailItem label="Started">
            {build.createdDate ? (
              formatDate(new Date(build.createdDate), DEPLOYMENT_DATE_FORMAT)
            ) : (
              <MissingValue>—</MissingValue>
            )}
          </DetailItem>
          <DetailItem label="Duration">
            <span className="tabular-nums">{durationLabel}</span>
          </DetailItem>
          <DetailItem label="Deploys to" wide>
            {url ? (
              <ExternalLink href={url}>{url.replace(/^https?:\/\//, "")}</ExternalLink>
            ) : (
              <MissingValue>—</MissingValue>
            )}
          </DetailItem>
          <DetailItem label="Pipeline" wide>
            {build.html_url && build.pipelineRunName ? (
              <ExternalLink href={build.html_url}>{build.pipelineRunName}</ExternalLink>
            ) : (
              <MissingValue>{build.pipelineRunName || "—"}</MissingValue>
            )}
          </DetailItem>
        </DetailList>
      </div>
    </Card>
  );
}

export function NoBuildCard() {
  return (
    <Card
      data-testid="no-build-card"
      className="flex min-h-60 flex-col items-center justify-center gap-3 px-5 py-10 text-center"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-sm bg-primary/[0.07] text-primary">
        <Rocket className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm text-muted-foreground">This repository has not been deployed yet</p>
    </Card>
  );
}
