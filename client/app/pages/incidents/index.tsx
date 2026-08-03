import type { SortValue } from "@seliseblocks/genesis-os/components";
import { Button, Card, CardContent } from "@/components/core";
import IncidentList from "@/components/module/incident/incident-list";
import { useIncidentFilterQueryParams } from "@/components/module/incident/use-incident-query-filter-params";
import { useGetAllIncidentList } from "@/hooks/use-alerts";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router";

const IncidentPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const monitorId = id || "";

  const { queryParams, setQueryParams } = useIncidentFilterQueryParams({
    property: "started_time",
    isDescending: true,
  });

  const { data, isLoading } = useGetAllIncidentList({
    monitorId,
    pageNumber: queryParams.page,
    pageSize: queryParams.pageSize,
    sortProperty: queryParams.sortProperty,
    sortIsDescending: queryParams.isDescending,
  });
  const handlePageChange = (page: number) => {
    setQueryParams((params) => ({ ...params, page }));
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
      <div className="hidden md:flex"></div>
      <div className="mb-[18px] md:mb-[20px]">
        <div className="flex items-center">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <span className="text-lg font-semibold md:text-2xl">Incidents</span>
        </div>
      </div>
      <Card className="h-full">
        <CardContent>
          <IncidentList
            isLoading={isLoading}
            data={data?.data || []}
            totalCount={data?.totalCount}
            pageSize={queryParams.pageSize}
            pageNumber={queryParams.page}
            onPageChange={handlePageChange}
            sortQueryParams={{
              property: queryParams.sortProperty,
              isDescending: queryParams.isDescending,
            }}
            onSortChange={handleSortChange}
          />
        </CardContent>
      </Card>
    </main>
  );
};
export default IncidentPage;
