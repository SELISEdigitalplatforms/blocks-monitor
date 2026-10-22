import { Link, useParams } from "react-router";
import { useQueryState, parseAsStringEnum } from "nuqs";
import { useProjectStore } from "@seliseblocks/app-kit/store";
import { useScopedPath } from "@seliseblocks/app-kit/hooks";
import { ArrowUpRight, ChevronLeft, FolderGit2, GitBranch } from "lucide-react";
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

const TAB_VALUES = ["deployment-logs", "sast", "sca"] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TABS: { value: TabValue; label: string; needsBuild: boolean }[] = [
  { value: "deployment-logs", label: "Deployment Logs", needsBuild: false },
  { value: "sast", label: "SAST", needsBuild: true },
  { value: "sca", label: "SCA", needsBuild: true },
];

const NEEDS_BUILD_HINT = "Available after the first build";

const RepoDetailsPage = () => {
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

  const repoName = repo?.repoName || latestBuild?.repoName || repoId;
  const shortName = repoName.split("/").pop() || repoName;
  const repoUrl = repo?.repoUrl || latestBuild?.repoUrl || "";
  const branch = repo?.branch || latestBuild?.branch || "";

  const handleTabChange = (value: string) => void setTab(value as TabValue);

  if (!projectKey) {
    return (
      <main>
        <p className="text-sm text-muted-foreground">
          Select a project to view repository details.
        </p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main>
        <PageLoadingSkeleton testId="repo-details-loading" />
      </main>
    );
  }

  if (is404) {
    return (
      <main data-testid="repo-not-found">
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-5 py-12 text-center">
          <FolderGit2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Repository not found</p>
          <Button asChild variant="outline" size="sm" className="mt-2 gap-2">
            <Link to={scoped("repos")}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to Repos
            </Link>
          </Button>
        </Card>
      </main>
    );
  }

  if (isError) {
    return (
      <main>
        <PageErrorCard message="Failed to load repository details." onRetry={() => refetch()} />
      </main>
    );
  }

  return (
    <main className="min-w-0 pb-8" data-testid="repo-details-page">
      {/* Same rhythm as PageHeader (title, subtitle, mb-4 / sm:mb-6), with a back button. */}
      <header className="mb-4 flex min-w-0 items-start gap-1 sm:mb-6">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="-ml-1.5 h-7 w-7 shrink-0 rounded-sm sm:h-8 sm:w-8"
        >
          <Link to={scoped("repos")} aria-label="Back to Repos" title="Back to Repos">
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-xl font-semibold tracking-tight text-high-emphasis sm:text-2xl">
            {shortName}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 hover:text-primary"
              >
                <span className="break-all">{repoName}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="break-all">{repoName}</span>
            )}
            {branch && (
              <span
                data-testid="repo-branch"
                className="inline-flex items-center gap-1.5 rounded-sm bg-primary/[0.07] px-2 py-1 text-xs font-medium text-primary"
              >
                <GitBranch className="h-3 w-3" aria-hidden="true" />
                {branch}
              </span>
            )}
          </div>
        </div>
      </header>

      <TooltipProvider>
        <Tabs value={effectiveTab} onValueChange={handleTabChange} className="flex w-full flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-5">
            <div className="md:hidden">
              <Select value={effectiveTab} onValueChange={handleTabChange}>
                <SelectTrigger className="h-9 w-56" aria-label="Repository section">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TABS.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={item.needsBuild && !hasBuild}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="hidden min-w-0 md:flex">
              <TabsList>
                {TABS.map((item) =>
                  item.needsBuild && !hasBuild ? (
                    <Tooltip key={item.value}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-full">
                          <TabsTrigger value={item.value} disabled>
                            {item.label}
                          </TabsTrigger>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{NEEDS_BUILD_HINT}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <TabsTrigger key={item.value} value={item.value}>
                      {item.label}
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
            </div>
          </div>

          <TabsContent value="deployment-logs">
            <RepoDeploymentLogsTab repo={repo} build={latestBuild} />
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
