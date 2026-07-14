import { parseAsInteger, useQueryStates } from "nuqs";
import { useCallback } from "react";
import type { PaginationValue } from "./pagination.types";

export const paginationQueryParsers = (initialValues: PaginationValue) => ({
  page: parseAsInteger.withDefault(initialValues.pageIndex),
  pageSize: parseAsInteger.withDefault(initialValues.pageSize),
});

export const usePaginationQueryParams = ({
  initial = { pageIndex: 0, pageSize: 10 },
}: {
  initial?: PaginationValue;
}) => {
  const [queryParams, setQueryParams] = useQueryStates(
    paginationQueryParsers(initial),
  );

  const setPaginationQueryParams = useCallback(
    (paginate: PaginationValue) => {
      setQueryParams(() => ({
        page: paginate.pageIndex,
        pageSize: paginate.pageSize,
      }));
    },
    [setQueryParams],
  );

  const reset = useCallback(() => {
    setQueryParams(null);
  }, [setQueryParams]);

  const paginationQueryParams = {
    page: queryParams["page"],
    pageSize: queryParams["pageSize"],
  };

  return {
    paginationQueryParams,
    setPaginationQueryParams,
    reset,
  };
};
