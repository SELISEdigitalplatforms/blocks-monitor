import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/core";
import type { IRepo } from "@/models/repos.model";
import { useT } from "@seliseblocks/genesis-os/i18n";

export function RepositoryCard({ repo }: Readonly<{ repo: IRepo }>) {
  const { t } = useT("monitor.repos");
  const isLive = Boolean(repo.deployedNamespace);
  return (
    <Card data-testid="repository-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("REPOSITORY_CARD.TITLE")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <p className="text-muted-foreground">{t("REPOSITORY_CARD.REPO_URL")}</p>
          {repo.repoUrl ? (
            <a
              href={repo.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              {repo.repoUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p>—</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">{t("REPOSITORY_CARD.DEPLOYMENT_TYPE")}</p>
          <p className="font-medium">{repo.deploymentType || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t("REPOSITORY_CARD.CUSTOM_URL")}</p>
          {repo.customDeploymentUrl ? (
            <a
              href={repo.customDeploymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              {repo.customDeploymentUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <p>—</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">{t("REPOSITORY_CARD.LIVE")}</p>
          <p className="font-medium" data-testid="repo-live">
            {isLive ? t("common:YES") : t("common:NO")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
