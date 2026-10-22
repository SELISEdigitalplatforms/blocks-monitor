import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/core";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import type { IRepo } from "@/models/repos.model";
import { RepoStatusBadge } from "@/components/module/repos/repo-status-badge";
import { DetailItem, DetailList, MissingValue } from "@/components/module/repos/repo-detail-fields";

function ExternalUrl({ url }: Readonly<{ url: string }>) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="inline-flex max-w-full items-center gap-1 font-normal text-primary hover:underline"
    >
      <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

export function RepositoryCard({ repo }: Readonly<{ repo: IRepo }>) {
  const isLive = Boolean(repo.deployedNamespace);
  return (
    <Card data-testid="repository-card" className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-5 py-3">
        <SectionHeading title="Repository" />
      </div>
      <div className="px-5 py-5 sm:px-6">
        <DetailList>
          <DetailItem label="Repo URL" wide>
            {repo.repoUrl ? <ExternalUrl url={repo.repoUrl} /> : <MissingValue>—</MissingValue>}
          </DetailItem>
          <DetailItem label="Deployment type">
            {repo.deploymentType || <MissingValue>—</MissingValue>}
          </DetailItem>
          <DetailItem label="Custom URL" wide>
            {repo.customDeploymentUrl ? (
              <ExternalUrl url={repo.customDeploymentUrl} />
            ) : (
              <MissingValue>—</MissingValue>
            )}
          </DetailItem>
          <DetailItem label="Live">
            <span data-testid="repo-live">
              <RepoStatusBadge
                status={isLive ? "Succeeded" : "NoBuild"}
                label={isLive ? "Yes" : "No"}
              />
            </span>
          </DetailItem>
        </DetailList>
      </div>
    </Card>
  );
}
