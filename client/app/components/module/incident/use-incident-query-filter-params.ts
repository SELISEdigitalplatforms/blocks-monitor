import {
  type PaginationValue,
  type SortValue,
  paginationQueryParsers,
  sortQueryParsers,
} from "@seliseblocks/genesis-os/components";
import { parseAsString, useQueryStates } from "nuqs";

export type IncidentFilter = {
  search: string;
} & PaginationValue &
  SortValue;

const defaultIncidentFilter: IncidentFilter = {
  search: "",
  pageIndex: 0,
  pageSize: 10,
  property: "status",
  isDescending: false,
};

export const useIncidentFilterQueryParams = (initialValues: Partial<IncidentFilter> = {}) => {
  const values: IncidentFilter = {
    ...defaultIncidentFilter,
    ...initialValues,
  };

  const [queryParams, setQueryParams] = useQueryStates({
    search: parseAsString.withDefault(values.search),
    ...paginationQueryParsers({
      pageIndex: values.pageIndex,
      pageSize: values.pageSize,
    }),
    ...sortQueryParsers({
      property: values.property,
      isDescending: values.isDescending,
    }),
  });

  return { queryParams, setQueryParams };
};
