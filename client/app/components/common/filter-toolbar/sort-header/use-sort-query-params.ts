import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import type { SortValue } from "./sort-header.types";
import { useCallback } from "react";

export const sortQueryParsers = (initialValues: SortValue) => ({
  sortProperty: parseAsString.withDefault(initialValues.property),
  isDescending: parseAsBoolean.withDefault(initialValues.isDescending),
});

export const useSortQueryParams = ({
  initial = { property: "", isDescending: false },
}: {
  initial?: SortValue;
}) => {
  const [queryParams, setQueryParams] = useQueryStates(
    sortQueryParsers(initial),
  );

  const setSortQueryParams = useCallback(
    (sort: SortValue) => {
      setQueryParams(() => ({
        isDescending: sort.isDescending,
        sortProperty: sort.property,
      }));
    },
    [setQueryParams],
  );

  const reset = useCallback(() => {
    setQueryParams(null);
  }, [setQueryParams]);

  const sortQueryParams = {
    property: queryParams["sortProperty"],
    isDescending: queryParams["isDescending"],
  };

  return {
    sortQueryParams,
    setSortQueryParams,
    reset,
  };
};
