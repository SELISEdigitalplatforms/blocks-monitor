"use client";
import { BackIconButton } from "@/components/common/back-buttons";
import { Button, Skeleton } from "@/components/core";
import { PageHeader } from "@/components/common/page-header/page-header";
import { SectionHeading } from "@/components/common/section-heading/section-heading";
import AlertAction from "@/components/module/alert/alert-action";
import NotificationModal from "@/components/module/alert/notification-modal";
import IncidentList from "@/components/module/incident/incident-list";
import IncidentActivity from "@/components/module/monitor/details/incident-activity";
import MonitorCard from "@/components/module/monitor/details/monitor-card";
import {
  LoadingListSkelton,
  MonitorCardSkeleton,
  ResponseSkeletonLoader,
} from "@/components/module/monitor/details/monitor-details-skeletons";
import ResponseTime from "@/components/module/monitor/details/response-time";
import { StatusPill } from "@/components/module/monitor/details/status-pill";
import {
  SECTION_CLASS,
  STAT_GRID_CLASS,
  STAT_LABEL_CLASS,
  STAT_SUB_CLASS,
  STAT_VALUE_CLASS,
  SURFACE_TILE_CLASS,
  TABLE_CARD_CLASS,
} from "@/components/module/monitor/details/surface-styles";
import { EditSingleMonitorForm } from "@/components/module/monitor/form/edit-monitor-form";
import { MonitorModal } from "@/components/module/monitor/modal/monitor-modal";
import { useGetMonitorById, useGetMonitorDetails, useGetMonitorDownTime } from "@/hooks/use-alerts";
import { IMonitorSummary } from "@/models/alerts.model";
import { useScopedPath } from "@seliseblocks/app-kit/hooks";
import { useProjectStore } from "@seliseblocks/app-kit/store";
import { ArrowLeft, ArrowRight, BellRing, EllipsisVertical, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

interface MonitorSummaryProps {
  data: IMonitorSummary[];
  status: boolean;
  incident: Date;
  createdAt: string;
  /**
   * Whether the monitor is running. Typed plain `boolean` on purpose: the API model declares
   * `isActive` as the literal `true`, so a `=== false` comparison against it directly would be a
   * no-overlap error. The call site resolves it with `?? true`, which also gives C4's default --
   * unexpected data reads as active, never as a false "Paused".
   */
  isActive: boolean;
}

const MonitorDetailsSkeleton = () => {
  return (
    <main>
      <div className="mb-4 flex items-center gap-2 sm:mb-6">
        <Skeleton className="h-8 w-8 rounded-sm" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="flex flex-col gap-6">
        <MonitorCardSkeleton />

        {/* Status overview skeleton: heading over four stat tiles. */}
        <div className={SECTION_CLASS}>
          <Skeleton className="h-4 w-40" />
          <div className={STAT_GRID_CLASS}>
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[116px] w-full rounded-sm" />
            ))}
          </div>
        </div>

        {/* Response time chart skeleton */}
        <ResponseSkeletonLoader />

        {/* Incident list skeleton */}
        <div className={SECTION_CLASS}>
          <Skeleton className="h-4 w-48" />
          <div className={`${TABLE_CARD_CLASS} p-5`}>
            <LoadingListSkelton length={5} />
          </div>
        </div>
      </div>
    </main>
  );
};
export const formatDuration = (ms: number) => {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  ms %= 24 * 60 * 60 * 1000;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  ms %= 60 * 60 * 1000;
  const minutes = Math.floor(ms / (60 * 1000));
  ms %= 60 * 1000;
  const seconds = Math.floor(ms / 1000);

  if (days > 0) {
    const hoursStr = hours > 0 ? ` ${hours}h` : "";
    return `${days}d${hoursStr}`;
  }
  if (hours > 0) {
    const minutesStr = minutes > 0 ? ` ${minutes}m` : "";
    return `${hours}h${minutesStr}`;
  }
  if (minutes > 0) {
    const secondsStr = seconds > 0 ? ` ${seconds}s` : "";
    return `${minutes}m${secondsStr}`;
  }
  return `${seconds}s`;
};

const MonitorSummary = ({ data, status, incident, createdAt, isActive }: MonitorSummaryProps) => {
  const toMilliseconds = (value: string): number =>
    Number.parseInt(value, 10) * 24 * 60 * 60 * 1000;
  const [now] = useState(() => Date.now());
  const incidentDate = new Date(incident);
  const incidentTime =
    incidentDate.getUTCFullYear() === 1 ? new Date(createdAt).getTime() : incidentDate.getTime();

  const incidentDuration = formatDuration(now - incidentTime);

  return (
    <section aria-label="Status overview" className={SECTION_CLASS}>
      <SectionHeading
        title="Status overview"
        description="Current health and uptime over recent periods"
      />
      <div className={STAT_GRID_CLASS}>
        {data.map((item, index) => {
          if (item.type === "status") {
            // Paused monitors are not being checked, so up/down says nothing true about them.
            // Everything that encodes health here -- the pill's tone, the status word and the
            // "Currently up for ..." line -- drops out together rather than leaving a green
            // tile that also says "Paused".
            const isPaused = isActive === false;
            let tone: "up" | "down" | "paused" = "down";
            if (isPaused) {
              tone = "paused";
            } else if (status) {
              tone = "up";
            }

            return (
              <div
                key={`status-${index}`} //nosonar
                data-testid="status-tile"
                className={SURFACE_TILE_CLASS}
              >
                <p className={STAT_LABEL_CLASS}>Current status</p>
                <div className={STAT_VALUE_CLASS}>
                  <StatusPill tone={tone} size="lg" className="capitalize">
                    {isPaused ? "Paused" : item.status}
                  </StatusPill>
                </div>
                <p className={STAT_SUB_CLASS}>
                  {isPaused
                    ? "Checks are paused until resumed"
                    : `Currently ${status ? "up" : "down"} for ${incidentDuration}`}
                </p>
              </div>
            );
          }

          const totalPossibleMs = toMilliseconds(item.range!);
          const uptimePercentage =
            ((totalPossibleMs - item.totalDurationMs!) / totalPossibleMs) * 100;

          return (
            <div key={item.range} className={SURFACE_TILE_CLASS}>
              <p className={STAT_LABEL_CLASS}>Last {item.range?.slice(0, -1)} days</p>
              <p className={STAT_VALUE_CLASS}>{uptimePercentage.toFixed(2)}%</p>
              <p className={STAT_SUB_CLASS}>
                {item.incidentCount} incidents, {formatDuration(item.totalDurationMs!)} down
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const MonitorDetailsPage = () => {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const { id } = useParams();
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";

  const [openNotificationSettings, setOpenNotificationSettings] = useState(false);
  const [open, setOpen] = useState(false);
  const [timeRange, setTimeRange] = useState("1h");

  const monitorId = id || "";

  const {
    data,
    isLoading,
    isError: isDetailsError,
    refetch: refetchDetails,
  } = useGetMonitorDetails(monitorId);
  const {
    data: monitorData,
    isLoading: isMonitorLoading,
    isError: isMonitorError,
    refetch: refetchMonitor,
  } = useGetMonitorById(monitorId);
  const request = monitorData?.data?.monitorConfigurationType === 0;
  const interval = monitorData?.data?.intervalInSeconds || 0;
  const monitorSourceType = monitorData?.data?.monitorSourceTypes;
  const {
    data: rtData,
    isLoading: isRTLoading,
    isError: isChartError,
    refetch: refetchChart,
  } = useGetMonitorDownTime({
    monitorId,
    timeRange,
    interval,
  });

  const gracePeriod = monitorData?.data?.gracePeriodInSeconds;
  const intervalInSeconds = monitorData?.data?.intervalInSeconds;
  const requestTimeout = monitorData?.data?.timeoutInSeconds;
  const timePeriod = request ? requestTimeout : gracePeriod;

  if (isLoading || isMonitorLoading || isRTLoading) {
    return <MonitorDetailsSkeleton />;
  }

  if (isDetailsError || isMonitorError || isChartError) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 p-6 text-sm">
        <p>Could not load this monitor.</p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => {
            void refetchDetails();
            void refetchMonitor();
            void refetchChart();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  // Add the status card to the beginning of the array
  const summaryData: IMonitorSummary[] = [
    {
      type: "status",
      status: monitorData?.data?.currentStatus ? "up" : "down", // Use your actual status field from API
      statusDuration: data?.statusDuration || "0h", // Use your actual duration field from API
    },
    ...(data?.dateRangeSummary || []),
  ];

  return (
    <main>
      <div className="mb-4 flex items-start gap-1 sm:mb-6">
        <BackIconButton
          data-testid="back-button"
          icon={<ArrowLeft className="h-6 w-6" />}
          onClick={() => navigate(-1)}
          className="h-8 w-8 shrink-0"
        />
        <PageHeader
          // The back button sits beside the header, so the header gives up its own bottom margin
          // to the row; `break-all` keeps an unbroken monitor name inside the page.
          className="mb-0 min-w-0 flex-1 sm:mb-0 [&_h1]:break-all"
          title={monitorData?.data?.name || ""}
          description="Health, uptime and incidents for this monitor."
          actions={
            monitorSourceType !== 2 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setOpenNotificationSettings((open) => !open)}
                >
                  <BellRing className="h-4 w-4" />
                  Notification Settings
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setOpen((open) => !open)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Configure
                </Button>
                <AlertAction
                  monitorId={monitorId as string}
                  isActive={monitorData?.data?.isActive ?? false}
                  name={monitorData?.data?.name || ""}
                  request={request}
                  projectKey={projectKey}
                  monitorSourceType={monitorSourceType}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-9 px-0"
                    aria-label="Actions"
                  >
                    <EllipsisVertical className="h-4 w-4" />
                  </Button>
                </AlertAction>
              </>
            ) : undefined
          }
        />
      </div>
      <div className="flex flex-col gap-6">
        <MonitorCard
          onOpenChange={setOpenNotificationSettings}
          repoName={monitorData?.data?.repoName}
          externalServiceName={monitorData?.data?.externalServiceName}
          url={monitorData?.data?.url || ""}
          request={request}
          emails={monitorData?.data?.emails || []}
          monitorSourceType={monitorData?.data?.monitorSourceTypes ?? 0}
        />
        <MonitorSummary
          data={summaryData}
          status={monitorData?.data?.currentStatus ?? false}
          // `?? true`, not `?? false`: unexpected data must read as active (C4). The
          // AlertAction call above deliberately keeps `?? false` -- it sends `!isActive`, so
          // that default offers to activate rather than to pause a possibly-running monitor.
          isActive={monitorData?.data?.isActive ?? true}
          incident={
            monitorData?.data?.lastIncidentAt
              ? new Date(monitorData?.data?.lastIncidentAt)
              : new Date()
          }
          createdAt={monitorData?.data?.createdDate as string}
        />
        <ResponseTime
          request={request}
          interval={intervalInSeconds || 30}
          timeout={timePeriod || 60}
          data={rtData?.data || []}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          currentStatus={monitorData?.data?.currentStatus || false}
          // Same `?? true` default as the status tile: the chart must not assert a current
          // up/down state while the page is showing "Paused".
          isActive={monitorData?.data?.isActive ?? true}
        />
        {/* Same treatment as the release "Monitoring" table: small caps title with an inline
            description, the action on the right, and a table that draws its own card. */}
        <section aria-label="Latest incidents" className={SECTION_CLASS}>
          <SectionHeading
            className="items-center"
            title="Latest incidents"
            description="Recent downtime for this monitor"
            actions={
              data?.monitorIncidents && data.monitorIncidents.length > 4 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => navigate(scoped(`monitor/incidents/${monitorId}`))}
                >
                  View all incidents
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : undefined
            }
          />
          {/* Downtime per day (last 7 / 30 / 90 days) above the latest incidents; paused monitors
              keep their history, so it is shown whatever the monitor's state. */}
          <div className={SURFACE_TILE_CLASS}>
            <IncidentActivity monitorId={monitorId} />
          </div>
          <IncidentList
            data={data?.monitorIncidents || []}
            showLastStatus={request}
            isLoading={isLoading || isMonitorLoading || isRTLoading}
          />
        </section>
      </div>

      <MonitorModal open={open} onOpenChange={setOpen} itemId={monitorId}>
        <EditSingleMonitorForm itemId={monitorId} onSuccess={() => setOpen(false)} />
      </MonitorModal>
      <NotificationModal
        open={openNotificationSettings}
        onOpenChange={setOpenNotificationSettings}
        data={{
          name: monitorData?.data?.name || "",
          repoId: monitorData?.data?.repoId || "",
          repoName: monitorData?.data?.repoName || "",
          itemId: monitorId || "",
          emails: monitorData?.data?.emails || [],
          isActive: monitorData?.data?.isActive || false,
          projectKey: projectKey,
        }}
        request={request}
      />
    </main>
  );
};

export default MonitorDetailsPage;
