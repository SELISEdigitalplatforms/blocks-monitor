import type { ReactNode } from "react";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { useGetReposList } from "@/hooks/use-alerts";
import { ReposListTable } from "@/components/module/repos/repos-list-table";
import { PageErrorCard, PageLoadingSkeleton } from "@/components/module/repos/report-states";
import { useT } from "@seliseblocks/genesis-os/i18n";

const ReposPage = () => {
  const { t } = useT("monitor.repos");
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { data, isLoading, isError, refetch } = useGetReposList(projectKey);

  const rows = data?.data ?? [];

  let body: ReactNode;
  if (projectKey === "") {
    body = <p className="text-sm text-muted-foreground">{t("REPOS_PAGE.SELECT_PROJECT")}</p>;
  } else if (isLoading) {
    body = <PageLoadingSkeleton testId="repos-list-loading" />;
  } else if (isError) {
    body = <PageErrorCard message={t("REPOS_PAGE.LOAD_FAILED")} onRetry={() => refetch()} />;
  } else if (rows.length === 0) {
    body = (
      <p data-testid="repos-empty" className="text-sm text-muted-foreground">
        {t("REPOS_PAGE.EMPTY")}
      </p>
    );
  } else {
    body = <ReposListTable rows={rows} />;
  }

  return (
    <main className="space-y-4" data-testid="repos-page">
      <h1 className="text-lg font-semibold md:text-2xl">{t("REPOS_PAGE.TITLE")}</h1>
      {body}
    </main>
  );
};

export default ReposPage;
