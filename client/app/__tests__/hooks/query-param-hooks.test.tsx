import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import {
  useSortQueryParams,
  sortQueryParsers,
} from "@/components/common/filter-toolbar/sort-header/use-sort-query-params";
import {
  usePaginationQueryParams,
  paginationQueryParsers,
} from "@/components/common/filter-toolbar/table-pagination/use-pagination-query-params";
import { useAlertFilterQueryParams } from "@/components/module/alert/use-alert-filter-query-params";
import { useIncidentFilterQueryParams } from "@/components/module/incident/use-incident-query-filter-params";

const adapter =
  (search = "") =>
  ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );

describe("parser factories", () => {
  it("sortQueryParsers applies initial defaults", () => {
    const parsers = sortQueryParsers({ property: "name", isDescending: true });
    expect(parsers.sortProperty.defaultValue).toBe("name");
    expect(parsers.isDescending.defaultValue).toBe(true);
  });

  it("paginationQueryParsers applies initial defaults", () => {
    const parsers = paginationQueryParsers({ pageIndex: 3, pageSize: 25 });
    expect(parsers.page.defaultValue).toBe(3);
    expect(parsers.pageSize.defaultValue).toBe(25);
  });
});

describe("useSortQueryParams", () => {
  it("returns the default sort values", () => {
    const { result } = renderHook(
      () => useSortQueryParams({ initial: { property: "name", isDescending: false } }),
      { wrapper: adapter() },
    );
    expect(result.current.sortQueryParams).toEqual({
      property: "name",
      isDescending: false,
    });
  });

  it("reads sort values from the query string", () => {
    const { result } = renderHook(
      () => useSortQueryParams({ initial: { property: "name", isDescending: false } }),
      { wrapper: adapter("?sortProperty=status&isDescending=true") },
    );
    expect(result.current.sortQueryParams).toEqual({
      property: "status",
      isDescending: true,
    });
  });

  it("setSortQueryParams updates the values", async () => {
    const { result } = renderHook(
      () => useSortQueryParams({ initial: { property: "name", isDescending: false } }),
      { wrapper: adapter() },
    );
    await act(async () => {
      result.current.setSortQueryParams({ property: "url", isDescending: true });
    });
    expect(result.current.sortQueryParams.property).toBe("url");
    expect(result.current.sortQueryParams.isDescending).toBe(true);
  });

  it("reset restores defaults", async () => {
    const { result } = renderHook(
      () => useSortQueryParams({ initial: { property: "name", isDescending: false } }),
      { wrapper: adapter("?sortProperty=url&isDescending=true") },
    );
    await act(async () => {
      result.current.reset();
    });
    expect(result.current.sortQueryParams.property).toBe("name");
  });

  it("defaults the initial argument when omitted", () => {
    const { result } = renderHook(() => useSortQueryParams({}), {
      wrapper: adapter(),
    });
    expect(result.current.sortQueryParams).toEqual({
      property: "",
      isDescending: false,
    });
  });
});

describe("usePaginationQueryParams", () => {
  it("returns defaults and reads from the query string", () => {
    const def = renderHook(() => usePaginationQueryParams({}), {
      wrapper: adapter(),
    });
    expect(def.result.current.paginationQueryParams).toEqual({
      page: 0,
      pageSize: 10,
    });

    const fromQuery = renderHook(() => usePaginationQueryParams({}), {
      wrapper: adapter("?page=4&pageSize=50"),
    });
    expect(fromQuery.result.current.paginationQueryParams).toEqual({
      page: 4,
      pageSize: 50,
    });
  });

  it("setPaginationQueryParams updates page + size", async () => {
    const { result } = renderHook(() => usePaginationQueryParams({}), {
      wrapper: adapter(),
    });
    await act(async () => {
      result.current.setPaginationQueryParams({ pageIndex: 2, pageSize: 20 });
    });
    expect(result.current.paginationQueryParams).toEqual({
      page: 2,
      pageSize: 20,
    });
  });

  it("reset clears the pagination params", async () => {
    const { result } = renderHook(() => usePaginationQueryParams({}), {
      wrapper: adapter("?page=5&pageSize=100"),
    });
    await act(async () => {
      result.current.reset();
    });
    expect(result.current.paginationQueryParams.page).toBe(0);
  });
});

describe("useAlertFilterQueryParams", () => {
  it("merges defaults with provided initial values", () => {
    const { result } = renderHook(
      () => useAlertFilterQueryParams({ search: "seed" }),
      { wrapper: adapter() },
    );
    expect(result.current.queryParams.search).toBe("seed");
    expect(result.current.queryParams.tab).toBe("all");
    expect(result.current.queryParams.repositories).toEqual([]);
  });

  it("reads tab, search and repositories from the query string", () => {
    const { result } = renderHook(() => useAlertFilterQueryParams(), {
      wrapper: adapter("?tab=services&search=web&repositories=a,b"),
    });
    expect(result.current.queryParams.tab).toBe("services");
    expect(result.current.queryParams.search).toBe("web");
    expect(result.current.queryParams.repositories).toEqual(["a", "b"]);
  });
});

describe("useIncidentFilterQueryParams", () => {
  it("uses default status sort", () => {
    const { result } = renderHook(() => useIncidentFilterQueryParams(), {
      wrapper: adapter(),
    });
    expect(result.current.queryParams.sortProperty).toBe("status");
    expect(result.current.queryParams.search).toBe("");
  });

  it("reads search from the query string", () => {
    const { result } = renderHook(() => useIncidentFilterQueryParams(), {
      wrapper: adapter("?search=down"),
    });
    expect(result.current.queryParams.search).toBe("down");
  });
});
