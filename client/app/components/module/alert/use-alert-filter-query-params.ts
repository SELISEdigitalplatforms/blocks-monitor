import {
  type PaginationValue,
  type SortValue,
  paginationQueryParsers,
  sortQueryParsers,
} from "@seliseblocks/genesis-os/components";
import { type HealthTabKey, parseAsHealthTabKey } from "@/constants/health.constant";
import { useQueryStates, parseAsString, parseAsArrayOf } from "nuqs";

export type AlertFilter = {
  tab: HealthTabKey;
  search: string;
  repositories: string[];
} & PaginationValue &
  SortValue;

const defaultAlertFilter: AlertFilter = {
  tab: "all",
  search: "",
  repositories: [],
  pageIndex: 0,
  pageSize: 10,
  property: "name",
  isDescending: false,
};

export const useAlertFilterQueryParams = (initialValues: Partial<AlertFilter> = {}) => {
  const values: AlertFilter = {
    ...defaultAlertFilter,
    ...initialValues,
  };
  const [queryParams, setQueryParams] = useQueryStates({
    tab: parseAsHealthTabKey.withDefault(values.tab),
    search: parseAsString.withDefault(values.search),
    repositories: parseAsArrayOf(parseAsString).withDefault(values.repositories),
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
