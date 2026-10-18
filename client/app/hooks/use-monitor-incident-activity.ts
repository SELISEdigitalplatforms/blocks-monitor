import { useQuery } from "@tanstack/react-query";
import { useProjectStore } from "@seliseblocks/app-kit/store";
import { getMonitorIncidentActivity } from "@/services/incident-activity.service";

/** A year of a monitor's incidents for the downtime calendar on its details page. */
export const useMonitorIncidentActivity = (monitorId: string, endDate: string) => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  return useQuery({
    // Under the details page's ["get-monitor-details", monitorId] prefix, so the monitor
    // mutations that invalidate the details refresh the calendar with them.
    queryKey: ["get-monitor-details", monitorId, "incident-activity", projectKey, endDate],
    queryFn: ({ signal }) => getMonitorIncidentActivity(monitorId, endDate, { signal }),
    enabled: Boolean(monitorId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};
