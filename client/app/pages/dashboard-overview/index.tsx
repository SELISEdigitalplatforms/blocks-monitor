import { ProjectDetail } from "@/components/project/details";
import { showErrorToast } from "@/hooks/use-toast";
import { useProjectStore } from "@/store/project.store";
import { getDomain } from "@/utils/domain.util";
import { useCallback, useEffect } from "react";

import {
  useGetProject,
  useValidateCNameProject,
} from "@blocks-identifier/hooks/use-project";

export const DashboardOverview = () => {
  const projectKey = useProjectStore().selectedProject?.tenantId || "";
  const itemId = useProjectStore().selectedProject?.itemId || "";

  const { data, isLoading } = useGetProject({ projectId: itemId });
  const { mutateAsync } = useValidateCNameProject({ projectKey });

  const cNameValidator = useCallback(async () => {
    try {
      if (
        !data?.data.applicationDomain ||
        getDomain(data.data.applicationDomain) === "seliseblocks.com"
      )
        return;
      if (!data?.data?.customDomain) return;

      await mutateAsync({
        projectKey: projectKey,
        cookieDomain: new URL(data?.data.customDomain).hostname,
      });
    } catch (error) {
      if (error && typeof error === "object" && "errors" in error) {
        showErrorToast({ errors: error.errors });
      }
    }
  }, [
    data?.data.applicationDomain,
    data?.data.customDomain,
    mutateAsync,
    projectKey,
  ]);

  useEffect(() => {
    cNameValidator();
  }, [cNameValidator]);

  return (
    <main className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold md:text-2xl">
          Environment Overview
        </h1>
      </div>
      <ProjectDetail project={data?.data} isLoading={isLoading} />
    </main>
  );
};
