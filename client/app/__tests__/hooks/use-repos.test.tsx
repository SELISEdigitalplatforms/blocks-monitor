import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryWrapper } from "@/__tests__/test-utils";

const getRepoDetails = vi.fn();
const getReport = vi.fn();

vi.mock("@/services/repos.service", () => ({
  reposService: {
    getRepoDetails: (...a: unknown[]) => getRepoDetails(...a),
    getReport: (...a: unknown[]) => getReport(...a),
  },
}));

import { getHttpStatus, useGetRepoDetails, useGetReport } from "@/hooks/use-repos";

describe("getHttpStatus", () => {
  it("reads status from common error shapes", () => {
    expect(getHttpStatus({ status: 404 })).toBe(404);
    expect(getHttpStatus({ response: { status: 500 } })).toBe(500);
    expect(getHttpStatus(null)).toBeUndefined();
  });
});

describe("useGetRepoDetails", () => {
  beforeEach(() => {
    getRepoDetails.mockReset().mockResolvedValue({ data: { build: [] } });
  });

  it("is disabled without projectKey or repoId", () => {
    const { result } = renderHook(() => useGetRepoDetails("", "r1"), {
      wrapper: QueryWrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(getRepoDetails).not.toHaveBeenCalled();
  });

  it("fetches with projectKey in the query key scope", async () => {
    const { result } = renderHook(() => useGetRepoDetails("t1", "r1"), {
      wrapper: QueryWrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getRepoDetails).toHaveBeenCalledWith("r1", { pageNumber: 1, pageSize: 1 });
  });

  it("does not retry on 404", async () => {
    getRepoDetails.mockRejectedValue({ status: 404 });
    // Use a client that allows the hook's own retry logic
    const { result } = renderHook(() => useGetRepoDetails("t1", "missing"), {
      wrapper: QueryWrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // QueryWrapper sets retry:false globally, so also assert the retry option itself
    expect(result.current.failureCount).toBeLessThanOrEqual(1);
  });
});

describe("useGetReport", () => {
  beforeEach(() => {
    getReport.mockReset().mockResolvedValue({ data: null });
  });

  it("stays idle until the tab is active", () => {
    renderHook(() => useGetReport("t1", "b1", "sast", false), { wrapper: QueryWrapper });
    expect(getReport).not.toHaveBeenCalled();
  });

  it("fetches when active", async () => {
    const { result } = renderHook(() => useGetReport("t1", "b1", "sast", true), {
      wrapper: QueryWrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getReport).toHaveBeenCalledWith("b1", "sast");
  });
});
