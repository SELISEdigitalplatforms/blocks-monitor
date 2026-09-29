import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { useGetReposList } from "@/hooks/use-alerts";
import { ReposListTable } from "@/components/module/repos/repos-list-table";
import {
  PageErrorCard,
  PageLoadingSkeleton,
} from "@/components/module/repos/report-states";

const ReposPage = () => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { data, isLoading, isError, refetch } = useGetReposList(projectKey);

  const rows = data?.data ?? [];

  return (
    <main className="space-y-4" data-testid="repos-page">
      <h1 className="text-lg font-semibold md:text-2xl">Repos</h1>

      {!projectKey ? (
        <p className="text-sm text-muted-foreground">Select a project to view repositories.</p>
      ) : isLoading ? (
        <PageLoadingSkeleton testId="repos-list-loading" />
      ) : isError ? (
        <PageErrorCard message="Failed to load repositories." onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <p data-testid="repos-empty" className="text-sm text-muted-foreground">
          No repositories deployed yet
        </p>
      ) : (
        <ReposListTable rows={rows} />
      )}
    </main>
  );
};

export default ReposPage;
