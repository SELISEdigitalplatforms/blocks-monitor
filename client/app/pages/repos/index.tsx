import type { ReactNode } from "react";
import { useProjectStore } from "@seliseblocks/app-kit/store";
import { FilterControls } from "@seliseblocks/app-kit/components";
import { Card } from "@/components/core";
import { PageHeader } from "@/components/common/page-header/page-header";
import { useGetReposList } from "@/hooks/use-alerts";
import { ReposListEmpty, ReposListTable } from "@/components/module/repos/repos-list-table";
import { useReposFilterQueryParams } from "@/components/module/repos/use-repos-filter-query-params";
import { PageErrorCard } from "@/components/module/repos/report-states";

const ReposPage = () => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { data, isLoading, isError, refetch } = useGetReposList(projectKey);
  const { queryParams, setQueryParams } = useReposFilterQueryParams();

  const rows = data?.data ?? [];
  // Search only means something once there is a list to search (or a query to clear).
  const showSearch =
    projectKey !== "" && !isError && (isLoading || rows.length > 0 || queryParams.search !== "");

  const content: ReactNode =
    projectKey !== "" && isError ? (
      <PageErrorCard message="Failed to load repositories." onRetry={() => refetch()} />
    ) : (
      <Card data-testid="repos-list-table" className="overflow-hidden p-0">
        {projectKey === "" ? (
          <ReposListEmpty message="Select a project to view repositories." />
        ) : (
          <ReposListTable rows={rows} isLoading={isLoading} />
        )}
      </Card>
    );

  return (
    <main data-testid="repos-page">
      <PageHeader
        title="Repos"
        description="Repositories deployed in this project and the state of their latest build."
        toolbar={
          showSearch ? (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
              <FilterControls.SearchInput
                value={queryParams.search}
                placeholder="Search repositories..."
                onChange={(search) => void setQueryParams({ search })}
              />
            </div>
          ) : undefined
        }
      />

      <div className="min-w-0 space-y-3">{content}</div>
    </main>
  );
};

export default ReposPage;
