"use client";

import { FilterControls, SortValue } from "@seliseblocks/app-kit/components";
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/core";
import { AlertsList } from "@/components/module/alert/alerts-list";
import { useAlertFilterQueryParams } from "@/components/module/alert/use-alert-filter-query-params";
import { AddSingleMonitorForm } from "@/components/module/monitor/form/add-monitor-form";
import { MonitorModal } from "@/components/module/monitor/modal/monitor-modal";
import { type MonitorTabKey, MONITOR_TABS } from "@/constants/monitor.constant";
import { useGetHealthMonitorList } from "@/hooks/use-alerts";
import { getRuntimeEnv } from "@seliseblocks/app-kit/lib";
import { PageHeader } from "@/components/common/page-header/page-header";
import { useProjectStore } from "@seliseblocks/app-kit/store";
import { BookOpen, Plus } from "lucide-react";
import { useMemo, useState } from "react";

const MonitorPage = () => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { queryParams, setQueryParams } = useAlertFilterQueryParams();
  const [open, setOpen] = useState(false);

  const monitorSourceType = useMemo(
    () => MONITOR_TABS[queryParams.tab as MonitorTabKey].monitorSourceType,
    [queryParams.tab],
  );

  const { data, isLoading, isError, refetch } = useGetHealthMonitorList({
    projectKey,
    monitorSourceType,
    pageNumber: queryParams.page,
    pageSize: queryParams.pageSize,
    sortProperty: queryParams.sortProperty,
    sortIsDescending: queryParams.isDescending,
  });

  const handleTabChange = (tab: string) => {
    setQueryParams((params) => ({
      ...params,
      page: 0,
      tab: tab as MonitorTabKey,
    }));
  };

  const handlePageChange = (page: number) => {
    setQueryParams((params) => ({ ...params, page }));
  };

  const handlePageSizeChange = (pageSize: number) => {
    setQueryParams((params) => ({ ...params, page: 0, pageSize }));
  };

  const handleSortChange = (params: SortValue) => {
    setQueryParams((prev) => ({
      ...prev,
      sortProperty: params.property,
      isDescending: params.isDescending,
    }));
  };

  return (
    <main>
      <PageHeader
        title="Monitor"
        description="Track uptime and health checks across your services."
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a
                href={getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") + "/swagger/index.html"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <BookOpen className="h-4 w-4" />
                API Docs
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="add-monitor-button"
              onClick={() => setOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Monitor
            </Button>
          </>
        }
      />

      <div className="mb-4 sm:mb-5">
        <Tabs value={queryParams.tab} onValueChange={handleTabChange}>
          <div className="text-base">
            {/* Mobile Select */}
            <div className="md:hidden">
              <Select value={queryParams.tab} onValueChange={handleTabChange}>
                <SelectTrigger className="w-32 rounded-sm bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-sm">
                  {Object.entries(MONITOR_TABS).map(([key, { label }]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Desktop Tabs */}
            <div className="hidden md:block">
              <TabsList>
                {Object.entries(MONITOR_TABS).map(([key, { label }]) => (
                  <TabsTrigger key={key} value={key}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </Tabs>
      </div>

      {/* Alert List Table */}
      <Card className="overflow-hidden p-0">
        <CardContent className="[&_[data-table-container]]:rounded-none [&_[data-table-container]]:shadow-none">
          {isError && (
            <div role="alert" className="px-5 py-4 text-sm text-destructive">
              Could not load monitors.{" "}
              <Button variant="outline" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          )}
          {!isError && (
            <AlertsList
              data={data?.data || []}
              isLoading={isLoading}
              sortQueryParams={{
                property: queryParams.sortProperty,
                isDescending: queryParams.isDescending,
              }}
              onSortChange={handleSortChange}
            />
          )}
        </CardContent>
        {/* Pagination */}
        {!isError && data?.totalCount !== undefined && (
          <div className="flex items-center border-t border-border/60 px-5 py-3 md:justify-end">
            <FilterControls.TablePagination
              pageIndex={queryParams.page}
              pageSize={queryParams.pageSize}
              pageSizeOptions={[5, 10, 20]}
              onPageSizeChange={handlePageSizeChange}
              onPageChange={handlePageChange}
              pageCount={Math.ceil(data.totalCount / queryParams.pageSize)}
            />
          </div>
        )}
      </Card>

      <MonitorModal open={open} onOpenChange={setOpen} itemId={null}>
        <AddSingleMonitorForm itemId={null} onSuccess={() => setOpen(false)} />
      </MonitorModal>
    </main>
  );
};

export default MonitorPage;
