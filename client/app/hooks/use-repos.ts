import { useQuery } from "@tanstack/react-query";
import { reposService } from "@/services/repos.service";
import type { ReportType } from "@/models/repos.model";

/** Extract an HTTP status from the shapes genesis HttpClient / axios may throw. */
export function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.status === "number") return e.status;
  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === "number") return response.status;
  return undefined;
}

export const useGetRepoDetails = (projectKey: string, repoId: string) => {
  return useQuery({
    queryKey: ["repo-details", projectKey, repoId],
    queryFn: () => reposService.getRepoDetails(repoId, { pageNumber: 1, pageSize: 1 }),
    enabled: !!projectKey && !!repoId,
    retry: (count, err) => getHttpStatus(err) !== 404 && count < 2,
  });
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export const useGetReport = (
  projectKey: string,
  buildId: string | undefined | null,
  type: ReportType,
  isActive: boolean,
) => {
  return useQuery({
    queryKey: ["repo-report", projectKey, buildId, type],
    queryFn: () => reposService.getReport(buildId as string, type),
    enabled: !!projectKey && !!buildId && isActive,
    staleTime: FIVE_MINUTES_MS,
    retry: 2,
  });
};
