"use client";

import { useSortQueryParams } from "@/components/common/filter-toolbar";
import { Button, Card, CardContent, CardHeader } from "@/components/core";
import IncidentList, {
  useAlertFilterQueryParams,
} from "@/components/module/incident/incident-list";
import { useGetAllIncidentList } from "@/hooks/use-alerts";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

const IncidentPage = () => {
  const navigate = useNavigate();
  const params = useParams();
  const monitorId = params.id as string;

  const { queryParams, setQueryParams } = useAlertFilterQueryParams();
  const { sortQueryParams, setSortQueryParams } = useSortQueryParams({
    initial: { property: "started_time", isDescending: true },
  });

  const { data, isLoading } = useGetAllIncidentList(
    monitorId,
    queryParams.page,
    queryParams.pageSize,
    sortQueryParams.property,
    sortQueryParams.isDescending,
  );
  const handlePageChange = (page: number) => {
    setQueryParams((params) => ({ ...params, page }));
  };

  return (
    <main>
      {/* <PageBreadcrumb breadcrumbIndex={2} /> */}
      <div className="hidden md:flex"></div>
      <div className="mb-[18px] md:mb-[20px]">
        <div className="flex items-center">
          {" "}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => navigate(-1)}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <span className="text-lg font-semibold md:text-2xl">Incidents</span>
        </div>
      </div>
      <Card className="h-full">
        <CardHeader></CardHeader>
        <CardContent>
          <IncidentList
            isLoading={isLoading}
            data={data?.data || []}
            pageSize={queryParams.pageSize}
            totalCount={data?.totalCount}
            pageNumber={queryParams.page}
            onPageChange={handlePageChange}
            sortQueryParams={sortQueryParams}
            onSortChange={setSortQueryParams}
          />
        </CardContent>
      </Card>
    </main>
  );
};
export default IncidentPage;
