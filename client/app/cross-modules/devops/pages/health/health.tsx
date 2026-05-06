"use client";
import { Card, CardContent } from "@/components/ui-kits/card/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-kits/select/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui-kits/tabs/tabs";
import { useProjectStore } from "@/store/useProjectStore";
import { TabKey, TABS } from "@blocks-devops/constants/health.constant";
import { useGetHealthMonitorList } from "@blocks-devops/hooks/alerts";
import { AlertsList } from "@blocks-devops/pages/alert/alerts-list";
import { useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { useAlertFilterQueryParams } from "../alert/alerts-filter-toolbar";
import { Button } from "@/components/ui-kits/button/button";
import { Plus } from "lucide-react";
import AddSingleMonitor from "../../components/add-repo/add-monitor";

const validTabs: TabKey[] = ["all", "services", "deployed", "external"];

const Health = () => {
  const projectKey = useProjectStore()?.selectedProject?.tenantId || "";
  const [activeTab, setActiveTab] = useQueryState<TabKey>("tab", {
    defaultValue: "all",
    parse: (value: string) => {
      return validTabs.includes(value as TabKey) ? (value as TabKey) : "all";
    },
  });
  const [open, setOpen] = useState(false);

  const monitorSourceType = useMemo(
    () => TABS[activeTab].monitorSourceType,
    [activeTab],
  );
  const { queryParams, setQueryParams } = useAlertFilterQueryParams();

  const handlePageChange = (page: number) => {
    setQueryParams((params) => ({ ...params, page }));
  };

  const { data, isLoading } = useGetHealthMonitorList(
    projectKey,
    monitorSourceType,
    queryParams.page,
    queryParams.pageSize,
  );

  return (
    <main>
      <div className="mb-[18px] flex items-center justify-between md:mb-[24px]">
        <div className="flex items-center">
          <h1 className="text-lg font-semibold md:text-2xl">Health</h1>
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabKey)}>
          <div className="mb-5 mt-6 flex items-center justify-between rounded text-base">
            {/* Mobile Select */}
            <div className="md:hidden">
              <Select
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as TabKey)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TABS).map(([key, { label }]) => (
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
                {Object.entries(TABS).map(([key, { label }]) => (
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
          className="gap-1 items-center justify-center">
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
            pageNumber={queryParams.page}
            pageSize={queryParams.pageSize}
            onPageChange={handlePageChange}
            totalCount={data?.totalCount}
          />
        </CardContent>
      </Card>

      <AddSingleMonitor
        open={open}
        onOpenChange={setOpen}
        itemId={""}
        request={true}
        repoId={""}
        repoName={""}
      />
    </main>
  );
};

export default Health;
