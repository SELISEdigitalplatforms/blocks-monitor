"use client";

import { FilterControls, SortValue } from "@seliseblocks/genesis-os/components";
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
import { ExportReportDialog } from "@/components/module/monitor/export/export-report-dialog";
import { type MonitorTabKey, MONITOR_TABS } from "@/constants/monitor.constant";
import { useGetHealthMonitorList } from "@/hooks/use-alerts";
import { getRuntimeEnv } from "@seliseblocks/genesis-os/lib";
import { useProjectStore } from "@seliseblocks/genesis-os/store";
import { BookOpen, Download, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@seliseblocks/genesis-os/i18n";

const MonitorPage = () => {
  const { t } = useT("monitor.monitors");
  const tabLabels: Record<MonitorTabKey, string> = {
    all: t("MONITOR_PAGE.TAB_MY_MONITORS"),
    services: t("MONITOR_PAGE.TAB_BLOCKS_SERVICES"),
  };
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const { queryParams, setQueryParams } = useAlertFilterQueryParams();
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const monitorSourceType = useMemo(
    () => MONITOR_TABS[queryParams.tab as MonitorTabKey].monitorSourceType,
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
    <main className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold md:text-2xl">{t("MONITOR_PAGE.TITLE")}</h1>
          <p className="text-sm text-muted-foreground">{t("MONITOR_PAGE.DESCRIPTION")}</p>
        </div>
        <a
          href={getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") + "/swagger/index.html"}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" className="gap-2 items-center justify-center">
            <BookOpen className="h-3.5 w-3.5" />
            {t("MONITOR_PAGE.API_DOCS")}
          </Button>
        </a>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Tabs value={queryParams.tab} onValueChange={handleTabChange}>
          <div className="flex items-center justify-between rounded text-base">
            {/* Mobile Select */}
            <div className="md:hidden">
              <Select value={queryParams.tab} onValueChange={handleTabChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MONITOR_TABS) as MonitorTabKey[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {tabLabels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Desktop Tabs */}
            <div className="hidden md:block">
              <TabsList>
                {(Object.keys(MONITOR_TABS) as MonitorTabKey[]).map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {tabLabels[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            data-testid="export-report-button"
            aria-label={t("EXPORT_REPORT.BUTTON")}
            onClick={() => setExportOpen(true)}
            className="gap-1 items-center justify-center"
          >
            <Download size={16} />
            <span className="hidden sm:inline">{t("EXPORT_REPORT.BUTTON")}</span>
          </Button>
          <Button
            type="button"
            data-testid="add-monitor-button"
            onClick={() => setOpen(true)}
            className="gap-1 items-center justify-center"
          >
            <Plus size={16} />
            {t("MONITOR_PAGE.ADD_MONITOR")}
          </Button>
        </div>
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

      {/* Covers every monitor of the selected tab, not just the visible page. */}
      <ExportReportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        scope={{
          kind: "project",
          projectKey,
          monitorSourceType,
          name: tabLabels[queryParams.tab as MonitorTabKey],
        }}
      />

      <MonitorModal open={open} onOpenChange={setOpen} itemId={null}>
        <AddSingleMonitorForm itemId={null} onSuccess={() => setOpen(false)} />
      </MonitorModal>
    </main>
  );
};

export default MonitorPage;
