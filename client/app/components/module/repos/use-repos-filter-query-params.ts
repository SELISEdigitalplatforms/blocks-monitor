import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";

/** The only sortable column today; kept in the URL under the app-kit sort key names. */
export const REPOS_SORT_PROPERTY = "lastDeploymentDate";

/**
 * Repos list state (search + sort) in the URL, so the list is linkable and survives reloads.
 * Key names match app-kit's `sortQueryParsers` (`sortProperty`, `isDescending`); the list is
 * not paginated (the endpoint returns every repo), so there is no page key.
 */
export const useReposFilterQueryParams = () => {
  const [queryParams, setQueryParams] = useQueryStates({
    search: parseAsString.withDefault(""),
    sortProperty: parseAsString.withDefault(REPOS_SORT_PROPERTY),
    isDescending: parseAsBoolean.withDefault(true),
  });

  return { queryParams, setQueryParams };
};
