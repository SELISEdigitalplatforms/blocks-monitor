import { FilterToolbar } from "@seliseblocks/blocks-kit/components";
import {
  type AlertFilter,
  useAlertFilterQueryParams,
} from "./use-alert-filter-query-params";

type AlertFilterToolBarProps = {
  repositories: { value: string; label: string }[];
};

export function AlertsFilterToolbar({ repositories }: AlertFilterToolBarProps) {
  const { queryParams, setQueryParams } = useAlertFilterQueryParams();

  const changeHandler = (key: string, value: unknown) => {
    setQueryParams((params) => ({
      ...params,
      [key]: value,
      page: 0,
    }));
  };
  const resetHandler = () => setQueryParams(null);

  return (
    <FilterToolbar<AlertFilter>
      filters={[
        { key: "search", type: "SearchInput", label: "" },
        {
          key: "repositories",
          type: "MultiSelect",
          label: "Repositories",
          props: { options: repositories },
        },
      ]}
      values={{
        tab: queryParams.tab,
        search: queryParams.search,
        repositories: queryParams.repositories,
        pageIndex: queryParams.page,
        pageSize: queryParams.pageSize,
        property: queryParams.sortProperty,
        isDescending: queryParams.isDescending,
      }}
      defaultValues={{
        tab: "all",
        search: "",
        repositories: [],
        pageIndex: 0,
        pageSize: 10,
        property: "name",
        isDescending: false,
      }}
      onChange={changeHandler}
      onReset={resetHandler}
    />
  );
}
