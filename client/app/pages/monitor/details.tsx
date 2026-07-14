"use client";
import { BackIconButton } from "@/components/common/buttons";
import { Button, Skeleton } from "@/components/core";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/core/card/card";
import { Separator } from "@/components/core/separator/separator";
import AlertAction from "@/components/module/alert/alert-action";
import NotificationModal from "@/components/module/alert/notification-modal";
import IncidentList from "@/components/module/incident/incident-list";
import MonitorCard from "@/components/module/monitor/details/monitor-card";
import {
  LoadingListSkelton,
  MonitorCardSkeleton,
  ResponseSkeletonLoader,
} from "@/components/module/monitor/details/monitor-details-skeletons";
import ResponseTime from "@/components/module/monitor/details/response-time";
import { EditSingleMonitorForm } from "@/components/module/monitor/form/edit-monitor-form";
import { MonitorModal } from "@/components/module/monitor/modal/monitor-modal";
import {
  useGetMonitorById,
  useGetMonitorDetails,
  useGetMonitorDownTime,
} from "@/hooks/use-alerts";
import { IMonitorSummary } from "@/models/alerts.model";
import { useScopedPath } from "@seliseblocks/blocks-kit/hooks";
import { useProjectStore } from "@seliseblocks/blocks-kit/store";
import { ArrowLeft, EllipsisVertical, Settings } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

interface MonitorSummaryProps {
  data: IMonitorSummary[];
  status: boolean;
  incident: Date;
  createdAt: string;
}

const MonitorDetailsSkeleton = () => {
  return (
    <main>
      <div className="flex flex-col gap-4">
        <MonitorCardSkeleton />

        <Card className="flex flex-col p-6">
          <CardHeader className="text-lg font-semibold">
            {/* Summary Cards Skeleton */}
            <div className="my-2 flex w-full gap-10">
              <Skeleton className="h-24 flex-1 rounded-md" />
              <Skeleton className="h-24 flex-1 rounded-md" />
              <Skeleton className="h-24 flex-1 rounded-md" />
              <Skeleton className="h-24 flex-1 rounded-md" />
            </div>
          </CardHeader>

          <CardContent>
            {/* Response Time Chart Skeleton */}
            <ResponseSkeletonLoader />
            <Separator orientation="horizontal" className="mb-6" />
            {/* Incident List Skeleton */}
            <LoadingListSkelton length={5} />
          </CardContent>
        </Card>
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

  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  if (minutes > 0) return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`;
  return `${seconds}s`;
};

const MonitorSummary = ({
  data,
  status,
  incident,
  createdAt,
}: MonitorSummaryProps) => {
  const toMilliseconds = (value: string): number =>
    parseInt(value, 10) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const incidentDate = new Date(incident);
  const incidentTime =
    incidentDate.getUTCFullYear() === 1
      ? new Date(createdAt).getTime()
      : incidentDate.getTime();

  const incidentDuration = formatDuration(now - incidentTime);

  return (
    <div className="my-6 flex w-full flex-col gap-4 md:flex-row md:gap-10">
      {data.map((item, index) => {
        if (item.type === "status") {
          return (
            <Card
              key={`status-${index}`}
              className={`flex flex-1 flex-col rounded-md border-0 border-l-8 shadow-none ${
                status ? "border-l-green-500" : "border-l-red-500"
              } bg-transparent py-2 pl-4`}>
              <CardTitle className="text-base font-medium">
                Current Status
              </CardTitle>
              <CardContent className="mt-3 flex flex-col gap-3">
                <span
                  className={`text-xl font-semibold capitalize ${
                    status ? "text-green-500" : "text-red-500"
                  }`}>
                  {item.status}
                </span>
                <span className="text-xs font-medium text-medium-emphasis">
                  {" "}
                  Currently {status ? "up" : "down"} for {incidentDuration}
                </span>
              </CardContent>
            </Card>
          );
        }

        const totalPossibleMs = toMilliseconds(item.range!);
        const uptimePercentage =
          ((totalPossibleMs - item.totalDurationMs!) / totalPossibleMs) * 100;

        return (
          <Card
            key={item.range}
            className={`flex flex-1 flex-col gap-2 rounded-md border-0 border-l-8 bg-transparent py-1 pl-4 shadow-none ${
              index === 1
                ? "border-l-blocks-secondary-500"
                : index === 2
                  ? "border-l-chart-blue"
                  : "border-l-chart-purple"
            }`}>
            <CardTitle className="text-base font-medium">
              Last {item.range?.slice(0, -1)} days
            </CardTitle>
            <CardContent className="mt-3 flex flex-col gap-3">
              <span className="text-xl font-semibold">
                {uptimePercentage.toFixed(2)}%
              </span>
              <span className="text-xs font-medium text-primary underline">
                {item.incidentCount} incidents,{" "}
                {formatDuration(item.totalDurationMs!)} down
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

const MonitorDetailsPage = () => {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const { id } = useParams();
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";

  const [openNotificationSettings, setOpenNotificationSettings] =
    useState(false);
  const [open, setOpen] = useState(false);
  const [timeRange, setTimeRange] = useState("1h");

  const monitorId = id || "";

  const { data, isLoading } = useGetMonitorDetails(monitorId);
  const { data: monitorData, isLoading: isMonitorLoading } =
    useGetMonitorById(monitorId);
  const request = monitorData?.data?.monitorConfigurationType === 0;
  const interval = monitorData?.data?.intervalInSeconds || 0;
  const monitorSourceType = monitorData?.data?.monitorSourceTypes;
  const { data: rtData, isLoading: isRTLoading } = useGetMonitorDownTime({
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
    <div>
      <div className="mb-[18px] flex items-center justify-between md:mb-[24px]">
        <div className="flex items-center gap-1">
          <BackIconButton
            data-testid="back-button"
            icon={<ArrowLeft className="h-6 w-6" />}
            onClick={() => navigate(-1)}
            className="h-8 w-8"
          />
          <h1 className="text-lg font-semibold md:text-2xl break-all max-w-[40vw]">
            {monitorData?.data?.name}
          </h1>
        </div>
        {monitorSourceType !== 2 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpenNotificationSettings((open) => !open)}>
              <Settings className="mr-2 h-4 w-4" />
              Notification Settings
            </Button>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => setOpen((open) => !open)}>
              <Settings className="mr-2 h-4 w-4" />
              Configure
            </Button>
            <AlertAction
              monitorId={monitorId as string}
              isActive={monitorData?.data?.isActive ?? false}
              name={monitorData?.data?.name || ""}
              request={request}
              projectKey={projectKey}
              monitorSourceType={monitorSourceType}>
              <Button variant="outline" size="icon" aria-label="Actions">
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </AlertAction>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-5">
        <MonitorCard
          onOpenChange={setOpenNotificationSettings}
          repoName={monitorData?.data?.repoName}
          externalServiceName={monitorData?.data?.externalServiceName}
          url={monitorData?.data?.url || ""}
          request={request}
          emails={monitorData?.data?.emails || []}
          monitorSourceType={monitorData?.data?.monitorSourceTypes ?? 0}
        />
        <Card className="flex flex-col px-6 py-2">
          <CardHeader className="text-lg font-semibold">
            <MonitorSummary
              data={summaryData}
              status={monitorData?.data?.currentStatus ?? false}
              incident={
                monitorData?.data?.lastIncidentAt
                  ? new Date(monitorData?.data?.lastIncidentAt)
                  : new Date()
              }
              createdAt={monitorData?.data?.createdDate as string}
            />
          </CardHeader>
          <CardContent>
            <ResponseTime
              request={request}
              interval={intervalInSeconds || 30}
              timeout={timePeriod || 60}
              data={rtData?.data || []}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
              currentStatus={monitorData?.data?.currentStatus || false}
            />
            <Separator orientation="horizontal" className="mb-6" />
            <div className="flex flex-col gap-5">
              <div className="flex w-full justify-between">
                <span className="text-lg font-semibold">Latest incidents</span>
                {data?.monitorIncidents && data.monitorIncidents.length > 4 && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigate(scoped(`monitor/incidents/${monitorId}`))
                    }>
                    View all incidents
                  </Button>
                )}
              </div>
              <IncidentList
                data={data?.monitorIncidents || []}
                showLastStatus={request}
                isLoading={isLoading || isMonitorLoading || isRTLoading}
              />
            </div>
          </CardContent>

          <MonitorModal open={open} onOpenChange={setOpen} itemId={monitorId}>
            <EditSingleMonitorForm
              itemId={monitorId}
              onSuccess={() => setOpen(false)}
            />
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
        </Card>
      </div>
    </div>
  );
};

export default MonitorDetailsPage;
