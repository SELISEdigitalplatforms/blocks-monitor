import { useProjectStore } from "@seliseblocks/blocks-kit";
import { ProjectCardLoading } from "@/components/project/card/loading";
import { Skeleton } from "@/components/ui-kits/skeleton/skeleton";
import { useGetProjects } from "@blocks-identifier/hooks/use-project";
import { EnvironmentCard } from "@seliseblocks/blocks-kit";
import { ErrorDisplay } from "@/components/error-display";

const ProjectGroupLoading = () => (
  <main className="flex flex-1 flex-col gap-4 p-4 sm:mx-10 md:gap-6">
    <div className="mt-4">
      <div className="mb-8 flex flex-row items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array(8)
          .fill(1)
          .map((_, index) => (
            <ProjectCardLoading key={index} />
          ))}
      </div>
    </div>
  </main>
);
export const EnvironmentsPage = () => {
  const groupId = useProjectStore().selectedTenantGroup;
  const {
    data: environmentList,
    isLoading,
    isFetching,
    isError,
  } = useGetProjects({ tenantGroupId: groupId ?? "" });

  if (isLoading || isFetching) {
    return <ProjectGroupLoading />;
  }

  if (isError || !environmentList) {
    return <ErrorDisplay />;
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-6 md:gap-6">
      <div>
        <div className="mb-6 flex flex-row justify-between">
          <h4 className="text-lg font-semibold md:text-xl">Environments</h4>
          <div className="flex gap-2 sm:gap-4"></div>
        </div>
        {environmentList?.[0]?.isShared && (
          <div className="mb-4 mt-6 border-b-2 border-border pb-2">
            <h5 className="text-sm font-medium text-muted-foreground">
              Shared with you
            </h5>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {environmentList?.[0]?.projects?.map((project) => (
            <EnvironmentCard
              key={`shared-${project.itemId}`}
              project={project}
            />
          ))}
        </div>
        {environmentList[0]?.isShared &&
          environmentList[0]?.nonSharedProject?.length > 0 && (
            <>
              <div className="mb-4 mt-8 border-b-2 border-border pb-2">
                <h5 className="text-sm font-medium text-muted-foreground">
                  Others
                </h5>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {environmentList[0]?.nonSharedProject?.map((project) => (
                  <div
                    key={`others-${project.itemId}`}
                    className="pointer-events-none grayscale">
                    <EnvironmentCard
                      key={`others-${project.itemId}`}
                      project={project}
                      className="bg-muted"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
      </div>
    </main>
  );
};
