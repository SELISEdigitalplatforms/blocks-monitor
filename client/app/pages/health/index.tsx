"use client";

import { FilterControls, SortValue } from "@seliseblocks/blocks-kit/components";
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
import { type HealthTabKey, HEALTH_TABS } from "@/constants/health.constant";
import { useGetHealthMonitorList } from "@/hooks/use-alerts";
import { getRuntimeEnv } from "@seliseblocks/blocks-kit/lib";
import { useProjectStore } from "@seliseblocks/blocks-kit/store";
import { BookOpen, Plus } from "lucide-react";
import { useMemo, useState } from "react";

const HealthPage = () => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { queryParams, setQueryParams } = useAlertFilterQueryParams();
  const [open, setOpen] = useState(false);

  const monitorSourceType = useMemo(
    () => HEALTH_TABS[queryParams.tab as HealthTabKey].monitorSourceType,
    [queryParams.tab],
  );

  const { data, isLoading } = useGetHealthMonitorList({
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
      tab: tab as HealthTabKey,
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
    <main className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Monitor</h1>
        <a
          href={getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") + "/swagger/index.html"}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" className="gap-2 items-center justify-center">
            <BookOpen className="h-3.5 w-3.5" />
            API Docs
          </Button>
        </a>
      </div>

      <div className="flex items-baseline justify-between">
        <Tabs value={queryParams.tab} onValueChange={handleTabChange}>
          <div className="mb-5 mt-6 flex items-center justify-between rounded text-base">
            {/* Mobile Select */}
            <div className="md:hidden">
              <Select value={queryParams.tab} onValueChange={handleTabChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HEALTH_TABS).map(([key, { label }]) => (
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
                {Object.entries(HEALTH_TABS).map(([key, { label }]) => (
                  <TabsTrigger key={key} value={key}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </Tabs>

        <Button
          type="button"
          data-testid="add-monitor-button"
          onClick={() => setOpen(true)}
          className="gap-1 items-center justify-center"
        >
          <Plus size={16} />
          Add Monitor
        </Button>
      </div>

      {/* Alert List Table */}
      <Card>
        <CardContent>
          <AlertsList
            data={data?.data || []}
            isLoading={isLoading}
            sortQueryParams={{
              property: queryParams.sortProperty,
              isDescending: queryParams.isDescending,
            }}
            onSortChange={handleSortChange}
          />
        </CardContent>
        {/* Pagination */}
        {data?.totalCount !== undefined && (
          <div className="mt-5 flex items-center md:justify-end">
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

export default HealthPage;
