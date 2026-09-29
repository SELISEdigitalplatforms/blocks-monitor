import { Link, useParams } from "react-router";
import { useQueryState, parseAsStringEnum } from "nuqs";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { useScopedPath } from "@seliseblocks/genesis-os/hooks";
import { ExternalLink } from "lucide-react";
import {
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
import { LatestBuildCard, NoBuildCard } from "@/components/module/repos/latest-build-card";
import { RepositoryCard } from "@/components/module/repos/repository-card";
import { SastTab } from "@/components/module/repos/sast-tab";
import { ScaTab } from "@/components/module/repos/sca-tab";
import {
  PageErrorCard,
  PageLoadingSkeleton,
} from "@/components/module/repos/report-states";

const TAB_VALUES = ["overview", "sast", "sca"] as const;
type TabValue = (typeof TAB_VALUES)[number];

const RepoDetailsPage = () => {
  const { repoId = "" } = useParams<{ repoId: string }>();
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const scoped = useScopedPath();
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringEnum<TabValue>([...TAB_VALUES]).withDefault("overview"),
  );

  const { data, isLoading, isError, error, refetch } = useGetRepoDetails(projectKey, repoId);
  const is404 = getHttpStatus(error) === 404;

  const repo = data?.data?.repo ?? null;
  const builds = data?.data?.build ?? [];
  const latestBuild = builds[0] ?? null;
  const hasBuild = !!latestBuild;

  // C8: fall back to overview when SAST/SCA requested without a build
  const effectiveTab: TabValue =
    !hasBuild && (tab === "sast" || tab === "sca") ? "overview" : (tab ?? "overview");

  const shortName = repo?.repoName?.split("/").pop() || repo?.repoName || repoId;

  if (!projectKey) {
    return (
      <main className="space-y-4">
        <p className="text-sm text-muted-foreground">Select a project to view repository details.</p>
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
        <p className="text-sm">Repository not found</p>
        <Link to={scoped("repos")} className="text-primary underline">
          Back to Repos
        </Link>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="space-y-4">
        <PageErrorCard message="Failed to load repository details." onRetry={() => refetch()} />
      </main>
    );
  }

  return (
    <main className="space-y-4" data-testid="repo-details-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link to={scoped("repos")} className="text-sm text-muted-foreground hover:underline">
            ← Repos
          </Link>
          <h1 className="text-lg font-semibold md:text-2xl">{shortName}</h1>
        </div>
        {repo?.repoUrl && (
          <a
            href={repo.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline"
          >
            {repo.repoName}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <TooltipProvider>
        <Tabs
          value={effectiveTab}
          onValueChange={(v) => setTab(v as TabValue)}
        >
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
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
                <TooltipContent>Available after the first build</TooltipContent>
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
                <TooltipContent>Available after the first build</TooltipContent>
              </Tooltip>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {hasBuild && latestBuild ? <LatestBuildCard build={latestBuild} /> : <NoBuildCard />}
            {repo && <RepositoryCard repo={repo} />}
          </TabsContent>

          <TabsContent value="sast">
            <SastTab
              projectKey={projectKey}
              buildId={latestBuild?.itemId}
              isActive={effectiveTab === "sast"}
            />
          </TabsContent>

          <TabsContent value="sca">
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
