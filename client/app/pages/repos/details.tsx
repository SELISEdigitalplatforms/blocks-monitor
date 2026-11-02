import { Link, useParams } from "react-router";
import { useQueryState, parseAsStringEnum } from "nuqs";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { ChevronLeft } from "lucide-react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/core";
import { useGetRepoDetails, getHttpStatus } from "@/hooks/use-repos";
import { RepoDeploymentLogsTab } from "@/components/module/repos/repo-deployment-logs-tab";
import { SastTab } from "@/components/module/repos/sast-tab";
import { ScaTab } from "@/components/module/repos/sca-tab";
import { PageErrorCard, PageLoadingSkeleton } from "@/components/module/repos/report-states";
import { useT } from "@seliseblocks/genesis-os/i18n";

const TAB_VALUES = ["deployment-logs", "sast", "sca"] as const;
type TabValue = (typeof TAB_VALUES)[number];

const RepoDetailsPage = () => {
  const { t } = useT("monitor.repos");
  const { repoId = "" } = useParams<{ repoId: string }>();
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const scoped = useScopedPath();
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringEnum<TabValue>([...TAB_VALUES]).withDefault("deployment-logs"),
  );

  const { data, isLoading, isError, error, refetch } = useGetRepoDetails(projectKey, repoId);
  const is404 = getHttpStatus(error) === 404;

  const repo = data?.data?.repo ?? null;
  const builds = data?.data?.build ?? [];
  const latestBuild = builds[0] ?? null;
  const hasBuild = !!latestBuild;

  // C8: fall back to deployment logs when SAST/SCA is requested without a build.
  const effectiveTab: TabValue =
    !hasBuild && (tab === "sast" || tab === "sca") ? "deployment-logs" : (tab ?? "deployment-logs");

  const shortName = repo?.repoName?.split("/").pop() || repo?.repoName || repoId;

  if (!projectKey) {
    return (
      <main className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("REPO_DETAILS_PAGE.SELECT_PROJECT")}</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="space-y-4">
        <PageLoadingSkeleton testId="repo-details-loading" />
      </main>
    );
  }

  if (is404) {
    return (
      <main className="space-y-4" data-testid="repo-not-found">
        <p className="text-sm">{t("REPO_DETAILS_PAGE.NOT_FOUND")}</p>
        <Link to={scoped("repos")} className="text-primary underline">
          {t("REPO_DETAILS_PAGE.BACK_TO_REPOS")}
        </Link>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="space-y-4">
        <PageErrorCard message={t("REPO_DETAILS_PAGE.LOAD_FAILED")} onRetry={() => refetch()} />
      </main>
    );
  }

  return (
    <main className="space-y-4" data-testid="repo-details-page">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" className="pl-0">
          <Link to={scoped("repos")} aria-label={t("REPO_DETAILS_PAGE.BACK_TO_REPOS")}>
            <ChevronLeft size={20} />
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold text-high-emphasis">{shortName}</h1>
      </div>

      <TooltipProvider>
        <Tabs value={effectiveTab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            <TabsTrigger value="deployment-logs">
              {t("REPO_DETAILS_PAGE.TAB_DEPLOYMENT_LOGS")}
            </TabsTrigger>
            {hasBuild ? (
              <TabsTrigger value="sast">SAST</TabsTrigger>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <TabsTrigger value="sast" disabled>
                      SAST
                    </TabsTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("REPO_DETAILS_PAGE.AVAILABLE_AFTER_BUILD")}</TooltipContent>
              </Tooltip>
            )}
            {hasBuild ? (
              <TabsTrigger value="sca">SCA</TabsTrigger>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <TabsTrigger value="sca" disabled>
                      SCA
                    </TabsTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("REPO_DETAILS_PAGE.AVAILABLE_AFTER_BUILD")}</TooltipContent>
              </Tooltip>
            )}
          </TabsList>

          <TabsContent value="deployment-logs" className="mt-4 space-y-4">
            <RepoDeploymentLogsTab repo={repo} build={latestBuild} />
          </TabsContent>

          <TabsContent value="sast" className="mt-4">
            <SastTab
              projectKey={projectKey}
              buildId={latestBuild?.itemId}
              isActive={effectiveTab === "sast"}
            />
          </TabsContent>

          <TabsContent value="sca" className="mt-4">
            <ScaTab
              projectKey={projectKey}
              buildId={latestBuild?.itemId}
              isActive={effectiveTab === "sca"}
            />
          </TabsContent>
        </Tabs>
      </TooltipProvider>
    </main>
  );
};

export default RepoDetailsPage;
